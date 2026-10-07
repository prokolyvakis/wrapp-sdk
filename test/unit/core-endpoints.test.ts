import { describe, expect, it } from 'vitest';
import { WrappClient, WrappError } from '../../src/index.js';
import type { RequestOptions } from '../../src/index.js';
import { credentials, json, login, provider, tenant } from '../fixtures/provider.js';

// Method, path and query are written out literally here. They are never read back from the
// SDK's own operation registry, so a wrong registry entry cannot make its own test pass.
type Call = (client: WrappClient, options?: RequestOptions) => Promise<unknown>;
interface Endpoint {
  readonly name: string;
  readonly path: string;
  readonly search: string;
  readonly call: Call;
  readonly success: unknown;
  readonly result: unknown;
  /** A success body with one known field malformed. */
  readonly malformed: unknown;
}
const vatDetails = {
  vat_no: 'synthetic-vat',
  name: 'Synthetic Company',
  city: 'Athens',
  address: 'Synthetic street',
  postal_code: '00000',
  street_number: '1',
};
const endpoints: readonly Endpoint[] = [
  {
    name: 'tenant.get',
    path: '/api/v1/tenant_details',
    search: '',
    call: (client, options) => client.tenant.get(options),
    success: {
      ...tenant({ next_payment_date: '2026-10-01', next_payment_amount: 12.4 }),
      extra: 1,
    },
    result: { ...tenant(), next_payment_date: '2026-10-01', next_payment_amount: '12.4' },
    malformed: tenant({ has_plan: 'yes' }),
  },
  {
    name: 'vat.search',
    path: '/api/v1/vat_search',
    search: '?vat=synthetic%2Bvat%2F+%26%3F&country_code=EL',
    call: (client, options) =>
      client.vat.search({ vat: 'synthetic+vat/ &?', country_code: 'EL' }, options),
    success: { ...vatDetails, extra: 1 },
    result: vatDetails,
    malformed: { ...vatDetails, vat_no: 42 },
  },
  {
    name: 'vat.exemptions',
    path: '/api/v1/vat_exemptions',
    search: '',
    call: (client, options) => client.vat.exemptions(options),
    success: [{ '1': 'Synthetic exemption', category: 'additive' }, { '31': 'Another' }],
    result: [{ '1': 'Synthetic exemption' }, { '31': 'Another' }],
    malformed: [{ '1': 42 }],
  },
  {
    name: 'branches.list',
    path: '/api/v1/branches',
    search: '',
    call: (client, options) => client.branches.list(options),
    success: [
      { id: 'branch-one', name: 'Main', code: 0, extra: 1 },
      { id: 'branch-two', name: 'Second', code: '001' },
    ],
    result: [
      { id: 'branch-one', name: 'Main', code: '0' },
      { id: 'branch-two', name: 'Second', code: '001' },
    ],
    malformed: [{ id: 'branch-one', name: '', code: 0 }],
  },
  {
    name: 'billingBooks.list',
    path: '/api/v1/billing_books',
    search: '',
    call: (client, options) => client.billingBooks.list(options),
    success: [
      {
        id: 'book-one',
        name: 'Service',
        series: 'S',
        invoice_type_code: '2.1',
        number: 4,
        extra: 1,
      },
    ],
    result: [
      { id: 'book-one', name: 'Service', series: 'S', invoice_type_code: '2.1', number: '4' },
    ],
    malformed: [
      { id: 'book-one', name: 'Service', series: 'S', invoice_type_code: '2.1', number: -1 },
    ],
  },
];
const token = 'synthetic.jwt.token';
function answering(respond: () => Response | Promise<Response>, timeoutMs?: number) {
  return provider(
    ({ url }) => (url.pathname.endsWith('/login') ? login(token) : respond()),
    timeoutMs === undefined ? {} : { timeoutMs },
  );
}
function headers(init: RequestInit): Record<string, string> {
  return Object.fromEntries(
    Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
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

describe.each(endpoints)('read endpoint $name', (endpoint) => {
  const resource = (calls: readonly { url: URL }[]) =>
    calls.filter((call) => call.url.pathname === endpoint.path);
  it('should send one bodiless authenticated GET to its literal path', async () => {
    const { client, calls } = answering(() => json(endpoint.success));
    await endpoint.call(client);
    expect(calls).toHaveLength(2);
    const [, call] = calls;
    if (!call) throw new Error('fixture');
    expect(call.url.origin).toBe('https://staging.wrapp.ai');
    expect(call.url.pathname).toBe(endpoint.path);
    expect(call.url.search).toBe(endpoint.search);
    expect(call.url.hash).toBe('');
    expect(call.init.method).toBe('GET');
    expect(call.init.body).toBeUndefined();
    expect(call.init.redirect).toBe('error');
    expect(headers(call.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    });
  });
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json(endpoint.success));
    for (const options of [
      { timeoutMs: 0 },
      { timeoutMs: 120_001 },
      { timeoutMs: 1.5 },
      { signal: {} },
      { diagnostics: 'all' },
      { unknown: true },
    ]) {
      const error = await failure(endpoint.call(client, options as unknown as RequestOptions));
      expect(error).toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
    }
    expect(calls).toHaveLength(0);
  });
  it('should return the validated, deeply frozen result without additive fields', async () => {
    const { client } = answering(() => json(endpoint.success));
    const result = await endpoint.call(client);
    expect(result).toEqual(endpoint.result);
    expect(Object.isFrozen(result)).toBe(true);
    for (const item of Array.isArray(result) ? (result as unknown[]) : [])
      expect(Object.isFrozen(item)).toBe(true);
  });
  it.each([
    { label: 'an errors envelope', body: { errors: [{ title: 'Synthetic refusal' }] } },
    { label: 'a single error string', body: { error: 'Synthetic refusal' } },
  ])('should report $label as a provider rejection', async ({ body }) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(endpoint.call(client))).toMatchObject({
      code: 'PROVIDER_REJECTED',
      effect: 'not-sent',
    });
    expect(resource(calls)).toHaveLength(1);
  });
  it.each([
    { label: 'a malformed known field', body: () => endpoint.malformed },
    { label: 'an unexplained status envelope', body: () => ({ status: 'surprise' }) },
    { label: 'a JSON null', body: () => null },
    { label: 'an errors envelope beside success evidence', body: () => ({ errors: [], id: 'x' }) },
  ])('should treat $label as a protocol error', async ({ body }) => {
    const { client, calls } = answering(() => json(body()));
    expect(await failure(endpoint.call(client))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'not-sent',
    });
    expect(resource(calls)).toHaveLength(1);
  });
  it.each([
    { label: 'HTTP 401', respond: () => json({}, 401), code: 'AUTH_ERROR', httpStatus: 401 },
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
    {
      label: 'a redirect',
      respond: () =>
        new Response(null, { status: 302, headers: { location: 'https://x.invalid' } }),
      code: 'HTTP_ERROR',
      httpStatus: 302,
    },
  ])(
    'should dispatch once and report not-sent after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(endpoint.call(client));
      expect(error).toMatchObject({ code, effect: 'not-sent' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(resource(calls)).toHaveLength(1);
      expect(calls).toHaveLength(2);
    },
  );
  it('should stop before dispatch on an aborted signal and after dispatch on a late abort', async () => {
    const early = answering(() => json(endpoint.success));
    const aborted = AbortSignal.abort();
    expect(await failure(endpoint.call(early.client, { signal: aborted }))).toMatchObject({
      code: 'ABORTED',
      effect: 'not-sent',
    });
    expect(early.calls).toHaveLength(0);
    const controller = new AbortController();
    const late = answering(() => {
      controller.abort();
      return new Promise<Response>(() => undefined);
    });
    expect(await failure(endpoint.call(late.client, { signal: controller.signal }))).toMatchObject({
      code: 'ABORTED',
      effect: 'not-sent',
    });
    expect(resource(late.calls)).toHaveLength(1);
  });
});

