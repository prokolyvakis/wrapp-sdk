import type { CalendarDate, Decimal } from './values.js';

/** Tenant addressed either by login email or by Wrapp user id. */
export type TenantIdentity = Readonly<{ kind: 'email' | 'userId'; value: string }>;
/** Provider-assigned invoice id, or the caller-supplied external reference. */
export type InvoiceReference = Readonly<{ kind: 'invoiceId' | 'externalId'; value: string }>;
/**
 * How a returned invoice matched the requested reference: byte-exact, or differing only in
 * ASCII letter case. No Unicode folding is performed; case variance is surfaced, not resolved.
 * 'ascii-case-variant' can only arise for externalId references — a case-variant provider id
 * is a protocol error.
 */
export type IdentityEvidence = 'exact' | 'ascii-case-variant';
/**
 * Which provider validation family reported a rejection: the invoice-validation envelope, the
 * myDATA (tax authority) envelope, or an envelope carrying no recognized status. Evidence of
 * where the rejection came from, never of terminality or reference availability.
 */
export type RejectionSource = 'invoice-errors' | 'mydata-errors' | 'unknown';
/** Per-call cancellation and deadline. The deadline spans auth wait through body read. */
export interface RequestOptions {
  readonly signal?: AbortSignal;
  /** Overrides the client default (30 seconds) for this call only; 1 to 120 000 ms. */
  readonly timeoutMs?: number;
  /**
   * Opt in to keeping the provider's rejection detail for this call. It is read back with
   * getProviderDiagnostics and stays out of the result, the error, its message and its JSON.
   * On a non-2xx response it also reads the error body, bounded by the same deadline and
   * byte cap. Without this option nothing is retained and no error body is read.
   */
  readonly diagnostics?: 'provider-issues';
}
/** Construction options. Credentials stay memory-only; rotation requires a new client. */
export interface ClientOptions {
  /** Selects a fixed official origin. Production requires separately authorized credentials. */
  readonly environment: 'staging' | 'production';
  readonly credentials: { readonly apiKey: string; readonly tenant: TenantIdentity };
  /** Default per-request budget in milliseconds; defaults to 30 000, at most 120 000. */
  readonly timeoutMs?: number;
  /** Response byte cap; defaults to 2 MiB, at most 8 MiB. Larger bodies fail with RESPONSE_TOO_LARGE. */
  readonly maxResponseBytes?: number;
  /** Serialized request byte cap; defaults to 2 MiB, at most 8 MiB. Exceeding it fails before dispatch. */
  readonly maxRequestBytes?: number;
  /** Trusted testing seams. Origin override accepts loopback HTTP only, never another provider. */
  readonly advanced?: {
    readonly testBaseUrl?: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly now?: () => number;
  };
}
/**
 * Invoice recipient. Address and VAT fields are required for B2B service types 2.x and
 * optional for retail type 11.2; validation enforces this before any network access.
 */
export interface Counterpart {
  readonly name: string;
  readonly country_code?: string;
  readonly vat?: string;
  readonly city?: string;
  readonly street?: string;
  readonly number?: string;
  readonly postal_code?: string;
  readonly email?: string;
  /**
   * The client's supply account number, for a fuel invoice. Optional. The provider documents
   * that it ignores and does not store it on any other invoice; the SDK sends it as given.
   */
  readonly supply_account_no?: string;
}
/**
 * One invoice line. The caller supplies every amount and tax classification; the SDK
 * computes no totals, VAT rates or tax decisions. A zero VAT rate requires an exemption code.
 * The numeric codes are checked against the provider's documented request sets before any
 * network access. Those sets say what the SDK will send, not which code is fiscally correct.
 */
