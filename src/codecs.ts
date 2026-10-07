import { z } from 'zod';
import { LosslessNumber, parse, stringify } from 'lossless-json';
import { WrappError } from './errors.js';
import {
  supportedInvoiceTypeCodes,
  thirdPartyCollectionTypes,
  typeProfile,
} from './invoice-contracts.js';
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
// Monetary totals stay at 2 fraction digits. Quantities and unit prices keep the full
// precision: the provider was observed to accept and return more than 2 digits for both.
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
// A timestamp with optional fraction, ending in Z or an offset: the reference shows this form
// on catering order notes and digital transports. Returned verbatim, never reparsed.
export const instant = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z| ?[+-](?:0\d|1[0-4]):?[0-5]\d)$/.test(
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
  fuel_code: member([
    10, 11, 12, 13, 14, 15, 20, 21, 30, 31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 50, 60,
    61, 70, 71, 72, 999,
  ]).optional(),
  cpv_code: nonempty.optional(),
};
// Line fields the reference defines for invoice types create() does not issue yet: the
// accommodation-tax fields of type 8.2 and the detail type of type 1.5. Each codec is complete
// and tested on its own. create() knows the fields and refuses each on any other type, so they
// are refused today and become usable only when their type is promoted.
export const profileLineFields = {
  other_taxes_amount: inputAmount,
  accommodation_tax: inputAmount,
  // The codes the reference lists for this request field, not its general other-tax table.
  other_taxes_percent_category: z.enum([
    '6',
    '7',
    '8',
    '9',
    '10',
    '17',
    '20',
    '21',
    '22',
    '23',
    '24',
    '25',
    '26',
    '27',
    '28',
    '29',
    '30',
  ]),
  invoice_detail_type: member([1, 2]),
};
export const profileLineFieldTypes: Readonly<
  Record<keyof typeof profileLineFields, readonly string[]>
> = {
  other_taxes_amount: ['8.2'],
  accommodation_tax: ['8.2'],
  other_taxes_percent_category: ['8.2'],
  invoice_detail_type: ['1.5'],
};
const profileLineKeys = Object.keys(profileLineFields) as (keyof typeof profileLineFields)[];
// "DD-MM-YYYY" and "HH:MM", as the reference writes them for a dispatch. The date must exist.
const dispatchDate = z
  .string()
  .refine(
    (v) =>
      /^\d{2}-\d{2}-\d{4}$/.test(v) &&
      isCalendarDate(`${v.slice(6)}-${v.slice(3, 5)}-${v.slice(0, 2)}`),
  );
const dispatchTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
// Codes 1 to 20 without 6, 15, 16, 17 and 18, as strings.
const purposeOfMovement = z.enum([
  '1',
  '2',
  '3',
  '4',
  '5',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '19',
  '20',
]);
const branchCode = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
// The delivery detail. Its two branch fields are branch codes, sent as JSON integers: the
// provider was observed to accept and return them so. No code is checked against a branch.
const deliveryDetailSchema = z
  .strictObject({
    dispatch_date: dispatchDate,
    dispatch_time: dispatchTime,
    vehicle_number: nonempty,
    purpose_of_movement: purposeOfMovement,
    purpose_of_movement_custom_title: nonempty.optional(),
    issuer_of_movement: nonempty,
    from_address: nonempty,
    from_number: nonempty,
    from_city: nonempty,
    from_zipcode: nonempty,
    to_address: nonempty,
    to_number: nonempty,
    to_city: nonempty,
    to_zipcode: nonempty,
    reverse_delivery_note: z.boolean().optional(),
    reverse_delivery_note_purpose: member([1, 2, 3, 4, 5]).optional(),
    non_obligated_recipient: z.boolean().optional(),
    without_digital_transport_tracking: z.boolean().optional(),
    from_branch: branchCode.optional(),
    to_branch: branchCode.optional(),
  })
  .refine((v) => v.purpose_of_movement !== '19' || v.purpose_of_movement_custom_title !== undefined)
  .refine((v) => v.reverse_delivery_note !== true || v.reverse_delivery_note_purpose !== undefined)
  .refine(
    (v) => !(v.non_obligated_recipient === true && v.without_digital_transport_tracking === true),
  );
