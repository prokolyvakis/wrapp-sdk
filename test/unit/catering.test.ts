import { describe, expect, it } from 'vitest';
import { getProviderDiagnostics, WrappError } from '../../src/index.js';
import type { RequestOptions, WrappClient } from '../../src/index.js';
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
    respond: () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    code: 'PROTOCOL_ERROR',
  },
];
const refusal = { errors: [{ status: '422', title: 'Synthetic refusal' }] };
const rejected = { kind: 'rejected', errorCount: 1, rejectionSource: 'unknown' };
const table = {
  id: 'table-one',
  status: 'open',
  name: 'table1',
  total: '140.0',
  invoices: ['invoice-one', 'invoice-two'],
  error_message: null,
};
const summary = { id: 'table-one', status: 'open', name: 'table1', total: '140.0' };

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
const receipt = {
  id: 'invoice-cancel',
  my_data_mark: '400000000000009',
  my_data_uid: 'SYNTHETICUID',
  my_data_qr_url: 'https://example.invalid/qr',
  series: 'a',
  num: 1,
  wrapp_invoice_url: 'https://example.invalid/el',
  wrapp_invoice_url_en: 'https://example.invalid/en',
};
const cancelInput = {
  billing_book_id: 'book-one',
  correlated_invoices: ['400000000000001', '400000000000002'],
};
const page = {
  invoices: [
    {
      id: 'note-one',
      my_data_mark: '400000000000001',
      issued_at: '2026-05-13T10:00:00.000Z',
      catering_table_id: 'table-one',
    },
  ],
  total_pages: 3,
  current_page: 1,
};
const operations: readonly Operation[] = [
  {
    name: 'cateringTables.list',
    operation: 'cateringTables',
    method: 'GET',
    path: '/api/v1/catering_tables',
    effect: 'not-sent',
    success: [summary],
    call: (client, options) => client.cateringTables.list(options),
  },
  {
    name: 'cateringTables.get',
    operation: 'cateringTable',
    method: 'GET',
    path: '/api/v1/catering_tables/table-one',
    effect: 'not-sent',
    success: table,
    call: (client, options) => client.cateringTables.get('table-one', options),
    withId: (client, id) => client.cateringTables.get(id),
  },
  {
    name: 'cateringTables.create',
    operation: 'cateringTableCreate',
    method: 'POST',
    path: '/api/v1/catering_tables',
    effect: 'unknown',
    body: { name: 'table1' },
    success: table,
    call: (client, options) => client.cateringTables.create({ name: 'table1' }, options),
    withInput: (client, input) => client.cateringTables.create(input as never),
    wrongInputs: [
      {},
      { name: undefined },
      { name: '' },
      { name: 5 },
      { name: null },
      { name: 'a', id: 'x' },
      null,
      'a',
      [],
    ],
  },
  {
    name: 'cateringTables.update',
    operation: 'cateringTableUpdate',
    method: 'PATCH',
    path: '/api/v1/catering_tables/table-one',
    effect: 'unknown',
    body: { name: 'table-A1' },
    success: table,
    call: (client, options) =>
      client.cateringTables.update('table-one', { name: 'table-A1' }, options),
    withId: (client, id) => client.cateringTables.update(id, { name: 'table-A1' }),
    withInput: (client, input) => client.cateringTables.update('table-one', input as never),
    wrongInputs: [{}, { name: '' }, { name: 5 }, { name: 'a', status: 'open' }, null, 'a'],
  },
  {
    name: 'cateringTables.open',
    operation: 'cateringTableOpen',
    method: 'POST',
    path: '/api/v1/catering_tables/open_table',
    effect: 'unknown',
    body: { id: 'table-one' },
    success: table,
    call: (client, options) => client.cateringTables.open({ id: 'table-one' }, options),
    withInput: (client, input) => client.cateringTables.open(input as never),
    wrongInputs: [
      {},
      { id: '' },
      { name: '' },
      { id: 'a/b' },
      { id: 5 },
      { name: 5 },
      { id: 'table-one', status: 'open' },
      null,
      'table-one',
    ],
  },
  {
    name: 'cateringTables.close',
    operation: 'cateringTableClose',
    method: 'POST',
    path: '/api/v1/catering_tables/table-one/close',
    effect: 'unknown',
    success: table,
    call: (client, options) => client.cateringTables.close('table-one', options),
    withId: (client, id) => client.cateringTables.close(id),
  },
  {
    name: 'cateringTables.delete',
    operation: 'cateringTableDelete',
    method: 'DELETE',
    path: '/api/v1/catering_tables/table-one',
    effect: 'unknown',
    success: { status: 'Catering table deleted' },
    call: (client, options) => client.cateringTables.delete('table-one', options),
    withId: (client, id) => client.cateringTables.delete(id),
  },
  {
    name: 'invoices.listOpenCateringOrderNotes',
    operation: 'openCateringOrderNotes',
    method: 'GET',
    path: '/api/v1/invoices/list_open_catering_order_notes',
    effect: 'not-sent',
    success: page,
    call: (client, options) => client.invoices.listOpenCateringOrderNotes({}, options),
    withInput: (client, input) => client.invoices.listOpenCateringOrderNotes(input as never),
    wrongInputs: [{ page: 0 }, { page: 1.5 }, { page: '1' }, { page: 1, status: 'open' }, null],
  },
  {
    name: 'invoices.cancelCateringOrderNotes',
    operation: 'cancelCateringOrderNotes',
    method: 'POST',
    path: '/api/v1/invoices/cancel_catering_order_note',
    effect: 'unknown',
    body: cancelInput,
    success: receipt,
    call: (client, options) => client.invoices.cancelCateringOrderNotes(cancelInput, options),
    withInput: (client, input) => client.invoices.cancelCateringOrderNotes(input as never),
    wrongInputs: [
      {},
      { billing_book_id: 'book-one' },
      { correlated_invoices: ['400000000000001'] },
      { ...cancelInput, correlated_invoices: [] },
      { ...cancelInput, correlated_invoices: [400000000000001] },
      { ...cancelInput, correlated_invoices: [''] },
      { ...cancelInput, correlated_invoices: '400000000000001' },
      { ...cancelInput, correlated_invoices: Array.from({ length: 101 }, () => '1') },
      { ...cancelInput, billing_book_id: 'a/b' },
      { ...cancelInput, catering_table_id: '' },
      { ...cancelInput, catering_table_id: 5 },
      { ...cancelInput, external_id: 'reference' },
      null,
    ],
  },
];

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
  it('should treat a rejection beside identifying evidence, a list where an object belongs, and null as protocol errors', async () => {
    for (const body of [{ ...refusal, id: 'table-one' }, null, 'text', 5]) {
      const { client, calls } = answering(() => json(body));
      expect(await failure(op.call(client))).toMatchObject({
        code: 'PROTOCOL_ERROR',
        operation: op.operation,
        effect: op.effect,
      });
      expect(dispatched(calls)).toHaveLength(1);
    }
  });
});