export interface InvoiceLine {
  readonly line_number: number;
  readonly name: string;
  readonly code?: string;
  readonly description?: string;
  readonly quantity: Decimal;
  /** One of 1 to 6. */
  readonly quantity_type?: number;
  readonly unit_price: Decimal;
  readonly net_total_price: Decimal;
  /**
   * One of 0, 3, 4, 6, 9, 13, 17, 24. The provider documents that it does not refuse other
   * values but issues the invoice as if without VAT, so they are rejected here instead.
   */
  readonly vat_rate: number;
  readonly vat_total: Decimal;
  readonly subtotal: Decimal;
  /** One of 1 to 31; required when vat_rate is 0. */
  readonly vat_exemption_code?: number;
  /**
   * Both scalar fields are required unless `classifications` is supplied. All three may be
   * sent together: the provider documents that the array then overrides the pair, and the SDK
   * sends them as given without merging.
   */
  readonly classification_category?: string;
  readonly classification_type?: string;
  /** At least one entry when supplied. Amounts are not checked against the line total. */
  readonly classifications?: readonly LineClassification[];
  /** Whole percent, 0 to 100: 20 means 20%. */
  readonly withhold_tax_rate?: number;
  /** One of '1' to '18', as a string. Not derived from or checked against the rate. */
  readonly withhold_tax_code?: string;
  readonly withholding_total?: Decimal;
  /** One of '1' to '4', as a string. */
  readonly stamp_duty_tax_code?: string;
  readonly stamp_duty_amount?: Decimal;
  /** Required when `deductions` holds at least one entry. Never computed from them. */
  readonly deductions_amount?: Decimal;
  readonly deductions?: readonly LineDeduction[];
  /** Required on every line when the invoice sets `self_pricing: true`. */
  readonly expenses_vat_classification?: string;
  readonly expense?: boolean;
  /** Marks a fee line; 2 is the only value the reference documents. */
  readonly rec_type?: 2;
  /**
   * Positive integer sent as given. The reference publishes no table for it, so membership
   * is not validated.
   */
  readonly fees_category?: number;
  /**
   * A fuel code from the provider's table, accepted only when the invoice sets
   * `fuel_invoice: true`. Code 999 may appear on one line only, and that line's
   * `net_total_price` may not exceed the sum of the other lines' `net_total_price`.
   */
  readonly fuel_code?: number;
  /** Required on every line when the invoice sets `b2g: true`. */
  readonly cpv_code?: string;
}
/** One entry of a line's `classifications`. */
export interface LineClassification {
  readonly category: string;
  readonly type: string;
  /** At most 2 fraction digits. */
  readonly amount: Decimal;
}
/**
 * One deduction on a line. Omitted fields are not sent; the provider documents that a missing
 * `informational` means false.
 */
export interface LineDeduction {
  readonly title?: string;
  /** At most 2 fraction digits. */
  readonly amount: Decimal;
  readonly informational?: boolean;
}
/**
 * Invoice creation payload, using the provider's snake_case field vocabulary.
 * Unrecognized fields are rejected before any network access.
 */
