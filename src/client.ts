import { z } from 'zod';
import { Session } from './auth.js';
import {
  booksSchema,
  branchesSchema,
  createSchema,
  decode,
  detailsSchema,
  encodeJson,
  exemptionsSchema,
  identifier,
  identity,
  input,
  listSchema,
  observationSchema,
  pageSchema,
  pdfSchema,
  pdfStatusSchema,
  pendingSchema,
  referenceSchema,
  rejection,
  tenantSchema,
  vatInputSchema,
  vatSchema,
} from './codecs.js';
import { WrappError } from './errors.js';
import { operations, assertActive, scope, Transport } from './transport.js';
import type { Operation } from './transport.js';
import { freeze } from './values.js';
import type {
  BillingBook,
  Branch,
  ClientOptions,
  CreateInvoiceInput,
  CreateOutcome,
  IdentityEvidence,
  InvoiceDetails,
  InvoiceObservation,
  InvoicePage,
  InvoiceReference,
  ListInvoicesInput,
  PdfOutcome,
  RequestOptions,
  TenantDetails,
  VatDetails,
} from './types.js';

const limit = z.number().int().min(1).max(120_000);
const optionsSchema = z.strictObject({
  environment: z.enum(['staging', 'production']),
  credentials: z.strictObject({
    apiKey: z.string().min(1).max(16_384),
    tenant: z.strictObject({
      kind: z.enum(['email', 'userId']),
      value: z.string().min(1).max(320),
    }),
  }),
  timeoutMs: limit.optional(),
  maxResponseBytes: z.number().int().min(1).max(8_388_608).optional(),
  maxRequestBytes: z.number().int().min(1).max(8_388_608).optional(),
  advanced: z
    .strictObject({
      testBaseUrl: z.string().optional(),
      fetch: z.custom<typeof globalThis.fetch>((v) => typeof v === 'function').optional(),
      now: z.custom<() => number>((v) => typeof v === 'function').optional(),
    })
    .optional(),
});
const requestSchema = z.strictObject({
  timeoutMs: limit.optional(),
  signal: z.instanceof(AbortSignal).optional(),
});
function readValue(value: unknown): unknown {
  if (rejection(value) !== undefined) throw new WrappError('PROVIDER_REJECTED', 'decode');
  if (value !== null && typeof value === 'object' && 'status' in value)
    throw new WrappError('PROTOCOL_ERROR', 'decode');
  return value;
}
/** Invoice operations. Reference-addressed reads report identity evidence; writes preserve ambiguity. */
export interface InvoiceResource {
  /** Status lookup with identity evidence; a not-found never proves a reference is free. */
  getStatus(
    reference: InvoiceReference,
    options?: RequestOptions,
  ): Promise<
    Readonly<{
      invoice: InvoiceObservation;
      identity: IdentityEvidence;
    }>
  >;
  /** Validated core projection, not a complete fiscal archive. */
  get(
    reference: InvoiceReference,
    options?: RequestOptions,
  ): Promise<
    Readonly<{
      invoice: InvoiceDetails;
      identity: IdentityEvidence;
    }>
  >;
  list(filters?: ListInvoicesInput, options?: RequestOptions): Promise<InvoicePage>;
  /**
   * Lazy, cancellable page walk with no prefetch and no silent deduplication.
   * maxPages accepts 1 to 10 000.
   * @throws WrappError PAGINATION_LIMIT when maxPages is exhausted, instead of truncating.
   */
  iterate(
    filters: ListInvoicesInput,
    options: RequestOptions & { readonly maxPages: number },
  ): AsyncIterable<InvoiceDetails>;
  /**
   * Dispatches the invoice at most once and reports what was observed; see CreateOutcome.
   * Failures after dispatch carry effect 'unknown' and are never retried or replayed.
   */
  create(invoice: CreateInvoiceInput, options?: RequestOptions): Promise<CreateOutcome>;
  /** Effectful GET, dispatched at most once. The returned URL is data, never fetched. */
  requestPdf(invoiceId: string, options?: RequestOptions): Promise<PdfOutcome>;
}

/**
 * Tenant/environment-isolated client. No requests occur during construction; login happens
 * lazily, coalesced across concurrent calls. The instance and its resources are frozen.
 */
export class WrappClient {
  readonly tenant: Readonly<{ get(options?: RequestOptions): Promise<TenantDetails> }>;
  readonly branches: Readonly<{ list(options?: RequestOptions): Promise<readonly Branch[]> }>;
  readonly billingBooks: Readonly<{
    list(options?: RequestOptions): Promise<readonly BillingBook[]>;
  }>;
  readonly vat: Readonly<{
    search(
      query: Readonly<{ vat: string; country_code: string }>,
      options?: RequestOptions,
    ): Promise<VatDetails>;
    exemptions(options?: RequestOptions): Promise<readonly Readonly<Record<string, string>>[]>;
  }>;
  readonly invoices: Readonly<InvoiceResource>;
  #transport: Transport;
  #session: Session;
  #timeout: number;
  #maxRequestBytes: number;

