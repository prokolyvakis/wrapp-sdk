import { z } from 'zod';
import {
  createSchema,
  decode,
  decodeDraftPage,
  detailsSchema,
  draftCreateSchema,
  draftListSchema,
  draftSavedSchema,
  encodeJson,
  hasObservation,
  identifier,
  identity,
  input,
  invoiceOutcome,
  isDraftStatus,
  issueDraftSchema,
  listSchema,
  pageSchema,
  pdfSchema,
  pdfStatusSchema,
  referenceSchema,
  rejection,
} from '../codecs.js';
import {
  openOrderNotesInputSchema,
  openOrderNotesPageSchema,
  orderNoteCancellationInputSchema,
  orderNoteCancellationSchema,
} from '../catering-codecs.js';
import type {
  CancelCateringOrderNotesInput,
  CateringOrderNoteCancellationOutcome,
  OpenCateringOrderNotesPage,
} from '../catering-types.js';
import { WrappError } from '../errors.js';
import {
  cancellationSchema,
  externalIdAssignmentSchema,
  externalIdInputSchema,
  issuedCountSchema,
} from '../invoice-lifecycle-codecs.js';
import type {
  AcknowledgementOutcome,
  CancellationOutcome,
  ExternalIdAssignmentOutcome,
} from '../invoice-lifecycle-types.js';
import { acknowledgement, readValue, refused, rejected, requestSchema } from '../runtime.js';
import type { Report, Runtime } from '../runtime.js';
import { freeze } from '../values.js';
import type {
  CreateDraftInput,
  CreateInvoiceInput,
  CreateOutcome,
  DraftCreateOutcome,
  DraftInvoiceDetails,
  DraftInvoicePage,
  DraftIssueOutcome,
  IdentityEvidence,
  InvoiceDetails,
  InvoicePage,
  InvoiceReference,
  InvoiceStatusOutcome,
  IssueDraftInput,
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
  /**
   * Effectful GET, dispatched at most once. The returned URL is data, never fetched. `locale`
   * asks for the document in that language; without it nothing is sent and the provider uses
   * its default.
   */
  requestPdf(
    invoiceId: string,
    options?: RequestOptions & { readonly locale?: 'el' | 'en' },
  ): Promise<PdfOutcome>;
  /**
   * The thermal-printer counterpart of requestPdf, with the same outcomes and the same rules:
   * an effectful GET dispatched at most once, whose returned URL is data and is never fetched.
   */
  requestThermalPdf(invoiceId: string, options?: RequestOptions): Promise<PdfOutcome>;
  /** The tenant's number of issued invoices, as exact integer text. */
  issuedCount(options?: RequestOptions): Promise<Readonly<{ issuedCount: string }>>;
  /**
   * Cancels a delivery note. The provider offers this for delivery notes only; it is not a
   * way to reverse an ordinary invoice, and the provider decides eligibility. Dispatched at
   * most once; a failure after dispatch carries effect 'unknown' and is never retried.
   */
  cancelDeliveryNote(invoiceId: string, options?: RequestOptions): Promise<CancellationOutcome>;
  /**
   * Assigns an external reference to an invoice that has none. The provider never overwrites
   * a reference, so this is permanent. Dispatched at most once and never retried; a
   * rejection does not show whether the reference is free or held elsewhere.
   */
  setExternalId(
    invoiceId: string,
    input: Readonly<{ external_id: string }>,
    options?: RequestOptions,
  ): Promise<ExternalIdAssignmentOutcome>;
  /**
   * Asks the provider to mark an invoice as paid. An effectful GET, dispatched at most once.
   * The acknowledgement is the provider's answer, not independently verified settlement.
   */
  markAsPaid(invoiceId: string, options?: RequestOptions): Promise<AcknowledgementOutcome>;
  /**
   * One page of open catering order notes, as summaries. This is its own page shape, with up
   * to 20 records and no total count, not a page of full invoice records.
   */
  listOpenCateringOrderNotes(
    input?: Readonly<{ page?: number }>,
    options?: RequestOptions,
  ): Promise<OpenCateringOrderNotesPage>;
  /**
   * Cancels catering order notes. The provider does this by issuing a new invoice of type
   * 8.6, so this is a fiscal creation, dispatched at most once and never retried. The request
   * carries no external reference: after a failure whose effect is 'unknown', read the open
   * order notes before deciding anything, and never repeat the call blindly. Nothing follows
   * the dispatch: no table is closed and no replacement is issued.
   */
  cancelCateringOrderNotes(
    input: CancelCateringOrderNotesInput,
    options?: RequestOptions,
  ): Promise<CateringOrderNoteCancellationOutcome>;
  /**
   * Draft invoices: saved with the provider, not issued and not sent to the tax authority.
   * Each write is dispatched at most once and never retried, and nothing follows it: saving
   * does not issue, and issuing reads nothing back.
   */
  readonly drafts: Readonly<{
    /**
     * Saves an invoice as a draft. The request is validated as an ordinary create and the
     * draft flag is added by this method. After a failure whose effect is 'unknown', read
     * the status by the external reference before saving again.
     */
    create(invoice: CreateDraftInput, options?: RequestOptions): Promise<DraftCreateOutcome>;
    /**
     * Issues a draft, addressed by the provider's id or by its external reference. This is a
     * fiscal creation. After a failure whose effect is 'unknown', read the status before
     * deciding anything; the provider answers a second issue of the same draft with an HTTP
     * error.
     */
    issue(
      reference: InvoiceReference,
      input?: IssueDraftInput,
      options?: RequestOptions,
    ): Promise<DraftIssueOutcome>;
    /** One page of drafts, 1 by default. `invoices.list` returns issued invoices only. */
    list(
      filters?: Readonly<{ page?: number }>,
      options?: RequestOptions,
    ): Promise<DraftInvoicePage>;
    /** Lazy, finite iteration over drafts with the rules of `invoices.iterate`. */
    iterate(
      filters: Readonly<{ page?: number }>,
      options: RequestOptions & { readonly maxPages: number },
    ): AsyncIterable<DraftInvoiceDetails>;
    /**
     * Deletes a draft. The provider decides whether the invoice is an untransmitted draft.
     * Dispatched at most once. An acknowledgement does not show that the draft's external
     * reference can be used again.
     */
    delete(invoiceId: string, options?: RequestOptions): Promise<AcknowledgementOutcome>;
  }>;
}