const tableWrites = operations.filter((op) =>
  [
    'cateringTableCreate',
    'cateringTableUpdate',
    'cateringTableOpen',
    'cateringTableClose',
  ].includes(op.operation),
);
describe.each(tableWrites)('$name result', (op) => {
  it('should return the table details deeply frozen, status and message included as data', async () => {
    const alert = { ...table, status: 'alert', error_message: 'Synthetic table message' };
    const { client } = answering(() => json({ ...alert, additive: true }));
    const outcome = (await op.call(client)) as { kind: string; table: typeof table };
    expect(outcome).toEqual({ kind: 'observed', table: alert });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.table) && Object.isFrozen(outcome.table.invoices)).toBe(true);
  });
  it('should return an errors list as a rejected result with diagnostics only on request', async () => {
    const { client, calls } = answering(() => json(refusal));
    const plain = await op.call(client);
    expect(plain).toEqual(rejected);
    expect(getProviderDiagnostics(plain)).toBeUndefined();
    const detailed = await op.call(client, { diagnostics: 'provider-issues' });
    expect(getProviderDiagnostics(detailed)?.issues).toEqual([{ title: 'Synthetic refusal' }]);
    expect(dispatched(calls)).toHaveLength(2);
  });
  it.each([
    ['no id', { ...table, id: undefined }],
    ['an id that is not path-safe', { ...table, id: 'a/b' }],
    ['no status', { ...table, status: undefined }],
    ['a non-text status', { ...table, status: 1 }],
    ['an empty status', { ...table, status: '' }],
    ['no name', { ...table, name: undefined }],
    ['no total', { ...table, total: undefined }],
    ['a total that is not a number', { ...table, total: 'many' }],
    ['invoices that are not a list', { ...table, invoices: 'invoice-one' }],
    ['an invoice entry that is not an id', { ...table, invoices: [{ id: 'invoice-one' }] }],
    ['a non-text message', { ...table, error_message: { text: 'x' } }],
    ['a list', [table]],
    ['an empty object', {}],
  ])('should treat a table with %s as a protocol error with unknown effect', async (_l, body) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(op.call(client))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: op.operation,
      effect: 'unknown',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
});

