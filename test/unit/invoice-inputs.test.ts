import { LosslessNumber, parse } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { decimal } from '../../src/index.js';
import type { CreateInvoiceInput } from '../../src/index.js';
import { invoice, json, login, observation, provider } from '../fixtures/provider.js';

// Fixtures here are synthetic values in the request shape of the Wrapp reference v1.18.0.
// Nothing below decides a tax treatment: the tests pin what the SDK sends and refuses.
type Location = 'create' | 'line';
type Patch = Record<string, unknown>;
// Answers every create as issued, echoing the reference that was sent.
function issuing() {
  return provider(({ url, init }) => {
    if (url.pathname.endsWith('/login')) return login();
    const sentBody: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const reference = isRecord(sentBody) ? sentBody.external_id : undefined;
    return json(observation(typeof reference === 'string' ? { external_id: reference } : {}));
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
// Builds a create input from the minimal invoice. `lines` holds one patch per line; a key set
// to undefined is removed. The result is deliberately untyped: these tests exercise the
// runtime boundary with values the public types would refuse.
function build(root: Patch = {}, lines: readonly Patch[] = [{}]): CreateInvoiceInput {
  const base = invoice();
  const [first] = base.invoice_lines;
  const patched: unknown = strip({
    ...base,
    ...root,
    invoice_lines: lines.map((patch, index) =>
      strip({ ...first, line_number: index + 1, ...patch }),
    ),
  });
  return patched as CreateInvoiceInput;
}
function strip(value: Patch): Patch {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
function at(where: Location, key: string, value: unknown, root: Patch = {}): CreateInvoiceInput {
  return where === 'create' ? build({ ...root, [key]: value }) : build(root, [{ [key]: value }]);
}
// The dispatched body with every number kept as its literal wire text.
function wire(value: unknown): unknown {
  if (value instanceof LosslessNumber) return '#' + value.value;
  if (Array.isArray(value)) return value.map(wire);
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)]));
  return value;
}
interface Sent {
  readonly create: Record<string, unknown>;
  readonly lines: readonly Record<string, unknown>[];
}
async function accepted(input: CreateInvoiceInput): Promise<Sent> {
  const { client, calls } = issuing();
  expect((await client.invoices.create(input)).kind).toBe('observed');
  expect(calls).toHaveLength(2);
  const body = calls.at(-1)?.init.body;
  if (typeof body !== 'string') throw new Error('No JSON body was dispatched');
  const create = wire(parse(body));
  if (!isRecord(create) || !Array.isArray(create.invoice_lines))
    throw new Error('The dispatched body is not a create request');
  return { create, lines: create.invoice_lines.filter(isRecord) };
}
async function refused(input: CreateInvoiceInput): Promise<void> {
  const { client, calls } = issuing();
  await expect(client.invoices.create(input)).rejects.toMatchObject({
    name: 'WrappError',
    code: 'INVALID_INPUT',
    operation: 'create',
    effect: 'not-sent',
  });
  // Not even the login request: validation precedes authentication.
  expect(calls).toHaveLength(0);
}
const sequence = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const amounts: readonly (readonly [Location, string])[] = [
  ['create', 'other_taxes_amount'],
  ['create', 'withholding_total_amount'],
  ['create', 'total_stamp_duty_amount'],
  ['create', 'deductions_total_amount'],
  ['create', 'fees_amount'],
  ['create', 'stamp_duty_amount'],
  ['line', 'withholding_total'],
  ['line', 'stamp_duty_amount'],
  ['line', 'deductions_amount'],
];
const classifications = [
  { category: 'category1_3', type: 'E3_561_001', amount: decimal('6.00') },
  { category: 'category1_1', type: 'E3_561_002', amount: decimal('4.00') },
];
const deductions = [
  { title: 'Synthetic deduction', amount: decimal('5.00'), informational: false },
  { amount: decimal('5.00') },
];
const withDeductions = { deductions, deductions_amount: decimal('10.00') };
const general = [
  'other_taxes_amount',
  'withholding_total_amount',
  'total_stamp_duty_amount',
  'email_subject',
  'email_body',
  'deductions_total_amount',
  'num',
  'self_pricing',
  'fees_amount',
  'stamp_duty_amount',
  'special_invoice_category',
];
const lineGeneral = [
  'withhold_tax_rate',
  'withhold_tax_code',
  'withholding_total',
  'stamp_duty_tax_code',
  'stamp_duty_amount',
  'deductions_amount',
  'deductions',
  'expenses_vat_classification',
  'classifications',
  'expense',
  'rec_type',
  'fees_category',
];

