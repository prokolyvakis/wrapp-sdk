import type { AcknowledgementOutcome } from './invoice-lifecycle-types.js';
import type { RejectionSource, RequestOptions } from './types.js';

/** A catering table as the list returns it. */
export interface CateringTableSummary {
  readonly id: string;
  /**
   * The provider's status text, kept verbatim. The reference documents `available`, `open`,
   * `closed` and `alert`; another value is returned as received, not refused.
   */
  readonly status: string;
  /** Kept as text, also when the provider sends a number. */
  readonly name: string;
  /** Exact numeric text as the provider sent it, for example '140.0'. */
  readonly total: string;
}
/** A catering table as a single read or a write returns it. */
export interface CateringTable extends CateringTableSummary {
  /**
   * Invoice ids. Absent when the provider omits the field; absent and empty are different
   * observations.
   */
  readonly invoices?: readonly string[];
  /** The provider's message about the table, as data. Null when it reports none. */
  readonly error_message?: string | null;
}
/**
 * Result of a table write. 'observed' carries the table the provider returned; its status is
 * the evidence of what happened, and no status is treated as a failure by the SDK.
 */
export type CateringTableOutcome =
  | Readonly<{ kind: 'observed'; table: CateringTable }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/** Which order notes to move from one table to another. */
export interface TransferCateringOrderNotesInput {
  readonly current_table: string;
  readonly target_table: string;
  /**
   * Registration marks of the order notes to move: 1 to 100. Omitted, the provider moves
   * every open order note of the current table. An empty list is refused.
   */
  readonly marks?: readonly string[];
}
/** At least one of the two. When both are given, both are sent and the provider decides. */
export type OpenCateringTableInput =
  Readonly<{ id: string; name?: string }> | Readonly<{ id?: string; name: string }>;
export interface CateringTableResource {
  /** Every table. The provider's status and name filters are not available yet. */
  list(options?: RequestOptions): Promise<readonly CateringTableSummary[]>;
  get(tableId: string, options?: RequestOptions): Promise<CateringTable>;
  /**
   * Creates a table with the given name. Dispatched at most once: after a failure whose
   * effect is 'unknown', list the tables before creating again.
   */
  create(
    table: Readonly<{ name: string }>,
    options?: RequestOptions,
  ): Promise<CateringTableOutcome>;
  /** Renames a table. Dispatched at most once. */
  update(
    tableId: string,
    patch: Readonly<{ name: string }>,
    options?: RequestOptions,
  ): Promise<CateringTableOutcome>;
  /** Opens a table by id, by name, or both. Dispatched at most once. */
  open(table: OpenCateringTableInput, options?: RequestOptions): Promise<CateringTableOutcome>;
  /** Closes a table. Dispatched at most once; no invoice is issued or cancelled by the SDK. */
  close(tableId: string, options?: RequestOptions): Promise<CateringTableOutcome>;
  /**
   * Moves order notes from one table to another. A GET that changes provider state: it is
   * dispatched at most once and never retried, and a failure after dispatch has effect
   * 'unknown'. 'observed' carries the table the provider returned, which can be either of
   * the two; read both tables to see where the notes are.
   */
  transfer(
    input: TransferCateringOrderNotesInput,
    options?: RequestOptions,
  ): Promise<CateringTableOutcome>;
  /** Deletes a table; the provider documents this for an available table. Dispatched at most once. */
  delete(tableId: string, options?: RequestOptions): Promise<AcknowledgementOutcome>;
}

/** An open catering order note: a summary, not the full invoice record. */
export interface OpenCateringOrderNote {
  readonly id: string;
  readonly my_data_mark: string | null;
  /** The provider's timestamp text, verbatim; never reparsed or converted between zones. */
  readonly issued_at: string;
  readonly catering_table_id: string | null;
}
/** One page of open order notes: up to 20 records. The provider reports no total count. */
export interface OpenCateringOrderNotesPage {
  readonly invoices: readonly OpenCateringOrderNote[];
  readonly total_pages: number;
  readonly current_page: number;
}
export interface CancelCateringOrderNotesInput {
  /** The billing book of the cancelling invoice, which the provider issues as type 8.6. */
  readonly billing_book_id: string;
  /** Registration marks of the order notes to cancel: 1 to 100. */
  readonly correlated_invoices: readonly string[];
  /** Optional: without it the provider resolves the table from the marks. */
  readonly catering_table_id?: string;
}
/**
 * What the provider returns for the cancelling invoice. It is not an invoice observation: the
 * answer documents no issue date and no external reference, so none is carried. A null mark
 * means the provider returned the record without a registration mark.
 */
export interface CateringOrderNoteCancellation {
  readonly id: string;
  readonly my_data_mark: string | null;
  readonly my_data_uid: string | null;
  readonly my_data_qr_url: string | null;
  readonly series: string;
  readonly num: string;
  readonly wrapp_invoice_url: string;
  readonly wrapp_invoice_url_en: string;
}
export type CateringOrderNoteCancellationOutcome =
  | Readonly<{ kind: 'observed'; receipt: CateringOrderNoteCancellation }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
