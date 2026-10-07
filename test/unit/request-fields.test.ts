import { LosslessNumber, parse } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { decimal } from '../../src/index.js';
import type { CreateInvoiceInput, CreateOutcome } from '../../src/index.js';
import {
  enrichedPending,
  invoice,
  json,
  login,
  observation,
  pending,
  provider,
} from '../fixtures/provider.js';
import type { RecordedRequest } from '../fixtures/provider.js';

// Fixtures here are synthetic values in the request shape of the Wrapp reference v1.18.0.
// The code sets are the reviewed request contract, not a tax eligibility decision.
type Location = 'create' | 'counterpart' | 'line';
// Answers every create as issued, echoing the reference that was sent.
function issuing() {
  return provider(({ url, init }) => {
    if (url.pathname.endsWith('/login')) return login();
    const sentBody: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const reference = isRecord(sentBody) ? sentBody.external_id : undefined;
    return json(observation(typeof reference === 'string' ? { external_id: reference } : {}));
  });
}
// Builds a create input with one field replaced. The result is deliberately untyped: these
// tests exercise the runtime boundary with values the public types would refuse.
function place(at: Location, key: string, value: unknown): CreateInvoiceInput {
  const base = invoice();
  const [line] = base.invoice_lines;
  const patched: unknown =
    at === 'create'
      ? { ...base, [key]: value }
      : at === 'counterpart'
        ? { ...base, counterpart: { ...base.counterpart, [key]: value } }
        : { ...base, invoice_lines: [{ ...line, [key]: value }] };
  return patched as CreateInvoiceInput;
}
function line(patch: Record<string, unknown>): CreateInvoiceInput {
  const base = invoice();
  const [first] = base.invoice_lines;
  const patched: unknown = { ...base, invoice_lines: [{ ...first, ...patch }] };
  return patched as CreateInvoiceInput;
}
function sent(calls: readonly RecordedRequest[]): string {
  const body = calls.at(-1)?.init.body;
  if (typeof body !== 'string') throw new Error('No JSON body was dispatched');
  return body;
}
// The exact JSON token dispatched for one field, read from the parsed body so a similarly
// named or nested key cannot be matched by accident. Numbers keep their literal wire text.
function token(body: string, at: Location, key: string): string | undefined {
  const root = parse(body);
  if (!isRecord(root)) throw new Error('The dispatched body is not a JSON object');
  const lines: unknown = root.invoice_lines;
  const holder: unknown =
    at === 'create'
      ? root
      : at === 'counterpart'
        ? root.counterpart
        : Array.isArray(lines)
          ? lines[0]
          : undefined;
  if (!isRecord(holder)) throw new Error('The dispatched body has no ' + at + ' object');
  const value = holder[key];
  if (value === undefined) return undefined;
  return value instanceof LosslessNumber ? value.value : JSON.stringify(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
async function accepted(input: CreateInvoiceInput): Promise<string> {
  const { client, calls } = issuing();
  expect((await client.invoices.create(input)).kind).toBe('observed');
  expect(calls).toHaveLength(2);
  return sent(calls);
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

describe('request code membership and precision', () => {
  it.each([0, 3, 4, 6, 9, 13, 17, 24])(
    'should accept the reviewed VAT rate %d and send it as an integer token',
    async (rate) => {
      const body = await accepted(
        line({ vat_rate: rate, ...(rate === 0 ? { vat_exemption_code: 1 } : {}) }),
      );
      expect(token(body, 'line', 'vat_rate')).toBe(String(rate));
    },
  );
  it.each([1, 25, -1, 100, 101, Number.NaN, Number.POSITIVE_INFINITY, 1.5, '24', null])(
    'should refuse the VAT rate %s before authentication',
    async (rate) => {
      await refused(line({ vat_rate: rate, vat_exemption_code: 1 }));
    },
  );
  it('should accept exactly the eight documented VAT percentages out of 0 to 100', async () => {
    const { client, calls } = issuing();
    const passed: number[] = [];
    for (let rate = 0; rate <= 100; rate++) {
      const before = calls.length;
      try {
        await client.invoices.create(line({ vat_rate: rate, vat_exemption_code: 1 }));
        passed.push(rate);
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
        expect(calls).toHaveLength(before);
      }
    }
    expect(passed).toEqual([0, 3, 4, 6, 9, 13, 17, 24]);
  });
  it('should require an allowed exemption code whenever the VAT rate is zero', async () => {
    await refused(line({ vat_rate: 0 }));
    await refused(line({ vat_rate: 0, vat_exemption_code: 32 }));
    expect(
      token(
        await accepted(line({ vat_rate: 0, vat_exemption_code: 31 })),
        'line',
        'vat_exemption_code',
      ),
    ).toBe('31');
  });
  it.each([1, 2, 3, 4, 5, 6])('should accept quantity type %d', async (code) => {
    expect(token(await accepted(line({ quantity_type: code })), 'line', 'quantity_type')).toBe(
      String(code),
    );
  });
  it.each([0, 7, 100, 1.5, '1', null])('should refuse quantity type %s', async (code) => {
    await refused(line({ quantity_type: code }));
  });
  it('should accept every VAT exemption code from 1 to 31 and nothing else up to 999', async () => {
    const { client, calls } = issuing();
    const passed: number[] = [];
    for (const code of [...Array.from({ length: 40 }, (_, index) => index), 100, 999]) {
      const before = calls.length;
      try {
        await client.invoices.create(line({ vat_rate: 0, vat_exemption_code: code }));
        passed.push(code);
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
        expect(calls).toHaveLength(before);
      }
    }
    expect(passed).toEqual(Array.from({ length: 31 }, (_, index) => index + 1));
  });
  it.each([0, 32, 999, 1.5, '1', null])('should refuse VAT exemption code %s', async (code) => {
    await refused(line({ vat_rate: 0, vat_exemption_code: code }));
  });
  it.each(['1', '1.0', '1.08', '0.5', '123456789012345678.99'])(
    'should send exchange rate %s as the exact numeric token',
    async (rate) => {
      const body = await accepted({
        ...invoice(),
        currency: 'USD',
        exchange_rate: decimal(rate),
      });
      expect(token(body, 'create', 'exchange_rate')).toBe(rate);
    },
  );
  it.each(['1.0834', '1.230', '0.001'])(
    'should refuse exchange rate %s unchanged instead of rounding it',
    async (rate) => {
      await refused({ ...invoice(), currency: 'USD', exchange_rate: decimal(rate) });
    },
  );
  it('should keep exchange rate coupled to currency and typed as an exact decimal', async () => {
    await refused({ ...invoice(), exchange_rate: decimal('1.08') });
    await refused({ ...invoice(), currency: 'USD' });
    for (const value of [1.08, null, true, '1e2', '01.08']) {
      await refused({ ...place('create', 'exchange_rate', value), currency: 'USD' });
    }
    expect(token(await accepted(invoice()), 'create', 'exchange_rate')).toBeUndefined();
  });
  it('should keep unit price and quantity precision above two decimals', async () => {
    // Unit price above two decimals is a repository-recorded provider observation. Quantity
    // precision is an open provider question, so its existing bound is left unchanged.
    const body = await accepted(
      line({ unit_price: decimal('3.9920'), quantity: decimal('1.234') }),
    );
    expect(token(body, 'line', 'unit_price')).toBe('3.9920');
    expect(token(body, 'line', 'quantity')).toBe('1.234');
    await refused(line({ unit_price: decimal('3.99'), quantity: 1.234 }));
  });
  it('should dispatch nothing for invalid input on an already authenticated client', async () => {
    const { client, calls } = issuing();
    expect((await client.invoices.create(invoice())).kind).toBe('observed');
    expect(calls).toHaveLength(2);
    for (const input of [
      line({ vat_rate: 25 }),
      line({ quantity_type: 7 }),
      line({ vat_rate: 0, vat_exemption_code: 999 }),
      { ...invoice(), currency: 'USD', exchange_rate: decimal('1.0834') },
    ]) {
      await expect(client.invoices.create(input)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'create',
        effect: 'not-sent',
      });
    }
    expect(calls).toHaveLength(2);
  });
});

// One row per request field the SDK already represents. `valid` pairs a value with the exact
// JSON token it must become; `wrong` values must be refused before authentication.
interface FieldRow {
  readonly field: string;
  readonly at: Location;
  readonly key: string;
  readonly valid: readonly (readonly [unknown, string])[];
  readonly wrong: readonly unknown[];
  /** Whether a 2.1 create without the field is accepted, and whether retail 11.2 differs. */
  readonly omitted: 'accepted' | 'refused';
  readonly omittedForRetail?: 'accepted';
  /** Fields that must accompany this one for the input to be valid at all. */
  readonly with?: Record<string, unknown>;
}
const quoted = (value: string) => JSON.stringify(value);
const freeText = (key: string, at: Location = 'create'): FieldRow => ({
  field: `${at === 'create' ? 'create' : 'invoice_lines[]'}.${key}`,
  at,
  key,
  valid: [
    ['Synthetic text', quoted('Synthetic text')],
    ['first line\nsecond line {placeholder}', quoted('first line\nsecond line {placeholder}')],
    ['', '""'],
    ['x'.repeat(4096), quoted('x'.repeat(4096))],
  ],
  wrong: [42, null, true, ['x'], 'x'.repeat(4097)],
  omitted: 'accepted',
});
const total = (key: string, at: Location = 'create'): FieldRow => ({
  field: `${at === 'create' ? 'create' : 'invoice_lines[]'}.${key}`,
  at,
  key,
  valid: [
    [decimal('10.00'), '10.00'],
    [decimal('0'), '0'],
    [decimal('0.5'), '0.5'],
    [decimal('9007199254740993.12'), '9007199254740993.12'],
  ],
  wrong: [10, 10.5, '10.001', '1e2', '-1', '01.00', '', null],
  omitted: 'refused',
});
const precise = (key: string): FieldRow => ({
  field: `invoice_lines[].${key}`,
  at: 'line',
  key,
  valid: [
    [decimal('1'), '1'],
    [decimal('3.9920'), '3.9920'],
    [decimal('0.000000000001'), '0.000000000001'],
    [decimal('123456789012345678'), '123456789012345678'],
  ],
  wrong: [1, 1.5, '0.0000000000001', '1234567890123456789', '1e2', '-1', '', null],
  omitted: 'refused',
});
const flag = (key: string): FieldRow => ({
  field: `create.${key}`,
  at: 'create',
  key,
  valid: [
    [true, 'true'],
    [false, 'false'],
  ],
  wrong: ['true', 1, 0, null],
  omitted: 'accepted',
});
const businessIdentity = (key: string, sample: string): FieldRow => ({
  field: `counterpart.${key}`,
  at: 'counterpart',
  key,
  valid: [[sample, quoted(sample)]],
  wrong: [42, null, '', ['x']],
  omitted: 'refused',
  omittedForRetail: 'accepted',
});
const rows: readonly FieldRow[] = [
  {
    field: 'create.branch',
    at: 'create',
    key: 'branch',
    valid: [['branch-one', '"branch-one"']],
    wrong: [42, null, '', 'a/b', 'a b'],
    omitted: 'accepted',
  },
  {
    field: 'create.counterpart',
    at: 'create',
    key: 'counterpart',
    valid: [
      [
        invoice().counterpart,
        '{"name":"Synthetic Company","country_code":"GR","vat":"synthetic-vat","city":"Athens","street":"Synthetic","number":"1","postal_code":"00000"}',
      ],
    ],
    wrong: [null, 'Synthetic Company', [], {}, { ...invoice().counterpart, unknown: true }],
    omitted: 'refused',
  },
  {
    field: 'create.billing_book_id',
    at: 'create',
    key: 'billing_book_id',
    valid: [['book-one', '"book-one"']],
    wrong: [42, null, '', 'a/b'],
    omitted: 'refused',
  },
  {
    field: 'create.payment_method_type',
    at: 'create',
    key: 'payment_method_type',
    valid: [0, 1, 2, 3, 4, 5, 6, 7].map((code) => [code, String(code)] as const),
    wrong: ['1', 1.5, -1, 8, Number.NaN, null],
    omitted: 'refused',
  },
  freeText('payment_details'),
  {
    field: 'create.currency',
    at: 'create',
    key: 'currency',
    valid: [
      ['USD', '"USD"'],
      ['NOK', '"NOK"'],
    ],
    wrong: ['usd', 'US', 'USDX', 42, null],
    // Leaving currency out while still sending a rate is the coupled-presence policy.
    omitted: 'refused',
    with: { exchange_rate: decimal('1.08') },
  },
  total('net_total_amount'),
  total('vat_total_amount'),
  total('total_amount'),
  total('payable_total_amount'),
  freeText('notes'),
  {
    field: 'create.correlated_invoices',
    at: 'create',
    key: 'correlated_invoices',
    valid: [
      [[], '[]'],
      [['mark-one', 'mark-two'], '["mark-one","mark-two"]'],
    ],
    wrong: ['mark-one', [42], [''], ['a/b'], Array.from({ length: 101 }, () => 'mark'), null],
    omitted: 'accepted',
  },
  {
    field: 'create.customer_emails',
    at: 'create',
    key: 'customer_emails',
    valid: [
      [[], '[]'],
      [
        ['first@example.invalid', 'second@example.invalid'],
        '["first@example.invalid","second@example.invalid"]',
      ],
    ],
    wrong: [
      'first@example.invalid',
      [42],
      [''],
      Array.from({ length: 101 }, () => 'a@example.invalid'),
      null,
    ],
    omitted: 'accepted',
  },
  {
    field: 'create.email_locale',
    at: 'create',
    key: 'email_locale',
    valid: [
      ['el', '"el"'],
      ['en', '"en"'],
    ],
    wrong: ['EL', 'fr', '', 42, null],
    omitted: 'accepted',
  },
  flag('generate_pdf'),
  flag('mark_as_paid'),
  {
    field: 'create.external_id',
    at: 'create',
    key: 'external_id',
    valid: [
      ['reference-one', '"reference-one"'],
      ['Δοκιμή-1', quoted('Δοκιμή-1')],
      ['r'.repeat(256), quoted('r'.repeat(256))],
    ],
    wrong: ['', 'a b', 'a/b', 'a%b', 'a?b', 'a#b', 'a\\b', '..', 'r'.repeat(257), 42, null],
    // Required by SDK policy even though the provider makes it optional.
    omitted: 'refused',
  },
  {
    field: 'counterpart.name',
    at: 'counterpart',
    key: 'name',
    valid: [
      ['Synthetic Company', '"Synthetic Company"'],
      ['Όνομα Επώνυμο', quoted('Όνομα Επώνυμο')],
    ],
    wrong: ['', 42, null],
    omitted: 'refused',
  },
  {
    field: 'counterpart.country_code',
    at: 'counterpart',
    key: 'country_code',
    valid: [['GR', '"GR"']],
    wrong: ['gr', 'GRC', 'G', 42, null],
    omitted: 'refused',
    omittedForRetail: 'accepted',
  },
  businessIdentity('vat', 'synthetic-vat'),
  businessIdentity('city', 'Athens'),
  businessIdentity('street', 'Synthetic street'),
  businessIdentity('number', '1A'),
  businessIdentity('postal_code', '00000'),
  {
    field: 'counterpart.email',
    at: 'counterpart',
    key: 'email',
    valid: [['recipient@example.invalid', '"recipient@example.invalid"']],
    wrong: ['', 42, null],
    omitted: 'accepted',
  },
  {
    field: 'invoice_lines[].line_number',
    at: 'line',
    key: 'line_number',
    valid: [
      [1, '1'],
      [1000, '1000'],
    ],
    wrong: [0, 1001, 1.5, '1', null],
    omitted: 'refused',
  },
  {
    field: 'invoice_lines[].name',
    at: 'line',
    key: 'name',
    valid: [['Synthetic service', '"Synthetic service"']],
    wrong: ['', 42, null],
    omitted: 'refused',
  },
  freeText('code', 'line'),
  freeText('description', 'line'),
  precise('quantity'),
  precise('unit_price'),
  total('net_total_price', 'line'),
  total('vat_total', 'line'),
  total('subtotal', 'line'),
];
function withOut(at: Location, key: string, type: '2.1' | '11.2', extra: Record<string, unknown>) {
  const input = place(at, key, undefined) as unknown as Record<string, unknown>;
  const drop = (record: unknown) =>
    Object.fromEntries(Object.entries(record as object).filter(([name]) => name !== key));
  const lines = input.invoice_lines as unknown[];
  const patched: unknown = {
    ...(at === 'create' ? drop(input) : input),
    ...(at === 'counterpart' ? { counterpart: drop(input.counterpart) } : {}),
    ...(at === 'line' ? { invoice_lines: [drop(lines[0])] } : {}),
    invoice_type_code: type,
    ...extra,
  };
  return patched as CreateInvoiceInput;
}
describe.each(rows)('request field $field', (row) => {
  it('should send each valid value as its literal wire token', async () => {
    for (const [value, expected] of row.valid) {
      const body = await accepted({ ...place(row.at, row.key, value), ...row.with });
      expect(token(body, row.at, row.key)).toBe(expected);
    }
  });
  it('should refuse a wrong type or out-of-bounds value before authentication', async () => {
    for (const value of row.wrong) await refused({ ...place(row.at, row.key, value), ...row.with });
  });
  it('should apply its presence rule for the business and retail profiles', async () => {
    const business = withOut(row.at, row.key, '2.1', row.with ?? {});
    if (row.omitted === 'refused') await refused(business);
    else expect(token(await accepted(business), row.at, row.key)).toBeUndefined();
    if (row.omittedForRetail === 'accepted')
      expect(
        token(await accepted(withOut(row.at, row.key, '11.2', {})), row.at, row.key),
      ).toBeUndefined();
  });
});
describe('request field create.invoice_lines', () => {
  const [first] = invoice().invoice_lines;
  if (!first) throw new Error('fixture');
  it('should send each valid value as its literal wire token', async () => {
    const body = await accepted({
      ...invoice(),
      invoice_lines: [first, { ...first, line_number: 2, name: 'Second synthetic service' }],
    });
    const lines: unknown = (parse(body) as Record<string, unknown>).invoice_lines;
    expect(Array.isArray(lines) && lines.length).toBe(2);
    expect(body).toContain('"line_number":2,"name":"Second synthetic service"');
  });
  it('should refuse a wrong type or out-of-bounds value before authentication', async () => {
    for (const value of [
      [],
      'line',
      null,
      [first, first],
      [{ ...first, unknown: true }],
      [null],
      Array.from({ length: 1001 }, (_, index) => ({ ...first, line_number: index + 1 })),
    ])
      await refused(place('create', 'invoice_lines', value));
  });
  it('should apply its presence rule for the business and retail profiles', async () => {
    await refused(withOut('create', 'invoice_lines', '2.1', {}));
    await refused(withOut('create', 'invoice_lines', '11.2', {}));
  });
});

// Historical profile regression for the four invoice types the SDK already issues. Local
// acceptance says the request is well formed; whether the tenant may issue the type, and
// whether the tax treatment is right, is decided by the provider and the caller.
const complete = (type: '2.1' | '2.2' | '2.3' | '11.2'): CreateInvoiceInput => {
  const base = invoice();
  const [first] = base.invoice_lines;
  if (!first) throw new Error('fixture');
  return {
    ...base,
    invoice_type_code: type,
    branch: 'branch-one',
    payment_details: 'Synthetic payment note',
    notes: 'Synthetic note',
    currency: 'USD',
    exchange_rate: decimal('1.08'),
    correlated_invoices: ['mark-one'],
    customer_emails: ['recipient@example.invalid'],
    email_locale: 'en',
    generate_pdf: true,
    mark_as_paid: false,
    counterpart: { ...base.counterpart, email: 'recipient@example.invalid' },
    invoice_lines: [
      { ...first, code: 'SKU-SYNTHETIC', description: 'Synthetic description', quantity_type: 1 },
      { ...first, line_number: 2, vat_rate: 0, vat_exemption_code: 1, vat_total: decimal('0') },
    ],
  };
};
describe.each(['2.1', '2.2', '2.3', '11.2'] as const)('invoice type %s profile', (type) => {
  const answer = (body: unknown) =>
    provider(({ url }) => (url.pathname.endsWith('/login') ? login() : json(body))).client.invoices;
  it('should issue the minimal profile with the type code as a string', async () => {
    const body = await accepted({ ...invoice(), invoice_type_code: type });
    expect(token(body, 'create', 'invoice_type_code')).toBe(quoted(type));
  });
  it('should issue the complete optional-field profile and send every field', async () => {
    const body = await accepted(complete(type));
    for (const key of [
      'branch',
      'payment_details',
      'notes',
      'currency',
      'exchange_rate',
      'correlated_invoices',
      'customer_emails',
      'email_locale',
      'generate_pdf',
      'mark_as_paid',
    ])
      expect(token(body, 'create', key)).toBeDefined();
    expect(token(body, 'create', 'mark_as_paid')).toBe('false');
    expect(token(body, 'counterpart', 'email')).toBe('"recipient@example.invalid"');
    for (const key of ['code', 'description', 'quantity_type'])
      expect(token(body, 'line', key)).toBeDefined();
  });
  it('should apply the counterpart requirement of its profile', async () => {
    const nameOnly = { ...invoice(), invoice_type_code: type, counterpart: { name: 'Synthetic' } };
    if (type === '11.2') {
      expect(token(await accepted(nameOnly), 'counterpart', 'vat')).toBeUndefined();
    } else {
      await refused(nameOnly);
      for (const key of ['country_code', 'vat', 'city', 'street', 'number', 'postal_code'])
        await refused(withOut('counterpart', key, type as '2.1', { invoice_type_code: type }));
    }
    await refused(withOut('counterpart', 'name', type as '2.1', { invoice_type_code: type }));
  });
  it('should refuse fields of profiles this SDK does not issue yet', async () => {
    for (const [key, value] of [
      ['draft', true],
      ['is_delivery_note', true],
      ['b2g', true],
      ['taxes_totals', []],
      ['refund_invoice_id', 'invoice-one'],
      ['aade_preloaded', true],
      ['third_party_collection', true],
    ] as const)
      await refused({ ...place('create', key, value), invoice_type_code: type });
  });
  it('should report observed, pending and rejected outcomes for the same request', async () => {
    const input = { ...invoice(), invoice_type_code: type };
    const kinds: CreateOutcome['kind'][] = [];
    for (const body of [
      observation(),
      pending(),
      enrichedPending(),
      { status: 'Invoice Errors', errors: [{ title: 'Synthetic refusal' }] },
    ])
      kinds.push((await answer(body).create(input)).kind);
    expect(kinds).toEqual(['observed', 'pending', 'pending', 'rejected']);
  });
});
describe('unsupported invoice types', () => {
  it.each(['1.1', '2.4', '8.6', '9.3', '11.1', '', 2.1, null])(
    'should refuse invoice type %j before authentication',
    async (type) => {
      await refused(place('create', 'invoice_type_code', type));
    },
  );
});
