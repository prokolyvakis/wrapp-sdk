import { LosslessNumber, parse } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { decimal } from '../../src/index.js';
import type { CreateInvoiceInput } from '../../src/index.js';
import { invoice, json, login, observation, provider } from '../fixtures/provider.js';

// Synthetic values in the request shape of the Wrapp reference v1.18.0. The one comparison
// tested here is the validity rule the reference states for fuel code 999; nothing is a tax
// calculation.
type Patch = Record<string, unknown>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function issuing() {
  return provider(({ url, init }) => {
    if (url.pathname.endsWith('/login')) return login();
    const sentBody: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const reference = isRecord(sentBody) ? sentBody.external_id : undefined;
    return json(observation(typeof reference === 'string' ? { external_id: reference } : {}));
  });
}
// One patch per line; `counterpart` patches the counterpart. Deliberately untyped: these tests
// exercise the runtime boundary with values the public types would refuse.
function build(root: Patch = {}, lines: readonly Patch[] = [{}], counterpart: Patch = {}) {
  const base = invoice();
  const [first] = base.invoice_lines;
  const patched: unknown = {
    ...base,
    ...root,
    counterpart: { ...base.counterpart, ...counterpart },
    invoice_lines: lines.map((patch, index) => ({ ...first, line_number: index + 1, ...patch })),
  };
  return patched as CreateInvoiceInput;
}
function wire(value: unknown): unknown {
  if (value instanceof LosslessNumber) return '#' + value.value;
  if (Array.isArray(value)) return value.map(wire);
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)]));
  return value;
}
interface Sent {
  readonly create: Record<string, unknown>;
  readonly counterpart: Record<string, unknown>;
  readonly lines: readonly Record<string, unknown>[];
}
async function accepted(input: CreateInvoiceInput): Promise<Sent> {
  const { client, calls } = issuing();
  expect((await client.invoices.create(input)).kind).toBe('observed');
  expect(calls).toHaveLength(2);
  const body = calls.at(-1)?.init.body;
  const create = wire(typeof body === 'string' ? parse(body) : undefined);
  if (!isRecord(create) || !Array.isArray(create.invoice_lines) || !isRecord(create.counterpart))
    throw new Error('The dispatched body is not a create request');
  return { create, counterpart: create.counterpart, lines: create.invoice_lines.filter(isRecord) };
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
const fuel = { fuel_invoice: true };
const codes = [
  10, 11, 12, 13, 14, 15, 20, 21, 30, 31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 50, 60,
  61, 70, 71, 72, 999,
];
const net = (amount: string) => ({ net_total_price: decimal(amount) });

describe('fuel invoice fields', () => {
  it('should send none of the fuel fields when the caller supplies none', async () => {
    const sent = await accepted(build());
    expect(sent.create).not.toHaveProperty('fuel_invoice');
    expect(sent.counterpart).not.toHaveProperty('supply_account_no');
    expect(sent.lines[0]).not.toHaveProperty('fuel_code');
  });
  it.each([true, false])('should preserve fuel_invoice %j', async (value) => {
    expect((await accepted(build({ fuel_invoice: value }))).create.fuel_invoice).toBe(value);
  });
  it.each(['true', 1, 0, null])('should refuse fuel_invoice %j', async (value) => {
    await refused(build({ fuel_invoice: value }));
  });
  it.each(codes.filter((code) => code !== 999))(
    'should send fuel_code %d as an integer token on a fuel invoice',
    async (code) => {
      const sent = await accepted(build(fuel, [{ fuel_code: code }]));
      expect(sent.lines[0]?.fuel_code).toBe('#' + String(code));
    },
  );
  it.each([0, 9, 16, 22, 45, 73, 998, 1000, -20, 20.5, '20', null, true])(
    'should refuse fuel_code %j on a fuel invoice',
    async (code) => {
      await refused(build(fuel, [{ fuel_code: code }]));
    },
  );
  it.each([{}, { fuel_invoice: false }])(
    'should refuse a fuel_code on an invoice sent with %j: the provider refuses it too',
    async (root) => {
      await refused(build(root, [{ fuel_code: 20 }]));
      await refused(build(root, [{}, { fuel_code: 999, ...net('0') }]));
    },
  );
  it('should accept a fuel invoice whose lines carry no fuel code', async () => {
    expect((await accepted(build(fuel))).create.fuel_invoice).toBe(true);
  });
});

describe('fuel code 999', () => {
  it('should accept no line with code 999', async () => {
    const sent = await accepted(build(fuel, [{ fuel_code: 20 }, { fuel_code: 21 }]));
    expect(sent.lines.map((line) => line.fuel_code)).toEqual(['#20', '#21']);
  });
  it('should accept one line with code 999 and send it as given', async () => {
    const sent = await accepted(build(fuel, [{ fuel_code: 20 }, { fuel_code: 999, ...net('5') }]));
    expect(sent.lines[1]).toMatchObject({ fuel_code: '#999', net_total_price: '#5' });
  });
  it('should refuse two lines with code 999', async () => {
    await refused(
      build(fuel, [
        { fuel_code: 20 },
        { fuel_code: 999, ...net('1') },
        { fuel_code: 999, ...net('1') },
      ]),
    );
  });
  it.each([
    ['below the sum of the other lines', ['10.00', '5.50'], '15.49'],
    ['equal to the sum of the other lines', ['10.00', '5.50'], '15.50'],
    ['equal, in another spelling of the same amount', ['10', '5.5'], '15.50'],
    ['zero when it is the only line', [], '0.00'],
    ['equal at a size no double can hold', ['9007199254740993.01'], '9007199254740993.01'],
    ['equal to a sum that binary floating point would understate', ['0.10', '0.70'], '0.80'],
    [
      'equal to a sum that only exact arithmetic gets right',
      ['0.10', '0.20', '999999999999999999.69'],
      '999999999999999999.99',
    ],
  ])('should accept a code 999 line whose net value is %s', async (_label, others, charge) => {
    const lines = [...others.map((amount) => net(amount)), { fuel_code: 999, ...net(charge) }];
    const sent = await accepted(build(fuel, lines));
    // Sent exactly as given: the comparison changes nothing.
    expect(sent.lines.at(-1)?.net_total_price).toBe('#' + charge);
  });
  it.each([
    ['one cent above the sum of the other lines', ['10.00', '5.50'], '15.51'],
    ['above zero when it is the only line', [], '0.01'],
    ['one cent above at a size no double can hold', ['9007199254740993.01'], '9007199254740993.02'],
    ['one cent above a small sum', ['0.10', '0.20'], '0.31'],
  ])('should refuse a code 999 line whose net value is %s', async (_label, others, charge) => {
    await refused(
      build(fuel, [...others.map((amount) => net(amount)), { fuel_code: 999, ...net(charge) }]),
    );
  });
  it('should compare with the other lines wherever the 999 line stands, and with nothing else', async () => {
    // First in the list; the invoice totals disagree with the lines and are not consulted.
    const sent = await accepted(
      build({ ...fuel, net_total_amount: decimal('1.00') }, [
        { fuel_code: 999, ...net('3.00') },
        net('1.00'),
        net('2.00'),
      ]),
    );
    expect(sent.create.net_total_amount).toBe('#1.00');
    await refused(build(fuel, [{ fuel_code: 999, ...net('3.01') }, net('1.00'), net('2.00')]));
  });
});

describe('supply account number', () => {
  it('should send supply_account_no literally on a fuel invoice', async () => {
    const sent = await accepted(build(fuel, [{}], { supply_account_no: '12345678' }));
    expect(sent.counterpart.supply_account_no).toBe('12345678');
  });
  it('should stay optional on a fuel invoice', async () => {
    expect((await accepted(build(fuel))).counterpart).not.toHaveProperty('supply_account_no');
  });
  it('should send it on a non-fuel invoice too, where the provider documents that it ignores it', async () => {
    const sent = await accepted(build({}, [{}], { supply_account_no: '12345678' }));
    expect(sent.counterpart.supply_account_no).toBe('12345678');
    expect(sent.create).not.toHaveProperty('fuel_invoice');
  });
  it.each([12345678, '', null, true, 'x'.repeat(4097)])(
    'should refuse supply_account_no %j',
    async (value) => {
      await refused(build(fuel, [{}], { supply_account_no: value }));
    },
  );
});
