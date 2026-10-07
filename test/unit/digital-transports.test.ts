import { describe, expect, it } from 'vitest';
import { getProviderDiagnostics, WrappError } from '../../src/index.js';
import type { ProviderJson, RequestOptions, WrappClient } from '../../src/index.js';
import { json, login, provider } from '../fixtures/provider.js';
import type { RecordedRequest } from '../fixtures/provider.js';

// Synthetic bodies in the documented shapes of the Wrapp reference v1.18.0. Methods, paths
// and request bodies are written literally and never read from the SDK's operation registry.
const token = 'synthetic.jwt.token';
function answering(respond: () => Response | Promise<Response>, timeoutMs?: number) {
  return provider(
    ({ url }) => (url.pathname.endsWith('/login') ? login(token) : respond()),
    timeoutMs === undefined ? {} : { timeoutMs },
  );
}
const raw = (text: string) =>
  new Response(text, { headers: { 'content-type': 'application/json' } });
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
const dispatched = (calls: readonly RecordedRequest[]) =>
  calls.filter((call) => !call.url.pathname.endsWith('/login'));
function only(calls: readonly RecordedRequest[]): RecordedRequest {
  const [call, ...rest] = dispatched(calls);
  if (call === undefined || rest.length > 0) throw new Error('Expected exactly one dispatch');
  return call;
}
const badOptions = [
  { timeoutMs: 0 },
  { signal: {} },
  { diagnostics: 'all' },
  { unknown: true },
] as unknown as RequestOptions[];
const badIds = ['', '../x', 'a/b', 'a b', 'a?b', 'a#b', '..', 'x'.repeat(257), 42, null];
const failures = [
  { label: 'HTTP 401', respond: () => json({}, 401), code: 'AUTH_ERROR', httpStatus: 401 },
  { label: 'HTTP 404', respond: () => json({}, 404), code: 'HTTP_ERROR', httpStatus: 404 },
  { label: 'HTTP 422', respond: () => json({}, 422), code: 'HTTP_ERROR', httpStatus: 422 },
  { label: 'HTTP 429', respond: () => json({}, 429), code: 'HTTP_ERROR', httpStatus: 429 },
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
    respond: () => raw('{'),
    code: 'PROTOCOL_ERROR',
  },
];
const record = {
  id: 'transport-one',
  category: 'shipping',
  invoice_id: 'invoice-one',
  invoice_issued_at: '2026-06-01T10:00:00.000+03:00',
  invoice_code: 'ΔΑΠ-1024',
  status: 'pending',
  last_status_update_at: '2026-06-08T09:30:00.000+03:00',
};
const evidence = { statusCode: 'Synthetic', legs: [1, '1'], total: 12.5 };
const evidenceTree: ProviderJson = {
  kind: 'object',
  entries: [
    { key: 'statusCode', value: { kind: 'string', value: 'Synthetic' } },
    {
      key: 'legs',
      value: {
        kind: 'array',
        items: [
          { kind: 'number', text: '1' },
          { kind: 'string', value: '1' },
        ],
      },
    },
    { key: 'total', value: { kind: 'number', text: '12.5' } },
  ],
};
const wrapped = { digital_transport: { ...record, my_data_response: evidence } };
const observed = { ...record, my_data_response: evidenceTree };
const listed = { digital_transports: [wrapped.digital_transport], total_pages: 3, current_page: 1 };
const leg = { vehicle_number: 'ABC1234', transport_type: 2, carrier_vat_number: '123456789' };
const createInput = { invoice_id: 'invoice-one', ...leg };
const delivery = {
  outcome: 'PARTIAL',
  delivered_packaging: [
    { packaging_type: 1, quantity: 3 },
    { packaging_type: 6, quantity: 2, other_packaging_title: 'Big bag' },
  ],
};
const wrongLegs = [
  {},
  { ...leg, vehicle_number: '' },
  { ...leg, vehicle_number: 5 },
  { ...leg, carrier_vat_number: '' },
  { ...leg, carrier_vat_number: 123456789 },
  { ...leg, transport_type: 0 },
  { ...leg, transport_type: 8 },
  { ...leg, transport_type: 2.5 },
  { ...leg, transport_type: '2' },
  { ...leg, transport_type: undefined },
  { ...leg, driver: 'x' },
  null,
  'ABC1234',
];