const correlatedEntitySchema = z.strictObject({
  entity_type: member([1, 2, 3, 4, 5, 6]),
  vat_number: nonempty,
  country_code: z.string().regex(/^[A-Z]{2}$/),
  branch_code: branchCode,
  name: nonempty,
  street: nonempty,
  number: nonempty,
  postal_code: nonempty,
  city: nonempty,
});
const isZero = (amount: LosslessNumber) => /^0+(?:\.0+)?$/.test(amount.value);
// The invoice fields the reference marks "required for B2G". These address fields belong to
// the B2G invoice itself and are unrelated to the delivery-note object.
const b2gRequiredFields = {
  delivery_address_city: nonempty.optional(),
  delivery_address_street: nonempty.optional(),
  delivery_address_street_number: nonempty.optional(),
  delivery_address_postal_code: nonempty.optional(),
  delivery_address_party_name: nonempty.optional(),
  b2g_contracting_authority_id: nonempty.optional(),
  b2g_contract_identifier: nonempty.optional(),
  b2g_budget_type: member([1, 2, 3]).optional(),
  b2g_budget_identifier: nonempty.optional(),
  b2g_payment_details: nonempty.optional(),
  b2g_due_date: isoDate.optional(),
};
const b2gRequiredKeys = Object.keys(b2gRequiredFields) as (keyof typeof b2gRequiredFields)[];
// Presence rules the reference states for one line. They require a field to be there; they
// never compute or compare an amount.
const lineSchema = z
  .strictObject({
    ...lineFields,
    other_taxes_amount: profileLineFields.other_taxes_amount.optional(),
    accommodation_tax: profileLineFields.accommodation_tax.optional(),
    other_taxes_percent_category: profileLineFields.other_taxes_percent_category.optional(),
    invoice_detail_type: profileLineFields.invoice_detail_type.optional(),
  })
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
// An amount of at most 2 fraction digits as a whole number of hundredths. Exact: the digits
// are aligned and compared as integers, never through a binary floating-point number.
function hundredths(amount: LosslessNumber): bigint {
  const [whole = '0', fraction = ''] = amount.value.split('.');
  return BigInt(whole + fraction.padEnd(2, '0'));
}
// The reference allows fuel code 999 on one line only, with a net value no greater than the
// sum of the net values of the other lines. Only that stated inequality is checked; no total
// is derived, corrected or compared with the invoice totals.
function fuelChargeWithinOtherLines(
  lines: readonly { fuel_code?: number | undefined; net_total_price: LosslessNumber }[],
): boolean {
  const charges = lines.filter((line) => line.fuel_code === 999);
  const [charge] = charges;
  if (charge === undefined) return true;
  if (charges.length > 1) return false;
  const others = lines
    .filter((line) => line !== charge)
    .reduce((sum, line) => sum + hundredths(line.net_total_price), 0n);
  return hundredths(charge.net_total_price) <= others;
}
export const createSchema = z
  .strictObject({
    external_id: identifier,
    billing_book_id: identifier,
    invoice_type_code: z.enum(supportedInvoiceTypeCodes),
    payment_method_type: z.number().int().min(0).max(7),
    counterpart: z.strictObject({
      ...counterpartFields,
      // A request field only: the shared fields above also shape the counterpart that reads
      // return, and no returned supply account is claimed. The provider documents that it
      // ignores this on an invoice that is not a fuel invoice, so it is sent as given either
      // way and never required.
      supply_account_no: nonempty.optional(),
    }),
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
    pos_device_id: identifier.optional(),
    installments: z.boolean().optional(),
    tip_amount: inputAmount.optional(),
    third_party_collection: z.boolean().optional(),
    fuel_invoice: z.boolean().optional(),
    b2g: z.boolean().optional(),
    ...b2gRequiredFields,
    b2g_buyer_reference: text.optional(),
    b2g_bt_70: text.optional(),
    is_delivery_note: z.boolean().optional(),
    delivery_detail: deliveryDetailSchema.optional(),
    other_correlated_entities: z.array(correlatedEntitySchema).max(100).optional(),
    receiving_note_purpose: member([1, 2, 3, 4, 5, 6, 7]).optional(),
    other_receiving_note_purpose_title: nonempty.max(150).optional(),
  })
  .refine((v) => (v.currency === undefined) === (v.exchange_rate === undefined))
  // Per-profile refinement, kept apart from the field validation above: a business profile
  // needs the counterpart's identity and address, a retail one only its name.
  .refine((v) => {
    if (typeProfile(v.invoice_type_code).counterpart === 'name-only') return true;
    const { country_code, vat, city, street, number, postal_code } = v.counterpart;
    return [country_code, vat, city, street, number, postal_code].every(
      (field) => field !== undefined && field.length > 0,
    );
  })
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
  )
  // Whether the device is a terminal that offers installments is the provider's to decide;
  // no device is looked up here.
  .refine((v) => v.installments !== true || v.pos_device_id !== undefined)
  .refine(
    (v) =>
      v.third_party_collection === undefined ||
      thirdPartyCollectionTypes.includes(v.invoice_type_code),
  )
  // The provider refuses a fuel code on an invoice not sent as a fuel invoice.
  .refine((v) => v.fuel_invoice === true || v.invoice_lines.every((l) => l.fuel_code === undefined))
  .refine((v) => fuelChargeWithinOtherLines(v.invoice_lines))
  .refine((v) =>
    v.invoice_lines.every((l) =>
      profileLineKeys.every(
        (key) => l[key] === undefined || profileLineFieldTypes[key].includes(v.invoice_type_code),
      ),
    ),
  )
  // The flag and the detail are sent together or not at all.
  .refine((v) => (v.is_delivery_note === true) === (v.delivery_detail !== undefined))
  // The rules of particular invoice types. See TypeRules.
  .refine((v) => {
    const { rules } = typeProfile(v.invoice_type_code);
    const marked = v.correlated_invoices !== undefined && v.correlated_invoices.length > 0;
    if (rules.correlatedInvoices === true && !marked) return false;
    if (rules.deliveryNote === true && v.is_delivery_note !== true) return false;
    if (rules.receivingNote !== undefined && v.is_delivery_note === true) return false;
    if (
      rules.zeroTotals === true &&
      !(
        isZero(v.net_total_amount) &&
        isZero(v.vat_total_amount) &&
        isZero(v.total_amount) &&
        isZero(v.payable_total_amount)
      )
    )
      return false;
    if (
      rules.zeroValueLines === true &&
      !v.invoice_lines.every(
        (l) =>
          isZero(l.net_total_price) &&
          l.vat_rate === 24 &&
          isZero(l.vat_total) &&
          isZero(l.subtotal) &&
          l.classification_category === 'category3' &&
          l.classifications === undefined,
      )
    )
      return false;
    if (rules.receivingNote === undefined)
      return (
        v.receiving_note_purpose === undefined && v.other_receiving_note_purpose_title === undefined
      );
    if (v.receiving_note_purpose === undefined) return false;
    if (v.receiving_note_purpose === 5 && rules.receivingNote !== 'correlated') return false;
    if (v.receiving_note_purpose === 7 && v.other_receiving_note_purpose_title === undefined)
      return false;
    return rules.receivingNote !== 'correlated' || marked;
  })
  // Presence only: no authority, contract or budget is looked up or checked for meaning.
  .refine(
    (v) =>
      v.b2g !== true ||
      (b2gRequiredKeys.every((key) => v[key] !== undefined) &&
        v.invoice_lines.every((l) => l.cpv_code !== undefined)),
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
  // member sets. Provider-observed: a field the provider has no value for comes back as
  // null (a line's code is null on almost every record), so null is kept as null and stays
  // distinct from an absent field.
  payment_method: integerString.nullable().exactOptional(),
  branch: integerString.nullable().exactOptional(),
  is_delivery_note: z.boolean().nullable().exactOptional(),
  fuel_invoice: z.boolean().nullable().exactOptional(),
  third_party_collection: z.boolean().nullable().exactOptional(),
  currency: nonempty,
  exchange_rate: numericText.nullable().exactOptional(),
  other_taxes_amount: numericText.nullable().exactOptional(),
  net_total_amount: numericText,
  vat_total_amount: numericText,
  total_amount: numericText,
  payable_total_amount: numericText,
  notes: text.nullable().exactOptional(),
  withholding_total_amount: numericText.nullable().exactOptional(),
  total_stamp_duty_amount: numericText.nullable().exactOptional(),
  special_invoice_category: integerString.nullable().exactOptional(),
  // Provider-observed shapes of the two structured fields, present only on a delivery note
  // and on a B2G invoice. Every member is optional and nullable; dates are the provider's
  // DD-MM-YYYY text, returned as written.
  delivery_details: z
    .object({
      dispatch_date: text.nullable().exactOptional(),
      dispatch_time: text.nullable().exactOptional(),
      vehicle_number: text.nullable().exactOptional(),
      purpose_of_movement: text.nullable().exactOptional(),
      purpose_of_movement_custom_title: text.nullable().exactOptional(),
      issuer_of_movement: text.nullable().exactOptional(),
      from_address: text.nullable().exactOptional(),
      from_number: text.nullable().exactOptional(),
      from_city: text.nullable().exactOptional(),
      from_zipcode: text.nullable().exactOptional(),
      from_branch: integerString.nullable().exactOptional(),
      to_address: text.nullable().exactOptional(),
      to_number: text.nullable().exactOptional(),
      to_city: text.nullable().exactOptional(),
      to_zipcode: text.nullable().exactOptional(),
      to_branch: integerString.nullable().exactOptional(),
      reverse_delivery_note: z.boolean().nullable().exactOptional(),
      reverse_delivery_note_purpose: integerString.nullable().exactOptional(),
      non_obligated_recipient: z.boolean().nullable().exactOptional(),
      without_digital_transport_tracking: z.boolean().nullable().exactOptional(),
    })
    .nullable()
    .exactOptional(),
  b2g_details: z
    .object({
      buyer_reference: text.nullable().exactOptional(),
      delivery_address_city: text.nullable().exactOptional(),
      delivery_address_street: text.nullable().exactOptional(),
      delivery_address_street_number: text.nullable().exactOptional(),
      delivery_address_postal_code: text.nullable().exactOptional(),
      delivery_address_party_name: text.nullable().exactOptional(),
      b2g_contracting_authority_id: text.nullable().exactOptional(),
      b2g_contract_identifier: text.nullable().exactOptional(),
      b2g_budget_type: integerString.nullable().exactOptional(),
      b2g_budget_identifier: text.nullable().exactOptional(),
      b2g_due_date: text.nullable().exactOptional(),
      b2g_payment_details: text.nullable().exactOptional(),
      bt_70: text.nullable().exactOptional(),
    })
    .nullable()
    .exactOptional(),
  // Provider-observed: the wire carries vat: "" for counterparts without a VAT number, and
  // an empty name on a record that has no counterpart at all. The supply account is present
  // on a fuel invoice only.
  counterpart: z.object({
    ...counterpartFields,
    name: text,
    vat: text.optional(),
    supply_account_no: text.nullable().exactOptional(),
  }),
  // A list returns every invoice of the tenant, including types create() does not issue.
  // Provider-observed on such records: an empty line name, and null for the VAT rate and
  // for either classification field. One such record must not fail the whole read.
  invoice_lines: z
    .array(
      z.object({
        line_number: integer,
        name: text,
        code: text.nullable().exactOptional(),
        description: text.nullable().exactOptional(),
        quantity: numericText,
        quantity_type: integerString.nullable().exactOptional(),
        unit_price: numericText,
        net_total_price: numericText,
        vat_rate: integer.nullable(),
        vat_total: numericText,
        subtotal: numericText,
        // Provider-observed: a JSON string, "20" when set and "" when the line has none.
        withhold_tax_rate: z
          .union([numericText, z.literal('')])
          .nullable()
          .exactOptional(),
        withhold_tax_code: text.nullable().exactOptional(),
        withholding_total: numericText.nullable().exactOptional(),
        classification_category: text.nullable(),
        classification_type: text.nullable(),
        stamp_duty_tax_code: text.nullable().exactOptional(),
        stamp_duty_amount: numericText.nullable().exactOptional(),
        deductions_amount: numericText.nullable().exactOptional(),
        deductions: z
          .array(
            z.object({
              title: text.nullable().exactOptional(),
              amount: numericText,
              informational: z.boolean().nullable().exactOptional(),
            }),
          )
          .max(1000)
          .nullable()
          .exactOptional(),
        fuel_code: integerString.nullable().exactOptional(),
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
export const bookSchema = z.object({
  id: identifier,
  name: nonempty,
  series: text,
  invoice_type_code: nonempty,
  number: integerString,
});
export const booksSchema = z.array(bookSchema).max(10_000);
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
// The same key with a primitive value leaves no trace at all: it is silently dropped. The
// native parser keeps "__proto__" as an own property, so it is used to find the key. Only a
// text that can spell the key, literally or through an escape, pays for the second pass.
function hasProtoKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return Object.hasOwn(value, '__proto__') || Object.values(value).some(hasProtoKey);
}
// Both parsers recurse once per level of nesting, so a deeply nested body would exhaust the
// stack inside them. Depth is bounded here first, by a linear scan that ignores brackets
// inside strings. No documented answer comes near the limit.
const maxJsonDepth = 64;
function nestedTooDeep(textValue: string): boolean {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < textValue.length; index += 1) {
    const code = textValue.charCodeAt(index);
    if (inString) {
      // A backslash escapes the next character, a quote included.
      if (code === 92) index += 1;
      else if (code === 34) inString = false;
    } else if (code === 34) inString = true;
    else if (code === 91 || code === 123) {
      depth += 1;
      if (depth > maxJsonDepth) return true;
    } else if (code === 93 || code === 125) depth -= 1;
  }
  return false;
}
export function parseJson(textValue: string): unknown {
  if (nestedTooDeep(textValue)) throw new Error('JSON nested too deeply');
  if (/__proto__|\\u/i.test(textValue) && hasProtoKey(JSON.parse(textValue)))
    throw new Error('Forbidden JSON key');
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