// The common request options of a call that takes more than those: the rest never reaches
// the runtime, whose option check is strict.
function common(config: z.infer<typeof requestSchema>): RequestOptions {
  return {
    ...(config.signal === undefined ? {} : { signal: config.signal }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.diagnostics === undefined ? {} : { diagnostics: config.diagnostics }),
  };
}
// Both PDF requests answer with the same three envelopes: a rejection, a link to an existing
// artifact, or a status whose wording is not evidence of anything.
const iterationSchema = requestSchema.extend({ maxPages: z.number().int().min(1).max(10_000) });
interface Page<T> {
  readonly invoices: readonly T[];
  readonly total_count: number;
  readonly total_pages: number;
  readonly current_page: number;
}
function pdfOutcome(value: unknown, report: Report, operation: 'pdf' | 'thermalPdf'): PdfOutcome {
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
    if ('status' in value) throw new WrappError('PROTOCOL_ERROR', operation);
    return freeze({
      kind: 'available',
      downloadUrl: decode(pdfSchema, value, operation).download_url,
    });
  }
  decode(pdfStatusSchema, value, operation);
  return freeze({ kind: 'acknowledged', status: 'unknown' });
}

export function invoiceResource(runtime: Runtime): InvoiceResource {
  // One page of the listing route, for issued invoices or for drafts: the page checks are
  // the same, the query and the record model are the caller's.
  function fetchPage<T>(
    operation: 'list' | 'listDrafts',
    query: URLSearchParams,
    page: number,
    decodePage: (value: unknown) => Page<T>,
    options?: RequestOptions,
  ): Promise<Page<T>> {
    return runtime.run(
      operation,
      '/invoices/find_all_invoices?' + query.toString(),
      (v, report) => {
        const result = decodePage(readValue(v, report));
        // Providers report empty collections either as total_pages 0 or as one empty page.
        if (
          result.current_page !== page ||
          result.invoices.length > result.total_count ||
          (result.total_pages === 0 &&
            (result.total_count !== 0 || result.invoices.length !== 0)) ||
          (result.total_pages > 0 && page > result.total_pages) ||
          (result.total_pages > 0 && result.total_count > 0 && result.invoices.length === 0)
        ) {
          throw new WrappError('PROTOCOL_ERROR', operation);
        }
        return result;
      },
      options,
    );
  }
  async function* pages<T extends { readonly id: string }>(
    operation: 'list' | 'listDrafts',
    start: number,
    config: z.infer<typeof iterationSchema>,
    fetch: (page: number, request: RequestOptions) => Promise<Page<T>>,
  ): AsyncGenerator<T> {
    const seen = new Set<string>();
    const request = common(config);
    let page = start;
    for (let count = 0; count < config.maxPages; count++, page++) {
      const result = await fetch(page, request);
      const fingerprint = JSON.stringify(result.invoices.map((v) => v.id).sort());
      if (seen.has(fingerprint)) throw new WrappError('PROTOCOL_ERROR', operation);
      seen.add(fingerprint);
      for (const invoice of result.invoices) {
        if (config.signal?.aborted) throw new WrappError('ABORTED', operation);
        yield invoice;
      }
      if (page >= result.total_pages) return;
    }
    throw new WrappError('PAGINATION_LIMIT', operation);
  }
  async function list(filters: ListInvoicesInput, options?: RequestOptions): Promise<InvoicePage> {
    const data = input(listSchema, filters, 'list');
    const page = data.page ?? 1;
    const query = new URLSearchParams({
      page: String(page),
      ...(data.start_date === undefined ? {} : { start_date: data.start_date }),
      ...(data.end_date === undefined ? {} : { end_date: data.end_date }),
    });
    return fetchPage('list', query, page, (v) => decode(pageSchema, v, 'list'), options);
  }
  async function* iterate(
    filters: ListInvoicesInput,
    options: RequestOptions & { readonly maxPages: number },
  ): AsyncGenerator<InvoiceDetails> {
    const config = input(iterationSchema, options, 'list');
    const valid = input(listSchema, filters, 'list');
    yield* pages('list', valid.page ?? 1, config, (page, request) =>
      list(
        {
          page,
          ...(valid.start_date === undefined ? {} : { start_date: valid.start_date }),
          ...(valid.end_date === undefined ? {} : { end_date: valid.end_date }),
        },
        request,
      ),
    );
  }
  async function listDrafts(
    filters: Readonly<{ page?: number }>,
    options?: RequestOptions,
  ): Promise<DraftInvoicePage> {
    const page = input(draftListSchema, filters, 'listDrafts').page ?? 1;
    const query = new URLSearchParams({ status: 'draft', page: String(page) });
    return fetchPage('listDrafts', query, page, (v) => decodeDraftPage(v, 'listDrafts'), options);
  }
  async function* iterateDrafts(
    filters: Readonly<{ page?: number }>,
    options: RequestOptions & { readonly maxPages: number },
  ): AsyncGenerator<DraftInvoiceDetails> {
    const config = input(iterationSchema, options, 'listDrafts');
    const valid = input(draftListSchema, filters, 'listDrafts');
    yield* pages('listDrafts', valid.page ?? 1, config, (page, request) =>
      listDrafts({ page }, request),
    );
  }
  // Resource methods are async so validation failures reject rather than throw
  // synchronously out of a Promise-returning call.
  return {
    getStatus: async (ref: InvoiceReference, opts?: RequestOptions) => {
      const valid = input(referenceSchema, ref, 'status');
      return runtime.run(
        'status',
        '/invoices/' + encodeURIComponent(valid.value),
        (v, report): InvoiceStatusOutcome => {
          if (rejection(v) !== undefined) throw rejected('status', v, report);
          if (isDraftStatus(v, 'status')) return freeze({ kind: 'draft', identity: 'unavailable' });
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
    requestPdf: async (
      invoiceId: string,
      opts: RequestOptions & { readonly locale?: 'el' | 'en' } = {},
    ) => {
      const valid = input(identifier, invoiceId, 'pdf');
      const config = input(
        requestSchema.extend({ locale: z.enum(['el', 'en']).optional() }),
        opts,
        'pdf',
      );
      return runtime.run(
        'pdf',
        '/invoices/' +
          encodeURIComponent(valid) +
          '/generate_pdf' +
          (config.locale === undefined ? '' : '?locale=' + config.locale),
        (value, report) => pdfOutcome(value, report, 'pdf'),
        common(config),
      );
    },
    requestThermalPdf: async (invoiceId: string, opts?: RequestOptions) => {
      const valid = input(identifier, invoiceId, 'thermalPdf');
      return runtime.run(
        'thermalPdf',
        '/invoices/' + encodeURIComponent(valid) + '/generate_thermal_pdf',
        (value, report) => pdfOutcome(value, report, 'thermalPdf'),
        opts,
      );
    },
    issuedCount: (opts?: RequestOptions) =>
      runtime.run(
        'issuedCount',
        '/invoices/issued_count',
        (value, report) =>
          freeze({
            issuedCount: decode(issuedCountSchema, readValue(value, report), 'issuedCount')
              .issued_count,
          }),
        opts,
      ),
    cancelDeliveryNote: async (invoiceId: string, opts?: RequestOptions) => {
      const valid = input(identifier, invoiceId, 'cancelDeliveryNote');
      return runtime.run(
        'cancelDeliveryNote',
        '/invoices/' + encodeURIComponent(valid) + '/cancel',
        (value, report): CancellationOutcome => {
          const outcome = refused(value, report);
          if (outcome !== undefined) return outcome;
          // No status envelope is documented for this answer; one is refused, not ignored.
          if (value !== null && typeof value === 'object' && 'status' in value)
            throw new WrappError('PROTOCOL_ERROR', 'cancelDeliveryNote');
          const cancellation = decode(cancellationSchema, value, 'cancelDeliveryNote');
          if (cancellation.id !== valid)
            throw new WrappError('PROTOCOL_ERROR', 'cancelDeliveryNote');
          return freeze({ kind: 'observed', cancellation });
        },
        opts,
      );
    },
    setExternalId: async (
      invoiceId: string,
      assignment: Readonly<{ external_id: string }>,
      opts?: RequestOptions,
    ) => {
      const valid = input(identifier, invoiceId, 'setExternalId');
      const data = input(externalIdInputSchema, assignment, 'setExternalId');
      return runtime.run(
        'setExternalId',
        '/invoices/' + encodeURIComponent(valid) + '/set_external_id',
        (value, report): ExternalIdAssignmentOutcome => {
          // An error envelope that also echoes the reference cannot say whether the
          // assignment happened, so it is neither a rejection nor a success.
          if (
            value !== null &&
            typeof value === 'object' &&
            'external_id' in value &&
            ('errors' in value || 'error' in value)
          )
            throw new WrappError('PROTOCOL_ERROR', 'setExternalId');
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
          const answer = decode(externalIdAssignmentSchema, value, 'setExternalId');
          if (answer.id !== undefined && answer.id !== valid)
            throw new WrappError('PROTOCOL_ERROR', 'setExternalId');
          return freeze({
            kind: 'acknowledged',
            invoiceId: valid,
            externalId: answer.external_id,
            identity: identity(
              { kind: 'externalId', value: data.external_id },
              { id: valid, external_id: answer.external_id },
            ),
          });
        },
        opts,
        encodeJson(data),
      );
    },
    markAsPaid: async (invoiceId: string, opts?: RequestOptions) => {
      const valid = input(identifier, invoiceId, 'markAsPaid');
      return runtime.run(
        'markAsPaid',
        '/invoices/' + encodeURIComponent(valid) + '/mark_as_paid',
        (value, report) => acknowledgement(value, report, 'markAsPaid'),
        opts,
      );
    },
    listOpenCateringOrderNotes: async (
      filters: Readonly<{ page?: number }> = {},
      opts?: RequestOptions,
    ) => {
      const valid = input(openOrderNotesInputSchema, filters, 'openCateringOrderNotes');
      return runtime.run(
        'openCateringOrderNotes',
        '/invoices/list_open_catering_order_notes' +
          (valid.page === undefined ? '' : '?page=' + String(valid.page)),
        (v, report) =>
          decode(openOrderNotesPageSchema, readValue(v, report), 'openCateringOrderNotes'),
        opts,
      );
    },
    cancelCateringOrderNotes: async (
      cancellation: CancelCateringOrderNotesInput,
      opts?: RequestOptions,
    ) => {
      const data = input(
        orderNoteCancellationInputSchema,
        cancellation,
        'cancelCateringOrderNotes',
      );
      return runtime.run(
        'cancelCateringOrderNotes',
        '/invoices/cancel_catering_order_note',
        (value, report): CateringOrderNoteCancellationOutcome => {
          const outcome = refused(value, report);
          if (outcome !== undefined) return outcome;
          // The documented answer is the receipt alone. A pending or other status here is
          // not a documented answer of this operation and is not guessed at.
          if (value !== null && typeof value === 'object' && 'status' in value)
            throw new WrappError('PROTOCOL_ERROR', 'cancelCateringOrderNotes');
          return freeze({
            kind: 'observed',
            receipt: decode(orderNoteCancellationSchema, value, 'cancelCateringOrderNotes'),
          });
        },
        opts,
        encodeJson(data),
      );
    },
    drafts: Object.freeze({
      create: async (invoice: CreateDraftInput, opts?: RequestOptions) => {
        const data = input(draftCreateSchema, invoice, 'createDraft');
        return runtime.run(
          'createDraft',
          '/invoices',
          (value, report): DraftCreateOutcome => {
            const outcome = refused(value, report);
            if (outcome !== undefined) return outcome;
            // Only the exact status says a draft was saved; a pending or issued answer here
            // is another outcome and is never read as one.
            const draft = decode(draftSavedSchema, value, 'createDraft');
            if (hasObservation(value)) throw new WrappError('PROTOCOL_ERROR', 'createDraft');
            return freeze({ kind: 'saved', invoiceId: draft.invoice_id });
          },
          opts,
          encodeJson({ ...data, draft: true }),
        );
      },
      issue: async (
        reference: InvoiceReference,
        fields?: IssueDraftInput,
        opts?: RequestOptions,
      ) => {
        const valid = input(referenceSchema, reference, 'issueDraft');
        const data = input(issueDraftSchema.optional(), fields, 'issueDraft');
        // The provider was observed to issue on a request without a body, so none is sent
        // when there is nothing to say.
        const body =
          data !== undefined && Object.values(data).some((field) => field !== undefined)
            ? encodeJson(data)
            : undefined;
        return runtime.run(
          'issueDraft',
          '/invoices/' + encodeURIComponent(valid.value) + '/issue_draft',
          (value, report): DraftIssueOutcome =>
            refused(value, report) ?? invoiceOutcome(value, valid, 'issueDraft'),
          opts,
          body,
        );
      },
      list: (filters: Readonly<{ page?: number }> = {}, opts?: RequestOptions) =>
        listDrafts(filters, opts),
      iterate: (
        filters: Readonly<{ page?: number }>,
        opts: RequestOptions & { readonly maxPages: number },
      ) => iterateDrafts(filters, opts),
      delete: async (invoiceId: string, opts?: RequestOptions) => {
        const valid = input(identifier, invoiceId, 'deleteDraft');
        return runtime.run(
          'deleteDraft',
          '/invoices/' + encodeURIComponent(valid) + '/delete_draft',
          (value, report) => acknowledgement(value, report, 'deleteDraft'),
          opts,
        );
      },
    }),
  };
}
