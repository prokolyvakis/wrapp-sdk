import { describe, expect, it } from 'vitest';
import { getProviderDiagnostics, WrappError } from '../../src/index.js';
import type { RequestOptions, WrappClient } from '../../src/index.js';
import { json, login, provider } from '../fixtures/provider.js';

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
const rejected = { kind: 'rejected', errorCount: 1, rejectionSource: 'unknown' };
interface Operation {
  readonly name: string;
  readonly operation: string;
  readonly path: string;
  readonly body: string;
  readonly call: (client: WrappClient, id: string, options?: RequestOptions) => Promise<unknown>;
  readonly withInput: (client: WrappClient, input: unknown) => Promise<unknown>;
  readonly wrongInputs: readonly unknown[];
}
const operations: readonly Operation[] = [
  {
    name: 'digitalClienteles.correlateByMark',
    operation: 'clienteleCorrelateByMark',
    path: '/api/v1/digital_clienteles/clientele-one/correlate_by_mark',
    body: '{"correlate_mark":"400000000000001"}',
    call: (client, id, options) =>
      client.digitalClienteles.correlateByMark(id, { correlate_mark: '400000000000001' }, options),
    withInput: (client, input) =>
      client.digitalClienteles.correlateByMark('clientele-one', input as never),
    wrongInputs: [
      {},
      { correlate_mark: '' },
      { correlate_mark: 400000000000001 },
      { correlate_mark: null },
      { correlate_mark: 'x'.repeat(4097) },
      { correlate_mark: '1', correlate_fim_number: '1' },
      { correlate_fim_number: '1', correlate_fim_aa: '1' },
      { correlate_mark: '1', unknown: true },
      null,
      '400000000000001',
    ],
  },
  {
    name: 'digitalClienteles.correlateByFim',
    operation: 'clienteleCorrelateByFim',
    path: '/api/v1/digital_clienteles/clientele-one/correlate_by_fim',
    body: '{"correlate_fim_number":"ABC0000001","correlate_fim_aa":"999"}',
    call: (client, id, options) =>
      client.digitalClienteles.correlateByFim(
        id,
        { correlate_fim_number: 'ABC0000001', correlate_fim_aa: '999' },
        options,
      ),
    withInput: (client, input) =>
      client.digitalClienteles.correlateByFim('clientele-one', input as never),
    wrongInputs: [
      {},
      { correlate_fim_number: 'ABC0000001' },
      { correlate_fim_aa: '999' },
      { correlate_fim_number: '', correlate_fim_aa: '999' },
      { correlate_fim_number: 'ABC0000001', correlate_fim_aa: '' },
      { correlate_fim_number: 'ABC0000001', correlate_fim_aa: 999 },
      { correlate_fim_number: 1, correlate_fim_aa: '999' },
      { correlate_fim_number: 'ABC0000001', correlate_fim_aa: '999', correlate_mark: '1' },
      { correlate_mark: '400000000000001' },
      null,
    ],
  },
];
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