export interface CreateInvoiceInput {
  /**
   * Caller-supplied durable reference, preserved byte-exact. Required by this SDK even where
   * the provider makes it optional: it is the only reconciliation handle after an ambiguous
   * outcome. Never mint a new reference to escape ambiguity. At most 256 characters; no
   * whitespace, control characters, backslash, slash, percent, question mark or hash.
   */
  readonly external_id: string;
  readonly billing_book_id: string;
  /**
   * The supported types; any other code is rejected pre-I/O. 5.1 needs the mark of the
   * invoice it credits in `correlated_invoices`. 9.2 and 9.3 are delivery notes and 10.1 and
   * 10.2 quantity receipt notes, each sent in one fixed shape; see the API reference.
   */
  readonly invoice_type_code:
    | '1.1'
    | '2.1'
    | '2.2'
    | '2.3'
    | '5.1'
    | '5.2'
    | '9.2'
    | '9.3'
    | '10.1'
    | '10.2'
    | '11.1'
    | '11.2'
    | '11.4';
  readonly payment_method_type: number;
  readonly counterpart: Counterpart;
  readonly net_total_amount: Decimal;
  readonly vat_total_amount: Decimal;
  readonly total_amount: Decimal;
  readonly payable_total_amount: Decimal;
  readonly invoice_lines: readonly InvoiceLine[];
  readonly branch?: string;
  readonly payment_details?: string;
  readonly notes?: string;
  /** Three uppercase letters (ISO 4217 shape; membership is not validated). Must be provided together with exchange_rate or not at all. */
  readonly currency?: string;
  /** At most 2 fraction digits; more precision is rejected, never rounded. */
  readonly exchange_rate?: Decimal;
  readonly correlated_invoices?: readonly string[];
  readonly customer_emails?: readonly string[];
  readonly email_locale?: 'el' | 'en';
  readonly generate_pdf?: boolean;
  readonly mark_as_paid?: boolean;
  /**
   * Override the customer email's subject and body. Sent exactly as given: placeholders such
   * as $INVOICE_CODE are substituted by the provider, and line breaks are kept.
   */
  readonly email_subject?: string;
  readonly email_body?: string;
  /**
   * A specific invoice number, chosen by the caller: a positive integer. The SDK keeps no
   * numbering state and does not check the number against the billing book.
   */
  readonly num?: number;
  /** When true, every line needs `expenses_vat_classification`. */
  readonly self_pricing?: boolean;
  /** One of 1 to 13. */
  readonly special_invoice_category?: number;
  /**
   * Invoice-level totals, each at most 2 fraction digits and sent exactly as given. The SDK
   * never derives one from the lines or compares it with them.
   */
  readonly other_taxes_amount?: Decimal;
  readonly withholding_total_amount?: Decimal;
  /**
   * The reference documents two stamp-duty totals with separate wire fields. Neither is
   * treated as an alias of the other, and neither is required by the SDK.
   */
  readonly total_stamp_duty_amount?: Decimal;
  readonly stamp_duty_amount?: Decimal;
  /** Required when any line holds at least one deduction. */
  readonly deductions_total_amount?: Decimal;
  /** Required when any line sets `rec_type` or `fees_category`. */
  readonly fees_amount?: Decimal;
  /**
   * The registered POS device for an issuance tied to a POS transaction. Not required for a
   * card payment as such, and never looked up by the SDK.
   */
  readonly pos_device_id?: string;
  /** `true` needs `pos_device_id`. The provider documents installments for Viva terminals only. */
  readonly installments?: boolean;
  /** At most 2 fraction digits. */
  readonly tip_amount?: Decimal;
  /** Marks a fuel invoice. Required as `true` for any line to carry a `fuel_code`. */
  readonly fuel_invoice?: boolean;
  /**
   * Marks a B2G (public sector) invoice. When true, the eleven fields from
   * `delivery_address_city` to `b2g_due_date` are required, and every line needs a
   * `cpv_code`. The SDK checks that they are present and well-formed; it does not look up or
   * verify an authority, a contract or a budget. Without the flag the fields are optional and
   * are sent as given.
   */
  readonly b2g?: boolean;
  /** The B2G invoice's own delivery address; unrelated to a delivery note. */
  readonly delivery_address_city?: string;
  readonly delivery_address_street?: string;
  readonly delivery_address_street_number?: string;
  readonly delivery_address_postal_code?: string;
  readonly delivery_address_party_name?: string;
  readonly b2g_contracting_authority_id?: string;
  readonly b2g_contract_identifier?: string;
  /** One of 1, 2, 3. */
  readonly b2g_budget_type?: number;
  readonly b2g_budget_identifier?: string;
  readonly b2g_payment_details?: string;
  /** A real calendar date, YYYY-MM-DD. */
  readonly b2g_due_date?: CalendarDate;
  readonly b2g_buyer_reference?: string;
  readonly b2g_bt_70?: string;
  /**
   * Marks the invoice as a delivery note. `true` needs `delivery_detail`, and
   * `delivery_detail` needs `true`. The provider then tracks the movement as a digital
   * transport unless the detail says otherwise.
   */
  readonly is_delivery_note?: boolean;
  readonly delivery_detail?: DeliveryDetail;
  readonly other_correlated_entities?: readonly OtherCorrelatedEntity[];
  /**
   * One of 1 to 7. Required on types 10.1 and 10.2 and refused on every other type. 5 is
   * accepted on 10.1 only; 7 needs `other_receiving_note_purpose_title`.
   */
  readonly receiving_note_purpose?: number;
  /** At most 150 characters. */
  readonly other_receiving_note_purpose_title?: string;
}
/**
 * The movement of a delivery note. The provider's two branch fields (`from_branch`,
 * `to_branch`) are not available and are refused.
 */
