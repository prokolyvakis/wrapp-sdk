import { z } from 'zod';
import { LosslessNumber, parse, stringify } from 'lossless-json';
import { WrappError } from './errors.js';
import { counterpartRule, supportedInvoiceTypeCodes } from './invoice-contracts.js';
import { calendarDate, decimal, freeze, isCalendarDate } from './values.js';
import type {
  IdentityEvidence,
  InvoiceReference,
  InvoiceStatusOutcome,
  RejectionSource,
} from './types.js';

export const text = z.string().max(4096);
export const nonempty = text.min(1);
export const identifier = z
  .string()
  .min(1)
  .max(256)
  .refine((v) => !/[\p{Cc}\s\\/%?#]/u.test(v) && !/^\.+$/.test(v) && validUnicode(v));
function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}
export const referenceSchema = z.strictObject({
  kind: z.enum(['invoiceId', 'externalId']),
  value: identifier,
});
// A reference the provider returns is free-form text another producer may have stored. It is
// kept exactly as received: never trimmed, case-folded, percent-decoded or turned from empty
// into null. The path-safety rules of `identifier` govern only what this SDK sends.
export const returnedReference = text.refine(validUnicode);
const returnedExternalReference = returnedReference.nullable();
export const httpsUrl = nonempty.refine((v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
});
const token = z.instanceof(LosslessNumber);
export const integer = token
  .refine((v) => /^\d{1,16}$/.test(v.value) && Number.isSafeInteger(Number(v.value)))
  .transform((v) => Number(v.value));
export const integerString = token
  .refine((v) => /^\d{1,30}$/.test(v.value))
  .transform((v) => v.value);
const numericGrammar = /^(0|[1-9]\d{0,29})(\.\d{1,12})?([eE][+-]?\d{1,2})?$/;
// The provider serializes some numeric fields as JSON strings (observed on the wire: line
// quantity "1.0" beside numeric unit_price); both token forms keep their exact text.
export const numericText = z.union([
  token.refine((v) => numericGrammar.test(v.value)).transform((v) => v.value),
  z.string().regex(numericGrammar),
]);
const inputDecimal = z
  .string()
  .refine((v) => {
    try {
      decimal(v);
      return true;
    } catch {
      return false;
    }
  })
  .transform((v) => new LosslessNumber(v));
// Monetary totals stay at 2 fraction digits; quantities and unit prices may need more (V07 is
// open).
const inputAmount = inputDecimal.refine((v) => /^\d+(\.\d{1,2})?$/.test(v.value));
// The reference bounds the exchange rate at 2 fraction digits. Excess precision is refused,
// never rounded.
const inputExchangeRate = inputDecimal.refine((v) => /^\d+(\.\d{1,2})?$/.test(v.value));
// Reviewed request-contract member sets. They decide what this SDK will send, not tax
// eligibility, and are never applied to values the provider returns. The reference warns that
// a VAT rate outside its table is not refused: the invoice is issued as if without VAT.
const member = (values: readonly number[]) => z.number().refine((v) => values.includes(v));
const vatRate = member([0, 3, 4, 6, 9, 13, 17, 24]);
const quantityType = member([1, 2, 3, 4, 5, 6]);
const vatExemptionCode = member([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31,
]);
// Codes the reference documents as strings: "1" up to the given count, no padding.
const codeText = (count: number) =>
  z.string().refine((v) => /^[1-9]\d?$/.test(v) && Number(v) <= count);
// Caller-chosen integers the reference gives no table for. The bound is the exact-integer
// range, not a claim about which values the provider accepts.
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const isoDate = z.string().refine(isCalendarDate).transform(calendarDate);
const providerDate = z
  .string()
  .regex(/^\d{2}-\d{2}-\d{4}$/)
  .transform((v) => `${v.slice(6)}-${v.slice(3, 5)}-${v.slice(0, 2)}`)
  .pipe(isoDate);
// Docs show "2026-05-13 10:00:00 +0300"; the wire carries ISO "2026-09-18T14:28:41+03:00"
// (provider-observed). Both separators and offset spellings are accepted, never reparsed.
const timestamp = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d ?[+-](?:0\d|1[0-4]):?[0-5]\d$/.test(
        v,
      ) && isCalendarDate(v.slice(0, 10)),
  );
