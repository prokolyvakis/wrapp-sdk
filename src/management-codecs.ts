import { z } from 'zod';
import { identifier, integerString, nonempty, text } from './codecs.js';
import { invoiceTypeCatalogue } from './invoice-contracts.js';

// A request integer that JSON and JavaScript both hold exactly.
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const branchFields = {
  name: nonempty,
  code: count,
  address: nonempty,
  street_number: nonempty,
  city: nonempty,
  postal_code: nonempty,
  phone: text.optional(),
  address_en: text.optional(),
  city_en: text.optional(),
  default_option: z.boolean().optional(),
  company_activity: text.optional(),
  company_activity_en: text.optional(),
};
export const branchCreateSchema = z.strictObject(branchFields);
// Every field optional, each keeping its own rule when sent; an empty patch changes nothing
// and is refused rather than dispatched.
export const branchUpdateSchema = z
  .strictObject(branchFields)
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined));
export const billingBookCreateSchema = z.strictObject({
  name: nonempty,
  series: nonempty,
  number: count,
  // Any type code of the provider reference: a book can exist for a type create cannot issue.
  invoice_type_code: z.enum(invoiceTypeCatalogue.map((entry) => entry.code)),
});
// The one field the provider lets a book change: a name sent in its place is refused there.
export const billingBookNumberSchema = z.strictObject({ number: count });
// The creation answer has no number in the reference, unlike a listed book.
export const billingBookReceiptSchema = z.object({
  id: identifier,
  name: nonempty,
  series: text,
  invoice_type_code: nonempty,
  number: integerString.exactOptional(),
});
