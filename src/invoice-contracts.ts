import type { CreateInvoiceInput } from './types.js';

/** Which counterpart fields a supported profile requires before any request is made. */
export type CounterpartRule = 'business-identity' | 'name-only';
/**
 * Why a code the provider lists is not accepted by create:
 * - 'delivery-note-profile': the reference documents delivery fields and zero-total rules for
 *   the type; they are not implemented yet;
 * - 'receipt-note-profile': the reference documents quantity-receipt rules for the type
 *   (purpose code, correlated marks, zero totals); they are not implemented yet;
 * - 'catering-profile': the reference's catering examples conflict with its general rules;
 * - 'partly-documented': the reference gives some rule or an example specific to the type,
 *   but not its complete profile;
 * - 'listed-only': the reference lists the code without any type-specific rule.
 */
export type UnsupportedReason =
  | 'delivery-note-profile'
  | 'receipt-note-profile'
  | 'catering-profile'
  | 'partly-documented'
  | 'listed-only';
export type InvoiceTypeContract =
  | Readonly<{ code: string; supported: true; counterpart: CounterpartRule }>
  | Readonly<{ code: string; supported: false; reason: UnsupportedReason }>;

const open = (code: string, reason: UnsupportedReason = 'listed-only') =>
  ({ code, supported: false, reason }) as const;
/**
 * Every invoice type code of the provider reference, in its order, and what this SDK does
 * with each. Listing a code is bookkeeping: create accepts a code only once its whole request
 * profile and its responses are implemented and tested. Whether a tenant may issue a type at
 * all is decided by the provider and the tax authority, never here.
 */
export const invoiceTypeCatalogue: readonly InvoiceTypeContract[] = Object.freeze([
  open('1.1', 'partly-documented'),
  open('1.2'),
  open('1.3'),
  open('1.4'),
  open('1.5', 'partly-documented'),
  open('1.6'),
  { code: '2.1', supported: true, counterpart: 'business-identity' },
  { code: '2.2', supported: true, counterpart: 'business-identity' },
  { code: '2.3', supported: true, counterpart: 'business-identity' },
  open('2.4'),
  open('3.1'),
  open('3.2'),
  open('5.1'),
  open('5.2'),
  open('6.1'),
  open('6.2'),
  open('7.1'),
  open('8.1'),
  open('8.2', 'partly-documented'),
  open('8.4', 'partly-documented'),
  open('8.5', 'partly-documented'),
  open('8.6', 'catering-profile'),
  open('9.2', 'delivery-note-profile'),
  open('9.3', 'delivery-note-profile'),
  open('10.1', 'receipt-note-profile'),
  open('10.2', 'receipt-note-profile'),
  open('11.1', 'partly-documented'),
  { code: '11.2', supported: true, counterpart: 'name-only' },
  open('11.3'),
  open('11.4'),
  open('11.5'),
  open('13.1'),
  open('13.2'),
  open('13.3'),
  open('13.4'),
  open('13.30'),
  open('13.31'),
  open('14.1'),
  open('14.2'),
  open('14.3'),
  open('14.4'),
  open('14.5'),
  open('14.30'),
  open('14.31'),
  open('15.1'),
  open('16.1'),
  open('17.1'),
  open('17.2'),
  open('17.3'),
  open('17.4'),
  open('17.5'),
  open('17.6'),
]);

type SupportedCode = CreateInvoiceInput['invoice_type_code'];
/** The codes create accepts. The public input type names exactly these. */
export const supportedInvoiceTypeCodes = ['2.1', '2.2', '2.3', '11.2'] as const;
// The tuple above and the public input type must name the same codes, in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const catalogueMatchesInputType: Same<
  (typeof supportedInvoiceTypeCodes)[number],
  SupportedCode
> = true;

export function counterpartRule(code: (typeof supportedInvoiceTypeCodes)[number]): CounterpartRule {
  const contract = invoiceTypeCatalogue.find((entry) => entry.code === code);
  // Unreachable for a validated code; a business profile is the stricter fallback.
  return contract?.supported === true ? contract.counterpart : 'business-identity';
}