describe('general invoice fields: omission', () => {
  it('should send none of the general fields when the caller supplies none', async () => {
    const sent = await accepted(build());
    for (const key of general) expect(sent.create, key).not.toHaveProperty(key);
    for (const key of lineGeneral) expect(sent.lines[0], key).not.toHaveProperty(key);
  });
});

describe('general invoice fields: amounts', () => {
  it.each(amounts)(
    'should send %s %s as the exact decimal token it was given',
    async (where, key) => {
      const sent = await accepted(at(where, key, decimal('0.50')));
      expect((where === 'create' ? sent.create : sent.lines[0])?.[key]).toBe('#0.50');
    },
  );
  it.each(amounts)('should keep a %s %s beyond double precision exact', async (where, key) => {
    const sent = await accepted(at(where, key, decimal('9007199254740993.10')));
    expect((where === 'create' ? sent.create : sent.lines[0])?.[key]).toBe('#9007199254740993.10');
  });
  it.each(
    amounts.flatMap(([where, key]) =>
      [0.5, '0.505', '-1.00', '1e2', '', null, true, ['0.50']].map(
        (value) => [where, key, value] as const,
      ),
    ),
  )('should refuse %s %s given %j before authentication', async (where, key, value) => {
    await refused(at(where, key, value));
  });
});

describe('general invoice fields: email overrides', () => {
  it.each([
    ['email_subject', 'Your invoice $INVOICE_CODE from $COMPANY_NAME'],
    ['email_subject', ''],
    ['email_body', 'Dear customer,\r\n\tplease find $INVOICE_CODE of $ISSUE_DATES.\n\n  Thanks  '],
    ['email_body', '{{name}} %s <b>&amp;</b> éα'],
  ])('should send %s literally, placeholders and line breaks included', async (key, value) => {
    const sent = await accepted(at('create', key, value));
    expect(sent.create[key]).toBe(value);
  });
  it.each(
    ['email_subject', 'email_body'].flatMap((key) =>
      [5, null, true, ['text'], 'x'.repeat(4097)].map((value) => [key, value] as const),
    ),
  )('should refuse %s given a non-text or oversized value', async (key, value) => {
    await refused(at('create', key, value));
  });
});

describe('general invoice fields: number, self pricing and special category', () => {
  it.each([1, 11, Number.MAX_SAFE_INTEGER])(
    'should send the caller-chosen invoice number %d as an integer token',
    async (num) => {
      expect((await accepted(at('create', 'num', num))).create.num).toBe('#' + String(num));
    },
  );
  it.each([0, -1, 1.5, '11', 2 ** 53, Number.NaN, null, true])(
    'should refuse the invoice number %j',
    async (num) => {
      await refused(at('create', 'num', num));
    },
  );
  it('should preserve self_pricing false instead of dropping it', async () => {
    expect((await accepted(at('create', 'self_pricing', false))).create.self_pricing).toBe(false);
  });
  it.each(['true', 'false', 1, 0, null])('should refuse self_pricing %j', async (value) => {
    await refused(at('create', 'self_pricing', value));
  });
  it.each(sequence(1, 13))(
    'should send special_invoice_category %d as an integer token',
    async (category) => {
      const sent = await accepted(at('create', 'special_invoice_category', category));
      expect(sent.create.special_invoice_category).toBe('#' + String(category));
    },
  );
  it.each([0, 14, -1, 1.5, '12', null, true])(
    'should refuse special_invoice_category %j',
    async (category) => {
      await refused(at('create', 'special_invoice_category', category));
    },
  );
});

