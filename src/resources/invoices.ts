import { z } from 'zod';
import {
  createSchema,
  decode,
  detailsSchema,
  encodeJson,
  identifier,
  identity,
  input,
  invoiceOutcome,
  listSchema,
  pageSchema,
  pdfSchema,
  pdfStatusSchema,
  referenceSchema,
  rejection,
} from '../codecs.js';
import { WrappError } from '../errors.js';
import { readValue, rejected, requestSchema } from '../runtime.js';
import type { Runtime } from '../runtime.js';
import { freeze } from '../values.js';
import type {
  CreateInvoiceInput,
  CreateOutcome,
  IdentityEvidence,
  InvoiceDetails,
  InvoicePage,
  InvoiceReference,
  InvoiceStatusOutcome,
  ListInvoicesInput,
  PdfOutcome,
  RequestOptions,
} from '../types.js';

/** Invoice operations. Reference-addressed reads report identity evidence; writes preserve ambiguity. */
export interface InvoiceResource {
  /**
   * Status lookup with identity evidence: an observed invoice or a pending one. A not-found
   * never proves a reference is free, and a pending status is never an issued invoice.
   */
  getStatus(reference: InvoiceReference, options?: RequestOptions): Promise<InvoiceStatusOutcome>;
  /** Validated projection, not a complete fiscal archive. */
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

export function invoiceResource(runtime: Runtime): InvoiceResource {
  async function list(filters: ListInvoicesInput, options?: RequestOptions): Promise<InvoicePage> {
    const data = input(listSchema, filters, 'list');
    const page = data.page ?? 1;
    const query = new URLSearchParams({
      page: String(page),
      ...(data.start_date === undefined ? {} : { start_date: data.start_date }),
      ...(data.end_date === undefined ? {} : { end_date: data.end_date }),
    });
    return runtime.run(
      'list',
      '/invoices/find_all_invoices?' + query.toString(),
      (v, report) => {
        const result = decode(pageSchema, readValue(v, report), 'list');
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
  async function* iterate(
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
      ...(config.diagnostics === undefined ? {} : { diagnostics: config.diagnostics }),
    };
    for (let count = 0; count < config.maxPages; count++, page++) {
      const result = await list(
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
  // Resource methods are async so validation failures reject rather than throw
  // synchronously out of a Promise-returning call.
  return {
    getStatus: async (ref: InvoiceReference, opts?: RequestOptions) => {
      const valid = input(referenceSchema, ref, 'status');
      return runtime.run(
        'status',
        '/invoices/' + encodeURIComponent(valid.value),
        (v, report) => {
          if (rejection(v) !== undefined) throw rejected('status', v, report);
          return invoiceOutcome(v, valid, 'status');
        },
        opts,
      );
    },
    get: async (ref: InvoiceReference, opts?: RequestOptions) => {
      const valid = input(referenceSchema, ref, 'details');
      return runtime.run(
        'details',
        '/invoices/' + encodeURIComponent(valid.value) + '/find_invoice_by_id',
        (v, report) => {
          const invoice = decode(detailsSchema, readValue(v, report), 'details');
          return freeze({ invoice, identity: identity(valid, invoice) });
        },
        opts,
      );
    },
    list: (filters: ListInvoicesInput = {}, opts?: RequestOptions) => list(filters, opts),
    iterate: (filters: ListInvoicesInput, opts: RequestOptions & { readonly maxPages: number }) =>
      iterate(filters, opts),
    create: async (invoice: CreateInvoiceInput, opts?: RequestOptions) => {
      const data = input(createSchema, invoice, 'create');
      return runtime.run(
        'create',
        '/invoices',
        (value, report): CreateOutcome => {
          const refusal = rejection(value);
          if (refusal !== undefined) {
            const outcome = freeze({
              kind: 'rejected',
              errorCount: refusal.errorCount,
              rejectionSource: refusal.source,
              referenceState: 'unknown',
            } as const);
            report(outcome, value);
            return outcome;
          }
          return invoiceOutcome(value, { kind: 'externalId', value: data.external_id }, 'create');
        },
        opts,
        encodeJson(data),
      );
    },
    requestPdf: async (invoiceId: string, opts?: RequestOptions) => {
      const valid = input(identifier, invoiceId, 'pdf');
      return runtime.run(
        'pdf',
        '/invoices/' + encodeURIComponent(valid) + '/generate_pdf',
        (value, report): PdfOutcome => {
          const refusal = rejection(value);
          if (refusal !== undefined) {
            const outcome = freeze({
              kind: 'rejected',
              errorCount: refusal.errorCount,
              rejectionSource: refusal.source,
            } as const);
            report(outcome, value);
            return outcome;
          }
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
  };
}
