import type { ProviderJson } from './provider-json.js';
import type { RejectionSource, RequestOptions } from './types.js';

/** A digital transport (delivery note movement) as the provider returns it. */
export interface DigitalTransport {
  readonly id: string;
  /** The provider's category text; the reference documents `shipping` and `receiving`. */
  readonly category: string;
  /**
   * The provider's status text, verbatim. The reference shows `pending`, `delivered`,
   * `rejected`, `COMPLETED` and `IN_TRANSIT` in different answers and defines no lifecycle
   * that relates them, so the SDK does not map, order or group them. A value not listed here
   * is returned as received and means nothing more than its text.
   */
  readonly status: string;
  /**
   * The four fields below are absent when the provider omits them and null when it reports
   * no value. Timestamps are the provider's text, verbatim, never reparsed.
   */
  readonly invoice_id?: string | null;
  readonly invoice_issued_at?: string | null;
  readonly invoice_code?: string | null;
  readonly last_status_update_at?: string | null;
  /**
   * The tax authority's answer as the provider stored it: opaque evidence. Absent when the
   * provider omits the field; an explicit JSON null is a node of kind 'null'.
   */
  readonly my_data_response?: ProviderJson;
}
/** One page of transports: up to 10 records. The provider reports no total count. */
export interface DigitalTransportPage {
  readonly digital_transports: readonly DigitalTransport[];
  readonly total_pages: number;
  readonly current_page: number;
}
/**
 * Result of a transport write. 'observed' carries the record the provider returned; read its
 * status as evidence of what the provider now holds, not as a verdict the SDK reached. A
 * rejection is the provider's decision about role, state or eligibility and is never
 * followed by another operation.
 */
export type DigitalTransportOutcome =
  | Readonly<{ kind: 'observed'; transport: DigitalTransport }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/** One leg of a transport. */
export interface TransportLegInput {
  readonly vehicle_number: string;
  /** One of 1 to 7, checked before any request. */
  readonly transport_type: number;
  readonly carrier_vat_number: string;
}
export interface CreateDigitalTransportInput extends TransportLegInput {
  /** The issued delivery-note invoice the transport is registered for. */
  readonly invoice_id: string;
}
export interface DeliveredPackaging {
  /** One of 1 to 6, checked before any request. */
  readonly packaging_type: number;
  /** A nonnegative integer. */
  readonly quantity: number;
  /** Optional for every type; the reference describes it for type 6. */
  readonly other_packaging_title?: string;
}
export interface ConfirmDeliveryInput {
  readonly outcome: 'FULL' | 'PARTIAL' | 'NONE';
  readonly delivered_packaging?: readonly DeliveredPackaging[];
}
export interface DigitalTransportResource {
  /** Without a category the provider lists the shipping transports. */
  list(
    input?: Readonly<{ category?: 'shipping' | 'receiving'; page?: number }>,
    options?: RequestOptions,
  ): Promise<DigitalTransportPage>;
  get(transportId: string, options?: RequestOptions): Promise<DigitalTransport>;
  /**
   * Registers a transport for an invoice. The provider requires an issued delivery note with
   * a registration mark and decides eligibility; nothing is checked beforehand. Dispatched at
   * most once: after a failure whose effect is 'unknown', list the transports before
   * registering again.
   */
  create(
    transport: CreateDigitalTransportInput,
    options?: RequestOptions,
  ): Promise<DigitalTransportOutcome>;
  /**
   * Asks the provider to fetch the status again and update its record. It changes provider
   * state, so it is dispatched at most once and is not a read.
   */
  refresh(transportId: string, options?: RequestOptions): Promise<DigitalTransportOutcome>;
  /** Rejects a received transport. The rejection is sent to the tax authority. */
  reject(
    transportId: string,
    input?: Readonly<{ reject_reason?: string }>,
    options?: RequestOptions,
  ): Promise<DigitalTransportOutcome>;
  /**
   * Confirms a delivery outcome. The provider does not accept it for a reverse delivery note
   * the caller issued; if it refuses, nothing else is attempted in its place.
   */
  confirmDelivery(
    transportId: string,
    input: ConfirmDeliveryInput,
    options?: RequestOptions,
  ): Promise<DigitalTransportOutcome>;
  /**
   * Completes a transport the caller issued on the return of undelivered goods. Only the
   * issuer may call it, and only in the states the provider documents; it decides.
   */
  confirmReturn(transportId: string, options?: RequestOptions): Promise<DigitalTransportOutcome>;
  /**
   * Declares a new leg of a transport the caller issued. The provider accepts it while the
   * transport is in transit, and decides.
   */
  transfer(
    transportId: string,
    leg: TransportLegInput,
    options?: RequestOptions,
  ): Promise<DigitalTransportOutcome>;
}