describe('catering table shapes', () => {
  it.each(['available', 'open', 'closed', 'alert', 'reserved-by-a-future-version'])(
    'should return the status "%s" verbatim and never read it as an error discriminator',
    async (status) => {
      const { client } = answering(() => json({ ...table, status }));
      expect(await client.cateringTables.get('table-one')).toEqual({ ...table, status });
    },
  );
  it('should return a list of summaries, without detail fields, deeply frozen', async () => {
    const { client } = answering(() =>
      json([summary, { ...table, id: 'table-two', status: 'available', total: 0 }]),
    );
    const tables = await client.cateringTables.list();
    expect(tables).toEqual([
      summary,
      { id: 'table-two', status: 'available', name: 'table1', total: '0' },
    ]);
    expect(Object.isFrozen(tables) && tables.every((entry) => Object.isFrozen(entry))).toBe(true);
  });
  it('should return an empty list and refuse a single table where the list belongs', async () => {
    expect(await answering(() => json([])).client.cateringTables.list()).toEqual([]);
    expect(await failure(answering(() => json(table)).client.cateringTables.list())).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'not-sent',
    });
  });
  it('should keep exact totals and tolerate omitted detail fields, absent apart from null', async () => {
    const { client } = answering(() =>
      json({ id: 'table-one', status: 'available', name: 7, total: '9007199254740993.10' }),
    );
    const details = await client.cateringTables.get('table-one');
    // A name that arrives as a JSON number is kept as its exact text.
    expect(details).toEqual({
      id: 'table-one',
      status: 'available',
      name: '7',
      total: '9007199254740993.10',
    });
    expect(details).not.toHaveProperty('invoices');
    expect(details).not.toHaveProperty('error_message');
  });
  it('should report a rejection of a read as PROVIDER_REJECTED without provider wording', async () => {
    for (const read of [
      (client: WrappClient) => client.cateringTables.list(),
      (client: WrappClient) => client.cateringTables.get('table-one'),
      (client: WrappClient) => client.invoices.listOpenCateringOrderNotes(),
    ]) {
      const error = await failure(read(answering(() => json(refusal)).client));
      expect(error).toMatchObject({ code: 'PROVIDER_REJECTED', effect: 'not-sent' });
      expect(JSON.stringify(error) + error.message).not.toContain('Synthetic refusal');
    }
  });
  it('should refuse a table answer for another table than the one addressed', async () => {
    const other = { ...table, id: 'table-two' };
    for (const run of [
      (client: WrappClient) => client.cateringTables.get('table-one'),
      (client: WrappClient) => client.cateringTables.update('table-one', { name: 'table-A1' }),
      (client: WrappClient) => client.cateringTables.close('table-one'),
      (client: WrappClient) => client.cateringTables.open({ id: 'table-one' }),
      (client: WrappClient) => client.cateringTables.open({ id: 'table-one', name: 'table1' }),
    ])
      expect(await failure(run(answering(() => json(other)).client))).toMatchObject({
        code: 'PROTOCOL_ERROR',
      });
    // Opened by name alone, or created, there is no requested id to compare with.
    const byName = await answering(() => json(other)).client.cateringTables.open({ name: 'x' });
    expect(byName).toMatchObject({ kind: 'observed', table: { id: 'table-two' } });
  });
  it('should percent-encode a table id once in every path that carries one', async () => {
    const echoed = { ...table, id: 'a+b&c=d' };
    const base = '/api/v1/catering_tables/a%2Bb%26c%3Dd';
    for (const [run, path, body] of [
      [(c: WrappClient) => c.cateringTables.get('a+b&c=d'), base, echoed],
      [(c: WrappClient) => c.cateringTables.update('a+b&c=d', { name: 'x' }), base, echoed],
      [(c: WrappClient) => c.cateringTables.close('a+b&c=d'), base + '/close', echoed],
      [(c: WrappClient) => c.cateringTables.delete('a+b&c=d'), base, { status: 'Deleted' }],
    ] as const) {
      const { client, calls } = answering(() => json(body));
      await run(client);
      expect(only(calls).url.pathname).toBe(path);
    }
  });
  it('should expose the eight table operations and nothing else', () => {
    const { client } = provider(() => login(token));
    expect(Object.keys(client.cateringTables).sort()).toEqual(
      ['close', 'create', 'delete', 'get', 'list', 'open', 'transfer', 'update'].sort(),
    );
    expect(Object.isFrozen(client.cateringTables)).toBe(true);
  });
});

