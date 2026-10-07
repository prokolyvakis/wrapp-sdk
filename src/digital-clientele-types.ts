import type { RejectionSource, RequestOptions } from './types.js';

/**
 * The provider answered a correlation request. 'acknowledged' means it returned its notice;
 * the wording is not retained and is not interpreted. A rejection is equally uninterpreted:
 * "already exists" is provider text, not a finding that the correlation is in place.
 */
export type ClienteleCorrelationOutcome =
  | Readonly<{ kind: 'acknowledged' }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/**
 * Digital clientele operations. Only the two correlations are available; reading, creating,
 * updating and cancelling an entry are not. Each call is dispatched at most once and never
 * retried, and no follow-up request is made.
 */
export interface DigitalClienteleResource {
  /** Correlates an entry with an invoice by its registration mark. */
  correlateByMark(
    clienteleId: string,
    input: Readonly<{ correlate_mark: string }>,
    options?: RequestOptions,
  ): Promise<ClienteleCorrelationOutcome>;
  /** Correlates an entry with a fiscal device receipt by registry number and serial number. */
  correlateByFim(
    clienteleId: string,
    input: Readonly<{ correlate_fim_number: string; correlate_fim_aa: string }>,
    options?: RequestOptions,
  ): Promise<ClienteleCorrelationOutcome>;
}