export interface DeliveryDetail {
  /** A real calendar date written DD-MM-YYYY. */
  readonly dispatch_date: string;
  /** HH:MM, from 00:00 to 23:59. */
  readonly dispatch_time: string;
  readonly vehicle_number: string;
  /** One of '1' to '20' without '6', '15', '16', '17' and '18', as a string. */
  readonly purpose_of_movement: string;
  /** Required when `purpose_of_movement` is '19'. */
  readonly purpose_of_movement_custom_title?: string;
  readonly issuer_of_movement: string;
  readonly from_address: string;
  readonly from_number: string;
  readonly from_city: string;
  readonly from_zipcode: string;
  readonly to_address: string;
  readonly to_number: string;
  readonly to_city: string;
  readonly to_zipcode: string;
  readonly reverse_delivery_note?: boolean;
  /** One of 1 to 5. Required when `reverse_delivery_note` is true. */
  readonly reverse_delivery_note_purpose?: number;
  /**
   * The two flags below change how the provider tracks the transport and cannot both be
   * true. With `without_digital_transport_tracking` the provider marks the delivery note
   * completed on issue.
   */
  readonly non_obligated_recipient?: boolean;
  readonly without_digital_transport_tracking?: boolean;
}
/** Another party related to the invoice, for example a sender when a carrier issues it. */
export interface OtherCorrelatedEntity {
  /** One of 1 to 6. */
  readonly entity_type: number;
  /** The tax id, as text. */
  readonly vat_number: string;
  /** Two uppercase letters. */
  readonly country_code: string;
  /** A nonnegative integer. */
  readonly branch_code: number;
  readonly name: string;
  readonly street: string;
  readonly number: string;
  readonly postal_code: string;
  readonly city: string;
}
/** An issued invoice as observed via status lookup, creation or a verified webhook. */
export interface InvoiceObservation {
  readonly id: string;
  /**
   * The reference as the provider stores it: free-form text, never trimmed, case-folded or
   * decoded. It can hold characters this SDK refuses in an outbound reference, when another
   * producer wrote it.
   */
  readonly external_id: string | null;
  /** Greek myDATA registration mark, accepted as the JSON string the provider documents. */
  readonly my_data_mark: string | null;
  readonly my_data_uid: string | null;
  readonly my_data_qr_url: string | null;
  readonly series: string;
  readonly num: string;
  readonly issued_at: CalendarDate;
  readonly cancelled_by_mark: string | null;
  /** Provider code kept verbatim as a string; no meanings are invented for new values. */
  readonly transmission_failure: string | null;
  /** Portal link returned as data; the SDK never fetches it. */
  readonly wrapp_invoice_url: string;
  readonly wrapp_invoice_url_en: string;
  /**
   * The five fields below are absent when the provider omits them and null when it reports
   * that they do not apply. Absent and null are different observations.
   */
  readonly authentication_code?: string | null;
  readonly catering_table_id?: string | null;
  readonly card_type?: string | null;
  /** Masked by the provider; kept as received. */
  readonly card_number?: string | null;
  readonly transaction_id?: string | null;
}
/**
 * Identity evidence for a pending outcome. 'unavailable' means the provider returned only its
 * own invoice id, so nothing could be compared with the requested external reference; a
 * provider id is never treated as proof about a reference.
 */
export type PendingIdentityEvidence = IdentityEvidence | 'unavailable';
/**
 * The provider reports the invoice as pending. This is never an issued invoice, whatever
 * evidence accompanies it: on a provider-to-authority connection loss the provider already
 * returns a number, UID and QR URL while the invoice is still pending. referenceState stays
 * 'unknown', so pending is never permission to mint a replacement external reference.
 */
export interface PendingInvoiceOutcome {
  readonly kind: 'pending';
  readonly invoiceId: string;
  readonly referenceState: 'unknown';
  readonly identity: PendingIdentityEvidence;
  /** Present only when the provider returned the full observation with the pending status. */
  readonly invoice?: InvoiceObservation;
}
/**
 * Result of a status lookup: an observed invoice or a pending one. Switch on kind before
 * reading invoice. A provider rejection, including not-found, is a PROVIDER_REJECTED error.
 */
export type InvoiceStatusOutcome =
  | Readonly<{ kind: 'observed'; invoice: InvoiceObservation; identity: IdentityEvidence }>
  | PendingInvoiceOutcome;
/**
 * Closed result union for invoice creation. No outcome establishes compliance, reference
 * freedom, or equality to an earlier request: rejections carry referenceState 'unknown'
 * regardless of the provider's rejection title, and read-back is evidence, never permission
 * to mint a replacement external reference.
 */
export type CreateOutcome =
  | Readonly<{ kind: 'observed'; invoice: InvoiceObservation; identity: IdentityEvidence }>
  | PendingInvoiceOutcome
  | Readonly<{
      kind: 'rejected';
      errorCount: number;
      rejectionSource: RejectionSource;
      referenceState: 'unknown';
    }>;
