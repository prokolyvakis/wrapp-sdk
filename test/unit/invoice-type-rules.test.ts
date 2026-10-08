import { describe, expect, it } from 'vitest';
import { decimal } from '../../src/index.js';
import type { CreateInvoiceInput } from '../../src/index.js';
import { invoiceOfType, json, login, observation, provider } from '../fixtures/provider.js';

// Rules of the invoice types accepted on observed provider behavior: each type is sent in a
// shape the provider and the tax authority were observed to accept, and a shape either was
// observed to refuse is refused before any request. Values are synthetic.
type Code = CreateInvoiceInput['invoice_type_code'];
type Patch = Record<string, unknown>;
function issuing() {
  return provider(({ url }) => (url.pathname.endsWith('/login') ? login() : json(observation())));
}
// The valid input of a type with root keys and first-line keys replaced; undefined removes.
function build(code: Code, root: Patch = {}, line: Patch = {}): CreateInvoiceInput {
  const base = invoiceOfType(code);
  const [first] = base.invoice_lines;
  const strip = (value: Patch) =>
    Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
  const patched: unknown = strip({
    ...base,
    invoice_lines: [strip({ ...first, ...line })],
    ...root,
  });
  return patched as CreateInvoiceInput;
}
async function sent(input: CreateInvoiceInput): Promise<Record<string, unknown>> {
  const { client, calls } = issuing();
  expect((await client.invoices.create(input)).kind).toBe('observed');
  expect(calls).toHaveLength(2);
  return JSON.parse(calls[1]?.init.body as string) as Record<string, unknown>;
}
async function refused(input: CreateInvoiceInput): Promise<void> {
  const { client, calls } = issuing();
  await expect(client.invoices.create(input)).rejects.toMatchObject({
    code: 'INVALID_INPUT',
    operation: 'create',
    effect: 'not-sent',
  });
  expect(calls).toHaveLength(0);
}
const party = {
  name: 'Synthetic Company',
  country_code: 'GR',
  vat: 'synthetic-vat',
  city: 'Athens',
  street: 'Synthetic',
  number: '1',
  postal_code: '00000',
};

describe('types in the ordinary shape', () => {
  it.each(['1.2', '1.3', '1.4', '7.1', '11.5'] as const)(
    'should send type %s with a full counterpart and refuse it with less',
    async (code) => {
      expect(await sent(build(code))).toMatchObject({
        invoice_type_code: code,
        counterpart: party,
      });
      await refused(build(code, { counterpart: { name: 'Synthetic' } }));
      await refused(build(code, { counterpart: undefined }));
    },
  );
  it('should send type 11.3 with a name-only counterpart or a full one', async () => {
    expect((await sent(build('11.3', { counterpart: { name: 'Synthetic' } }))).counterpart).toEqual(
      {
        name: 'Synthetic',
      },
    );
    expect((await sent(build('11.3'))).counterpart).toEqual(party);
    await refused(build('11.3', { counterpart: undefined }));
  });
  it('should check no country and no VAT rate on the cross-border goods types', async () => {
    for (const code of ['1.2', '1.3'] as const) {
      const body = await sent(
        build(code, {}, { vat_rate: 0, vat_exemption_code: 14, vat_total: decimal('0') }),
      );
      expect(body.invoice_lines).toMatchObject([{ vat_rate: 0, vat_exemption_code: 14 }]);
      expect((await sent(build(code))).invoice_lines).toMatchObject([{ vat_rate: 24 }]);
    }
  });
});

describe('supplementary invoices 1.6 and 2.4', () => {
  it.each(['1.6', '2.4'] as const)(
    'should send type %s with the mark it supplements',
    async (code) => {
      expect((await sent(build(code))).correlated_invoices).toEqual(['400000000000001']);
    },
  );
  it.each(['1.6', '2.4'] as const)(
    'should refuse type %s without a correlated mark',
    async (code) => {
      await refused(build(code, { correlated_invoices: undefined }));
      await refused(build(code, { correlated_invoices: [] }));
    },
  );
});