interface Operation {
  readonly name: string;
  readonly operation: string;
  readonly method: string;
  readonly path: string;
  readonly effect: 'unknown' | 'not-sent';
  // The JSON body the documented call carries, or undefined when it carries none.
  readonly body?: unknown;
  readonly success: unknown;
  readonly call: (client: WrappClient, options?: RequestOptions) => Promise<unknown>;
  readonly withId?: (client: WrappClient, id: string) => Promise<unknown>;
  readonly withInput?: (client: WrappClient, input: unknown) => Promise<unknown>;
  readonly wrongInputs?: readonly unknown[];
}
const base = '/api/v1/digital_transports';
const operations: readonly Operation[] = [
  {
    name: 'digitalTransports.list',
    operation: 'digitalTransports',
    method: 'GET',
    path: base,
    effect: 'not-sent',
    success: listed,
    call: (client, options) => client.digitalTransports.list({}, options),
    withInput: (client, input) => client.digitalTransports.list(input as never),
    wrongInputs: [
      { category: 'both' },
      { category: 'SHIPPING' },
      { category: 1 },
      { page: 0 },
      { page: 1.5 },
      { page: '1' },
      { status: 'pending' },
      null,
    ],
  },
  {
    name: 'digitalTransports.get',
    operation: 'digitalTransport',
    method: 'GET',
    path: base + '/transport-one',
    effect: 'not-sent',
    success: wrapped,
    call: (client, options) => client.digitalTransports.get('transport-one', options),
    withId: (client, id) => client.digitalTransports.get(id),
  },
  {
    name: 'digitalTransports.create',
    operation: 'digitalTransportCreate',
    method: 'POST',
    path: base,
    effect: 'unknown',
    body: createInput,
    success: wrapped,
    call: (client, options) => client.digitalTransports.create(createInput, options),
    withInput: (client, input) => client.digitalTransports.create(input as never),
    wrongInputs: [
      ...wrongLegs.map((wrong) =>
        wrong !== null && typeof wrong === 'object'
          ? { invoice_id: 'invoice-one', ...wrong }
          : wrong,
      ),
      leg,
      { ...createInput, invoice_id: '' },
      { ...createInput, invoice_id: 'a/b' },
      { ...createInput, invoice_id: 5 },
    ],
  },
  {
    name: 'digitalTransports.refresh',
    operation: 'digitalTransportRefresh',
    method: 'POST',
    path: base + '/transport-one/refresh',
    effect: 'unknown',
    success: wrapped,
    call: (client, options) => client.digitalTransports.refresh('transport-one', options),
    withId: (client, id) => client.digitalTransports.refresh(id),
  },
  {
    name: 'digitalTransports.reject',
    operation: 'digitalTransportReject',
    method: 'POST',
    path: base + '/transport-one/reject',
    effect: 'unknown',
    body: { reject_reason: 'Goods not received' },
    success: wrapped,
    call: (client, options) =>
      client.digitalTransports.reject(
        'transport-one',
        { reject_reason: 'Goods not received' },
        options,
      ),
    withId: (client, id) => client.digitalTransports.reject(id),
    withInput: (client, input) => client.digitalTransports.reject('transport-one', input as never),
    wrongInputs: [
      { reject_reason: 5 },
      { reject_reason: null },
      { reject_reason: 'x'.repeat(4097) },
      { reason: 'x' },
      null,
      'Goods not received',
    ],
  },
  {
    name: 'digitalTransports.confirmDelivery',
    operation: 'digitalTransportConfirmDelivery',
    method: 'POST',
    path: base + '/transport-one/confirm_delivery',
    effect: 'unknown',
    body: delivery,
    success: wrapped,
    call: (client, options) =>
      client.digitalTransports.confirmDelivery('transport-one', delivery as never, options),
    withId: (client, id) => client.digitalTransports.confirmDelivery(id, { outcome: 'FULL' }),
    withInput: (client, input) =>
      client.digitalTransports.confirmDelivery('transport-one', input as never),
    wrongInputs: [
      {},
      { outcome: 'full' },
      { outcome: 'Partial' },
      { outcome: 'DELIVERED' },
      { outcome: 1 },
      { outcome: 'FULL', delivered_packaging: {} },
      { outcome: 'FULL', delivered_packaging: [{ packaging_type: 0, quantity: 1 }] },
      { outcome: 'FULL', delivered_packaging: [{ packaging_type: 7, quantity: 1 }] },
      { outcome: 'FULL', delivered_packaging: [{ packaging_type: '1', quantity: 1 }] },
      { outcome: 'FULL', delivered_packaging: [{ packaging_type: 1 }] },
      { outcome: 'FULL', delivered_packaging: [{ quantity: 1 }] },
      { outcome: 'FULL', delivered_packaging: [{ packaging_type: 1, quantity: 1.5 }] },
      { outcome: 'FULL', delivered_packaging: [{ packaging_type: 1, quantity: -1 }] },
      { outcome: 'FULL', delivered_packaging: [{ packaging_type: 1, quantity: '3' }] },
      { outcome: 'FULL', delivered_packaging: [{ packaging_type: 1, quantity: 2 ** 53 }] },
      {
        outcome: 'FULL',
        delivered_packaging: [{ packaging_type: 6, quantity: 1, other_packaging_title: 5 }],
      },
      { outcome: 'FULL', delivered_packaging: [{ packaging_type: 1, quantity: 1, weight: 2 }] },
      { outcome: 'FULL', note: 'x' },
      null,
      'FULL',
    ],
  },
  {
    name: 'digitalTransports.confirmReturn',
    operation: 'digitalTransportConfirmReturn',
    method: 'POST',
    path: base + '/transport-one/confirm_return',
    effect: 'unknown',
    success: wrapped,
    call: (client, options) => client.digitalTransports.confirmReturn('transport-one', options),
    withId: (client, id) => client.digitalTransports.confirmReturn(id),
  },
  {
    name: 'digitalTransports.transfer',
    operation: 'digitalTransportTransfer',
    method: 'POST',
    path: base + '/transport-one/transfer',
    effect: 'unknown',
    body: leg,
    success: wrapped,
    call: (client, options) => client.digitalTransports.transfer('transport-one', leg, options),
    withId: (client, id) => client.digitalTransports.transfer(id, leg),
    withInput: (client, input) =>
      client.digitalTransports.transfer('transport-one', input as never),
    wrongInputs: [...wrongLegs, createInput],
  },
];
const writes = operations.filter((op) => op.effect === 'unknown');