describe.each(operations)('$name', (op) => {
  const dispatched = (calls: readonly { url: URL }[]) =>
    calls.filter((sent) => sent.url.pathname === op.path);
  it('should send exactly one authenticated POST with its literal path and body', async () => {
    const { client, calls } = answering(() => json({ notice: 'Synthetic notice' }));
    await op.call(client, 'clientele-one');
    // One request after login: no follow-up read, no second attempt.
    expect(calls).toHaveLength(2);
    const [, sent] = calls;
    if (!sent) throw new Error('fixture');
    expect(sent.url.href).toBe('https://staging.wrapp.ai' + op.path);
    expect(sent.init.method).toBe('POST');
    expect(sent.init.redirect).toBe('error');
    expect(sent.init.body).toBe(op.body);
    expect(headers(sent.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    });
  });
  it('should percent-encode the clientele id once', async () => {
    const { client, calls } = answering(() => json({ notice: 'Synthetic notice' }));
    await op.call(client, 'Δοκιμή.1');
    expect(calls[1]?.url.pathname).toBe(
      op.path.replace('clientele-one', '%CE%94%CE%BF%CE%BA%CE%B9%CE%BC%CE%AE.1'),
    );
  });
  it.each(['', '../x', 'a/b', 'a b', 'a?b', 'a#b', '..', 'x'.repeat(257), 42, null])(
    'should refuse the clientele id %j before any request',
    async (id) => {
      const { client, calls } = answering(() => json({ notice: 'x' }));
      expect(await failure(op.call(client, id as string))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: op.operation,
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it('should refuse a missing, mistyped, foreign or extra body field before any request', async () => {
    for (const wrong of op.wrongInputs) {
      const { client, calls } = answering(() => json({ notice: 'x' }));
      expect(await failure(op.withInput(client, wrong))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: op.operation,
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    }
  });
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json({ notice: 'x' }));
    for (const options of [
      { timeoutMs: 0 },
      { signal: {} },
      { diagnostics: 'all' },
      { unknown: true },
    ] as unknown as RequestOptions[])
      expect(await failure(op.call(client, 'clientele-one', options))).toMatchObject({
        code: 'INVALID_INPUT',
        effect: 'not-sent',
      });
    expect(calls).toHaveLength(0);
  });
  it('should return a frozen acknowledgement for the documented notice, without its wording', async () => {
    const { client, calls } = answering(() =>
      json({ notice: 'Synthetic correlation notice', future_field: true }),
    );
    const outcome = await op.call(client, 'clientele-one');
    expect(outcome).toEqual({ kind: 'acknowledged' });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each([
    { label: 'the documented errors string', body: { errors: 'Synthetic refusal text' } },
    { label: 'an errors list', body: { errors: [{ title: 'Synthetic refusal text' }] } },
    { label: 'a single error string', body: { error: 'Synthetic refusal text' } },
  ])('should return $label as a rejected result that names nothing', async ({ body }) => {
    const { client, calls } = answering(() => json(body));
    const outcome = await op.call(client, 'clientele-one', { diagnostics: 'provider-issues' });
    expect(outcome).toEqual(rejected);
    expect(JSON.stringify(outcome)).not.toContain('Synthetic');
    const [issue] = getProviderDiagnostics(outcome)?.issues ?? [];
    expect(issue?.message ?? issue?.title).toBe('Synthetic refusal text');
    expect(dispatched(calls)).toHaveLength(1);
    expect(
      getProviderDiagnostics(await op.call(answering(() => json(body)).client, 'clientele-one')),
    ).toBeUndefined();
  });
  it.each([
    ['a notice beside an errors string', { notice: 'x', errors: 'y' }],
    ['a notice beside an errors list', { notice: 'x', errors: [{ title: 'y' }] }],
    ['a notice beside an error string', { notice: 'x', error: 'y' }],
    ['a notice beside a status', { notice: 'x', status: 'ok' }],
    ['an empty notice', { notice: '' }],
    ['a notice of another type', { notice: 1 }],
    ['an empty errors string', { errors: '' }],
    ['an overlong errors string', { errors: 'x'.repeat(4097) }],
    ['an errors object', { errors: { message: 'x' } }],
    ['an empty errors list', { errors: [] }],
    ['a status alone', { status: 'ok' }],
    ['an errors string beside an id', { errors: 'x', id: 'clientele-one' }],
    ['an errors string beside an invoice id', { errors: 'x', invoice_id: 'invoice-one' }],
    ['an errors string beside a link', { errors: 'x', download_url: 'https://example.invalid/x' }],
    ['an errors string beside an unknown status', { errors: 'x', status: 'bogus' }],
    ['a JSON array', [{ notice: 'x' }]],
    ['a JSON number', 42],
    ['an empty object', {}],
    ['a JSON null', null],
    ['a bare string', 'Synthetic notice'],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(op.call(client, 'clientele-one'))).toMatchObject({
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
      const error = await failure(op.call(client, 'clientele-one'));
      expect(error).toMatchObject({ code, operation: op.operation, effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
      expect(calls).toHaveLength(2);
    },
  );
});

describe('digital clientele resource shape', () => {
  it('should read a rejection family from a status beside the errors string, like any rejection', async () => {
    for (const [status, source] of [
      ['Invoice Errors', 'invoice-errors'],
      ['myDATA Errors', 'mydata-errors'],
    ] as const) {
      const { client } = answering(() => json({ errors: 'Synthetic refusal', status }));
      expect(
        await client.digitalClienteles.correlateByMark('clientele-one', { correlate_mark: '1' }),
      ).toEqual({ kind: 'rejected', errorCount: 1, rejectionSource: source });
    }
  });
  it('should expose the two correlation operations on a frozen resource', () => {
    const { client } = provider(() => login(token));
    expect(Object.keys(client.digitalClienteles)).toEqual(
      expect.arrayContaining(['correlateByFim', 'correlateByMark']),
    );
    expect(Object.isFrozen(client.digitalClienteles)).toBe(true);
  });
  it('should keep the two bodies distinct: neither accepts the other', async () => {
    const { client, calls } = answering(() => json({ notice: 'x' }));
    expect(
      await failure(
        client.digitalClienteles.correlateByMark('clientele-one', {
          correlate_fim_number: 'ABC0000001',
          correlate_fim_aa: '999',
        } as never),
      ),
    ).toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
    expect(
      await failure(
        client.digitalClienteles.correlateByFim('clientele-one', {
          correlate_mark: '400000000000001',
        } as never),
      ),
    ).toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
    expect(calls).toHaveLength(0);
  });
  it('should leave the repeated-correlation wording uninterpreted', async () => {
    // "already exists" is provider text. It is a rejection like any other, not a success.
    const { client, calls } = answering(() =>
      json({ errors: 'Correlation for mark 400000000000001 already exists' }),
    );
    expect(
      await client.digitalClienteles.correlateByMark('clientele-one', {
        correlate_mark: '400000000000001',
      }),
    ).toEqual(rejected);
    expect(calls).toHaveLength(2);
  });
});
