import { LosslessNumber, parse } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import type { CreateInvoiceInput } from '../../src/index.js';
import { invoice, json, login, observation, provider } from '../fixtures/provider.js';

// Synthetic values in the request shape of the Wrapp reference v1.18.0. No authority,
// contract or budget identifier here is real, and none is looked up or interpreted.
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
const required = {
  delivery_address_city: 'Synthetic City',
  delivery_address_street: 'Synthetic Street',
  delivery_address_street_number: '2',
  delivery_address_postal_code: '11111',
  delivery_address_party_name: 'Synthetic Authority',
  b2g_contracting_authority_id: '1000.E00000.00001',
  b2g_contract_identifier: '26SYMV000000001',
  b2g_budget_type: 1,
  b2g_budget_identifier: 'SYNTHETIC-ADA-1',
  b2g_payment_details: 'Synthetic payment details',
  b2g_due_date: '2026-01-31',
};
const optional = { b2g_buyer_reference: 'Synthetic buyer reference', b2g_bt_70: 'Synthetic party' };
const cpv = { cpv_code: '72000000-5' };
// A key set to undefined is removed. Deliberately untyped: these tests exercise the runtime
// boundary with values the public types would refuse.
function strip(value: Patch): Patch {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
function build(root: Patch = {}, lines: readonly Patch[] = [cpv]): CreateInvoiceInput {
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
const b2g = (patch: Patch = {}, lines?: readonly Patch[]) =>
  build({ b2g: true, ...required, ...patch }, lines);
interface Sent {
  readonly create: Record<string, unknown>;
  readonly lines: readonly Record<string, unknown>[];
}
async function accepted(input: CreateInvoiceInput): Promise<Sent> {
  const { client, calls } = issuing();
  expect((await client.invoices.create(input)).kind).toBe('observed');
  expect(calls).toHaveLength(2);
  const body = calls.at(-1)?.init.body;
  const root = typeof body === 'string' ? parse(body) : undefined;
  if (!isRecord(root) || !Array.isArray(root.invoice_lines))
    throw new Error('The dispatched body is not a create request');
  const literal = (value: unknown) => (value instanceof LosslessNumber ? '#' + value.value : value);
  return {
    create: Object.fromEntries(Object.entries(root).map(([k, v]) => [k, literal(v)])),
    lines: root.invoice_lines
      .filter(isRecord)
      .map((line) => Object.fromEntries(Object.entries(line).map(([k, v]) => [k, literal(v)]))),
  };
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
const rootKeys = ['b2g', ...Object.keys(required), ...Object.keys(optional)];

describe('B2G invoice fields', () => {
  it('should send none of the B2G fields when the caller supplies none', async () => {
    const sent = await accepted(build({}, [{}]));
    for (const key of rootKeys) expect(sent.create, key).not.toHaveProperty(key);
    expect(sent.lines[0]).not.toHaveProperty('cpv_code');
  });
  it('should send all fourteen invoice fields and the line code under their exact names and values', async () => {
    const sent = await accepted(b2g(optional));
    expect(rootKeys).toHaveLength(14);
    expect(sent.create).toMatchObject({
      b2g: true,
      ...required,
      ...optional,
      b2g_budget_type: '#1',
    });
    expect(sent.lines[0]?.cpv_code).toBe('72000000-5');
  });
  it('should accept a B2G invoice without the two optional references and add none', async () => {
    const sent = await accepted(b2g());
    for (const key of Object.keys(optional)) expect(sent.create, key).not.toHaveProperty(key);
  });
  it.each(Object.keys(required))(
    'should refuse a B2G invoice without %s before authentication',
    async (key) => {
      await refused(b2g({ [key]: undefined }));
    },
  );
  it.each(Object.keys(required).filter((key) => key !== 'b2g_budget_type'))(
    'should refuse an empty or non-text %s',
    async (key) => {
      await refused(b2g({ [key]: '' }));
      await refused(b2g({ [key]: 5 }));
      await refused(b2g({ [key]: null }));
    },
  );
  it('should refuse a B2G invoice when any one line lacks a cpv_code', async () => {
    await refused(b2g({}, [{}]));
    await refused(b2g({}, [cpv, {}]));
    await refused(b2g({}, [{}, cpv]));
    expect((await accepted(b2g({}, [cpv, cpv]))).lines.map((line) => line.cpv_code)).toEqual([
      '72000000-5',
      '72000000-5',
    ]);
  });
  it.each([72000000, '', null, true])('should refuse cpv_code %j', async (value) => {
    await refused(b2g({}, [{ cpv_code: value }]));
  });
  it.each(['true', 1, 0, null])('should refuse b2g %j', async (value) => {
    await refused(build({ ...required, b2g: value }));
  });
});

describe('B2G budget type and due date', () => {
  it.each([1, 2, 3])('should send b2g_budget_type %d as an integer token', async (type) => {
    expect((await accepted(b2g({ b2g_budget_type: type }))).create.b2g_budget_type).toBe(
      '#' + String(type),
    );
  });
  it.each([0, 4, -1, 1.5, '1', null, true])('should refuse b2g_budget_type %j', async (type) => {
    await refused(b2g({ b2g_budget_type: type }));
  });
  it.each(['2026-01-01', '2028-02-29', '2026-12-31'])(
    'should send the due date %s as given',
    async (date) => {
      expect((await accepted(b2g({ b2g_due_date: date }))).create.b2g_due_date).toBe(date);
    },
  );
  it.each([
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '01-01-2026',
    '2026-1-1',
    '2026-01-01T00:00:00Z',
    ' 2026-01-01',
    20260101,
    null,
  ])('should refuse the due date %j', async (date) => {
    await refused(b2g({ b2g_due_date: date }));
  });
  it.each(Object.keys(optional))(
    'should send %s literally and refuse a non-text value',
    async (key) => {
      const text = 'Line one\nLine two  ';
      expect((await accepted(b2g({ [key]: text }))).create[key]).toBe(text);
      await refused(b2g({ [key]: 5 }));
      await refused(b2g({ [key]: null }));
      await refused(b2g({ [key]: 'x'.repeat(4097) }));
    },
  );
});

describe('invoices that are not B2G', () => {
  it.each([false, undefined])(
    'should require none of the B2G fields when b2g is %j',
    async (flag) => {
      const sent = await accepted(build({ b2g: flag }, [{}]));
      expect(sent.create.b2g).toBe(flag);
    },
  );
  it('should send B2G fields supplied without the flag as given, as the reference example does', async () => {
    const sent = await accepted(build({ b2g: false, ...required, ...optional }, [cpv]));
    expect(sent.create).toMatchObject({
      b2g: false,
      ...required,
      ...optional,
      b2g_budget_type: '#1',
    });
    expect(sent.lines[0]?.cpv_code).toBe('72000000-5');
  });
  it('should still validate a B2G field that is sent without the flag', async () => {
    await refused(build({ b2g_budget_type: 4 }, [{}]));
    await refused(build({ b2g_due_date: '2026-02-30' }, [{}]));
    await refused(build({ delivery_address_city: '' }, [{}]));
  });
  it('should keep the delivery-note object apart: delivery_detail is still not accepted', async () => {
    await refused(b2g({ delivery_detail: { to_city: 'Synthetic City' } }));
    await refused(b2g({ is_delivery_note: true }));
  });
});
