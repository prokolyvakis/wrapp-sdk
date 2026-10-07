import { LosslessNumber, parse } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { getProviderDiagnostics, WrappError } from '../../src/index.js';
import type {
  CreateBillingBookInput,
  CreateBranchInput,
  RequestOptions,
  WrappClient,
} from '../../src/index.js';
import { json, login, provider } from '../fixtures/provider.js';

// Synthetic values in the documented shapes of the Wrapp reference v1.18.0. Methods, paths
// and body tokens are written literally and never read from the SDK's operation registry.
const token = 'synthetic.jwt.token';
function answering(respond: () => Response | Promise<Response>, timeoutMs?: number) {
  return provider(
    ({ url }) => (url.pathname.endsWith('/login') ? login(token) : respond()),
    timeoutMs === undefined ? {} : { timeoutMs },
  );
}
async function failure(run: Promise<unknown>): Promise<WrappError> {
  const error: unknown = await run.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof WrappError)) throw new Error('Expected a WrappError');
  return error;
}
function headers(init: RequestInit): Record<string, string> {
  return Object.fromEntries(
    Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
  );
}
// The dispatched body as key → exact JSON token.
function tokens(init: RequestInit | undefined): Record<string, string> {
  if (typeof init?.body !== 'string') throw new Error('No JSON body was dispatched');
  return Object.fromEntries(
    Object.entries(parse(init.body) as Record<string, unknown>).map(([key, value]) => [
      key,
      value instanceof LosslessNumber ? value.value : JSON.stringify(value),
    ]),
  );
}
const branch = (): CreateBranchInput => ({
  name: 'Υποκατάστημα',
  code: 2,
  address: 'Synthetic street',
  street_number: '10',
  city: 'Athens',
  postal_code: '00000',
});
const book = (): CreateBillingBookInput => ({
  name: 'Synthetic book',
  series: 'ΣΒ',
  number: 1,
  invoice_type_code: '2.1',
});
const branchAnswer = { id: 'branch-one', name: 'Υποκατάστημα', code: 2, future_field: true };
const bookAnswer = {
  id: 'book-one',
  name: 'Synthetic book',
  series: 'ΣΒ',
  invoice_type_code: '2.1',
};
const rejected = { kind: 'rejected', errorCount: 2, rejectionSource: 'unknown' };
const refusal = {
  errors: [{ title: 'Synthetic refusal one' }, { title: 'Synthetic refusal two' }],
};
const failures = [
  { label: 'HTTP 401', respond: () => json({}, 401), code: 'AUTH_ERROR', httpStatus: 401 },
  { label: 'HTTP 404', respond: () => json({}, 404), code: 'HTTP_ERROR', httpStatus: 404 },
  { label: 'HTTP 422', respond: () => json({}, 422), code: 'HTTP_ERROR', httpStatus: 422 },
  { label: 'HTTP 500', respond: () => json({}, 500), code: 'HTTP_ERROR', httpStatus: 500 },
  {
    label: 'a network failure',
    respond: () => Promise.reject(new Error('synthetic network failure')),
    code: 'NETWORK_ERROR',
  },
  {
    label: 'a response that never arrives',
    respond: () => new Promise<Response>(() => undefined),
    code: 'TIMEOUT',
    // The only case that needs a short deadline; the others answer at once.
    timeoutMs: 40,
  },
  {
    label: 'a malformed success body',
    respond: () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    code: 'PROTOCOL_ERROR',
  },
];
interface Operation {
  readonly name: string;
  readonly operation: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly call: (client: WrappClient, options?: RequestOptions) => Promise<unknown>;
  readonly success: unknown;
  readonly outcome: unknown;
  readonly malformed: readonly (readonly [string, unknown])[];
}
const operations: readonly Operation[] = [
  {
    name: 'branches.create',
    operation: 'branchCreate',
    method: 'POST',
    path: '/api/v1/branches',
    body: '{"name":"Υποκατάστημα","code":2,"address":"Synthetic street","street_number":"10","city":"Athens","postal_code":"00000"}',
    call: (client, options) => client.branches.create(branch(), options),
    success: branchAnswer,
    outcome: { kind: 'observed', branch: { id: 'branch-one', name: 'Υποκατάστημα', code: '2' } },
    malformed: [
      ['a branch without an id', { name: 'x', code: 2 }],
      ['a branch with an empty name', { id: 'branch-one', name: '', code: 2 }],
      ['a branch with a fractional code', { id: 'branch-one', name: 'x', code: 1.5 }],
      ['a list of branches', [branchAnswer]],
      ['a status envelope', { ...branchAnswer, status: 'created' }],
      ['an empty object', {}],
      ['a JSON null', null],
    ],
  },
  {
    name: 'branches.update',
    operation: 'branchUpdate',
    method: 'PUT',
    path: '/api/v1/branches/branch-one',
    body: '{"name":"Νέο όνομα","city":"Piraeus"}',
    call: (client, options) =>
      client.branches.update('branch-one', { name: 'Νέο όνομα', city: 'Piraeus' }, options),
    success: { id: 'branch-one', name: 'Νέο όνομα', code: '002' },
    outcome: { kind: 'observed', branch: { id: 'branch-one', name: 'Νέο όνομα', code: '002' } },
    malformed: [
      ['another branch', { id: 'branch-two', name: 'x', code: 2 }],
      ['a branch whose id differs only in case', { id: 'BRANCH-ONE', name: 'x', code: 2 }],
      ['a branch without an id', { name: 'x', code: 2 }],
      ['a status envelope', { id: 'branch-one', name: 'x', code: 2, status: 'updated' }],
      ['an empty object', {}],
      ['a JSON null', null],
    ],
  },
  {
    name: 'billingBooks.create',
    operation: 'billingBookCreate',
    method: 'POST',
    path: '/api/v1/billing_books',
    body: '{"name":"Synthetic book","series":"ΣΒ","number":1,"invoice_type_code":"2.1"}',
    call: (client, options) => client.billingBooks.create(book(), options),
    success: { ...bookAnswer, future_field: true },
    outcome: { kind: 'observed', billingBook: bookAnswer },
    malformed: [
      ['a book without an id', { name: 'x', series: 'S', invoice_type_code: '2.1' }],
      ['a book without a type', { id: 'book-one', name: 'x', series: 'S' }],
      ['a book with a fractional number', { ...bookAnswer, number: 1.5 }],
      ['a book with a null number', { ...bookAnswer, number: null }],
      ['a status envelope', { ...bookAnswer, status: 'created' }],
      ['an empty object', {}],
      ['a JSON null', null],
    ],
  },
];