describe('cateringTables.create and open inputs', () => {
  it('should refuse a table without a name before any request, since the provider refuses one', async () => {
    const { client, calls } = answering(() => json(table));
    expect(await failure(client.cateringTables.create({} as never))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'cateringTableCreate',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it('should send the name alone and keep the name the provider returns, a number included', async () => {
    const { client, calls } = answering(() => json({ ...table, name: 7 }));
    const outcome = await client.cateringTables.create({ name: '7' });
    expect(only(calls).init.body).toBe('{"name":"7"}');
    expect(outcome).toMatchObject({ kind: 'observed', table: { name: '7' } });
  });
  it.each([
    ['the id alone', { id: 'table-one' }],
    ['the name alone', { name: 'table1' }],
    ['both, without choosing between them', { id: 'table-one', name: 'table1' }],
  ])('should open a table by %s and send exactly what was given', async (_label, input) => {
    const { client, calls } = answering(() => json(table));
    expect((await client.cateringTables.open(input)).kind).toBe('observed');
    expect(JSON.parse(only(calls).init.body as string)).toEqual(input);
  });
  it('should refuse to open a table with neither id nor name before any request', async () => {
    const { client, calls } = answering(() => json(table));
    expect(await failure(client.cateringTables.open({} as never))).toMatchObject({
      code: 'INVALID_INPUT',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('cateringTables.delete result', () => {
  it('should return a frozen acknowledgement without the provider wording', async () => {
    const { client } = answering(() => json({ status: 'Catering table deleted' }));
    const outcome = await client.cateringTables.delete('table-one');
    expect(outcome).toEqual({ kind: 'acknowledged' });
    expect(Object.isFrozen(outcome)).toBe(true);
  });
  it('should return an errors list as a rejected result', async () => {
    const { client } = answering(() => json(refusal));
    expect(await client.cateringTables.delete('table-one')).toEqual(rejected);
  });
  it.each([
    ['a table instead of an acknowledgement', table],
    ['an empty status', { status: '' }],
    ['an empty object', {}],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client } = answering(() => json(body));
    expect(await failure(client.cateringTables.delete('table-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
  });
});

describe('invoices.listOpenCateringOrderNotes result', () => {
  it('should send the page as a query parameter and nothing when it is omitted', async () => {
    const { client, calls } = answering(() => json(page));
    await client.invoices.listOpenCateringOrderNotes({ page: 2 });
    await client.invoices.listOpenCateringOrderNotes();
    expect(dispatched(calls).map((call) => call.url.search)).toEqual(['?page=2', '']);
  });
  it('should return its own page shape, deeply frozen, with no total count invented', async () => {
    const { client } = answering(() => json({ ...page, additive: 1 }));
    const result = await client.invoices.listOpenCateringOrderNotes({ page: 1 });
    expect(result).toEqual(page);
    expect(result).not.toHaveProperty('total_count');
    expect(Object.isFrozen(result) && Object.isFrozen(result.invoices[0])).toBe(true);
  });
  it('should keep a null mark or table id as null and an empty page as empty', async () => {
    const [note] = page.invoices;
    const sparse = { ...note, my_data_mark: null, catering_table_id: null };
    const { client } = answering(() =>
      json({ invoices: [sparse], total_pages: 1, current_page: 1 }),
    );
    expect((await client.invoices.listOpenCateringOrderNotes()).invoices).toEqual([sparse]);
    const empty = { invoices: [], total_pages: 0, current_page: 1 };
    expect(await answering(() => json(empty)).client.invoices.listOpenCateringOrderNotes()).toEqual(
      empty,
    );
  });
  it.each([
    '2026-05-13T10:00:00.000Z',
    '2026-05-13T10:00:00Z',
    '2026-05-13T10:00:00+03:00',
    '2026-05-13 10:00:00 +0300',
  ])('should return the issue timestamp %s verbatim', async (issued_at) => {
    const [note] = page.invoices;
    const { client } = answering(() => json({ ...page, invoices: [{ ...note, issued_at }] }));
    expect((await client.invoices.listOpenCateringOrderNotes()).invoices[0]?.issued_at).toBe(
      issued_at,
    );
  });
  it.each([
    ['a note without an id', { ...page, invoices: [{ ...page.invoices[0], id: undefined }] }],
    ['a note without a timestamp', { ...page, invoices: [{ id: 'note-one' }] }],
    [
      'an impossible date',
      { ...page, invoices: [{ ...page.invoices[0], issued_at: '2026-02-30T10:00:00Z' }] },
    ],
    [
      'a date without a time',
      { ...page, invoices: [{ ...page.invoices[0], issued_at: '2026-05-13' }] },
    ],
    ['invoices that are not a list', { ...page, invoices: {} }],
    [
      'more than one documented page of notes',
      { ...page, invoices: Array.from({ length: 21 }, () => page.invoices[0]) },
    ],
    ['no page counters', { invoices: [] }],
    ['a fractional page counter', { ...page, total_pages: 1.5 }],
    ['a status object', { status: 'pending' }],
    ['a bare list', page.invoices],
  ])('should treat %s as a protocol error of a read', async (_label, body) => {
    const { client } = answering(() => json(body));
    expect(await failure(client.invoices.listOpenCateringOrderNotes())).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'openCateringOrderNotes',
      effect: 'not-sent',
    });
  });
});

describe('invoices.cancelCateringOrderNotes result', () => {
  it('should send the table id only when it is given', async () => {
    const { client, calls } = answering(() => json(receipt));
    await client.invoices.cancelCateringOrderNotes({
      ...cancelInput,
      catering_table_id: 'table-one',
    });
    expect(JSON.parse(only(calls).init.body as string)).toEqual({
      ...cancelInput,
      catering_table_id: 'table-one',
    });
  });
  it('should return its own frozen receipt, with exact number text and no reference or issue date', async () => {
    const { client, calls } = answering(() =>
      json({ ...receipt, external_id: 'reference', issued_at: '13-05-2026', additive: true }),
    );
    const outcome = await client.invoices.cancelCateringOrderNotes(cancelInput);
    expect(outcome).toEqual({ kind: 'observed', receipt: { ...receipt, num: '1' } });
    expect(outcome.kind === 'observed' && Object.isFrozen(outcome.receipt)).toBe(true);
    // One fiscal dispatch and nothing after it: no table is closed, no invoice re-read.
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/api/v1/login',
      '/api/v1/invoices/cancel_catering_order_note',
    ]);
  });
  it('should keep null marks as null: a receipt without a mark is not a registered cancellation', async () => {
    const pendingLike = { ...receipt, my_data_mark: null, my_data_uid: null, my_data_qr_url: null };
    const { client } = answering(() => json(pendingLike));
    expect(await client.invoices.cancelCateringOrderNotes(cancelInput)).toEqual({
      kind: 'observed',
      receipt: { ...pendingLike, num: '1' },
    });
  });
  it('should return the documented refusals as a rejected result that names nothing', async () => {
    for (const title of ['correlated_invoices is required', 'Billing book not found']) {
      const { client, calls } = answering(() => json({ errors: [{ title }] }));
      const outcome = await client.invoices.cancelCateringOrderNotes(cancelInput);
      expect(outcome).toEqual(rejected);
      expect(dispatched(calls)).toHaveLength(1);
    }
  });
  it.each([
    ['a receipt without an id', { ...receipt, id: undefined }],
    ['a receipt without a series', { ...receipt, series: undefined }],
    ['a receipt without a number', { ...receipt, num: undefined }],
    [
      'a portal link that is not https',
      { ...receipt, wrapp_invoice_url: 'http://example.invalid' },
    ],
    [
      'a pending envelope, which this operation does not document',
      { status: 'pending', invoice_id: 'invoice-cancel' },
    ],
    ['a receipt beside a status', { ...receipt, status: 'pending' }],
    ['an empty object', {}],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(client.invoices.cancelCateringOrderNotes(cancelInput))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'cancelCateringOrderNotes',
      effect: 'unknown',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
});