const counterpartFields = {
  name: nonempty,
  country_code: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  vat: nonempty.optional(),
  city: text.optional(),
  street: text.optional(),
  number: text.optional(),
  postal_code: text.optional(),
  email: nonempty.optional(),
};
const lineFields = {
  line_number: z.number().int().min(1).max(1000),
  name: nonempty,
  code: text.optional(),
  description: text.optional(),
  quantity: inputDecimal,
  quantity_type: quantityType.optional(),
  unit_price: inputDecimal,
  net_total_price: inputAmount,
  vat_rate: vatRate,
  vat_total: inputAmount,
  subtotal: inputAmount,
  vat_exemption_code: vatExemptionCode.optional(),
  classification_category: nonempty.optional(),
  classification_type: nonempty.optional(),
  classifications: z
    .array(z.strictObject({ category: nonempty, type: nonempty, amount: inputAmount }))
    .min(1)
    .max(100)
    .optional(),
  withhold_tax_rate: z.number().int().min(0).max(100).optional(),
  withhold_tax_code: codeText(18).optional(),
  withholding_total: inputAmount.optional(),
  stamp_duty_tax_code: codeText(4).optional(),
  stamp_duty_amount: inputAmount.optional(),
  deductions_amount: inputAmount.optional(),
  deductions: z
    .array(
      z.strictObject({
        title: text.optional(),
        amount: inputAmount,
        informational: z.boolean().optional(),
      }),
    )
    .max(100)
    .optional(),
  expenses_vat_classification: nonempty.optional(),
  expense: z.boolean().optional(),
  rec_type: z.literal(2).optional(),
  fees_category: positiveInteger.optional(),
};
// Presence rules the reference states for one line. They require a field to be there; they
// never compute or compare an amount.
const lineSchema = z
  .strictObject(lineFields)
  .refine((v) => v.vat_rate !== 0 || v.vat_exemption_code !== undefined)
  // The array replaces the scalar pair. Both forms may be sent: the provider documents that
  // the array then overrides, so nothing is merged or dropped here.
  .refine(
    (v) =>
      v.classifications !== undefined ||
      (v.classification_category !== undefined && v.classification_type !== undefined),
  )
  .refine((v) => !hasDeductions(v) || v.deductions_amount !== undefined);
function hasDeductions(line: { deductions?: readonly unknown[] | undefined }): boolean {
  return line.deductions !== undefined && line.deductions.length > 0;
}
export const createSchema = z
  .strictObject({
    external_id: identifier,
    billing_book_id: identifier,
    invoice_type_code: z.enum(supportedInvoiceTypeCodes),
    payment_method_type: z.number().int().min(0).max(7),
    counterpart: z.strictObject(counterpartFields),
    net_total_amount: inputAmount,
    vat_total_amount: inputAmount,
    total_amount: inputAmount,
    payable_total_amount: inputAmount,
    invoice_lines: z.array(lineSchema).min(1).max(1000),
    branch: identifier.optional(),
    payment_details: text.optional(),
    notes: text.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    exchange_rate: inputExchangeRate.optional(),
    correlated_invoices: z.array(identifier).max(100).optional(),
    customer_emails: z.array(nonempty).max(100).optional(),
    email_locale: z.enum(['el', 'en']).optional(),
    generate_pdf: z.boolean().optional(),
    mark_as_paid: z.boolean().optional(),
    email_subject: text.optional(),
    email_body: text.optional(),
    num: positiveInteger.optional(),
    self_pricing: z.boolean().optional(),
    special_invoice_category: member([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]).optional(),
    other_taxes_amount: inputAmount.optional(),
    withholding_total_amount: inputAmount.optional(),
    // Two documented fields with their own wire keys. Which of them the provider requires
    // beside line stamp duty is an open provider question, so neither is enforced or aliased.
    total_stamp_duty_amount: inputAmount.optional(),
    stamp_duty_amount: inputAmount.optional(),
    deductions_total_amount: inputAmount.optional(),
    fees_amount: inputAmount.optional(),
  })
  .refine((v) => (v.currency === undefined) === (v.exchange_rate === undefined))
  // Per-profile refinement, kept apart from the field validation above: a business profile
  // needs the counterpart's identity and address, a retail one only its name.
  .refine(
    (v) =>
      counterpartRule(v.invoice_type_code) === 'name-only' ||
      [
        v.counterpart.country_code,
        v.counterpart.vat,
        v.counterpart.city,
        v.counterpart.street,
        v.counterpart.number,
        v.counterpart.postal_code,
      ].every((field) => field !== undefined && field.length > 0),
  )
  .refine((v) => new Set(v.invoice_lines.map((l) => l.line_number)).size === v.invoice_lines.length)
  // Presence rules across the invoice, as the reference words them: "required when
  // self_pricing is true", "required when deductions present", "required when fees present".
  .refine(
    (v) =>
      v.self_pricing !== true ||
      v.invoice_lines.every((l) => l.expenses_vat_classification !== undefined),
  )
  .refine((v) => v.deductions_total_amount !== undefined || !v.invoice_lines.some(hasDeductions))
  .refine(
    (v) =>
      v.fees_amount !== undefined ||
      v.invoice_lines.every((l) => l.rec_type === undefined && l.fees_category === undefined),
  );