describe('title deeds 3.1 and 3.2', () => {
  it.each(['3.1', '3.2'] as const)(
    'should send type %s with expense lines at VAT rate 0 and an exemption code',
    async (code) => {
      const body = await sent(build(code));
      expect(body.invoice_lines).toMatchObject([
        { expense: true, vat_rate: 0, vat_exemption_code: 1 },
      ]);
    },
  );
  it.each(['3.1', '3.2'] as const)(
    'should refuse type %s in a shape the authority refused',
    async (code) => {
      await refused(build(code, {}, { vat_rate: 24, vat_exemption_code: undefined }));
      await refused(build(code, {}, { vat_exemption_code: undefined }));
      await refused(build(code, {}, { expense: undefined }));
      await refused(build(code, {}, { expense: false }));
    },
  );
});

describe('rent income 8.1', () => {
  it('should send the type at VAT rate 0 with no exemption code', async () => {
    const [line] = (await sent(build('8.1'))).invoice_lines as Patch[];
    expect(line).toMatchObject({ vat_rate: 0 });
    expect(line).not.toHaveProperty('vat_exemption_code');
  });
  it('should refuse the type with an exemption code or another VAT rate', async () => {
    await refused(build('8.1', {}, { vat_exemption_code: 7 }));
    await refused(build('8.1', {}, { vat_rate: 24 }));
  });
  it.each(['1.1', '2.1', '1.2', '6.1', '11.3'] as const)(
    'should still require an exemption code with VAT rate 0 on type %s',
    async (code) => {
      await refused(build(code, {}, { vat_rate: 0, vat_exemption_code: undefined }));
      const body = await sent(build(code, {}, { vat_rate: 0, vat_exemption_code: 3 }));
      expect(body.invoice_lines).toMatchObject([{ vat_rate: 0, vat_exemption_code: 3 }]);
    },
  );
});

describe('accommodation tax receipt 8.2', () => {
  it('should send the three tax fields on the line as exact values and the total at the root', async () => {
    const body = await sent(build('8.2'));
    expect(body).toMatchObject({ invoice_type_code: '8.2', other_taxes_amount: 1.5 });
    expect(body.invoice_lines).toMatchObject([
      { accommodation_tax: 1.5, other_taxes_percent_category: '7', other_taxes_amount: 1.5 },
    ]);
  });
  it.each(['accommodation_tax', 'other_taxes_percent_category', 'other_taxes_amount'])(
    'should refuse the type without %s on a line',
    async (key) => {
      await refused(build('8.2', {}, { [key]: undefined }));
    },
  );
  it('should refuse the type without the other-taxes total, or with less than a full counterpart', async () => {
    await refused(build('8.2', { other_taxes_amount: undefined }));
    await refused(build('8.2', { counterpart: { name: 'Synthetic' } }));
    await refused(build('8.2', { counterpart: undefined }));
  });
  it.each([
    ['a nonzero net total', { net_total_amount: decimal('10.00') }, {}],
    ['a nonzero VAT total', { vat_total_amount: decimal('2.40') }, {}],
    ['a line with a net value', {}, { net_total_price: decimal('10') }],
    ['a line with a VAT value', {}, { vat_total: decimal('2.40') }],
    ['a line with a subtotal', {}, { subtotal: decimal('1.50') }],
    ['a line at another VAT rate', {}, { vat_rate: 13 }],
  ])(
    'should refuse the type with %s: only the zero-value shape was observed',
    async (_label, root, line) => {
      await refused(build('8.2', root, line));
    },
  );
  it('should accept every spelling of zero and leave the tax amounts to the caller', async () => {
    const body = await sent(
      build(
        '8.2',
        {
          net_total_amount: decimal('0.00'),
          total_amount: decimal('3.00'),
          payable_total_amount: decimal('3.00'),
          other_taxes_amount: decimal('3.00'),
        },
        {
          net_total_price: decimal('0.0'),
          accommodation_tax: decimal('3.00'),
          other_taxes_amount: decimal('3.00'),
        },
      ),
    );
    expect(body).toMatchObject({ net_total_amount: 0, total_amount: 3, other_taxes_amount: 3 });
  });
  it('should refuse a tax category outside the documented set', async () => {
    await refused(build('8.2', {}, { other_taxes_percent_category: '5' }));
    await refused(build('8.2', {}, { other_taxes_percent_category: 7 }));
  });
});

