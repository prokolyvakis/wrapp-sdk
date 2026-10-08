import type { RejectionSource, RequestOptions } from './types.js';
import type { CalendarDate, Decimal } from './values.js';

/**
 * The provider answered a correlation request. 'acknowledged' means it returned its notice;
 * the wording is not retained and is not interpreted. A rejection is equally uninterpreted:
 * "already exists" is provider text, not a finding that the correlation is in place.
 */
export type ClienteleCorrelationOutcome =
  | Readonly<{ kind: 'acknowledged' }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/**
 * A digital clientele entry as the provider returns it. Every field but the first three is
 * absent when the provider omits it and null when it has no value; a flag is a boolean and is
 * never derived from text. Codes, dates and timestamps are the provider's text, verbatim.
 */
export interface DigitalClientele {
  readonly id: string;
  readonly client_service_type: string;
  /** The provider's status text, verbatim: `pending`, `complete` and `cancelled` were observed. */
  readonly status: string;
  /** Exact numeric text as the provider sent it, for example '1.0'. */
  readonly amount?: string | null;
  readonly iddcl?: string | null;
  readonly creation_date_time?: string | null;
  readonly entity_vat_number?: string | null;
  readonly branch?: string | null;
  readonly from_agreed_period_date?: string | null;
  readonly to_agreed_period_date?: string | null;
  readonly customer_vat_number?: string | null;
  readonly customer_country?: string | null;
  readonly correlated_dc_id?: string | null;
  readonly comments?: string | null;
  readonly vehicle_registration_number?: string | null;
  readonly foreign_vehicle_registration_number?: string | null;
  readonly vehicle_category?: string | null;
  readonly vehicle_factory?: string | null;
  readonly vehicle_movement_purpose?: string | null;
  readonly vehicle_pickup_location?: string | null;
  readonly periodicity?: string | null;
  readonly periodicity_other?: string | null;
  readonly completion_date_time?: string | null;
  readonly vehicle_return_location?: string | null;
  readonly provided_service_category?: string | null;
  readonly provided_service_category_other?: string | null;
  readonly invoice_kind?: string | null;
  readonly off_site_provided_service?: string | null;
  readonly exit_date_time?: string | null;
  readonly cooperating_vat_number?: string | null;
  readonly other_branch?: string | null;
  readonly reason_non_issue_type?: string | null;
  readonly invoice_counterparty?: string | null;
  readonly invoice_counterparty_country?: string | null;
  readonly updated_iddcl?: string | null;
  readonly cancellation_id?: string | null;
  readonly recurring_service?: boolean | null;
  readonly continuous_service?: boolean | null;
  readonly continuous_lease_service?: boolean | null;
  readonly mixed_service?: boolean | null;
  readonly transmission_failure?: boolean | null;
  readonly is_diff_veh_pickup_location?: boolean | null;
  readonly entry_completion?: boolean | null;
  readonly non_issue_invoice?: boolean | null;
  readonly is_diff_veh_return_location?: boolean | null;
}
/**
 * A new entry. The service type, the branch and at least one of the two registration numbers
 * are required. The reference's presence rules are applied before any request: a foreign
 * registration needs the vehicle category and factory; a rental needs a movement purpose; a
 * continuous service needs both period dates; a recurring service needs the customer's tax id
 * and country. A field that applies to one context only is refused outside it.
 */