export const observationSchema = z.object({
  id: identifier,
  external_id: returnedExternalReference,
  my_data_mark: nonempty.nullable(),
  my_data_uid: nonempty.nullable(),
  my_data_qr_url: httpsUrl.nullable(),
  series: text,
  num: integerString,
  issued_at: providerDate,
  cancelled_by_mark: nonempty.nullable(),
  transmission_failure: integerString.nullable(),
  wrapp_invoice_url: httpsUrl,
  wrapp_invoice_url_en: httpsUrl,
  // Optional so earlier supported payloads still decode; absent stays absent and the
  // provider's explicit null stays null.
  authentication_code: text.nullable().exactOptional(),
  catering_table_id: text.nullable().exactOptional(),
  card_type: text.nullable().exactOptional(),
  card_number: text.nullable().exactOptional(),
  transaction_id: text.nullable().exactOptional(),
});
export const detailsSchema = z.object({
  id: identifier,
  external_id: returnedExternalReference,
  invoice_type_code: nonempty,
  billing_book_id: identifier,
  issued_at: timestamp,
  code: text,
  // The optional fields below and on each line follow the documented full-detail shape.
  // Returned codes keep their exact digits as text and are not checked against the request
  // member sets. The reference shows these fields populated and does not say they can be
  // null, so by SDK policy a null is a protocol error rather than a second kind of absence.
  payment_method: integerString.exactOptional(),
  branch: integerString.exactOptional(),
  is_delivery_note: z.boolean().exactOptional(),
  fuel_invoice: z.boolean().exactOptional(),
  third_party_collection: z.boolean().exactOptional(),
  currency: nonempty,
  exchange_rate: numericText.exactOptional(),
  other_taxes_amount: numericText.exactOptional(),
  net_total_amount: numericText,
  vat_total_amount: numericText,
  total_amount: numericText,
  payable_total_amount: numericText,
  notes: text.exactOptional(),
  withholding_total_amount: numericText.exactOptional(),
  total_stamp_duty_amount: numericText.exactOptional(),
  // Provider-observed: the wire carries vat: "" for counterparts without a VAT number.
  counterpart: z.object({ ...counterpartFields, vat: text.optional() }),
  invoice_lines: z
    .array(
      z.object({
        line_number: integer,
        name: nonempty,
        code: text.exactOptional(),
        description: text.exactOptional(),
        quantity: numericText,
        quantity_type: integerString.exactOptional(),
        unit_price: numericText,
        net_total_price: numericText,
        vat_rate: integer,
        vat_total: numericText,
        subtotal: numericText,
        withhold_tax_code: text.exactOptional(),
        withholding_total: numericText.exactOptional(),
        classification_category: nonempty,
        classification_type: nonempty,
        stamp_duty_tax_code: text.exactOptional(),
        stamp_duty_amount: numericText.exactOptional(),
        deductions_amount: numericText.exactOptional(),
      }),
    )
    .min(1)
    .max(1000),
});
export const pageSchema = z.object({
  invoices: z.array(detailsSchema).max(50),
  total_count: integer,
  total_pages: integer,
  current_page: integer,
});
export const listSchema = z
  .strictObject({
    start_date: isoDate.optional(),
    end_date: isoDate.optional(),
    page: z.number().int().min(1).max(1_000_000).optional(),
  })
  .refine((v) => !v.start_date || !v.end_date || v.start_date <= v.end_date);