describe('general line fields: withholding and stamp duty', () => {
  it.each([0, 1, 20, 100])('should send withhold_tax_rate %d as an integer token', async (rate) => {
    const sent = await accepted(at('line', 'withhold_tax_rate', rate));
    expect(sent.lines[0]?.withhold_tax_rate).toBe('#' + String(rate));
  });
  it.each([-1, 101, 1.5, '20', null, true])('should refuse withhold_tax_rate %j', async (rate) => {
    await refused(at('line', 'withhold_tax_rate', rate));
  });
  it.each(sequence(1, 18).map(String))(
    'should send withhold_tax_code "%s" as a string',
    async (code) => {
      const sent = await accepted(at('line', 'withhold_tax_code', code));
      expect(sent.lines[0]?.withhold_tax_code).toBe(code);
    },
  );
  it.each([3, '0', '19', '03', ' 3', '', null])(
    'should refuse withhold_tax_code %j',
    async (code) => {
      await refused(at('line', 'withhold_tax_code', code));
    },
  );
  it.each(['1', '2', '3', '4'])(
    'should send stamp_duty_tax_code "%s" as a string',
    async (code) => {
      const sent = await accepted(at('line', 'stamp_duty_tax_code', code));
      expect(sent.lines[0]?.stamp_duty_tax_code).toBe(code);
    },
  );
  it.each([1, '0', '5', '01', '', null])('should refuse stamp_duty_tax_code %j', async (code) => {
    await refused(at('line', 'stamp_duty_tax_code', code));
  });
  it('should accept line stamp duty with only total_stamp_duty_amount, as the reference example sends it', async () => {
    const sent = await accepted(
      build({ total_stamp_duty_amount: decimal('2.50') }, [
        { stamp_duty_tax_code: '1', stamp_duty_amount: decimal('2.50') },
      ]),
    );
    expect(sent.create.total_stamp_duty_amount).toBe('#2.50');
    expect(sent.create).not.toHaveProperty('stamp_duty_amount');
    expect(sent.lines[0]).toMatchObject({ stamp_duty_tax_code: '1', stamp_duty_amount: '#2.50' });
  });
  it('should send stamp_duty_amount and total_stamp_duty_amount as two separate fields', async () => {
    const sent = await accepted(
      build({ stamp_duty_amount: decimal('1.00'), total_stamp_duty_amount: decimal('2.50') }),
    );
    expect(sent.create).toMatchObject({
      stamp_duty_amount: '#1.00',
      total_stamp_duty_amount: '#2.50',
    });
  });
});

describe('general line fields: expense flag and expense VAT classification', () => {
  it.each([true, false])('should preserve expense %j', async (value) => {
    expect((await accepted(at('line', 'expense', value))).lines[0]?.expense).toBe(value);
  });
  it.each(['true', 1, null])('should refuse expense %j', async (value) => {
    await refused(at('line', 'expense', value));
  });
  it('should send expenses_vat_classification literally', async () => {
    const sent = await accepted(at('line', 'expenses_vat_classification', 'VAT_361'));
    expect(sent.lines[0]?.expenses_vat_classification).toBe('VAT_361');
  });
  it.each([361, '', null, true])('should refuse expenses_vat_classification %j', async (value) => {
    await refused(at('line', 'expenses_vat_classification', value));
  });
});

describe('line classifications', () => {
  it('should send the scalar pair alone when no array is supplied', async () => {
    const sent = await accepted(build());
    expect(sent.lines[0]).toMatchObject({
      classification_category: 'category1_3',
      classification_type: 'E3_561_001',
    });
    expect(sent.lines[0]).not.toHaveProperty('classifications');
  });
  it('should accept the array alone and send no scalar pair', async () => {
    const sent = await accepted(
      build({}, [
        { classification_category: undefined, classification_type: undefined, classifications },
      ]),
    );
    expect(sent.lines[0]?.classifications).toEqual([
      { category: 'category1_3', type: 'E3_561_001', amount: '#6.00' },
      { category: 'category1_1', type: 'E3_561_002', amount: '#4.00' },
    ]);
    expect(sent.lines[0]).not.toHaveProperty('classification_category');
    expect(sent.lines[0]).not.toHaveProperty('classification_type');
  });
  it('should send both forms untouched when both are supplied, leaving precedence to the provider', async () => {
    const sent = await accepted(build({}, [{ classifications }]));
    expect(sent.lines[0]).toMatchObject({
      classification_category: 'category1_3',
      classification_type: 'E3_561_001',
      classifications: [
        { category: 'category1_3', type: 'E3_561_001', amount: '#6.00' },
        { category: 'category1_1', type: 'E3_561_002', amount: '#4.00' },
      ],
    });
  });
  it.each(['classification_category', 'classification_type'])(
    'should keep a lone %s beside the array',
    async (kept) => {
      const dropped =
        kept === 'classification_category' ? 'classification_type' : 'classification_category';
      const sent = await accepted(build({}, [{ [dropped]: undefined, classifications }]));
      expect(sent.lines[0]).toHaveProperty(kept);
      expect(sent.lines[0]).not.toHaveProperty(dropped);
    },
  );
  it('should not require the array amounts to add up to the line total', async () => {
    const [first] = classifications;
    const sent = await accepted(build({}, [{ classifications: [first] }]));
    expect(sent.lines[0]?.classifications).toEqual([
      { category: 'category1_3', type: 'E3_561_001', amount: '#6.00' },
    ]);
    expect(sent.lines[0]?.net_total_price).toBe('#10');
  });
  it.each([
    ['neither form', { classification_category: undefined, classification_type: undefined }],
    ['only the category', { classification_type: undefined }],
    ['only the type', { classification_category: undefined }],
    ['an empty category', { classification_category: '' }],
    ['an empty type', { classification_type: '' }],
  ])('should refuse a line with %s and no array before authentication', async (_, patch) => {
    await refused(build({}, [patch]));
  });
  it('should refuse the request when any one line lacks a classification', async () => {
    await refused(
      build({}, [{}, { classification_category: undefined, classification_type: undefined }]),
    );
  });
  it.each([
    ['an empty array', []],
    ['a non-array', 'category1_3'],
    ['a null', null],
    ['an item without amount', [{ category: 'category1_3', type: 'E3_561_001' }]],
    ['an item without type', [{ category: 'category1_3', amount: decimal('6.00') }]],
    ['an item without category', [{ type: 'E3_561_001', amount: decimal('6.00') }]],
    ['an empty category', [{ category: '', type: 'E3_561_001', amount: decimal('6.00') }]],
    ['an empty type', [{ category: 'category1_3', type: '', amount: decimal('6.00') }]],
    ['a numeric amount', [{ category: 'category1_3', type: 'E3_561_001', amount: 6 }]],
    ['an over-precise amount', [{ category: 'category1_3', type: 'E3_561_001', amount: '6.005' }]],
    ['a non-text category', [{ category: 13, type: 'E3_561_001', amount: decimal('6.00') }]],
    [
      'an unknown item key',
      [{ category: 'category1_3', type: 'E3_561_001', amount: decimal('6.00'), vat: 1 }],
    ],
    ['a non-object item', ['category1_3']],
  ])('should refuse classifications holding %s, scalars present or not', async (_, value) => {
    await refused(build({}, [{ classifications: value }]));
    await refused(
      build({}, [
        {
          classification_category: undefined,
          classification_type: undefined,
          classifications: value,
        },
      ]),
    );
  });
});

