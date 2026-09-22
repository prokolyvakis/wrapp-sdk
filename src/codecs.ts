import { z } from 'zod';
import { LosslessNumber, parse, stringify } from 'lossless-json';
import { WrappError } from './errors.js';
import { calendarDate, decimal, freeze, isCalendarDate } from './values.js';
import type { IdentityEvidence, InvoiceReference, RejectionSource } from './types.js';

const text = z.string().max(4096);
const nonempty = text.min(1);
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
const httpsUrl = nonempty.refine((v) => {
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
const integerString = token.refine((v) => /^\d{1,30}$/.test(v.value)).transform((v) => v.value);
const numericGrammar = /^(0|[1-9]\d{0,29})(\.\d{1,12})?([eE][+-]?\d{1,2})?$/;
// Staging serializes some numeric fields as JSON strings (observed 2026-09-22: line
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
// Monetary totals stay at 2 fraction digits; rates and quantities may need more (V07 is open).
const inputAmount = inputDecimal.refine((v) => /^\d+(\.\d{1,2})?$/.test(v.value));
const isoDate = z.string().refine(isCalendarDate).transform(calendarDate);
const providerDate = z
  .string()
  .regex(/^\d{2}-\d{2}-\d{4}$/)
  .transform((v) => `${v.slice(6)}-${v.slice(3, 5)}-${v.slice(0, 2)}`)
  .pipe(isoDate);
// Docs show "2026-05-13 10:00:00 +0300"; staging emits ISO "2026-09-18T14:28:41+03:00"
// (observed 2026-09-22). Both separators and offset spellings are accepted, never reparsed.
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
  quantity_type: z.number().int().min(1).max(100).optional(),
  unit_price: inputDecimal,
  net_total_price: inputAmount,
  vat_rate: z.number().int().min(0).max(100),
  vat_total: inputAmount,
  subtotal: inputAmount,
  vat_exemption_code: z.number().int().min(1).max(1000).optional(),
  classification_category: nonempty,
  classification_type: nonempty,
};
export const createSchema = z
  .strictObject({
    external_id: identifier,
    billing_book_id: identifier,
    invoice_type_code: z.enum(['2.1', '2.2', '2.3', '11.2']),
    payment_method_type: z.number().int().min(0).max(7),
    counterpart: z.strictObject(counterpartFields),
    net_total_amount: inputAmount,
    vat_total_amount: inputAmount,
    total_amount: inputAmount,
    payable_total_amount: inputAmount,
    invoice_lines: z
      .array(
        z
          .strictObject(lineFields)
          .refine((v) => v.vat_rate !== 0 || v.vat_exemption_code !== undefined),
      )
      .min(1)
      .max(1000),
    branch: identifier.optional(),
    payment_details: text.optional(),
    notes: text.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    exchange_rate: inputDecimal.optional(),
    correlated_invoices: z.array(identifier).max(100).optional(),
    customer_emails: z.array(nonempty).max(100).optional(),
    email_locale: z.enum(['el', 'en']).optional(),
    generate_pdf: z.boolean().optional(),
    mark_as_paid: z.boolean().optional(),
  })
  .refine((v) => (v.currency === undefined) === (v.exchange_rate === undefined))
  .refine(
    (v) =>
      v.invoice_type_code === '11.2' ||
      [
        v.counterpart.country_code,
        v.counterpart.vat,
        v.counterpart.city,
        v.counterpart.street,
        v.counterpart.number,
        v.counterpart.postal_code,
      ].every((field) => field !== undefined && field.length > 0),
  )
  .refine(
    (v) => new Set(v.invoice_lines.map((l) => l.line_number)).size === v.invoice_lines.length,
  );

export const observationSchema = z.object({
  id: identifier,
  external_id: identifier.nullable(),
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
});
export const detailsSchema = z.object({
  id: identifier,
  external_id: identifier.nullable(),
  invoice_type_code: nonempty,
  billing_book_id: identifier,
  issued_at: timestamp,
  code: text,
  currency: nonempty,
  net_total_amount: numericText,
  vat_total_amount: numericText,
  total_amount: numericText,
  payable_total_amount: numericText,
  // Observed 2026-09-22: staging sends vat: "" for counterparts without a VAT number.
  counterpart: z.object({ ...counterpartFields, vat: text.optional() }),
  invoice_lines: z
    .array(
      z.object({
        line_number: integer,
        name: nonempty,
        quantity: numericText,
        unit_price: numericText,
        net_total_price: numericText,
        vat_rate: integer,
        vat_total: numericText,
        subtotal: numericText,
        classification_category: nonempty,
        classification_type: nonempty,
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
// Observed 2026-09-22: staging serializes the branch code as a JSON number (code: 0).
export const branchesSchema = z
  .array(z.object({ id: identifier, name: nonempty, code: z.union([text, integerString]) }))
  .max(10_000);
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
const errorsSchema = z
  .array(
    z
      .object({ title: text.optional(), message: text.optional(), code: text.optional() })
      .refine((v) => v.title !== undefined || v.message !== undefined || v.code !== undefined),
  )
  .min(1)
  .max(100);
const errorEnvelope = z.object({ errors: errorsSchema, status: text.optional() });
function sourceOf(status: string | undefined): RejectionSource {
  if (status === undefined) return 'unknown';
  if (status === 'Invoice Errors') return 'invoice-errors';
  if (status === 'myDATA Errors') return 'mydata-errors';
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
