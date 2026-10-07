import { describe, expect, it } from 'vitest';
import { encodeJson, profileLineFields, profileLineFieldTypes } from '../../src/codecs.js';
import { decimal } from '../../src/index.js';
import type { CreateInvoiceInput } from '../../src/index.js';
import { invoiceTypeCatalogue, supportedInvoiceTypeCodes } from '../../src/invoice-contracts.js';
import {
  invoice,
  invoiceOfType,
  json,
  login,
  observation,
  provider,
} from '../fixtures/provider.js';

// The line fields the reference defines for invoice types 8.2 and 1.5. Neither type is issued
// by create() yet, so these tests exercise the field codecs directly and then show that the
// public operation still refuses the fields. Values are synthetic.
const categories = [
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
];
function wire(field: keyof typeof profileLineFields, value: unknown): string | undefined {
  const result = profileLineFields[field].safeParse(value);
  return result.success ? encodeJson({ [field]: result.data }) : undefined;
}
async function refusedByCreate(patch: Record<string, unknown>, root: Record<string, unknown> = {}) {
  const { client, calls } = provider(({ url }) =>
    url.pathname.endsWith('/login') ? login() : json(observation()),
  );
  const base = invoice();
  const [first] = base.invoice_lines;
  const input: unknown = { ...base, ...root, invoice_lines: [{ ...first, ...patch }] };
  await expect(client.invoices.create(input as CreateInvoiceInput)).rejects.toMatchObject({
    code: 'INVALID_INPUT',
    operation: 'create',
    effect: 'not-sent',
  });
  expect(calls).toHaveLength(0);
}

describe('line fields of invoice type 8.2', () => {
  it.each(['other_taxes_amount', 'accommodation_tax'] as const)(
    'should encode %s as the exact decimal token it was given',
    (field) => {
      expect(wire(field, decimal('1.50'))).toBe('{"' + field + '":1.50}');
      expect(wire(field, decimal('0'))).toBe('{"' + field + '":0}');
      expect(wire(field, decimal('9007199254740993.01'))).toBe(
        '{"' + field + '":9007199254740993.01}',
      );
    },
  );
  it.each(
    (['other_taxes_amount', 'accommodation_tax'] as const).flatMap((field) =>
      [1.5, '1.505', '-1.50', '1e2', '', null, true].map((value) => [field, value] as const),
    ),
  )('should refuse %s given %j', (field, value) => {
    expect(wire(field, value)).toBeUndefined();
  });
  it.each(categories)('should encode other_taxes_percent_category "%s" as a string', (code) => {
    expect(wire('other_taxes_percent_category', code)).toBe(
      '{"other_taxes_percent_category":"' + code + '"}',
    );
  });
  it.each(['1', '5', '11', '16', '18', '19', '31', '07', ' 7', '', 7, null])(
    'should refuse other_taxes_percent_category %j: only the codes listed for this field',
    (code) => {
      expect(wire('other_taxes_percent_category', code)).toBeUndefined();
    },
  );
});

describe('line field of invoice type 1.5', () => {
  it.each([1, 2])('should encode invoice_detail_type %d as an integer', (type) => {
    expect(wire('invoice_detail_type', type)).toBe('{"invoice_detail_type":' + String(type) + '}');
  });
  it.each([0, 3, -1, 1.5, '1', null, true])('should refuse invoice_detail_type %j', (type) => {
    expect(wire('invoice_detail_type', type)).toBeUndefined();
  });
});

describe('profile-bound line fields stay closed', () => {
  const valid = {
    other_taxes_amount: decimal('1.50'),
    accommodation_tax: decimal('1.50'),
    other_taxes_percent_category: '7',
    invoice_detail_type: 1,
  };
  it('should bind each field to invoice types the catalogue knows and create() does not issue', () => {
    expect(Object.keys(profileLineFieldTypes).sort()).toEqual(
      Object.keys(profileLineFields).sort(),
    );
    expect(profileLineFieldTypes).toEqual({
      other_taxes_amount: ['8.2'],
      accommodation_tax: ['8.2'],
      other_taxes_percent_category: ['8.2'],
      invoice_detail_type: ['1.5'],
    });
    const supported: readonly string[] = supportedInvoiceTypeCodes;
    for (const code of Object.values(profileLineFieldTypes).flat()) {
      const entry = invoiceTypeCatalogue.find((row) => row.code === code);
      expect(entry?.supported).toBe(false);
      expect(supported).not.toContain(code);
    }
  });
  it.each(
    supportedInvoiceTypeCodes.flatMap((code) =>
      Object.entries(valid).map(([key, value]) => [code, key, value] as const),
    ),
  )('should refuse invoice type %s carrying %s before authentication', async (code, key, value) => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(observation()),
    );
    // The same invoice is accepted without the field, so the field is what is refused.
    const base = invoiceOfType(code);
    expect((await client.invoices.create(base)).kind).toBe('observed');
    const [first] = base.invoice_lines;
    const withField: unknown = { ...base, invoice_lines: [{ ...first, [key]: value }] };
    await expect(client.invoices.create(withField as CreateInvoiceInput)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(2);
  });
  it.each(['8.2', '1.5'])(
    'should still refuse invoice type %s itself: a prepared field does not open a profile',
    async (code) => {
      await refusedByCreate({}, { invoice_type_code: code });
      await refusedByCreate(valid, { invoice_type_code: code });
    },
  );
});