describe('types with an optional counterpart', () => {
  it.each(['6.1', '6.2', '8.6'] as const)(
    'should send type %s without a counterpart, with a name alone, or with a full one',
    async (code) => {
      expect(await sent(build(code))).not.toHaveProperty('counterpart');
      expect((await sent(build(code, { counterpart: { name: 'Synthetic' } }))).counterpart).toEqual(
        {
          name: 'Synthetic',
        },
      );
      expect((await sent(build(code, { counterpart: party }))).counterpart).toEqual(party);
    },
  );
  it.each(['6.1', '6.2', '8.6'] as const)(
    'should refuse a counterpart without a name on type %s',
    async (code) => {
      await refused(build(code, { counterpart: {} }));
      await refused(build(code, { counterpart: { country_code: 'GR' } }));
      await refused(build(code, { counterpart: null }));
    },
  );
});

describe('catering order notes 8.6', () => {
  it('should send the table of an order note by id, by a new name, or not at all', async () => {
    expect(await sent(build('8.6', { catering_table_id: 'table-one' }))).toMatchObject({
      invoice_type_code: '8.6',
      catering_table_id: 'table-one',
    });
    expect(await sent(build('8.6', { catering_table_name: 'Table 7' }))).toMatchObject({
      catering_table_name: 'Table 7',
    });
    const bare = await sent(build('8.6'));
    expect(bare).not.toHaveProperty('catering_table_id');
    expect(bare).not.toHaveProperty('catering_table_name');
  });
  it('should send payment method 0, the value of an order note that is not paid yet', async () => {
    expect((await sent(build('8.6', { payment_method_type: 0 }))).payment_method_type).toBe(0);
  });
  it.each([
    [
      'both a table id and a table name',
      { catering_table_id: 'table-one', catering_table_name: 'Table 7' },
    ],
    ['an unsafe table id', { catering_table_id: 'a/b' }],
    ['an empty table name', { catering_table_name: '' }],
    ['a table id that is not text', { catering_table_id: 7 }],
    ['a null table name', { catering_table_name: null }],
  ])('should refuse an order note with %s', async (_label, root) => {
    await refused(build('8.6', root));
  });
});

describe('catering table fields on other types', () => {
  it('should send a table id on a retail receipt 11.1 that closes order notes', async () => {
    const body = await sent(
      build('11.1', { catering_table_id: 'table-one', correlated_invoices: ['400000000000001'] }),
    );
    expect(body).toMatchObject({
      catering_table_id: 'table-one',
      correlated_invoices: ['400000000000001'],
    });
  });
  it('should refuse a table id on an 11.1 that names no order note', async () => {
    await refused(build('11.1', { catering_table_id: 'table-one' }));
    await refused(build('11.1', { catering_table_id: 'table-one', correlated_invoices: [] }));
  });
  it('should keep an 11.1 with correlated marks and no table an ordinary receipt, as before', async () => {
    const body = await sent(build('11.1', { correlated_invoices: ['400000000000001'] }));
    expect(body.correlated_invoices).toEqual(['400000000000001']);
    expect(body).not.toHaveProperty('catering_table_id');
  });
  it('should refuse a new table name on an 11.1: a table is created by an order note', async () => {
    await refused(
      build('11.1', { catering_table_name: 'Table 7', correlated_invoices: ['400000000000001'] }),
    );
  });
  it.each(['1.1', '2.1', '11.2', '5.1', '9.3', '6.1'] as const)(
    'should refuse either table field on type %s',
    async (code) => {
      await refused(build(code, { catering_table_id: 'table-one' }));
      await refused(build(code, { catering_table_name: 'Table 7' }));
    },
  );
  it('should treat an explicit undefined table field as omitted', async () => {
    const body = await sent(build('2.1', {}, {}));
    const explicit: unknown = {
      ...build('2.1'),
      catering_table_id: undefined,
      catering_table_name: undefined,
    };
    expect(await sent(explicit as CreateInvoiceInput)).toEqual(body);
  });
});
