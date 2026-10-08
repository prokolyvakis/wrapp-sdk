import { describe, expect, it } from 'vitest';
import { WrappError } from '../../src/index.js';
import type { RequestOptions, WrappClient } from '../../src/index.js';
import { json, login, provider } from '../fixtures/provider.js';

// Synthetic bodies in the documented shapes of the Wrapp reference v1.18.0. Methods and paths
// are written literally and never read from the SDK's operation registry.
const token = 'synthetic.jwt.token';
function answering(respond: () => Response | Promise<Response>, timeoutMs?: number) {
  return provider(
    ({ url }) => (url.pathname.endsWith('/login') ? login(token) : respond()),
    timeoutMs === undefined ? {} : { timeoutMs },
  );
}
const raw = (text: string) => () =>
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
const badOptions = [
  { timeoutMs: 0 },
  { timeoutMs: 120_001 },
  { signal: {} },
  { diagnostics: 'all' },
  { unknown: true },
] as unknown as RequestOptions[];
// What happens after the request has left, for each way a dispatched call can fail.
const failures = [
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
  { label: 'a malformed success body', respond: raw('{'), code: 'PROTOCOL_ERROR' },
];

describe('invoices.issuedCount', () => {
  const call = (client: WrappClient, options?: RequestOptions) =>
    client.invoices.issuedCount(options);
  it('should send one bodiless authenticated GET to /api/v1/invoices/issued_count', async () => {
    const { client, calls } = answering(() => json({ issued_count: 800 }));
    await call(client);
    expect(calls).toHaveLength(2);
    const [, sent] = calls;
    if (!sent) throw new Error('fixture');
    expect(sent.url.href).toBe('https://staging.wrapp.ai/api/v1/invoices/issued_count');
    expect(sent.init.method).toBe('GET');
    expect(sent.init.body).toBeUndefined();
    expect(sent.init.redirect).toBe('error');
    expect(headers(sent.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    });
  });
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json({ issued_count: 800 }));
    for (const options of badOptions)
      expect(await failure(call(client, options))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'issuedCount',
        effect: 'not-sent',
      });
    expect(calls).toHaveLength(0);
  });
  it.each([
    { label: 'zero', text: '0', count: '0' },
    { label: 'the documented example', text: '800', count: '800' },
    {
      label: 'a count beyond double precision',
      text: '9007199254740993',
      count: '9007199254740993',
    },
    { label: 'a 30-digit count', text: '9'.repeat(30), count: '9'.repeat(30) },
  ])('should return $label as exact integer text, frozen', async ({ text, count }) => {
    const { client } = answering(raw(`{"issued_count":${text},"future_field":true}`));
    const result = await call(client);
    expect(result).toEqual({ issuedCount: count });
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each([
    { label: 'a JSON string', text: '{"issued_count":"800"}' },
    { label: 'a fraction', text: '{"issued_count":800.5}' },
    { label: 'a negative number', text: '{"issued_count":-1}' },
    { label: 'an exponent', text: '{"issued_count":8e2}' },
    { label: 'a 31-digit count', text: `{"issued_count":${'9'.repeat(31)}}` },
    { label: 'null', text: '{"issued_count":null}' },
    { label: 'a missing count', text: '{}' },
    { label: 'a bare number', text: '800' },
    { label: 'a status envelope', text: '{"issued_count":800,"status":"surprise"}' },
  ])('should treat $label as a protocol error', async ({ text }) => {
    const { client, calls } = answering(raw(text));
    expect(await failure(call(client))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'issuedCount',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(2);
  });
  it.each([{ errors: [{ title: 'Synthetic refusal' }] }, { error: 'Synthetic refusal' }])(
    'should report the rejection %j as a provider rejection',
    async (body) => {
      const { client } = answering(() => json(body));
      expect(await failure(call(client))).toMatchObject({
        code: 'PROVIDER_REJECTED',
        operation: 'issuedCount',
        effect: 'not-sent',
      });
    },
  );
  it.each(failures)(
    'should dispatch once and report not-sent after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(call(client));
      expect(error).toMatchObject({ code, operation: 'issuedCount', effect: 'not-sent' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(calls).toHaveLength(2);
    },
  );
});

describe('invoices.requestThermalPdf', () => {
  const path = '/api/v1/invoices/invoice-one/generate_thermal_pdf';
  it('should send one bodiless authenticated GET to its literal path, encoding the id once', async () => {
    const { client, calls } = answering(() => json({ status: 'Synthetic acknowledgement' }));
    await client.invoices.requestThermalPdf('invoice-one');
    await client.invoices.requestThermalPdf('Δοκιμή.1');
    expect(calls).toHaveLength(3);
    const [, first, second] = calls;
    if (!first || !second) throw new Error('fixture');
    expect(first.url.href).toBe('https://staging.wrapp.ai' + path);
    expect(first.init.method).toBe('GET');
    expect(first.init.body).toBeUndefined();
    expect(first.init.redirect).toBe('error');
    expect(headers(first.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    });
    expect(second.url.pathname).toBe(
      '/api/v1/invoices/%CE%94%CE%BF%CE%BA%CE%B9%CE%BC%CE%AE.1/generate_thermal_pdf',
    );
    expect(second.url.search).toBe('');
  });
  it.each(['', '../x', 'a/b', 'a b', 'a?b', 'a#b', 'a%2Fb', '..', 'x'.repeat(257), 42, null])(
    'should refuse the invoice id %j before any request',
    async (id) => {
      const { client, calls } = answering(() => json({ status: 'x' }));
      expect(await failure(client.invoices.requestThermalPdf(id as string))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'thermalPdf',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json({ status: 'x' }));
    for (const options of badOptions)
      expect(
        await failure(client.invoices.requestThermalPdf('invoice-one', options)),
      ).toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
    expect(calls).toHaveLength(0);
  });
  it('should report an existing artifact as available, with the link as data', async () => {
    const { client, calls } = answering(() =>
      json({ download_url: 'https://example.invalid/thermal.pdf', future_field: 1 }),
    );
    const outcome = await client.invoices.requestThermalPdf('invoice-one');
    expect(outcome).toEqual({
      kind: 'available',
      downloadUrl: 'https://example.invalid/thermal.pdf',
    });
    expect(Object.isFrozen(outcome)).toBe(true);
    // One effectful GET and nothing else: the link is never fetched.
    expect(calls).toHaveLength(2);
    expect(calls.every((sent) => sent.url.hostname === 'staging.wrapp.ai')).toBe(true);
  });
  it('should report a started generation as acknowledged with unknown meaning', async () => {
    const { client, calls } = answering(() =>
      json({ status: 'PDF generation started, synthetic wording' }),
    );
    expect(await client.invoices.requestThermalPdf('invoice-one')).toEqual({
      kind: 'acknowledged',
      status: 'unknown',
    });
    expect(calls).toHaveLength(2);
  });
  it.each([
    { errors: [{ title: 'Please check your parameters' }] },
    { errors: [{ title: 'Synthetic: not an issued invoice' }, { title: 'second' }] },
    { error: 'Synthetic refusal' },
  ])('should report the rejection %j as a rejected result', async (body) => {
    const { client, calls } = answering(() => json(body));
    const outcome = await client.invoices.requestThermalPdf('invoice-one');
    expect(outcome).toMatchObject({ kind: 'rejected', rejectionSource: 'unknown' });
    expect(outcome).toHaveProperty('errorCount', 'errors' in body ? body.errors.length : 1);
    expect(calls).toHaveLength(2);
  });
  it.each([
    { label: 'an insecure link', body: { download_url: 'http://example.invalid/thermal.pdf' } },
    { label: 'a link with credentials', body: { download_url: 'https://u:p@example.invalid/x' } },
    {
      label: 'a link beside a status',
      body: { download_url: 'https://example.invalid/x', status: 'x' },
    },
    {
      label: 'a link beside errors',
      body: { download_url: 'https://example.invalid/x', errors: [{ title: 'x' }] },
    },
    { label: 'an empty status', body: { status: '' } },
    { label: 'a status of another type', body: { status: 1 } },
    { label: 'an empty object', body: {} },
    { label: 'a JSON null', body: null },
  ])('should treat $label as a protocol error with unknown effect', async ({ body }) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(client.invoices.requestThermalPdf('invoice-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'thermalPdf',
      effect: 'unknown',
    });
    expect(calls).toHaveLength(2);
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(client.invoices.requestThermalPdf('invoice-one'));
      expect(error).toMatchObject({ code, operation: 'thermalPdf', effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(calls.filter((sent) => sent.url.pathname === path)).toHaveLength(1);
      expect(calls).toHaveLength(2);
    },
  );
  it('should keep the ordinary PDF request on its own path and operation', async () => {
    const { client, calls } = answering(() => json({ status: 'x' }));
    await client.invoices.requestPdf('invoice-one');
    expect(calls[1]?.url.pathname).toBe('/api/v1/invoices/invoice-one/generate_pdf');
    const refused = answering(() => json({}, 500));
    expect(await failure(refused.client.invoices.requestPdf('invoice-one'))).toMatchObject({
      operation: 'pdf',
      effect: 'unknown',
    });
  });
});
