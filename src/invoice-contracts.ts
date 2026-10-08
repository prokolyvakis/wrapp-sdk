import type { CreateInvoiceInput } from './types.js';

/**
 * Which counterpart a supported type needs before any request is made: its full identity and
 * address, its name alone, or none at all ('optional': when one is sent, its name is needed).
 */
export type CounterpartRule = 'business-identity' | 'name-only' | 'optional';
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
 *   was observed on a receipt note, so the delivery flag is refused there;
 * - expenseLines: every line carries expense: true, the shape in which the type was accepted;
 * - noVat: the authority refuses VAT on the type. 'exempt': every line has vat_rate 0, and
 *   with it the exemption code every zero-rate line needs. 'plain': every line has vat_rate 0
 *   and no exemption code, which the authority refuses on this type;
 * - accommodationTax: the root other_taxes_amount is required, and every line carries
 *   accommodation_tax, other_taxes_percent_category and other_taxes_amount. The type was
 *   observed to be accepted with zero net and VAT totals and zero-value lines at vat_rate 24,
 *   and is sent only so: net_total_amount and vat_total_amount zero, every line with
 *   net_total_price 0, vat_rate 24, vat_total 0 and subtotal 0;
 * - cateringTable: where the two catering table fields may appear. 'order-note': at most one
 *   of catering_table_id and catering_table_name. 'closing-receipt': catering_table_id only,
 *   and only with the marks of the order notes being closed. Everywhere else both are refused.
 */
export interface TypeRules {
  readonly correlatedInvoices?: true;
  readonly expenseLines?: true;
  readonly noVat?: 'exempt' | 'plain';
  readonly accommodationTax?: true;
  readonly cateringTable?: 'order-note' | 'closing-receipt';
  readonly zeroTotals?: true;
  readonly zeroValueLines?: true;
  readonly deliveryNote?: true;
  readonly receivingNote?: 'correlated' | 'uncorrelated';
}
/**
 * Why a code the provider lists is not accepted by create, as observed on the provider:
 * - 'own-fields': the type was issued, but with request fields of its own that this SDK
 *   does not send yet;
 * - 'no-accepted-shape': no request shape was found that the provider and the tax authority
 *   both accept;
 * - 'other-party-issuer': a document whose issuer is the other party. The tax authority
 *   refuses it when the tenant transmits it through the provider.
 */
export type UnsupportedReason = 'own-fields' | 'no-accepted-shape' | 'other-party-issuer';
export type InvoiceTypeContract =
  | Readonly<{ code: string; supported: true; counterpart: CounterpartRule; rules?: TypeRules }>
  | Readonly<{ code: string; supported: false; reason: UnsupportedReason }>;

const open = (code: string, reason: UnsupportedReason) =>
  ({ code, supported: false, reason }) as const;
const business = (code: string, rules?: TypeRules) =>
  ({
    code,
    supported: true,
    counterpart: 'business-identity',
    ...(rules ? { rules } : {}),
  }) as const;
const optional = (code: string, rules?: TypeRules) =>
  ({ code, supported: true, counterpart: 'optional', ...(rules ? { rules } : {}) }) as const;
/**
 * Every invoice type code of the provider reference, in its order, and what this SDK does
 * with each. Listing a code is bookkeeping: create accepts a code only once its whole request
 * profile and its responses are implemented and tested. Whether a tenant may issue a type at
 * all is decided by the provider and the tax authority, never here.
 */
export const invoiceTypeCatalogue: readonly InvoiceTypeContract[] = Object.freeze([
  business('1.1'),
  business('1.2'),
  business('1.3'),
  business('1.4'),
  open('1.5', 'no-accepted-shape'),
  business('1.6', { correlatedInvoices: true }),
  business('2.1'),
  business('2.2'),
  business('2.3'),
  business('2.4', { correlatedInvoices: true }),
  business('3.1', { expenseLines: true, noVat: 'exempt' }),
  business('3.2', { expenseLines: true, noVat: 'exempt' }),
  business('5.1', { correlatedInvoices: true }),
  business('5.2'),
  optional('6.1'),
  optional('6.2'),
  business('7.1'),
  business('8.1', { noVat: 'plain' }),
  business('8.2', { accommodationTax: true }),
  open('8.4', 'own-fields'),
  open('8.5', 'own-fields'),
  optional('8.6', { cateringTable: 'order-note' }),
  business('9.2', { zeroTotals: true, zeroValueLines: true, deliveryNote: true }),
  business('9.3', { zeroTotals: true, zeroValueLines: true, deliveryNote: true }),
  business('10.1', { zeroTotals: true, zeroValueLines: true, receivingNote: 'correlated' }),
  business('10.2', { zeroTotals: true, zeroValueLines: true, receivingNote: 'uncorrelated' }),
  {
    code: '11.1',
    supported: true,
    counterpart: 'name-only',
    rules: { cateringTable: 'closing-receipt' },
  },
  { code: '11.2', supported: true, counterpart: 'name-only' },
  { code: '11.3', supported: true, counterpart: 'name-only' },
  { code: '11.4', supported: true, counterpart: 'name-only' },
  business('11.5'),
  ...['13.1', '13.2', '13.3', '13.4', '13.30', '13.31'].map((code) =>
    open(code, 'other-party-issuer'),
  ),
  ...['14.1', '14.2', '14.3', '14.4', '14.5', '14.30', '14.31'].map((code) =>
    open(code, 'other-party-issuer'),
  ),
  ...['15.1', '16.1'].map((code) => open(code, 'other-party-issuer')),
  ...['17.1', '17.2', '17.3', '17.4', '17.5', '17.6'].map((code) =>
    open(code, 'no-accepted-shape'),
  ),
]);

type SupportedCode = CreateInvoiceInput['invoice_type_code'];
/** The codes create accepts. The public input type names exactly these. */
export const supportedInvoiceTypeCodes = [
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.6',
  '2.1',
  '2.2',
  '2.3',
  '2.4',
  '3.1',
  '3.2',
  '5.1',
  '5.2',
  '6.1',
  '6.2',
  '7.1',
  '8.1',
  '8.2',
  '8.6',
  '9.2',
  '9.3',
  '10.1',
  '10.2',
  '11.1',
  '11.2',
  '11.3',
  '11.4',
  '11.5',
] as const;
// The tuple above and the public input type must name the same codes, in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const catalogueMatchesInputType: Same<
  (typeof supportedInvoiceTypeCodes)[number],
  SupportedCode
> = true;

/**
 * The reference accepts third_party_collection on these types only. create() knows the field
 * so that accepting either type enables it; neither is accepted yet, so it is refused today.
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