export const tenantSchema = z.object({
  wrapp_user_id: identifier,
  partner_user_id: nonempty.nullable(),
  issue_invoice_status: z.boolean(),
  email: nonempty,
  has_plan: z.boolean(),
  plan_name: text,
  next_payment_date: isoDate.nullable(),
  next_payment_amount: numericText.nullable(),
});
// Provider-observed: the branch code arrives as a JSON number (code: 0).
export const branchSchema = z.object({
  id: identifier,
  name: nonempty,
  code: z.union([text, integerString]),
});
export const branchesSchema = z.array(branchSchema).max(10_000);
export const booksSchema = z
  .array(
    z.object({
      id: identifier,
      name: nonempty,
      series: text,
      invoice_type_code: nonempty,
      number: integerString,
    }),
  )
  .max(10_000);
export const vatSchema = z.object({
  vat_no: nonempty,
  name: nonempty,
  city: text,
  address: text,
  postal_code: text,
  street_number: text,
});
export const vatInputSchema = z.strictObject({
  vat: nonempty,
  country_code: z.string().regex(/^[A-Z]{2}$/),
});
// Non-numeric keys are additive provider fields and are dropped, not rejected.
export const exemptionsSchema = z
  .array(
    z
      .record(z.string(), z.unknown())
      .transform((entry) =>
        Object.fromEntries(Object.entries(entry).filter(([key]) => /^\d{1,4}$/.test(key))),
      )
      .pipe(z.record(z.string(), nonempty)),
  )
  .max(1000);
export const loginSchema = z.object({
  data: z.object({
    type: z.literal('jwt'),
    attributes: z.object({
      jwt: z
        .string()
        .min(1)
        .max(16_384)
        .regex(/^[A-Za-z0-9._~-]+$/),
    }),
  }),
});
export const pendingSchema = z.object({ status: z.literal('pending'), invoice_id: identifier });
export const pdfSchema = z.object({ download_url: httpsUrl });
export const pdfStatusSchema = z.object({ status: nonempty });
export const webhookPdfSchema = z.object({ invoice_id: identifier, download_url: httpsUrl });
// The POS failure webhook carries its message as a plain string under `errors`; it is not the
// HTTP `errors[]` envelope and is decoded on its own terms.
export const webhookPosErrorSchema = z.object({ errors: text, invoice_id: identifier });
const errorsSchema = z
  .array(
    z
      .object({ title: text.optional(), message: text.optional(), code: text.optional() })
      .refine((v) => v.title !== undefined || v.message !== undefined || v.code !== undefined),
  )
  .min(1)
  .max(100);
