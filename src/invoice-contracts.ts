import type { CreateInvoiceInput } from './types.js';

/**
 * Which counterpart fields a profile requires before any request is made.
 * 'name-and-address' is the rule the reference states for type 9.2: the name and the address,
 * without a tax id.
 */
export type CounterpartRule = 'business-identity' | 'name-only' | 'name-and-address';
/**
 * The rules the reference states for one invoice type, beyond the general request rules.
 * Each is a presence or exact-value rule quoted from the reference; none is a calculation.
 * - zeroTotals: vat_total_amount, total_amount and payable_total_amount "need to be 0";
 * - deliveryNote: is_delivery_note is "mandatory", and with it the delivery detail;
 * - categoryThreeLines: every line keeps vat_rate 24, vat_total 0, subtotal 0 and the scalar
 *   classification_category 'category3'. A classifications array would override that
 *   category, and the reference documents none for the type, so one is refused;
 * - receivingNote: receiving_note_purpose is "mandatory"; a 'correlated' note also needs the
 *   mark of the delivery note being received, and only it accepts purpose 5. The reference
 *   ties the delivery fields to delivery notes and says nothing of them for a receipt note,
 *   so they are refused there.
 */
export interface TypeRules {
  readonly zeroTotals?: true;
  readonly deliveryNote?: true;
  readonly categoryThreeLines?: true;
  readonly receivingNote?: 'correlated' | 'uncorrelated';
}
/**
 * Why a code the provider lists is not accepted by create:
 * - 'field-notes-only': the reference states rules for the type in field notes but shows no
 *   request for it, so its whole profile is not known. The stated rules are implemented and
 *   tested as a prepared profile; the type is not accepted until a request is evidenced;
 * - 'catering-profile': the reference's catering examples conflict with its general rules;
 * - 'partly-documented': the reference gives some rule or an example specific to the type,
 *   but not its complete profile;
 * - 'listed-only': the reference lists the code without any type-specific rule.
 */
export type UnsupportedReason =
  'field-notes-only' | 'catering-profile' | 'partly-documented' | 'listed-only';
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
  open('9.2', 'field-notes-only'),
  open('9.3', 'field-notes-only'),
  open('10.1', 'field-notes-only'),
  open('10.2', 'field-notes-only'),
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

/**
 * The reference accepts third_party_collection on these types only. create() knows the field
 * so that promoting either type enables it; neither is issued yet, so it is refused today.
 */
export const thirdPartyCollectionTypes: readonly string[] = ['8.4', '8.5'];

/**
 * Profiles prepared for types create() does not accept. Each holds exactly the rules the
 * reference states for its type; where it states nothing, the general rule applies, which is
 * why three of them keep the full counterpart rule. No operation uses these: they exist so
 * that the stated rules are executable and tested, and accepting a type later is a reviewed
 * decision about evidence, not new code.
 */
export const preparedInvoiceTypeCodes = ['9.2', '9.3', '10.1', '10.2'] as const;
export const preparedTypeProfiles: Readonly<
  Record<
    (typeof preparedInvoiceTypeCodes)[number],
    Readonly<{ counterpart: CounterpartRule; rules: TypeRules }>
  >
> = Object.freeze({
  '9.2': { counterpart: 'name-and-address', rules: { zeroTotals: true, deliveryNote: true } },
  '9.3': {
    counterpart: 'business-identity',
    rules: { zeroTotals: true, deliveryNote: true, categoryThreeLines: true },
  },
  '10.1': {
    counterpart: 'business-identity',
    rules: { zeroTotals: true, receivingNote: 'correlated' },
  },
  '10.2': {
    counterpart: 'business-identity',
    rules: { zeroTotals: true, receivingNote: 'uncorrelated' },
  },
});

const noRules: TypeRules = Object.freeze({});
/** The counterpart rule and type rules of a code: a supported one, or a prepared one. */
export function typeProfile(code: string): Readonly<{
  counterpart: CounterpartRule;
  rules: TypeRules;
}> {
  if (Object.hasOwn(preparedTypeProfiles, code))
    return preparedTypeProfiles[code as (typeof preparedInvoiceTypeCodes)[number]];
  const contract = invoiceTypeCatalogue.find((entry) => entry.code === code);
  // Unreachable for a validated code; a business profile is the stricter fallback.
  return {
    counterpart: contract?.supported === true ? contract.counterpart : 'business-identity',
    rules: noRules,
  };
}