describe('vat.search input', () => {
  it.each([
    {},
    { vat: 'synthetic' },
    { country_code: 'GR' },
    { vat: '', country_code: 'GR' },
    { vat: 'synthetic', country_code: 'gr' },
    { vat: 'synthetic', country_code: 'GRC' },
    { vat: 42, country_code: 'GR' },
    { vat: 'synthetic', country_code: 'GR', unknown: true },
    null,
  ])('should refuse the query %j before any request', async (query) => {
    const { client, calls } = answering(() => json(vatDetails));
    expect(await failure(client.vat.search(query as never))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'vat',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('login', () => {
  const body = (init: RequestInit) => (typeof init.body === 'string' ? init.body : '');
  it.each([
    {
      label: 'a user id',
      tenant: { kind: 'userId', value: 'tenant-test' } as const,
      sent: '{"api_key":"synthetic-test-key","wrapp_user_id":"tenant-test"}',
    },
    {
      label: 'an email',
      tenant: { kind: 'email', value: 'tenant@example.invalid' } as const,
      sent: '{"api_key":"synthetic-test-key","email":"tenant@example.invalid"}',
    },
  ])(
    'should POST the credentials for $label in the JSON body only',
    async ({ tenant: id, sent }) => {
      const { client, calls } = provider(
        ({ url }) => (url.pathname.endsWith('/login') ? login(token) : json(tenant())),
        { credentials: { apiKey: credentials.apiKey, tenant: id } },
      );
      await client.tenant.get();
      const [call] = calls;
      if (!call) throw new Error('fixture');
      expect(call.url.href).toBe('https://staging.wrapp.ai/api/v1/login');
      expect(call.url.search).toBe('');
      expect(call.init.method).toBe('POST');
      expect(call.init.redirect).toBe('error');
      expect(body(call.init)).toBe(sent);
      expect(headers(call.init)).toEqual({
        accept: 'application/json',
        'content-type': 'application/json',
      });
      // Neither the key nor the tenant ever appears in a URL.
      for (const request of calls) {
        expect(request.url.href).not.toContain(credentials.apiKey);
        expect(request.url.href).not.toContain(id.value);
      }
    },
  );
  it.each([
    { apiKey: '', tenant: { kind: 'userId', value: 'tenant-test' } },
    { apiKey: 'k'.repeat(16_385), tenant: { kind: 'userId', value: 'tenant-test' } },
    { apiKey: 'key', tenant: { kind: 'userId', value: '' } },
    { apiKey: 'key', tenant: { kind: 'userId', value: 'v'.repeat(321) } },
    { apiKey: 'key', tenant: { kind: 'phone', value: 'tenant-test' } },
    { apiKey: 'key', tenant: { kind: 'userId', value: 'tenant-test', extra: true } },
    { apiKey: 42, tenant: { kind: 'userId', value: 'tenant-test' } },
    { apiKey: 'key' },
  ])('should refuse the credentials %j at construction, with no request', (bad) => {
    let requests = 0;
    const build = () =>
      new WrappClient({
        environment: 'staging',
        credentials: bad as never,
        advanced: {
          fetch: () => {
            requests++;
            return Promise.resolve(login(token));
          },
        },
      });
    expect(build).toThrow(WrappError);
    try {
      build();
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_INPUT', operation: 'configure' });
      expect(JSON.stringify(error)).not.toContain('key');
    }
    expect(requests).toBe(0);
  });
  it.each([
    {
      label: 'the documented errors envelope',
      respond: () => json({ errors: [{ title: 'Not valid user' }] }),
      code: 'PROTOCOL_ERROR',
    },
    {
      label: 'a token of another type',
      respond: () => json({ data: { type: 'session', attributes: { jwt: token } } }),
      code: 'PROTOCOL_ERROR',
    },
    {
      label: 'a token with illegal characters',
      respond: () => json({ data: { type: 'jwt', attributes: { jwt: 'a b' } } }),
      code: 'PROTOCOL_ERROR',
    },
    {
      label: 'an empty token',
      respond: () => json({ data: { type: 'jwt', attributes: { jwt: '' } } }),
      code: 'PROTOCOL_ERROR',
    },
    {
      label: 'HTTP 401',
      respond: () => json({ errors: [{ title: 'Not valid user' }] }, 401),
      code: 'AUTH_ERROR',
      httpStatus: 401,
    },
    { label: 'HTTP 429', respond: () => json({}, 429), code: 'HTTP_ERROR', httpStatus: 429 },
    { label: 'HTTP 500', respond: () => json({}, 500), code: 'HTTP_ERROR', httpStatus: 500 },
    {
      label: 'a network failure',
      respond: () => Promise.reject(new Error('synthetic')),
      code: 'NETWORK_ERROR',
    },
    {
      label: 'a malformed body',
      respond: () => new Response('{', { headers: { 'content-type': 'application/json' } }),
      code: 'PROTOCOL_ERROR',
    },
    {
      label: 'a response that never arrives',
      respond: () => new Promise<Response>(() => undefined),
      code: 'TIMEOUT',
      stalled: true,
    },
  ])(
    'should fail the call as not-sent after $label, with one login and no resource request',
    async ({ respond, code, httpStatus, stalled }) => {
      // The shared login keeps the client's own deadline; a stalled one is given up on by
      // each caller's shorter per-call deadline.
      const { client, calls } = provider(
        ({ url }) => (url.pathname.endsWith('/login') ? respond() : json(tenant())),
        { timeoutMs: 2000 },
      );
      const options = stalled ? { timeoutMs: 40 } : undefined;
      const error = await failure(client.tenant.get(options));
      expect(error).toMatchObject({ code, operation: 'tenant', effect: 'not-sent' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url.pathname).toBe('/api/v1/login');
      // A failed login is never cached, so the next call logs in again. A login that is
      // still in flight is joined instead: nothing is replayed either way.
      expect(await failure(client.tenant.get(options))).toMatchObject({ code, effect: 'not-sent' });
      expect(calls).toHaveLength(stalled ? 1 : 2);
      expect(calls.every((call) => call.url.pathname === '/api/v1/login')).toBe(true);
    },
  );
  it('should use the returned token as the bearer and log in once for many calls', async () => {
    const { client, calls } = answering(() => json(tenant()));
    await Promise.all([client.tenant.get(), client.tenant.get(), client.tenant.get()]);
    expect(calls.filter((call) => call.url.pathname === '/api/v1/login')).toHaveLength(1);
    for (const call of calls.slice(1))
      expect(headers(call.init).authorization).toBe('Bearer ' + token);
  });
});