export interface CreateDigitalClienteleInput {
  readonly client_service_type: 'rental' | 'parkingcarwash' | 'garage';
  /** The branch number, as text. */
  readonly branch: string;
  readonly vehicle_registration_number?: string;
  readonly foreign_vehicle_registration_number?: string;
  readonly vehicle_category?: string;
  readonly vehicle_factory?: string;
  /** Required for a rental. */
  readonly vehicle_movement_purpose?: 'vmp_rental' | 'vmp_self_use' | 'vmp_free_service';
  /** Rental only. */
  readonly is_diff_veh_pickup_location?: boolean;
  /** Rental only, and only with `is_diff_veh_pickup_location: true`. */
  readonly vehicle_pickup_location?: string;
  /** Parking and car-wash entries only. */
  readonly mixed_service?: boolean;
  readonly transmission_failure?: boolean;
  /** A timestamp with Z or an offset; only with `transmission_failure: true`. */
  readonly creation_date_time?: string;
  readonly entity_vat_number?: string;
  readonly recurring_service?: boolean;
  readonly customer_vat_number?: string;
  readonly customer_country?: string;
  readonly continuous_service?: boolean;
  readonly from_agreed_period_date?: CalendarDate;
  readonly to_agreed_period_date?: CalendarDate;
  readonly continuous_lease_service?: boolean;
  /** Only with `continuous_lease_service: true`. */
  readonly periodicity?: string;
  /** Only with `continuous_lease_service: true`. */
  readonly periodicity_other?: string;
  readonly correlated_dc_id?: string;
  readonly comments?: string;
}
/**
 * A change to an entry: at least one field, and only the fields given are sent. Rules that
 * depend on the entry's service type are the provider's to apply; the SDK never reads the
 * entry to learn it. `off_site_provided_service` is not offered: its value form is not
 * established.
 */
export interface UpdateDigitalClienteleInput {
  readonly entry_completion?: boolean;
  readonly non_issue_invoice?: boolean;
  /** At most 2 fraction digits. */
  readonly amount?: Decimal;
  readonly is_diff_veh_return_location?: boolean;
  /** Only with `is_diff_veh_return_location: true`. */
  readonly vehicle_return_location?: string;
  readonly provided_service_category?:
    | 'with_parts'
    | 'with_client_parts'
    | 'without_parts'
    | 'free_service'
    | 'other'
    | 'warranty_compensation'
    | 'by_price_list'
    | 'by_agreement'
    | 'self_use';
  /** Only with `provided_service_category: 'other'`. */
  readonly provided_service_category_other?: string;
  readonly invoice_kind?: 'retail_sales_receipt' | 'receipt' | 'invoice' | 'sales_invoice';
  readonly cooperating_vat_number?: string;
  readonly other_branch?: string;
  readonly reason_non_issue_type?:
    'no_invoice_free_service' | 'no_invoice_self_use' | 'no_invoice_compensation';
  readonly comments?: string;
  readonly invoice_counterparty?: string;
  readonly invoice_counterparty_country?: string;
}
/**
 * Result of creating or updating an entry. 'observed' carries the entry the provider
 * returned; its status is the evidence of what happened.
 */
export type DigitalClienteleOutcome =
  | Readonly<{ kind: 'observed'; clientele: DigitalClientele }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/**
 * Result of cancelling an entry. 'acknowledged' carries the cancellation id the provider
 * returned with its notice; read the entry to see its status.
 */
export type ClienteleCancellationOutcome =
  | Readonly<{ kind: 'acknowledged'; cancellationId: string }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/**
 * Digital clientele operations. Each write is dispatched at most once and never retried, and
 * no follow-up request is made.
 */
export interface DigitalClienteleResource {
  /** Reads one entry. A provider refusal, in either of its forms, is a PROVIDER_REJECTED error. */
  get(clienteleId: string, options?: RequestOptions): Promise<DigitalClientele>;
  /** Creates an entry. After a failure whose effect is 'unknown', do not create it again blindly. */
  create(
    input: CreateDigitalClienteleInput,
    options?: RequestOptions,
  ): Promise<DigitalClienteleOutcome>;
  /** Updates an entry; completing it is an update with `entry_completion: true`. */
  update(
    clienteleId: string,
    patch: UpdateDigitalClienteleInput,
    options?: RequestOptions,
  ): Promise<DigitalClienteleOutcome>;
  /** Cancels an entry. The provider cancels a complete entry only. */
  cancel(clienteleId: string, options?: RequestOptions): Promise<ClienteleCancellationOutcome>;
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
