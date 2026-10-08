import type { IdentityEvidence, RejectionSource } from './types.js';

/**
 * What the provider returns when a delivery note is cancelled. It is not a full invoice
 * observation: the response documents no issue date, external reference or transmission
 * state, so none is carried.
 */
export interface CancellationObservation {
  readonly id: string;
  readonly my_data_mark: string | null;
  readonly my_data_uid: string | null;
  readonly my_data_qr_url: string | null;
  readonly series: string;
  readonly num: string;
  /** The cancellation's own mark. Null means the provider returned the record without one. */
  readonly cancelled_by_mark: string | null;
  readonly wrapp_invoice_url: string;
  readonly wrapp_invoice_url_en: string;
}
/**
 * Result of cancelling a delivery note. 'observed' carries what the provider returned for the
 * requested invoice; read cancelled_by_mark before concluding anything. A rejection says the
 * provider refused, never why in a form the SDK interprets.
 */
export type CancellationOutcome =
  | Readonly<{ kind: 'observed'; cancellation: CancellationObservation }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/**
 * The provider answered a management request with a status or message text. The text is not
 * retained
 * and is not evidence of the effect: an acknowledged mark-as-paid is not verified settlement,
 * and an acknowledged draft deletion does not show that its external reference can be reused.
 */
export type AcknowledgementOutcome =
  | Readonly<{ kind: 'acknowledged' }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/**
 * Result of assigning an external reference to an invoice that has none. 'acknowledged'
 * means the provider echoed the reference; identity says whether the echo is byte-exact or
 * differs in ASCII case only. A rejection leaves the reference state unknown: an "already
 * used" answer does not show which invoice holds the reference, and nothing is retried.
 */
export type ExternalIdAssignmentOutcome =
  | Readonly<{
      kind: 'acknowledged';
      invoiceId: string;
      externalId: string;
      identity: IdentityEvidence;
    }>
  | Readonly<{
      kind: 'rejected';
      errorCount: number;
      rejectionSource: RejectionSource;
      referenceState: 'unknown';
    }>;