describe('self pricing', () => {
  const classified = { expenses_vat_classification: 'VAT_361' };
  it('should accept self_pricing true when every line carries an expense VAT classification', async () => {
    const sent = await accepted(build({ self_pricing: true }, [classified, classified]));
    expect(sent.create.self_pricing).toBe(true);
    expect(sent.lines.map((line) => line.expenses_vat_classification)).toEqual([
      'VAT_361',
      'VAT_361',
    ]);
  });
  it.each([
    ['its only line', [{}]],
    ['the first of two lines', [{}, classified]],
    ['the last of two lines', [classified, {}]],
  ])('should refuse self_pricing true when %s lacks the classification', async (_, lines) => {
    await refused(build({ self_pricing: true }, lines));
  });
  it.each([false, undefined])(
    'should not require the classification when self_pricing is %j',
    async (flag) => {
      const sent = await accepted(build({ self_pricing: flag }));
      expect(sent.lines[0]).not.toHaveProperty('expenses_vat_classification');
    },
  );
  it('should send a supplied classification when self_pricing is false', async () => {
    const sent = await accepted(build({ self_pricing: false }, [classified]));
    expect(sent.lines[0]?.expenses_vat_classification).toBe('VAT_361');
  });
});

describe('deductions', () => {
  const total = { deductions_total_amount: decimal('10.00') };
  it('should send deductions with their line and invoice totals exactly as given', async () => {
    const sent = await accepted(build(total, [withDeductions]));
    expect(sent.create.deductions_total_amount).toBe('#10.00');
    expect(sent.lines[0]).toMatchObject({
      deductions_amount: '#10.00',
      deductions: [
        { title: 'Synthetic deduction', amount: '#5.00', informational: false },
        { amount: '#5.00' },
      ],
    });
    // Omitted item fields stay omitted: the provider applies its own default.
    expect(Object.keys((sent.lines[0]?.deductions as Record<string, unknown>[])[1] ?? {})).toEqual([
      'amount',
    ]);
  });
  it.each([
    ['an empty title', { title: '', amount: decimal('5.00') }],
    ['informational true', { amount: decimal('5.00'), informational: true }],
    ['a title with a line break', { title: 'first\nsecond', amount: decimal('5.00') }],
  ])('should preserve a deduction with %s', async (_, item) => {
    const sent = await accepted(
      build(total, [{ deductions: [item], deductions_amount: decimal('5.00') }]),
    );
    expect(sent.lines[0]?.deductions).toEqual([{ ...item, amount: '#5.00' }]);
  });
  it('should refuse a line with deductions and no deductions_amount', async () => {
    await refused(build(total, [{ deductions }]));
  });
  it('should refuse an invoice with line deductions and no deductions_total_amount', async () => {
    await refused(build({}, [withDeductions]));
  });
  it('should require the line total only on the lines that carry deductions', async () => {
    const sent = await accepted(build(total, [{}, withDeductions]));
    expect(sent.lines[0]).not.toHaveProperty('deductions_amount');
    expect(sent.lines[1]?.deductions_amount).toBe('#10.00');
    await refused(build(total, [withDeductions, { deductions }]));
  });
  it('should not sum or round: totals that disagree with the items are sent as given', async () => {
    const sent = await accepted(
      build({ deductions_total_amount: decimal('99.99') }, [
        { deductions, deductions_amount: decimal('7.10') },
      ]),
    );
    expect(sent.create.deductions_total_amount).toBe('#99.99');
    expect(sent.lines[0]?.deductions_amount).toBe('#7.10');
  });
  it('should treat an empty deductions array as no deductions and send it as given', async () => {
    const sent = await accepted(build({}, [{ deductions: [] }]));
    expect(sent.lines[0]?.deductions).toEqual([]);
    expect(sent.create).not.toHaveProperty('deductions_total_amount');
  });
  it('should accept the totals without any deduction items', async () => {
    const sent = await accepted(build(total, [{ deductions_amount: decimal('10.00') }]));
    expect(sent.create.deductions_total_amount).toBe('#10.00');
    expect(sent.lines[0]).not.toHaveProperty('deductions');
  });
  it.each([
    ['a non-array', 'none'],
    ['a null', null],
    ['an item without amount', [{ title: 'Synthetic deduction' }]],
    ['a numeric amount', [{ amount: 5 }]],
    ['an over-precise amount', [{ amount: '5.005' }]],
    ['a negative amount', [{ amount: '-5.00' }]],
    ['a non-text title', [{ title: 5, amount: decimal('5.00') }]],
    ['a non-boolean informational', [{ amount: decimal('5.00'), informational: 'false' }]],
    ['an unknown item key', [{ amount: decimal('5.00'), rate: 1 }]],
    ['a non-object item', [decimal('5.00')]],
  ])('should refuse deductions holding %s', async (_, value) => {
    await refused(build(total, [{ deductions: value, deductions_amount: decimal('10.00') }]));
  });
});

