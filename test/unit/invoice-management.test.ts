import { describe, expect, it } from 'vitest';
import { getProviderDiagnostics, WrappError } from '../../src/index.js';
import type { RequestOptions, WrappClient } from '../../src/index.js';
import { json, login, provider } from '../fixtures/provider.js';

// Synthetic bodies in the documented shapes of the Wrapp reference v1.18.0. Methods, paths and
// request bodies are written literally and never read from the SDK's operation registry.
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
const receipt = (overrides: Record<string, unknown> = {}) => ({
  id: 'invoice-one',
  my_data_mark: '400000000000001',
  my_data_uid: 'uid-one',
  my_data_qr_url: 'https://example.invalid/qr',
  series: 'S',
  num: 7,
  cancelled_by_mark: '400000000000002',
  wrapp_invoice_url: 'https://example.invalid/el',
  wrapp_invoice_url_en: 'https://example.invalid/en',
  ...overrides,
});
const rejectedResult = { kind: 'rejected', errorCount: 1, rejectionSource: 'unknown' };
interface Operation {
  readonly name: string;
  readonly operation: string;
  readonly method: string;
  readonly path: string;
  readonly body?: string;
  readonly call: (client: WrappClient, id: string, options?: RequestOptions) => Promise<unknown>;
  readonly success: unknown;
  readonly outcome: unknown;
  /** What a provider rejection becomes. */
  readonly rejected: unknown;
  /** 2xx bodies that are neither the documented success nor a valid rejection. */
  readonly malformed: readonly (readonly [string, unknown])[];
}
const operations: readonly Operation[] = [
  {
    name: 'invoices.cancelDeliveryNote',
    operation: 'cancelDeliveryNote',
    method: 'DELETE',
    path: '/api/v1/invoices/invoice-one/cancel',
    call: (client, id, options) => client.invoices.cancelDeliveryNote(id, options),
    success: { ...receipt(), future_field: true },
    outcome: {
      kind: 'observed',
      cancellation: {
        id: 'invoice-one',
        my_data_mark: '400000000000001',
        my_data_uid: 'uid-one',
        my_data_qr_url: 'https://example.invalid/qr',
        series: 'S',
        num: '7',
        cancelled_by_mark: '400000000000002',
        wrapp_invoice_url: 'https://example.invalid/el',
        wrapp_invoice_url_en: 'https://example.invalid/en',
      },
    },
    rejected: rejectedResult,
    malformed: [
      ['a receipt for another invoice', receipt({ id: 'invoice-two' })],
      ['a receipt whose id differs only in case', receipt({ id: 'INVOICE-ONE' })],
      ['a receipt without a number', receipt({ num: undefined })],
      [
        'a receipt with an insecure link',
        receipt({ wrapp_invoice_url: 'http://example.invalid/el' }),
      ],
      ['a receipt with a malformed cancellation mark', receipt({ cancelled_by_mark: 42 })],
      ['a receipt beside a status', { ...receipt(), status: 'cancelled' }],
      ['a status alone', { status: 'Invoice cancelled' }],
      ['an empty object', {}],
      ['a JSON null', null],
    ],
  },
  {
    name: 'invoices.markAsPaid',
    operation: 'markAsPaid',
    method: 'GET',
    path: '/api/v1/invoices/invoice-one/mark_as_paid',
    call: (client, id, options) => client.invoices.markAsPaid(id, options),
    success: { status: 'Invoice marked as paid', future_field: true },
    outcome: { kind: 'acknowledged' },
    rejected: rejectedResult,
    malformed: [
      ['an empty status', { status: '' }],
      ['a status of another type', { status: true }],
      [
        'a status beside a download link',
        { status: 'x', download_url: 'https://example.invalid/x' },
      ],
      ['an empty object', {}],
      ['a JSON null', null],
      ['a bare string', 'Invoice marked as paid'],
    ],
  },
  {
    name: 'invoices.drafts.delete',
    operation: 'deleteDraft',
    method: 'DELETE',
    path: '/api/v1/invoices/invoice-one/delete_draft',
    call: (client, id, options) => client.invoices.drafts.delete(id, options),
    success: { status: 'Draft invoice deleted' },
    outcome: { kind: 'acknowledged' },
    rejected: rejectedResult,
    malformed: [
      ['an empty status', { status: '' }],
      ['a status of another type', { status: 1 }],
      ['an empty object', {}],
      ['a JSON null', null],
    ],
  },
  {
    name: 'invoices.setExternalId',
    operation: 'setExternalId',
    method: 'PUT',
    path: '/api/v1/invoices/invoice-one/set_external_id',
    body: '{"external_id":"reference-one"}',
    call: (client, id, options) =>
      client.invoices.setExternalId(id, { external_id: 'reference-one' }, options),
    success: { status: 'external_id updated', external_id: 'reference-one', future_field: true },
    outcome: {
      kind: 'acknowledged',
      invoiceId: 'invoice-one',
      externalId: 'reference-one',
      identity: 'exact',
    },
    rejected: { ...rejectedResult, referenceState: 'unknown' },
    malformed: [
      ['an echo of another reference', { status: 'x', external_id: 'reference-two' }],
      ['a null echo', { status: 'x', external_id: null }],
      ['an empty echo', { status: 'x', external_id: '' }],
      ['no echo at all', { status: 'external_id updated' }],
      ['an echo without a status', { external_id: 'reference-one' }],
      [
        'an id of another invoice',
        { status: 'x', external_id: 'reference-one', id: 'invoice-two' },
      ],
      [
        'an id differing only in case',
        { status: 'x', external_id: 'reference-one', id: 'INVOICE-ONE' },
      ],
      ['an empty object', {}],
      ['a JSON null', null],
    ],
  },
];
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