describe.each(operations)('$name', (op) => {
  it('should send exactly one authenticated request with its literal method, path and body', async () => {
    const { client, calls } = answering(() => json(op.success));
    await op.call(client);
    const call = only(calls);
    expect(call.init.method).toBe(op.method);
    expect(call.url.href).toBe('https://staging.wrapp.ai' + op.path);
    expect(call.init.redirect).toBe('error');
    if (op.body === undefined) {
      expect(call.init.body).toBeUndefined();
      expect(headers(call.init)).toEqual({
        accept: 'application/json',
        authorization: 'Bearer ' + token,
      });
    } else {
      expect(JSON.parse(call.init.body as string)).toEqual(op.body);
      expect(headers(call.init)).toEqual({
        accept: 'application/json',
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      });
    }
  });
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json(op.success));
    for (const options of badOptions)
      expect(await failure(op.call(client, options))).toMatchObject({
        code: 'INVALID_INPUT',
        effect: 'not-sent',
      });
    expect(calls).toHaveLength(0);
  });
  it('should refuse every unsafe id and every malformed input before any request', async () => {
    const { client, calls } = answering(() => json(op.success));
    const attempts = [
      ...(op.withId === undefined ? [] : badIds.map((id) => op.withId?.(client, id as string))),
      ...(op.wrongInputs ?? []).map((input) => op.withInput?.(client, input)),
    ];
    for (const attempt of attempts)
      expect(await failure(attempt ?? Promise.resolve())).toMatchObject({
        code: 'INVALID_INPUT',
        operation: op.operation,
        effect: 'not-sent',
      });
    expect(calls).toHaveLength(0);
  });
  it.each(failures)(
    'should dispatch once and report its effect class after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(op.call(client));
      expect(error).toMatchObject({ code, operation: op.operation, effect: op.effect });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
      expect(calls).toHaveLength(2);
    },
  );
  it.each([
    ['an errors list beside the record', { ...wrapped, errors: [{ message: 'Synthetic' }] }],
    ['an error string beside the record', { ...wrapped, error: 'Synthetic' }],
    ['an errors list beside an id', { errors: [{ message: 'Synthetic' }], id: 'transport-one' }],
    ['a status beside the answer', { ...(op.success as object), status: 'pending' }],
    ['a bare record without its wrapper', record],
    ['an empty object', {}],
    ['null', null],
    ['text', 'transport-one'],
  ])('should treat %s as a protocol error', async (_label, body) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(op.call(client))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: op.operation,
      effect: op.effect,
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each([
    ['no id', { ...record, id: undefined }],
    ['an id that is not path-safe', { ...record, id: 'a/b' }],
    ['no category', { ...record, category: undefined }],
    ['no status', { ...record, status: undefined }],
    ['an empty status', { ...record, status: '' }],
    ['a numeric status', { ...record, status: 3 }],
    ['an impossible issue date', { ...record, invoice_issued_at: '2026-02-30T10:00:00+03:00' }],
    ['a status update that is not a timestamp', { ...record, last_status_update_at: 'today' }],
    ['a numeric invoice code', { ...record, invoice_code: 1024 }],
    ['an evidence tree nested 21 levels deep', { ...record, my_data_response: deep(21) }],
    ['an evidence string of 65537 code units', { ...record, my_data_response: 'x'.repeat(65_537) }],
  ])('should treat a record with %s as a protocol error', async (_label, broken) => {
    const body =
      op.operation === 'digitalTransports'
        ? { ...listed, digital_transports: [broken] }
        : { digital_transport: broken };
    const { client } = answering(() => json(body));
    expect(await failure(op.call(client))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: op.operation,
      effect: op.effect,
    });
  });
});
function deep(levels: number): unknown {
  let value: unknown = 0;
  for (let level = 0; level < levels; level += 1) value = [value];
  return value;
}

