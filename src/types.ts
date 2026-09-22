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
}
/**
 * One invoice line. The caller supplies every amount and tax classification; the SDK
 * computes no totals, VAT rates or tax decisions. A zero VAT rate requires an exemption code.
 */
export interface InvoiceLine {
  readonly line_number: number;
  readonly name: string;
  readonly code?: string;
  readonly description?: string;
  readonly quantity: Decimal;
  readonly quantity_type?: number;
  readonly unit_price: Decimal;
  readonly net_total_price: Decimal;
  readonly vat_rate: number;
  readonly vat_total: Decimal;
  readonly subtotal: Decimal;
  readonly vat_exemption_code?: number;
  readonly classification_category: string;
  readonly classification_type: string;
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
  /** Supported service-invoice subset; other document types are rejected pre-I/O. */
  readonly invoice_type_code: '2.1' | '2.2' | '2.3' | '11.2';
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
  readonly exchange_rate?: Decimal;
  readonly correlated_invoices?: readonly string[];
  readonly customer_emails?: readonly string[];
  readonly email_locale?: 'el' | 'en';
  readonly generate_pdf?: boolean;
  readonly mark_as_paid?: boolean;
}
/** An issued invoice as observed via status lookup, creation or a verified webhook. */
export interface InvoiceObservation {
  readonly id: string;
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
}
/**
 * Closed result union for invoice creation. No outcome establishes compliance, reference
 * freedom, or equality to an earlier request: rejections carry referenceState 'unknown'
 * regardless of the provider's rejection title, and read-back is evidence, never permission
 * to mint a replacement external reference.
 */
export type CreateOutcome =
  | Readonly<{ kind: 'observed'; invoice: InvoiceObservation; identity: IdentityEvidence }>
  | Readonly<{ kind: 'pending'; invoiceId: string; referenceState: 'unknown' }>
  | Readonly<{
      kind: 'rejected';
      errorCount: number;
      rejectionSource: RejectionSource;
      referenceState: 'unknown';
    }>;
/**
 * Validated core projection of a full invoice lookup, not a complete fiscal archive.
 * Amounts retain the provider's exact numeric text; no rounding or float conversion occurs.
 */
export interface InvoiceDetails {
  readonly id: string;
  readonly external_id: string | null;
  readonly invoice_type_code: string;
  readonly billing_book_id: string;
  /** Documented provider timestamp with numeric offset, validated but not reinterpreted. */
  readonly issued_at: string;
  readonly code: string;
  readonly currency: string;
  readonly net_total_amount: string;
  readonly vat_total_amount: string;
  readonly total_amount: string;
  readonly payable_total_amount: string;
  readonly counterpart: Readonly<{
    name: string;
    country_code?: string | undefined;
    vat?: string | undefined;
    city?: string | undefined;
    street?: string | undefined;
    number?: string | undefined;
    postal_code?: string | undefined;
    email?: string | undefined;
  }>;
  readonly invoice_lines: readonly Readonly<{
    line_number: number;
    name: string;
    quantity: string;
    unit_price: string;
    net_total_price: string;
    vat_rate: number;
    vat_total: string;
    subtotal: string;
    classification_category: string;
    classification_type: string;
  }>[];
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
 * Byte-authenticated webhook payload. eventTypeAuthenticated is always false because the
 * Event-Type header lies outside the signed body; the type was used as a routing hint and
 * the corresponding body shape was validated, nothing more.
 */
export type VerifiedWebhook =
  | Readonly<{ kind: 'issued-invoice'; invoice: InvoiceObservation; eventTypeAuthenticated: false }>
  | Readonly<{
      kind: 'invoice-pdf';
      invoiceId: string;
      downloadUrl: string;
      eventTypeAuthenticated: false;
    }>;