/**
 * Validated projection of a full invoice lookup, not a complete fiscal archive.
 * Amounts and returned numeric codes retain the provider's exact text; no rounding or float
 * conversion occurs. Optional fields are absent when the provider omits them. Fields whose
 * returned shape the provider has not documented are not projected at all.
 */
export interface InvoiceDetails {
  readonly id: string;
  /** Free-form text exactly as stored by the provider; see InvoiceObservation.external_id. */
  readonly external_id: string | null;
  readonly invoice_type_code: string;
  readonly billing_book_id: string;
  /** Documented provider timestamp with numeric offset, validated but not reinterpreted. */
  readonly issued_at: string;
  readonly code: string;
  /**
   * The optional fields below, here and on each line, are absent when the provider omits
   * them and null when it returns null, which it does for a field it has no value for.
   * Absent and null are different observations.
   */
  /** Provider payment-method code as exact text; unknown codes are kept, not interpreted. */
  readonly payment_method?: string | null;
  /** Provider branch code as exact text. */
  readonly branch?: string | null;
  readonly is_delivery_note?: boolean | null;
  readonly fuel_invoice?: boolean | null;
  readonly third_party_collection?: boolean | null;
  readonly currency: string;
  readonly exchange_rate?: string | null;
  readonly other_taxes_amount?: string | null;
  readonly net_total_amount: string;
  readonly vat_total_amount: string;
  readonly total_amount: string;
  readonly payable_total_amount: string;
  readonly notes?: string | null;
  readonly withholding_total_amount?: string | null;
  readonly total_stamp_duty_amount?: string | null;
  /** Provider code as exact text; an unfamiliar code is kept, not interpreted. */
  readonly special_invoice_category?: string | null;
  /** Present on a delivery note. */
  readonly delivery_details?: InvoiceDeliveryDetails | null;
  /** Present on a B2G invoice. */
  readonly b2g_details?: InvoiceB2gDetails | null;
  readonly counterpart: Readonly<{
    /** Empty on a record that has no counterpart. */
    name: string;
    /** Present on a fuel invoice. */
    supply_account_no?: string | null;
    country_code?: string | undefined;
    vat?: string | undefined;
    city?: string | undefined;
    street?: string | undefined;
    number?: string | undefined;
    postal_code?: string | undefined;
    email?: string | undefined;
  }>;
  /**
   * A read returns every invoice of the tenant, including types this SDK does not issue.
   * On some of those a line has an empty name, or null for its VAT rate or for either
   * classification field.
   */
  readonly invoice_lines: readonly Readonly<{
    line_number: number;
    name: string;
    code?: string | null;
    description?: string | null;
    quantity: string;
    quantity_type?: string | null;
    unit_price: string;
    net_total_price: string;
    vat_rate: number | null;
    vat_total: string;
    subtotal: string;
    /** Exact text of the rate: '20' when set, '' when the line has none. */
    withhold_tax_rate?: string | null;
    withhold_tax_code?: string | null;
    withholding_total?: string | null;
    classification_category: string | null;
    classification_type: string | null;
    stamp_duty_tax_code?: string | null;
    stamp_duty_amount?: string | null;
    deductions_amount?: string | null;
    /** Empty when the line has none; an omitted item field stays absent. */
    deductions?:
      | readonly Readonly<{
          title?: string | null;
          amount: string;
          informational?: boolean | null;
        }>[]
      | null;
    /** Provider fuel code as exact text, on a line of a fuel invoice. */
    fuel_code?: string | null;
  }>[];
}
/**
 * The movement of a delivery note as the provider returns it. Every member is absent when
 * omitted and null when the provider reports no value. Codes and branch numbers are exact
 * text; the dispatch date is the provider's DD-MM-YYYY text, returned as written.
 */