describe.each(writes)('$name result', (op) => {
  it('should return the observed transport deeply frozen, with opaque evidence', async () => {
    const { client } = answering(() => json({ ...wrapped, additive: true }));
    const outcome = (await op.call(client)) as { kind: string; transport: typeof observed };
    expect(outcome).toEqual({ kind: 'observed', transport: observed });
    expect(Object.isFrozen(outcome) && Object.isFrozen(outcome.transport)).toBe(true);
    expect(Object.isFrozen(outcome.transport.my_data_response)).toBe(true);
  });
  it.each([
    ['an errors list of messages', { errors: [{ message: 'Synthetic refusal' }] }, 'message'],
    [
      'an errors list of titles',
      { errors: [{ status: '401', title: 'Synthetic refusal' }] },
      'title',
    ],
    ['a single error string', { error: 'Synthetic refusal' }, 'message'],
  ])(
    'should return %s as a rejected result with diagnostics only on request',
    async (_l, body, key) => {
      const { client, calls } = answering(() => json(body));
      const plain = await op.call(client);
      expect(plain).toEqual({ kind: 'rejected', errorCount: 1, rejectionSource: 'unknown' });
      expect(Object.isFrozen(plain)).toBe(true);
      expect(getProviderDiagnostics(plain)).toBeUndefined();
      const detailed = await op.call(client, { diagnostics: 'provider-issues' });
      expect(getProviderDiagnostics(detailed)?.issues).toEqual([{ [key]: 'Synthetic refusal' }]);
      // A refusal is the provider's decision about state or role: nothing is tried instead.
      expect(dispatched(calls).map((call) => call.url.pathname)).toEqual([op.path, op.path]);
    },
  );
  it('should refuse an answer about another transport than the one addressed', async () => {
    const other = { digital_transport: { ...record, id: 'transport-two' } };
    const { client } = answering(() => json(other));
    const run = op.call(client);
    // A new transport has no id to compare with; every other write addresses one.
    if (op.operation === 'digitalTransportCreate')
      expect(await run).toMatchObject({ kind: 'observed', transport: { id: 'transport-two' } });
    else expect(await failure(run)).toMatchObject({ code: 'PROTOCOL_ERROR', effect: 'unknown' });
  });
});