describe.each(operations)('$name', (op) => {
  const dispatched = (calls: readonly { url: URL; init: RequestInit }[]) =>
    calls.filter((sent) => sent.url.pathname === op.path && sent.init.method === op.method);
  it('should send exactly one authenticated request with its literal method, path and body', async () => {
    const { client, calls } = answering(() => json(op.success));
    await op.call(client);
    expect(calls).toHaveLength(2);
    const [, sent] = calls;
    if (!sent) throw new Error('fixture');
    expect(sent.url.href).toBe('https://staging.wrapp.ai' + op.path);
    expect(sent.init.method).toBe(op.method);
    expect(sent.init.redirect).toBe('error');
    expect(sent.init.body).toBe(op.body);
    expect(headers(sent.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    });
  });
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json(op.success));
    for (const options of [
      { timeoutMs: 0 },
      { signal: {} },
      { diagnostics: 'all' },
      { unknown: true },
    ] as unknown as RequestOptions[])
      expect(await failure(op.call(client, options))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: op.operation,
        effect: 'not-sent',
      });
    expect(calls).toHaveLength(0);
  });
  it('should return its own frozen outcome for the documented success body', async () => {
    const { client, calls } = answering(() => json(op.success));
    const outcome = await op.call(client);
    expect(outcome).toEqual(op.outcome);
    expect(Object.isFrozen(outcome)).toBe(true);
    for (const nested of Object.values(outcome as object))
      if (nested !== null && typeof nested === 'object') expect(Object.isFrozen(nested)).toBe(true);
    expect(dispatched(calls)).toHaveLength(1);
  });
  it('should return a provider rejection as a rejected result that names nothing', async () => {
    const { client, calls } = answering(() => json(refusal));
    const outcome = await op.call(client, { diagnostics: 'provider-issues' });
    expect(outcome).toEqual(rejected);
    expect(JSON.stringify(outcome)).not.toContain('Synthetic refusal');
    expect(getProviderDiagnostics(outcome)?.issues).toHaveLength(2);
    expect(dispatched(calls)).toHaveLength(1);
    expect(
      getProviderDiagnostics(await op.call(answering(() => json(refusal)).client)),
    ).toBeUndefined();
  });
  it.each(op.malformed)(
    'should treat %s as a protocol error with unknown effect',
    async (_label, body) => {
      const { client, calls } = answering(() => json(body));
      expect(await failure(op.call(client))).toMatchObject({
        code: 'PROTOCOL_ERROR',
        operation: op.operation,
        effect: 'unknown',
      });
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
  it.each([
    { errors: [{ title: 'x' }], id: 'branch-one' },
    { errors: [{ title: 'x' }], status: 'surprise' },
    { errors: [] },
    { error: 42 },
  ])('should treat the contradictory envelope %j as a protocol error', async (body) => {
    const { client } = answering(() => json(body));
    expect(await failure(op.call(client))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
  });
  it('should classify an error envelope by its identifying evidence, not by stray fields', async () => {
    // The answer's id is what identifies a success. An error envelope carrying one is
    // contradictory; one that merely repeats other fields, or names its rejection family,
    // is still a rejection.
    for (const extra of [
      { name: 'Synthetic', code: 2 },
      { name: 'Synthetic', series: 'S', invoice_type_code: '2.1' },
      { status: 'Invoice Errors' },
    ]) {
      const { client } = answering(() => json({ errors: [{ title: 'x' }], ...extra }));
      expect(await op.call(client)).toMatchObject({ kind: 'rejected', errorCount: 1 });
    }
    const { client } = answering(() =>
      json({ errors: [{ title: 'x' }], id: 'branch-one', name: 'Synthetic', code: 2 }),
    );
    expect(await failure(op.call(client))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(op.call(client));
      expect(error).toMatchObject({ code, operation: op.operation, effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
      expect(calls).toHaveLength(2);
    },
  );
});

// Each branch field on its own: the value sent, the exact token expected, and wrong values.
const branchFields = [
  { key: 'name', required: true, valid: [['Κεντρικό', '"Κεντρικό"']], wrong: ['', 42, null] },
  {
    key: 'code',
    required: true,
    valid: [
      [0, '0'],
      [2, '2'],
      [999999, '999999'],
    ],
    wrong: ['2', 1.5, -1, null, Number.NaN],
  },
  { key: 'address', required: true, valid: [['Ερμού', '"Ερμού"']], wrong: ['', 42, null] },
  { key: 'street_number', required: true, valid: [['10A', '"10A"']], wrong: ['', 10, null] },
  { key: 'city', required: true, valid: [['Αθήνα', '"Αθήνα"']], wrong: ['', 42, null] },
  { key: 'postal_code', required: true, valid: [['10563', '"10563"']], wrong: ['', 10563, null] },
  {
    key: 'phone',
    required: false,
    valid: [
      ['2100000000', '"2100000000"'],
      ['', '""'],
    ],
    wrong: [2100000000, null],
  },
  { key: 'address_en', required: false, valid: [['Ermou', '"Ermou"']], wrong: [42, null] },
  { key: 'city_en', required: false, valid: [['Athens', '"Athens"']], wrong: [42, null] },
  {
    key: 'default_option',
    required: false,
    valid: [
      [true, 'true'],
      [false, 'false'],
    ],
    wrong: ['true', 1, 0, null],
  },
  {
    key: 'company_activity',
    required: false,
    valid: [['Υπηρεσίες', '"Υπηρεσίες"']],
    wrong: [42, null],
  },
  {
    key: 'company_activity_en',
    required: false,
    valid: [['Services', '"Services"']],
    wrong: [42, null],
  },
] as const;
describe.each(branchFields)('branch field $key', (field) => {
  const without = () =>
    Object.fromEntries(Object.entries(branch()).filter(([key]) => key !== field.key)) as never;
  it('should send each valid value as its literal token on create', async () => {
    for (const [value, expected] of field.valid) {
      const { client, calls } = answering(() => json(branchAnswer));
      await client.branches.create({ ...branch(), [field.key]: value });
      const sent = tokens(calls[1]?.init);
      expect(sent[field.key]).toBe(expected);
      // Nothing else rides along: the six required fields plus, at most, this one.
      expect(Object.keys(sent).sort()).toEqual(
        [...new Set([...Object.keys(branch()), field.key])].sort(),
      );
    }
  });
  it('should refuse a wrong type or value on create before any request', async () => {
    for (const value of field.wrong) {
      const { client, calls } = answering(() => json(branchAnswer));
      expect(
        await failure(client.branches.create({ ...branch(), [field.key]: value })),
      ).toMatchObject({ code: 'INVALID_INPUT', operation: 'branchCreate', effect: 'not-sent' });
      expect(calls).toHaveLength(0);
    }
  });
  it('should apply its presence rule on create and leave an omitted field off the wire', async () => {
    const { client, calls } = answering(() => json(branchAnswer));
    if (field.required) {
      expect(await failure(client.branches.create(without()))).toMatchObject({
        code: 'INVALID_INPUT',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    } else {
      await client.branches.create(branch());
      expect(field.key in tokens(calls[1]?.init)).toBe(false);
    }
  });
  it('should send it alone on update, with no other field and no default', async () => {
    for (const [value, expected] of field.valid) {
      const { client, calls } = answering(() => json({ id: 'branch-one', name: 'x', code: 2 }));
      await client.branches.update('branch-one', { [field.key]: value });
      expect(tokens(calls[1]?.init)).toEqual({ [field.key]: expected });
    }
  });
  it('should refuse a wrong type or value on update before any request', async () => {
    for (const value of field.wrong) {
      const { client, calls } = answering(() => json(branchAnswer));
      expect(
        await failure(client.branches.update('branch-one', { [field.key]: value })),
      ).toMatchObject({ code: 'INVALID_INPUT', operation: 'branchUpdate', effect: 'not-sent' });
      expect(calls).toHaveLength(0);
    }
  });
});
describe('branch writes', () => {
  it('should send all twelve fields together, preserving an explicit false', async () => {
    const { client, calls } = answering(() => json(branchAnswer));
    await client.branches.create({
      ...branch(),
      phone: '2100000000',
      address_en: 'Ermou',
      city_en: 'Athens',
      default_option: false,
      company_activity: 'Υπηρεσίες',
      company_activity_en: 'Services',
    });
    expect(tokens(calls[1]?.init)).toEqual({
      name: '"Υποκατάστημα"',
      code: '2',
      address: '"Synthetic street"',
      street_number: '"10"',
      city: '"Athens"',
      postal_code: '"00000"',
      phone: '"2100000000"',
      address_en: '"Ermou"',
      city_en: '"Athens"',
      default_option: 'false',
      company_activity: '"Υπηρεσίες"',
      company_activity_en: '"Services"',
    });
  });
  it.each([{}, null, 'name', { unknown: true }, { name: 'x', unknown: true }])(
    'should refuse the update patch %j before any request',
    async (patch) => {
      const { client, calls } = answering(() => json(branchAnswer));
      expect(await failure(client.branches.update('branch-one', patch as never))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'branchUpdate',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it.each(['', '../x', 'a/b', 'a b', 'a?b', 'a#b', '..', 'x'.repeat(257), 42, null])(
    'should refuse the branch id %j before any request',
    async (id) => {
      const { client, calls } = answering(() => json(branchAnswer));
      expect(await failure(client.branches.update(id as string, { name: 'x' }))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'branchUpdate',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it('should percent-encode the branch id once and never read the branch before updating it', async () => {
    const { client, calls } = answering(() => json({ id: 'Δοκιμή.1', name: 'x', code: 2 }));
    await client.branches.update('Δοκιμή.1', { phone: '' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.pathname).toBe('/api/v1/branches/%CE%94%CE%BF%CE%BA%CE%B9%CE%BC%CE%AE.1');
    expect(calls[1]?.init.body).toBe('{"phone":""}');
  });
  it('should refuse an unknown create field and a body over the request-size bound', async () => {
    const { client, calls } = answering(() => json(branchAnswer));
    expect(
      await failure(client.branches.create({ ...branch(), unknown: true } as never)),
    ).toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
    expect(calls).toHaveLength(0);
    const bounded = provider(() => login(token), { maxRequestBytes: 30 });
    expect(await failure(bounded.client.branches.create(branch()))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'branchCreate',
      effect: 'not-sent',
    });
    expect(bounded.calls).toHaveLength(0);
  });
  it('should keep listing branches unchanged', async () => {
    const { client, calls } = answering(() => json([{ id: 'branch-one', name: 'Main', code: 0 }]));
    expect(await client.branches.list()).toEqual([{ id: 'branch-one', name: 'Main', code: '0' }]);
    expect(calls[1]?.init.method).toBe('GET');
  });
});
describe('billing-book creation', () => {
  const create = (client: WrappClient, patch: Record<string, unknown>) =>
    client.billingBooks.create({ ...book(), ...patch });
  it.each([
    { key: 'name', valid: [['Τιμολόγιο', '"Τιμολόγιο"']], wrong: ['', 42, null] },
    { key: 'series', valid: [['ΕΤΠΑ', '"ΕΤΠΑ"']], wrong: ['', 42, null] },
    {
      key: 'number',
      valid: [
        [0, '0'],
        [1, '1'],
        [123456, '123456'],
      ],
      wrong: ['1', 1.5, -1, null],
    },
    {
      key: 'invoice_type_code',
      valid: [
        ['1.1', '"1.1"'],
        ['9.3', '"9.3"'],
        ['17.6', '"17.6"'],
      ],
      wrong: ['', '2.10', '99.9', 2.1, null],
    },
  ] as const)('should validate and send $key literally', async ({ key, valid, wrong }) => {
    for (const [value, expected] of valid) {
      const { client, calls } = answering(() => json(bookAnswer));
      await create(client, { [key]: value });
      expect(tokens(calls[1]?.init)[key]).toBe(expected);
    }
    for (const value of wrong) {
      const { client, calls } = answering(() => json(bookAnswer));
      expect(await failure(create(client, { [key]: value }))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'billingBookCreate',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    }
    const { client, calls } = answering(() => json(bookAnswer));
    const missing = Object.fromEntries(Object.entries(book()).filter(([name]) => name !== key));
    expect(await failure(client.billingBooks.create(missing as never))).toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(calls).toHaveLength(0);
  });
  it('should accept the documented answer without a number, leaving it absent', async () => {
    const { client } = answering(() => json(bookAnswer));
    const outcome = await client.billingBooks.create(book());
    if (outcome.kind !== 'observed') throw new Error('fixture');
    expect('number' in outcome.billingBook).toBe(false);
  });
  it('should keep a returned number as exact text when the provider sends one', async () => {
    const text = JSON.stringify({ ...bookAnswer, number: 0 }).replace(
      '"number":0',
      '"number":9007199254740993',
    );
    const { client } = answering(
      () => new Response(text, { headers: { 'content-type': 'application/json' } }),
    );
    expect(await client.billingBooks.create(book())).toMatchObject({
      billingBook: { number: '9007199254740993' },
    });
  });
  it('should accept a returned type the provider normalized to its family', async () => {
    // The provider documents that a book requested as 1.2 is stored under 1.1.
    const { client } = answering(() => json({ ...bookAnswer, invoice_type_code: '1.1' }));
    expect(await create(client, { invoice_type_code: '1.2' })).toMatchObject({
      kind: 'observed',
      billingBook: { invoice_type_code: '1.1' },
    });
  });
  it('should keep listing billing books unchanged, with the number required there', async () => {
    const { client } = answering(() => json([{ ...bookAnswer, number: 4 }]));
    expect(await client.billingBooks.list()).toEqual([{ ...bookAnswer, number: '4' }]);
    expect(
      await failure(answering(() => json([bookAnswer])).client.billingBooks.list()),
    ).toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
});