describe.each(operations)('$name', (op) => {
  const dispatched = (calls: readonly { url: URL }[]) =>
    calls.filter((sent) => sent.url.pathname === op.path);
  it('should send exactly one authenticated request with its literal method, path and body', async () => {
    const { client, calls } = answering(() => json(op.success));
    await op.call(client, 'invoice-one');
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
      ...(op.body === undefined ? {} : { 'content-type': 'application/json' }),
    });
  });
  it('should percent-encode the invoice id once', async () => {
    const { client, calls } = answering(() => json(op.success));
    // Whatever the provider answers for this id, only the dispatched path matters here.
    await op.call(client, 'Δοκιμή.1').catch(() => undefined);
    expect(calls[1]?.url.pathname).toBe(
      op.path.replace('invoice-one', '%CE%94%CE%BF%CE%BA%CE%B9%CE%BC%CE%AE.1'),
    );
    expect(calls[1]?.url.search).toBe('');
  });
  it.each(['', '../x', 'a/b', 'a b', 'a?b', 'a#b', 'a%2Fb', '..', 'x'.repeat(257), 42, null])(
    'should refuse the invoice id %j before any request',
    async (id) => {
      const { client, calls } = answering(() => json(op.success));
      expect(await failure(op.call(client, id as string))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: op.operation,
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json(op.success));
    for (const options of [
      { timeoutMs: 0 },
      { timeoutMs: 120_001 },
      { signal: {} },
      { diagnostics: 'all' },
      { unknown: true },
    ] as unknown as RequestOptions[])
      expect(await failure(op.call(client, 'invoice-one', options))).toMatchObject({
        code: 'INVALID_INPUT',
        effect: 'not-sent',
      });
    expect(calls).toHaveLength(0);
  });
  it('should return its own frozen outcome for the documented success body', async () => {
    const { client, calls } = answering(() => json(op.success));
    const outcome = await op.call(client, 'invoice-one');
    expect(outcome).toEqual(op.outcome);
    expect(Object.isFrozen(outcome)).toBe(true);
    for (const nested of Object.values(outcome as object))
      if (nested !== null && typeof nested === 'object') expect(Object.isFrozen(nested)).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain('future_field');
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each([
    { label: 'the documented errors envelope', body: { errors: [{ title: 'Invoice not found' }] } },
    { label: 'a single error string', body: { error: 'Synthetic refusal' } },
  ])('should return $label as a rejected result that names nothing', async ({ body }) => {
    const { client, calls } = answering(() => json(body));
    const outcome = await op.call(client, 'invoice-one', { diagnostics: 'provider-issues' });
    expect(outcome).toEqual(op.rejected);
    expect(JSON.stringify(outcome)).not.toMatch(/not found|Synthetic/);
    expect(getProviderDiagnostics(outcome)?.issues).toHaveLength(1);
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each(op.malformed)(
    'should treat %s as a protocol error with unknown effect',
    async (_label, body) => {
      const { client, calls } = answering(() => json(body));
      expect(await failure(op.call(client, 'invoice-one'))).toMatchObject({
        code: 'PROTOCOL_ERROR',
        operation: op.operation,
        effect: 'unknown',
      });
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
  it.each([
    { errors: [{ title: 'x' }], id: 'invoice-one' },
    { errors: [{ title: 'x' }], invoice_id: 'invoice-one' },
    { errors: [{ title: 'x' }], download_url: 'https://example.invalid/x' },
    { errors: [], status: 'x' },
    { errors: [{ title: 'x' }], status: 'surprise' },
    // A success status beside an error envelope is not a recognized rejection status.
    { errors: [{ title: 'x' }], status: 'Invoice marked as paid' },
    { error: 'x', status: 'Draft invoice deleted' },
    { error: 42 },
  ])('should treat the contradictory envelope %j as a protocol error', async (body) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(op.call(client, 'invoice-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: op.operation,
      effect: 'unknown',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(op.call(client, 'invoice-one'));
      expect(error).toMatchObject({ code, operation: op.operation, effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
      expect(calls).toHaveLength(2);
    },
  );
});

describe('invoices.cancelDeliveryNote evidence', () => {
  it('should keep a receipt without a cancellation mark as an observation, not a cancellation', async () => {
    const { client } = answering(() =>
      json(receipt({ cancelled_by_mark: null, my_data_mark: null })),
    );
    const outcome = await client.invoices.cancelDeliveryNote('invoice-one');
    expect(outcome).toMatchObject({
      kind: 'observed',
      cancellation: { cancelled_by_mark: null, my_data_mark: null },
    });
  });
  it('should not carry fields the cancellation response does not document', async () => {
    const { client } = answering(() =>
      json(
        receipt({ issued_at: '21-09-2026', external_id: 'reference-one', transmission_failure: 2 }),
      ),
    );
    const outcome = await client.invoices.cancelDeliveryNote('invoice-one');
    if (outcome.kind !== 'observed') throw new Error('fixture');
    expect(Object.keys(outcome.cancellation).sort()).toEqual(
      [
        'cancelled_by_mark',
        'id',
        'my_data_mark',
        'my_data_qr_url',
        'my_data_uid',
        'num',
        'series',
        'wrapp_invoice_url',
        'wrapp_invoice_url_en',
      ].sort(),
    );
  });
  it('should keep a number beyond double precision as exact text', async () => {
    const text = JSON.stringify(receipt()).replace('"num":7', '"num":9007199254740993');
    const { client } = answering(
      () => new Response(text, { headers: { 'content-type': 'application/json' } }),
    );
    expect(await client.invoices.cancelDeliveryNote('invoice-one')).toMatchObject({
      cancellation: { num: '9007199254740993' },
    });
  });
});

describe('invoices.setExternalId reference handling', () => {
  const assign = (client: WrappClient, reference: unknown) =>
    client.invoices.setExternalId('invoice-one', { external_id: reference } as never);
  it.each(['', 'a b', 'a/b', 'a%b', 'a?b', 'a#b', '..', 'r'.repeat(257), 42, null, undefined])(
    'should refuse the reference %j before any request',
    async (reference) => {
      const { client, calls } = answering(() => json({ status: 'x', external_id: 'x' }));
      expect(await failure(assign(client, reference))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'setExternalId',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it.each([{}, { external_id: 'reference-one', extra: true }, null, 'reference-one'])(
    'should refuse the input %j before any request',
    async (input) => {
      const { client, calls } = answering(() => json({ status: 'x', external_id: 'x' }));
      expect(
        await failure(client.invoices.setExternalId('invoice-one', input as never)),
      ).toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
      expect(calls).toHaveLength(0);
    },
  );
  it('should send the reference byte-exact, including non-ASCII text', async () => {
    const { client, calls } = answering(() => json({ status: 'x', external_id: 'Δοκιμή-1' }));
    expect(await assign(client, 'Δοκιμή-1')).toMatchObject({
      kind: 'acknowledged',
      externalId: 'Δοκιμή-1',
      identity: 'exact',
    });
    expect(calls[1]?.init.body).toBe('{"external_id":"Δοκιμή-1"}');
  });
  it('should surface an ASCII case variant of the echo instead of treating it as equal', async () => {
    const { client } = answering(() => json({ status: 'x', external_id: 'REFERENCE-ONE' }));
    expect(await assign(client, 'reference-one')).toEqual({
      kind: 'acknowledged',
      invoiceId: 'invoice-one',
      externalId: 'REFERENCE-ONE',
      identity: 'ascii-case-variant',
    });
  });
  it('should accept a matching invoice id when the provider returns one', async () => {
    const { client } = answering(() =>
      json({ status: 'x', external_id: 'reference-one', id: 'invoice-one' }),
    );
    expect(await assign(client, 'reference-one')).toMatchObject({
      kind: 'acknowledged',
      invoiceId: 'invoice-one',
    });
  });
  it.each([
    'This invoice already has an external_id',
    'external_id is already used by another invoice',
    'Invoice not found',
    'completely different wording',
  ])('should leave the reference state unknown whatever the rejection says: %s', async (title) => {
    const { client, calls } = answering(() => json({ errors: [{ title }] }));
    expect(await assign(client, 'reference-one')).toEqual({
      kind: 'rejected',
      errorCount: 1,
      rejectionSource: 'unknown',
      referenceState: 'unknown',
    });
    // Nothing is retried, and no second reference is tried on the caller's behalf.
    expect(calls).toHaveLength(2);
  });
  it.each([
    { errors: [{ title: 'x' }], external_id: 'reference-one' },
    { error: 'x', external_id: 'reference-one' },
    { status: 'Invoice Errors', errors: [{ title: 'x' }], external_id: 'reference-one' },
  ])('should not read the mixed answer %j as a plain rejection', async (body) => {
    // An error envelope that also echoes the reference cannot say whether it was assigned.
    const { client, calls } = answering(() => json(body));
    expect(await failure(assign(client, 'reference-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'setExternalId',
      effect: 'unknown',
    });
    expect(calls).toHaveLength(2);
  });
  it('should refuse a body over the request-size bound before login', async () => {
    const { client, calls } = provider(() => login(token), { maxRequestBytes: 20 });
    expect(await failure(assign(client, 'reference-one'))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'setExternalId',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('invoice management resource shape', () => {
  it('should expose the five draft operations on a frozen drafts namespace', () => {
    const { client } = provider(() => login(token));
    expect(Object.keys(client.invoices.drafts).sort()).toEqual(
      ['create', 'delete', 'issue', 'iterate', 'list'].sort(),
    );
    expect(Object.isFrozen(client.invoices.drafts)).toBe(true);
    expect(Object.isFrozen(client.invoices)).toBe(true);
  });
});