const errorEnvelope = z.object({ errors: errorsSchema, status: text.optional() });
// Docs show "myDATA Errors"; the wire carries "myData Errors" (provider-observed),
// so the two known statuses match case-insensitively.
function sourceOf(status: string | undefined): RejectionSource {
  if (status === undefined) return 'unknown';
  const normalized = status.toLowerCase();
  if (normalized === 'invoice errors') return 'invoice-errors';
  if (normalized === 'mydata errors') return 'mydata-errors';
  throw new WrappError('PROTOCOL_ERROR', 'decode');
}
export function rejection(
  value: unknown,
): Readonly<{ errorCount: number; source: RejectionSource }> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const contradicted = 'id' in value || 'invoice_id' in value || 'download_url' in value;
  if ('errors' in value) {
    const result = errorEnvelope.safeParse(value);
    if (!result.success || contradicted) throw new WrappError('PROTOCOL_ERROR', 'decode');
    return freeze({ errorCount: result.data.errors.length, source: sourceOf(result.data.status) });
  }
  if ('error' in value) {
    if (typeof value.error !== 'string' || value.error.length > 4096 || contradicted) {
      throw new WrappError('PROTOCOL_ERROR', 'decode');
    }
    let status: string | undefined;
    if ('status' in value) {
      if (typeof value.status !== 'string') throw new WrappError('PROTOCOL_ERROR', 'decode');
      status = value.status;
    }
    return freeze({ errorCount: 1, source: sourceOf(status) });
  }
  return undefined;
}
export function decode<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new WrappError('PROTOCOL_ERROR', operation);
  return freeze(result.data);
}
export function input<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new WrappError('INVALID_INPUT', operation);
  return result.data;
}
// The parser assigns keys by plain assignment, so a "__proto__" key replaces an object's
// prototype and its fields pass 'in' checks as inherited properties. The key never appears
// as an own property, so it is detected by the prototype it leaves behind.
function assertOwnPrototypes(value: unknown): void {
  if (value === null || typeof value !== 'object' || value instanceof LosslessNumber) return;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== Array.prototype) {
    throw new Error('Forbidden JSON key');
  }
  for (const child of Object.values(value)) assertOwnPrototypes(child);
}
export function parseJson(textValue: string): unknown {
  const value = parse(textValue, undefined, {
    onDuplicateKey: () => {
      throw new Error('Duplicate JSON key');
    },
  });
  assertOwnPrototypes(value);
  return value;
}
export function encodeJson(value: unknown): string {
  const encoded = stringify(value);
  if (encoded === undefined) throw new WrappError('INVALID_INPUT', 'encode');
  return encoded;
}
export function identity(
  reference: InvoiceReference,
  record: { id: string; external_id: string | null },
): IdentityEvidence {
  const actual = reference.kind === 'invoiceId' ? record.id : record.external_id;
  if (actual === reference.value) return 'exact';
  if (
    reference.kind === 'externalId' &&
    actual !== null &&
    /^[\x21-\x7e]+$/.test(actual) &&
    /^[\x21-\x7e]+$/.test(reference.value) &&
    actual.toLowerCase() === reference.value.toLowerCase()
  ) {
    return 'ascii-case-variant';
  }
  throw new WrappError('PROTOCOL_ERROR', 'identity');
}
const observationKeys = Object.keys(observationSchema.shape);
/**
 * Decodes what create and status return once a rejection envelope has been ruled out: a
 * pending envelope or an issued observation. Pending is decided by the status discriminator
 * alone, never by a failure code, a number or a date.
 */
export function invoiceOutcome(
  value: unknown,
  reference: InvoiceReference,
  operation: string,
): InvoiceStatusOutcome {
  if (value === null || typeof value !== 'object' || !('status' in value)) {
    const invoice = decode(observationSchema, value, operation);
    return freeze({ kind: 'observed', invoice, identity: identity(reference, invoice) });
  }
  const pending = decode(pendingSchema, value, operation);
  // One known observation field makes this the enriched form, and then all of it must be
  // valid: malformed evidence is never stripped to fall back on the minimal form.
  if (observationKeys.some((key) => key in value)) {
    const invoice = decode(observationSchema, value, operation);
    if (invoice.id !== pending.invoice_id) throw new WrappError('PROTOCOL_ERROR', operation);
    return freeze({
      kind: 'pending',
      invoiceId: pending.invoice_id,
      referenceState: 'unknown',
      identity: identity(reference, invoice),
      invoice,
    });
  }
  // The minimal form echoes no reference. A provider id can confirm a lookup by that id; it
  // is never compared with an external reference.
  if (reference.kind === 'invoiceId' && pending.invoice_id !== reference.value)
    throw new WrappError('PROTOCOL_ERROR', operation);
  return freeze({
    kind: 'pending',
    invoiceId: pending.invoice_id,
    referenceState: 'unknown',
    identity: reference.kind === 'invoiceId' ? 'exact' : 'unavailable',
  });
}
