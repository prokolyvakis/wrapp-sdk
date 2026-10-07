import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as sdk from '../../src/index.js';
import type { CreateInvoiceInput } from '../../src/index.js';
import { invoiceTypeCatalogue, supportedInvoiceTypeCodes } from '../../src/invoice-contracts.js';
import type { TypeRules } from '../../src/invoice-contracts.js';
import {
  invoice,
  invoiceOfType,
  json,
  login,
  observation,
  provider,
} from '../fixtures/provider.js';

// The 52 codes of the provider reference v1.18.0, typed out here independently of the SDK's
// own catalogue so that a missing, extra or misspelled row cannot hide.
const reference = [
  ...['1.1', '1.2', '1.3', '1.4', '1.5', '1.6'],
  ...['2.1', '2.2', '2.3', '2.4'],
  ...['3.1', '3.2', '5.1', '5.2', '6.1', '6.2', '7.1'],
  ...['8.1', '8.2', '8.4', '8.5', '8.6'],
  ...['9.2', '9.3', '10.1', '10.2'],
  ...['11.1', '11.2', '11.3', '11.4', '11.5'],
  ...['13.1', '13.2', '13.3', '13.4', '13.30', '13.31'],
  ...['14.1', '14.2', '14.3', '14.4', '14.5', '14.30', '14.31'],
  ...['15.1', '16.1'],
  ...['17.1', '17.2', '17.3', '17.4', '17.5', '17.6'],
];
const accepted = [
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
const page = readFileSync(
  fileURLToPath(new URL('../../docs/invoice-capabilities.md', import.meta.url)),
  'utf8',
);
const documented = new Map(
  [...page.matchAll(/^\| (\d+\.\d+) +\| ([A-Za-z ]+?) +\| (.+?) +\|$/gm)].map((row) => [
    row[1],
    { status: row[2], detail: row[3] },
  ]),
);
// The sentence the page must give for each state, written out here so the page cannot drift
// from the catalogue in its explanation, not only in its status column.
const explanation = {
  'business-identity':
    'Counterpart name, country code, VAT number, city, street, number and postal code required',
  'name-only': 'Counterpart name required; the other counterpart fields optional',
  'catering-profile':
    'The reference shows catering examples that conflict with its general field rules; open provider question',
  'partly-documented':
    'The reference gives some rule or an example specific to this type, but not its complete profile',
  'listed-only':
    'The reference lists the code without any type-specific rule; open provider question',
} as const;
// The sentence for each type rule, in the order the page lists them.
function rulesText(rules: TypeRules | undefined): string {
  if (rules === undefined) return '';
  return [
    rules.correlatedInvoices === true ? 'the mark of the credited invoice required' : undefined,
    rules.deliveryNote === true ? 'delivery flag and delivery detail required' : undefined,
    rules.receivingNote === 'correlated'
      ? 'receiving note purpose and the mark of the received delivery note required'
      : undefined,
    rules.receivingNote === 'uncorrelated'
      ? 'receiving note purpose required, 5 not accepted'
      : undefined,
    rules.zeroTotals === true ? 'net, VAT, total and payable amounts must be zero' : undefined,
    rules.zeroValueLines === true
      ? 'every line keeps zero net, VAT rate 24, zero VAT total and subtotal, and category3'
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .map((part) => '; ' + part)
    .join('');
}

describe('invoice type catalogue', () => {
  it('should hold exactly the 52 distinct reference codes, in reference order', () => {
    expect(reference).toHaveLength(52);
    expect(new Set(reference).size).toBe(52);
    expect(invoiceTypeCatalogue.map((entry) => entry.code)).toEqual(reference);
    expect(Object.isFrozen(invoiceTypeCatalogue)).toBe(true);
  });
  it('should claim only the thirteen evidenced profiles and give every other code a reason', () => {
    const claimed = invoiceTypeCatalogue.filter((entry) => entry.supported);
    expect(claimed.map((entry) => entry.code)).toEqual(accepted);
    expect([...supportedInvoiceTypeCodes]).toEqual(accepted);
    expect(claimed).toEqual([
      { code: '1.1', supported: true, counterpart: 'business-identity' },
      { code: '2.1', supported: true, counterpart: 'business-identity' },
      { code: '2.2', supported: true, counterpart: 'business-identity' },
      { code: '2.3', supported: true, counterpart: 'business-identity' },
      {
        code: '5.1',
        supported: true,
        counterpart: 'business-identity',
        rules: { correlatedInvoices: true },
      },
      { code: '5.2', supported: true, counterpart: 'business-identity' },
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
      { code: '11.4', supported: true, counterpart: 'name-only' },
    ]);
    const reasons = new Map<string, string[]>();
    for (const entry of invoiceTypeCatalogue)
      if (!entry.supported)
        reasons.set(entry.reason, [...(reasons.get(entry.reason) ?? []), entry.code]);
    const explained = ['1.5', '8.2', '8.4', '8.5', '8.6'];
    expect(Object.fromEntries(reasons)).toEqual({
      'partly-documented': ['1.5', '8.2', '8.4', '8.5'],
      'catering-profile': ['8.6'],
      'listed-only': reference.filter(
        (code) => ![...accepted, ...explained].some((known) => known === code),
      ),
    });
    expect(reasons.get('listed-only')).toHaveLength(34);
  });
  it('should publish the same 52 rows, statuses and explanations in the capabilities page', () => {
    expect([...documented.keys()]).toEqual(reference);
    for (const entry of invoiceTypeCatalogue)
      expect(documented.get(entry.code)).toEqual(
        entry.supported
          ? {
              status: 'Supported',
              detail: explanation[entry.counterpart] + rulesText(entry.rules),
            }
          : { status: 'Not accepted', detail: explanation[entry.reason] },
      );
  });
  it('should stay internal: no catalogue or discovery export at the package root', () => {
    expect(Object.keys(sdk).sort()).toEqual(
      [
        'WrappClient',
        'WrappError',
        'calendarDate',
        'decimal',
        'getProviderDiagnostics',
        'verifyWebhook',
      ].sort(),
    );
  });
});
describe('invoice type acceptance', () => {
  const issuing = () =>
    provider(({ url }) => (url.pathname.endsWith('/login') ? login() : json(observation())));
  const withType = (code: unknown) =>
    ({ ...invoice(), invoice_type_code: code }) as CreateInvoiceInput;
  it.each(accepted)('should send the supported code %s as a JSON string', async (code) => {
    const { client, calls } = issuing();
    expect((await client.invoices.create(invoiceOfType(code))).kind).toBe('observed');
    expect(calls[1]?.init.body).toContain(`"invoice_type_code":"${code}"`);
  });
  it('should refuse every catalogued but unsupported code before authentication', async () => {
    const { client, calls } = issuing();
    const refused: string[] = [];
    for (const code of reference) {
      if (accepted.some((known) => known === code)) continue;
      await expect(client.invoices.create(withType(code))).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'create',
        effect: 'not-sent',
      });
      refused.push(code);
    }
    expect(refused).toHaveLength(39);
    expect(calls).toHaveLength(0);
  });
  it.each([2.1, 11.2, '2.10', '02.1', ' 2.1', '2.1 ', 'II', '', null, undefined, ['2.1']])(
    'should refuse the malformed or mistyped code %j before authentication',
    async (code) => {
      const { client, calls } = issuing();
      await expect(client.invoices.create(withType(code))).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it('should apply the name-only counterpart rule to the retail types and the full rule to the rest', async () => {
    for (const code of accepted) {
      const nameOnly = { ...invoiceOfType(code), counterpart: { name: 'Synthetic' } };
      const { client, calls } = issuing();
      if (['11.1', '11.2', '11.4'].includes(code)) {
        expect((await client.invoices.create(nameOnly)).kind).toBe('observed');
        expect(calls).toHaveLength(2);
      } else {
        await expect(client.invoices.create(nameOnly)).rejects.toMatchObject({
          code: 'INVALID_INPUT',
        });
        expect(calls).toHaveLength(0);
      }
    }
  });
});
