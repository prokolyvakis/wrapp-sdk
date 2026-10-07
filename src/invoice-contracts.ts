import type { CreateInvoiceInput } from './types.js';

/** Which counterpart fields a supported type requires before any request is made. */
export type CounterpartRule = 'business-identity' | 'name-only';
/**
 * Rules of one supported type beyond the general request rules. Each one is a presence or
 * exact-value rule that the provider or the tax authority was observed to enforce, or the
 * one shape in which the type was observed to be accepted; none is a calculation.
 * - correlatedInvoices: correlated_invoices must hold at least one mark;
 * - zeroTotals: net_total_amount, vat_total_amount, total_amount and payable_total_amount are
 *   zero. The reference names three of them; the authority also refuses a nonzero net;
 * - zeroValueLines: every line keeps net_total_price 0, vat_rate 24, vat_total 0, subtotal 0
 *   and the scalar classification_category 'category3', with no classifications array. This
 *   is the representation the reference prescribes for type 9.3 and the only one in which
 *   9.2, 10.1 and 10.2 were observed to be accepted;
 * - deliveryNote: is_delivery_note must be true, and with it the delivery detail;
 * - receivingNote: receiving_note_purpose is required; a 'correlated' note also needs the mark
 *   of the delivery note being received, and only it accepts purpose 5. No delivery field
 *   was observed on a receipt note, so the delivery flag is refused there.
 */
export interface TypeRules {
  readonly correlatedInvoices?: true;
  readonly zeroTotals?: true;
  readonly zeroValueLines?: true;
  readonly deliveryNote?: true;
  readonly receivingNote?: 'correlated' | 'uncorrelated';
}
/**
 * Why a code the provider lists is not accepted by create:
 * - 'catering-profile': the reference's catering examples conflict with its general rules;
 * - 'partly-documented': the reference gives some rule or an example specific to the type,
 *   but not its complete profile;
 * - 'listed-only': the reference lists the code without any type-specific rule.
 */
export type UnsupportedReason = 'catering-profile' | 'partly-documented' | 'listed-only';
export type InvoiceTypeContract =
  | Readonly<{ code: string; supported: true; counterpart: CounterpartRule; rules?: TypeRules }>
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
  { code: '1.1', supported: true, counterpart: 'business-identity' },
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
  {
    code: '5.1',
    supported: true,
    counterpart: 'business-identity',
    rules: { correlatedInvoices: true },
  },
  { code: '5.2', supported: true, counterpart: 'business-identity' },
  open('6.1'),
  open('6.2'),
  open('7.1'),
  open('8.1'),
  open('8.2', 'partly-documented'),
  open('8.4', 'partly-documented'),
  open('8.5', 'partly-documented'),
  open('8.6', 'catering-profile'),
  {
    code: '9.2',
    supported: true,
    counterpart: 'business-identity',
    rules: { zeroTotals: true, zeroValueLines: true, deliveryNote: true },
  },
  {
    code: '9.3',
    supported: true,
    counterpart: 'business-identity',
    rules: { zeroTotals: true, zeroValueLines: true, deliveryNote: true },
  },
  {
    code: '10.1',
    supported: true,
    counterpart: 'business-identity',
    rules: { zeroTotals: true, zeroValueLines: true, receivingNote: 'correlated' },
  },
  {
    code: '10.2',
    supported: true,
    counterpart: 'business-identity',
    rules: { zeroTotals: true, zeroValueLines: true, receivingNote: 'uncorrelated' },
  },
  { code: '11.1', supported: true, counterpart: 'name-only' },
  { code: '11.2', supported: true, counterpart: 'name-only' },
  open('11.3'),
  { code: '11.4', supported: true, counterpart: 'name-only' },
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
export const supportedInvoiceTypeCodes = [
  '1.1',
  '2.1',
  '2.2',
  '2.3',
  '5.1',
  '5.2',
  '9.2',
  '9.3',
  '10.1',
  '10.2',
  '11.1',
  '11.2',
  '11.4',
] as const;
// The tuple above and the public input type must name the same codes, in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const catalogueMatchesInputType: Same<
  (typeof supportedInvoiceTypeCodes)[number],
  SupportedCode
> = true;

/**
 * The reference accepts third_party_collection on these types only. create() knows the field
 * so that promoting either type enables it; neither is issued yet, so it is refused today.
 */
export const thirdPartyCollectionTypes: readonly string[] = ['8.4', '8.5'];

const noRules: TypeRules = Object.freeze({});
/** The counterpart rule and the type rules of a supported code. */
export function typeProfile(code: string): Readonly<{
  counterpart: CounterpartRule;
  rules: TypeRules;
}> {
  const contract = invoiceTypeCatalogue.find((entry) => entry.code === code);
  // Unreachable for a validated code; a business profile is the stricter fallback.
  return contract?.supported === true
    ? { counterpart: contract.counterpart, rules: contract.rules ?? noRules }
    : { counterpart: 'business-identity', rules: noRules };
}