  constructor(options: ClientOptions) {
    const config = input(optionsSchema, options, 'configure');
    let origin =
      config.environment === 'staging'
        ? 'https://staging.wrapp.ai/api/v1'
        : 'https://wrapp.ai/api/v1';
    if (config.advanced?.testBaseUrl !== undefined) {
      try {
        const url = new URL(config.advanced.testBaseUrl);
        // The canonical comparison also rejects bare '?'/'#' separators, which leave
        // url.search/url.hash empty yet survive serialization and misroute every path.
        if (
          url.protocol !== 'http:' ||
          !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
          url.pathname !== '/api/v1' ||
          url.toString() !== url.origin + '/api/v1'
        )
          throw new Error();
        origin = url.toString();
      } catch {
        throw new WrappError('INVALID_INPUT', 'configure');
      }
    }
    this.#timeout = config.timeoutMs ?? 30_000;
    this.#maxRequestBytes = config.maxRequestBytes ?? 2_097_152;
    this.#transport = new Transport(
      origin,
      config.advanced?.fetch ?? globalThis.fetch,
      config.maxResponseBytes ?? 2_097_152,
    );
    this.#session = new Session(
      this.#transport,
      config.credentials.apiKey,
      config.credentials.tenant,
      this.#timeout,
      config.advanced?.now ?? (() => performance.now()),
    );
    this.tenant = Object.freeze({
      get: (opts?: RequestOptions) =>
        this.#run(
          'tenant',
          '/tenant_details',
          (v) => decode(tenantSchema, readValue(v), 'tenant'),
          opts,
        ),
    });
    this.branches = Object.freeze({
      list: (opts?: RequestOptions) =>
        this.#run(
          'branches',
          '/branches',
          (v) => decode(branchesSchema, readValue(v), 'branches'),
          opts,
        ),
    });
    this.billingBooks = Object.freeze({
      list: (opts?: RequestOptions) =>
        this.#run(
          'billingBooks',
          '/billing_books',
          (v) => decode(booksSchema, readValue(v), 'billingBooks'),
          opts,
        ),
    });
    this.vat = Object.freeze({
      search: async (
        query: Readonly<{ vat: string; country_code: string }>,
        opts?: RequestOptions,
      ) => {
        const data = input(vatInputSchema, query, 'vat');
        return this.#run(
          'vat',
          '/vat_search?' + new URLSearchParams(data).toString(),
          (v) => decode(vatSchema, readValue(v), 'vat'),
          opts,
        );
      },
      exemptions: (opts?: RequestOptions) =>
        this.#run(
          'exemptions',
          '/vat_exemptions',
          (v) => decode(exemptionsSchema, readValue(v), 'exemptions'),
          opts,
        ),
    });
    // Resource methods are async so validation failures reject rather than throw
    // synchronously out of a Promise-returning call.
    this.invoices = Object.freeze({
      getStatus: async (ref: InvoiceReference, opts?: RequestOptions) => {
        const valid = input(referenceSchema, ref, 'status');
        return this.#run(
          'status',
          '/invoices/' + encodeURIComponent(valid.value),
          (v) => {
            const invoice = decode(observationSchema, readValue(v), 'status');
            return freeze({ invoice, identity: identity(valid, invoice) });
          },
          opts,
        );
      },
      get: async (ref: InvoiceReference, opts?: RequestOptions) => {
        const valid = input(referenceSchema, ref, 'details');
        return this.#run(
          'details',
          '/invoices/' + encodeURIComponent(valid.value) + '/find_invoice_by_id',
          (v) => {
            const invoice = decode(detailsSchema, readValue(v), 'details');
            return freeze({ invoice, identity: identity(valid, invoice) });
          },
          opts,
        );
      },
      list: (filters: ListInvoicesInput = {}, opts?: RequestOptions) => this.#list(filters, opts),
      iterate: (filters: ListInvoicesInput, opts: RequestOptions & { readonly maxPages: number }) =>
        this.#iterate(filters, opts),
      create: async (invoice: CreateInvoiceInput, opts?: RequestOptions) => {
        const data = input(createSchema, invoice, 'create');
        const body = encodeJson(data);
        if (Buffer.byteLength(body) > this.#maxRequestBytes)
          throw new WrappError('INVALID_INPUT', 'create');
        return this.#run(
          'create',
          '/invoices',
          (value): CreateOutcome => {
            const rejected = rejection(value);
            if (rejected !== undefined)
              return freeze({
                kind: 'rejected',
                errorCount: rejected.errorCount,
                rejectionSource: rejected.source,
                referenceState: 'unknown',
              });
            if (value !== null && typeof value === 'object' && 'status' in value) {
              if ('id' in value) throw new WrappError('PROTOCOL_ERROR', 'create');
              const pending = decode(pendingSchema, value, 'create');
              return freeze({
                kind: 'pending',
                invoiceId: pending.invoice_id,
                referenceState: 'unknown',
              });
            }
            const observed = decode(observationSchema, value, 'create');
            return freeze({
              kind: 'observed',
              invoice: observed,
              identity: identity({ kind: 'externalId', value: data.external_id }, observed),
            });
          },
          opts,
          body,
        );
      },
      requestPdf: async (invoiceId: string, opts?: RequestOptions) => {
        const valid = input(identifier, invoiceId, 'pdf');
        return this.#run(
          'pdf',
          '/invoices/' + encodeURIComponent(valid) + '/generate_pdf',
          (value): PdfOutcome => {
            const rejected = rejection(value);
            if (rejected !== undefined)
              return freeze({
                kind: 'rejected',
                errorCount: rejected.errorCount,
                rejectionSource: rejected.source,
              });
            if (value !== null && typeof value === 'object' && 'download_url' in value) {
              if ('status' in value) throw new WrappError('PROTOCOL_ERROR', 'pdf');
              return freeze({
                kind: 'available',
                downloadUrl: decode(pdfSchema, value, 'pdf').download_url,
              });
            }
            decode(pdfStatusSchema, value, 'pdf');
            return freeze({ kind: 'acknowledged', status: 'unknown' });
          },
          opts,
        );
      },
    });
    Object.freeze(this);
  }
  async #run<T>(
    operation: Operation,
    path: string,
    decoder: (v: unknown) => T,
    options: RequestOptions = {},
    body?: string,
  ): Promise<T> {
    const config = input(requestSchema, options, operation);
    const deadline = scope(config.timeoutMs ?? this.#timeout, config.signal);
    let dispatched = false;
    let token: string | undefined;
    try {
      assertActive(deadline.signal, operation, 'not-sent');
      token = await this.#session.get(deadline.signal);
      assertActive(deadline.signal, operation, 'not-sent');
      dispatched = true;
      return decoder(await this.#transport.send(operation, path, deadline.signal, token, body));
    } catch (error) {
      if (error instanceof WrappError) {
        if (error.code === 'AUTH_ERROR' && token !== undefined) this.#session.invalidate(token);
        throw new WrappError(
          error.code,
          operation,
          dispatched && operations[operation].effectful ? 'unknown' : 'not-sent',
          error.httpStatus,
        );
      }
      throw new WrappError(
        'PROTOCOL_ERROR',
        operation,
        dispatched && operations[operation].effectful ? 'unknown' : 'not-sent',
      );
    } finally {
      deadline.dispose();
    }
  }
  async #list(filters: ListInvoicesInput, options?: RequestOptions): Promise<InvoicePage> {
    const data = input(listSchema, filters, 'list');
    const page = data.page ?? 1;
    const query = new URLSearchParams({
      page: String(page),
      ...(data.start_date === undefined ? {} : { start_date: data.start_date }),
      ...(data.end_date === undefined ? {} : { end_date: data.end_date }),
    });
    return this.#run(
      'list',
      '/invoices/find_all_invoices?' + query.toString(),
      (v) => {
        const result = decode(pageSchema, readValue(v), 'list');
        // Providers report empty collections either as total_pages 0 or as one empty page.
        if (
          result.current_page !== page ||
          result.invoices.length > result.total_count ||
          (result.total_pages === 0 &&
            (result.total_count !== 0 || result.invoices.length !== 0)) ||
          (result.total_pages > 0 && page > result.total_pages) ||
          (result.total_pages > 0 && result.total_count > 0 && result.invoices.length === 0)
        ) {
          throw new WrappError('PROTOCOL_ERROR', 'list');
        }
        return result;
      },
      options,
    );
  }
  async *#iterate(
    filters: ListInvoicesInput,
    options: RequestOptions & { readonly maxPages: number },
  ): AsyncGenerator<InvoiceDetails> {
    const config = input(
      requestSchema.extend({ maxPages: z.number().int().min(1).max(10_000) }),
      options,
      'list',
    );
    const valid = input(listSchema, filters, 'list');
    const seen = new Set<string>();
    let page = valid.page ?? 1;
    const request: RequestOptions = {
      ...(config.signal === undefined ? {} : { signal: config.signal }),
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    };
    for (let count = 0; count < config.maxPages; count++, page++) {
      const result = await this.#list(
        {
          page,
          ...(valid.start_date === undefined ? {} : { start_date: valid.start_date }),
          ...(valid.end_date === undefined ? {} : { end_date: valid.end_date }),
        },
        request,
      );
      const fingerprint = JSON.stringify(result.invoices.map((v) => v.id).sort());
      if (seen.has(fingerprint)) throw new WrappError('PROTOCOL_ERROR', 'list');
      seen.add(fingerprint);
      for (const invoice of result.invoices) {
        if (config.signal?.aborted) throw new WrappError('ABORTED', 'list');
        yield invoice;
      }
      if (page >= result.total_pages) return;
    }
    throw new WrappError('PAGINATION_LIMIT', 'list');
  }
}