describe('fee lines', () => {
  const fees = { fees_amount: decimal('3.00') };
  it('should send rec_type 2 and fees_category as integer tokens with the invoice fee total', async () => {
    const sent = await accepted(build(fees, [{ rec_type: 2, fees_category: 5 }]));
    expect(sent.create.fees_amount).toBe('#3.00');
    expect(sent.lines[0]).toMatchObject({ rec_type: '#2', fees_category: '#5' });
  });
  it.each([1, 22, Number.MAX_SAFE_INTEGER])(
    'should send fees_category %d without judging its membership',
    async (category) => {
      const sent = await accepted(build(fees, [{ fees_category: category }]));
      expect(sent.lines[0]?.fees_category).toBe('#' + String(category));
    },
  );
  it.each([0, 1, 3, -2, 2.5, '2', null, true])('should refuse rec_type %j', async (value) => {
    await refused(build(fees, [{ rec_type: value }]));
  });
  it.each([0, -1, 1.5, '5', 2 ** 53, null, true])(
    'should refuse fees_category %j',
    async (value) => {
      await refused(build(fees, [{ fees_category: value }]));
    },
  );
  it.each([
    ['rec_type', { rec_type: 2 }],
    ['fees_category', { fees_category: 5 }],
    ['both', { rec_type: 2, fees_category: 5 }],
  ])('should refuse a line carrying %s when the invoice has no fees_amount', async (_, patch) => {
    await refused(build({}, [patch]));
    await refused(build({}, [{}, patch]));
  });
  it('should accept fees_amount on an invoice without fee lines', async () => {
    expect((await accepted(build(fees))).create.fees_amount).toBe('#3.00');
  });
});

describe('invoice-level tax mode stays unavailable', () => {
  it.each([[[]], [[{ tax_type: 1, tax_category: 1, tax_amount: decimal('1.00') }]]])(
    'should refuse taxes_totals %j before authentication',
    async (value) => {
      await refused(build({ taxes_totals: value }));
    },
  );
});