describe('digital transport records', () => {
  it.each(['pending', 'delivered', 'rejected', 'COMPLETED', 'IN_TRANSIT', 'SomethingNew'])(
    'should return the status "%s" verbatim, without folding it into a lifecycle',
    async (status) => {
      const { client } = answering(() => json({ digital_transport: { ...record, status } }));
      const transport = await client.digitalTransports.get('transport-one');
      expect(transport.status).toBe(status);
      expect(Object.keys(transport).sort()).toEqual(Object.keys(record).sort());
    },
  );
  it('should keep an absent evidence field absent and an explicit null as a null node', async () => {
    const absent = await answering(() =>
      json({ digital_transport: record }),
    ).client.digitalTransports.get('transport-one');
    expect(absent).toEqual(record);
    expect(absent).not.toHaveProperty('my_data_response');
    const explicit = await answering(() =>
      json({ digital_transport: { ...record, my_data_response: null } }),
    ).client.digitalTransports.get('transport-one');
    expect(explicit.my_data_response).toEqual({ kind: 'null' });
  });
  it('should keep null and absent record fields apart', async () => {
    const sparse = { id: 'transport-one', category: 'receiving', status: 'pending' };
    const { client } = answering(() =>
      json({ digital_transport: { ...sparse, invoice_id: null, invoice_code: null } }),
    );
    const transport = await client.digitalTransports.get('transport-one');
    expect(transport).toEqual({ ...sparse, invoice_id: null, invoice_code: null });
    expect(transport).not.toHaveProperty('invoice_issued_at');
    expect(transport).not.toHaveProperty('last_status_update_at');
  });
  it('should keep exact numeric evidence that a double cannot hold', async () => {
    const { client } = answering(() =>
      raw(
        '{"digital_transport":{"id":"transport-one","category":"shipping","status":"pending",' +
          '"my_data_response":{"mark":400000000000000000001,"rate":0.10,"n":-0,"e":1e-30}}}',
      ),
    );
    const transport = await client.digitalTransports.get('transport-one');
    expect(transport.my_data_response).toEqual({
      kind: 'object',
      entries: [
        { key: 'mark', value: { kind: 'number', text: '400000000000000000001' } },
        { key: 'rate', value: { kind: 'number', text: '0.10' } },
        { key: 'n', value: { kind: 'number', text: '-0' } },
        { key: 'e', value: { kind: 'number', text: '1e-30' } },
      ],
    });
  });
  it('should never read the evidence as an outcome: an error-shaped tree stays evidence', async () => {
    const tree = { errors: [{ title: 'Synthetic' }], status: 'failed', error: 'x', id: 'other' };
    const { client } = answering(() =>
      json({ digital_transport: { ...record, my_data_response: tree } }),
    );
    const outcome = await client.digitalTransports.refresh('transport-one');
    expect(outcome).toMatchObject({ kind: 'observed', transport: { status: 'pending' } });
  });
  it('should refuse a body whose evidence carries a __proto__ key', async () => {
    for (const body of [
      '{"digital_transport":{"id":"transport-one","category":"shipping","status":"pending","my_data_response":{"__proto__":5}}}',
      '{"digital_transport":{"id":"transport-one","category":"shipping","status":"pending","my_data_response":{"a":{"__proto__":{"b":1}}}}}',
    ])
      expect(
        await failure(answering(() => raw(body)).client.digitalTransports.get('transport-one')),
      ).toMatchObject({ code: 'PROTOCOL_ERROR', effect: 'not-sent' });
  });
  it('should refuse evidence nested deeply enough to exhaust a recursive parser, as a protocol error', async () => {
    const body =
      '{"digital_transport":{"id":"transport-one","category":"shipping","status":"pending",' +
      '"my_data_response":' +
      '['.repeat(400_000) +
      ']'.repeat(400_000) +
      '}}';
    const { client, calls } = answering(() => raw(body));
    expect(await failure(client.digitalTransports.refresh('transport-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
  it('should report a rejection of a read as PROVIDER_REJECTED without provider wording', async () => {
    for (const [read, body] of [
      [
        (c: WrappClient) => c.digitalTransports.get('transport-one'),
        { error: 'Synthetic refusal' },
      ],
      [
        (c: WrappClient) => c.digitalTransports.list(),
        { errors: [{ title: 'Synthetic refusal' }] },
      ],
    ] as const) {
      const error = await failure(read(answering(() => json(body)).client));
      expect(error).toMatchObject({ code: 'PROVIDER_REJECTED', effect: 'not-sent' });
      expect(JSON.stringify(error) + error.message).not.toContain('Synthetic refusal');
    }
  });
  it('should refuse a read answer about another transport than the one addressed', async () => {
    const { client } = answering(() =>
      json({ digital_transport: { ...record, id: 'transport-two' } }),
    );
    expect(await failure(client.digitalTransports.get('transport-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
    });
  });
  it('should percent-encode a transport id once in every path that carries one', async () => {
    const echoed = { digital_transport: { ...record, id: 'a+b&c=d' } };
    const encoded = base + '/a%2Bb%26c%3Dd';
    for (const [run, path] of [
      [(c: WrappClient) => c.digitalTransports.get('a+b&c=d'), encoded],
      [(c: WrappClient) => c.digitalTransports.refresh('a+b&c=d'), encoded + '/refresh'],
      [(c: WrappClient) => c.digitalTransports.reject('a+b&c=d'), encoded + '/reject'],
      [
        (c: WrappClient) => c.digitalTransports.confirmDelivery('a+b&c=d', { outcome: 'NONE' }),
        encoded + '/confirm_delivery',
      ],
      [
        (c: WrappClient) => c.digitalTransports.confirmReturn('a+b&c=d'),
        encoded + '/confirm_return',
      ],
      [(c: WrappClient) => c.digitalTransports.transfer('a+b&c=d', leg), encoded + '/transfer'],
    ] as const) {
      const { client, calls } = answering(() => json(echoed));
      await run(client);
      expect(only(calls).url.pathname).toBe(path);
    }
  });
  it('should expose the eight transport operations and nothing else', () => {
    const { client } = provider(() => login(token));
    expect(Object.keys(client.digitalTransports).sort()).toEqual(
      [
        'confirmDelivery',
        'confirmReturn',
        'create',
        'get',
        'list',
        'refresh',
        'reject',
        'transfer',
      ].sort(),
    );
    expect(Object.isFrozen(client.digitalTransports)).toBe(true);
  });
});

describe('digitalTransports.list', () => {
  it.each([
    [{}, ''],
    [{ category: 'shipping' }, '?category=shipping'],
    [{ category: 'receiving' }, '?category=receiving'],
    [{ page: 2 }, '?page=2'],
    [{ category: 'receiving', page: 3 }, '?category=receiving&page=3'],
  ] as const)('should send %j as the query %j', async (input, query) => {
    const { client, calls } = answering(() => json(listed));
    await client.digitalTransports.list(input);
    expect(only(calls).url.search).toBe(query);
  });
  it('should return its own page shape, deeply frozen, with no total count invented', async () => {
    const { client } = answering(() => json({ ...listed, additive: 1 }));
    const page = await client.digitalTransports.list();
    expect(page).toEqual({ digital_transports: [observed], total_pages: 3, current_page: 1 });
    expect(page).not.toHaveProperty('total_count');
    expect(Object.isFrozen(page) && Object.isFrozen(page.digital_transports[0])).toBe(true);
  });
  it('should return an empty page and refuse more than the documented ten records', async () => {
    const empty = { digital_transports: [], total_pages: 0, current_page: 1 };
    expect(await answering(() => json(empty)).client.digitalTransports.list()).toEqual(empty);
    const eleven = { ...listed, digital_transports: Array.from({ length: 11 }, () => record) };
    expect(
      await failure(answering(() => json(eleven)).client.digitalTransports.list()),
    ).toMatchObject({ code: 'PROTOCOL_ERROR', effect: 'not-sent' });
  });
  it.each([
    ['records that are not a list', { ...listed, digital_transports: {} }],
    ['no page counters', { digital_transports: [] }],
    ['a fractional page counter', { ...listed, current_page: 1.5 }],
    ['a bare list', [record]],
  ])('should treat %s as a protocol error of a read', async (_label, body) => {
    const { client } = answering(() => json(body));
    expect(await failure(client.digitalTransports.list())).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'not-sent',
    });
  });
});

describe('digital transport inputs', () => {
  it.each([1, 2, 3, 4, 5, 6, 7])(
    'should send transport_type %d as an integer on create and on transfer',
    async (transport_type) => {
      const { client, calls } = answering(() => json(wrapped));
      await client.digitalTransports.create({ ...createInput, transport_type });
      await client.digitalTransports.transfer('transport-one', { ...leg, transport_type });
      expect(
        dispatched(calls).map((call) =>
          (call.init.body as string).includes('"transport_type":' + String(transport_type)),
        ),
      ).toEqual([true, true]);
    },
  );
  it.each(['FULL', 'PARTIAL', 'NONE'] as const)(
    'should send the outcome %s alone when no packaging is given',
    async (outcome) => {
      const { client, calls } = answering(() => json(wrapped));
      await client.digitalTransports.confirmDelivery('transport-one', { outcome });
      expect(only(calls).init.body).toBe('{"outcome":"' + outcome + '"}');
    },
  );
  it.each([1, 2, 3, 4, 5, 6])(
    'should send packaging_type %d with an integer quantity, zero included',
    async (packaging_type) => {
      const { client, calls } = answering(() => json(wrapped));
      const delivered_packaging = [{ packaging_type, quantity: 0 }];
      await client.digitalTransports.confirmDelivery('transport-one', {
        outcome: 'PARTIAL',
        delivered_packaging,
      });
      expect(JSON.parse(only(calls).init.body as string)).toEqual({
        outcome: 'PARTIAL',
        delivered_packaging,
      });
    },
  );
  it.each([
    ['type 6 with a title', { packaging_type: 6, quantity: 2, other_packaging_title: 'Big bag' }],
    ['type 6 without a title', { packaging_type: 6, quantity: 2 }],
    [
      'another type with a title',
      { packaging_type: 1, quantity: 2, other_packaging_title: 'Euro' },
    ],
    ['an empty title', { packaging_type: 6, quantity: 2, other_packaging_title: '' }],
  ])('should send %s exactly as given: the title is optional for every type', async (_l, row) => {
    const { client, calls } = answering(() => json(wrapped));
    await client.digitalTransports.confirmDelivery('transport-one', {
      outcome: 'PARTIAL',
      delivered_packaging: [row],
    });
    expect(JSON.parse(only(calls).init.body as string)).toEqual({
      outcome: 'PARTIAL',
      delivered_packaging: [row],
    });
  });
  it('should send an empty packaging list as given and an empty object when no reject reason is given', async () => {
    const { client, calls } = answering(() => json(wrapped));
    await client.digitalTransports.confirmDelivery('transport-one', {
      outcome: 'NONE',
      delivered_packaging: [],
    });
    await client.digitalTransports.reject('transport-one');
    await client.digitalTransports.reject('transport-one', {});
    expect(dispatched(calls).map((call) => call.init.body)).toEqual([
      '{"outcome":"NONE","delivered_packaging":[]}',
      '{}',
      '{}',
    ]);
  });
  it('should refuse a created transport that names another invoice than the one requested', async () => {
    const other = { digital_transport: { ...record, invoice_id: 'invoice-two' } };
    expect(
      await failure(answering(() => json(other)).client.digitalTransports.create(createInput)),
    ).toMatchObject({ code: 'PROTOCOL_ERROR', effect: 'unknown' });
    // A record without an invoice id cannot contradict the request.
    const silent = { digital_transport: { ...record, invoice_id: null } };
    expect(
      await answering(() => json(silent)).client.digitalTransports.create(createInput),
    ).toMatchObject({ kind: 'observed' });
  });
});

describe('provider-owned eligibility', () => {
  it.each([
    [
      'create for an invoice that is not a delivery note',
      (c: WrappClient) => c.digitalTransports.create(createInput),
      base,
    ],
    [
      'confirmReturn outside its issuer and state conditions',
      (c: WrappClient) => c.digitalTransports.confirmReturn('transport-one'),
      base + '/transport-one/confirm_return',
    ],
    [
      'transfer of a transport that is not in transit',
      (c: WrappClient) => c.digitalTransports.transfer('transport-one', leg),
      base + '/transport-one/transfer',
    ],
    [
      'confirmDelivery of a reverse delivery note the caller issued',
      (c: WrappClient) => c.digitalTransports.confirmDelivery('transport-one', { outcome: 'FULL' }),
      base + '/transport-one/confirm_delivery',
    ],
  ])(
    'should leave %s to the provider: one call, no preflight, no substitute',
    async (_l, run, path) => {
      const { client, calls } = answering(() =>
        json({ errors: [{ message: 'Synthetic refusal' }] }),
      );
      expect(await run(client)).toEqual({
        kind: 'rejected',
        errorCount: 1,
        rejectionSource: 'unknown',
      });
      expect(calls.map((call) => call.url.pathname)).toEqual(['/api/v1/login', path]);
    },
  );
  it('should return the state the provider reports after a transfer as evidence, not as a verdict', async () => {
    const { client } = answering(() =>
      json({ digital_transport: { ...record, status: 'IN_TRANSIT' } }),
    );
    const outcome = await client.digitalTransports.transfer('transport-one', leg);
    expect(outcome).toEqual({ kind: 'observed', transport: { ...record, status: 'IN_TRANSIT' } });
  });
});