export interface InvoiceDeliveryDetails {
  readonly dispatch_date?: string | null;
  readonly dispatch_time?: string | null;
  readonly vehicle_number?: string | null;
  readonly purpose_of_movement?: string | null;
  readonly purpose_of_movement_custom_title?: string | null;
  readonly issuer_of_movement?: string | null;
  readonly from_address?: string | null;
  readonly from_number?: string | null;
  readonly from_city?: string | null;
  readonly from_zipcode?: string | null;
  readonly from_branch?: string | null;
  readonly to_address?: string | null;
  readonly to_number?: string | null;
  readonly to_city?: string | null;
  readonly to_zipcode?: string | null;
  readonly to_branch?: string | null;
  readonly reverse_delivery_note?: boolean | null;
  readonly reverse_delivery_note_purpose?: string | null;
  readonly non_obligated_recipient?: boolean | null;
  readonly without_digital_transport_tracking?: boolean | null;
}
/**
 * The B2G fields of an invoice as the provider returns them, under its own key names (for
 * example `bt_70`, where the request field is `b2g_bt_70`). The budget type is exact text and
 * the due date is the provider's DD-MM-YYYY text, where the request takes YYYY-MM-DD.
 */
export interface InvoiceB2gDetails {
  readonly buyer_reference?: string | null;
  readonly delivery_address_city?: string | null;
  readonly delivery_address_street?: string | null;
  readonly delivery_address_street_number?: string | null;
  readonly delivery_address_postal_code?: string | null;
  readonly delivery_address_party_name?: string | null;
  readonly b2g_contracting_authority_id?: string | null;
  readonly b2g_contract_identifier?: string | null;
  readonly b2g_budget_type?: string | null;
  readonly b2g_budget_identifier?: string | null;
  readonly b2g_due_date?: string | null;
  readonly b2g_payment_details?: string | null;
  readonly bt_70?: string | null;
}
/** One validated result page. No snapshot guarantee exists under concurrent writes. */
export interface InvoicePage {
  readonly invoices: readonly InvoiceDetails[];
  readonly total_count: number;
  readonly total_pages: number;
  readonly current_page: number;
}
/** Listing filters. Dates are ISO calendar dates; start must not exceed end. */
export interface ListInvoicesInput {
  readonly start_date?: CalendarDate;
  readonly end_date?: CalendarDate;
  readonly page?: number;
}
/**
 * Result of the effectful PDF-generation GET. An 'acknowledged' status has unknown
 * semantics: it is not evidence of a queued or eventually available document.
 */
export type PdfOutcome =
  | Readonly<{ kind: 'available'; downloadUrl: string }>
  | Readonly<{ kind: 'acknowledged'; status: 'unknown' }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/** Tenant account details. Payment amounts retain the provider's exact numeric text. */
export interface TenantDetails {
  readonly wrapp_user_id: string;
  readonly partner_user_id: string | null;
  readonly issue_invoice_status: boolean;
  readonly email: string;
  readonly has_plan: boolean;
  readonly plan_name: string;
  readonly next_payment_date: CalendarDate | null;
  readonly next_payment_amount: string | null;
}
/** A registered branch of the tenant. */
export interface Branch {
  readonly id: string;
  readonly name: string;
  readonly code: string;
}
/** A billing book: the series an invoice is issued under. */
export interface BillingBook {
  readonly id: string;
  readonly name: string;
  readonly series: string;
  readonly invoice_type_code: string;
  /** Current sequence number, preserved as a string. */
  readonly number: string;
}
/** VAT registry lookup result. */
export interface VatDetails {
  readonly vat_no: string;
  readonly name: string;
  readonly city: string;
  readonly address: string;
  readonly postal_code: string;
  readonly street_number: string;
}
/**
 * Byte-authenticated webhook payload. The kind names the body that was validated, not the
 * header: the two PDF headers carry the same body and share kind 'pdf'. eventTypeHint repeats
 * the Event-Type header as received and eventTypeAuthenticated is always false, because that
 * header lies outside the signed body. A valid signature proves which bytes were signed. It
 * does not prove the tenant, freshness, that issuance completed, or which PDF format a link
 * points to.
 */
export type VerifiedWebhook =
  | Readonly<{
      kind: 'invoice-observation';
      invoice: InvoiceObservation;
      eventTypeHint: 'issued-invoice';
      eventTypeAuthenticated: false;
    }>
  | Readonly<{
      kind: 'pdf';
      invoiceId: string;
      /** Returned as data; the SDK never fetches it. */
      downloadUrl: string;
      eventTypeHint: 'invoice-pdf' | 'thermal-print-pdf';
      eventTypeAuthenticated: false;
    }>
  | Readonly<{
      kind: 'pos-payment-error';
      invoiceId: string;
      /** The provider's failure text, kept as data. It may describe a customer transaction. */
      providerMessage: string;
      eventTypeHint: 'pos-payment';
      eventTypeAuthenticated: false;
    }>;
