import { describe, expect, it } from 'vitest';
import * as sdk from '../../src/index.js';
import { createRuntime } from '../../src/runtime.js';
import { credentials, invoice, json, login, observation, provider } from '../fixtures/provider.js';
import type { RecordedRequest } from '../fixtures/provider.js';

// The runtime is internal: these tests reach it directly to pin what every resource module
// inherits, including modules that do not exist yet.
function recording(maxRequestBytes: number, apiKey: string = credentials.apiKey) {
  const calls: RecordedRequest[] = [];
  const runtime = createRuntime({
    environment: 'staging',
    credentials: { ...credentials, apiKey },
    maxRequestBytes,
    advanced: {
      fetch: (resource, init = {}) => {
        const url = new URL(resource instanceof Request ? resource.url : String(resource));
        calls.push({ url, init });
        return Promise.resolve(
          url.pathname.endsWith('/login') ? login('token.for.' + apiKey) : json({ ok: true }),
        );
      },
    },
  });
  return { runtime, calls };
}
const body = (call: RecordedRequest | undefined) =>
  typeof call?.init.body === 'string' ? call.init.body : undefined;

describe('client runtime', () => {
  it('should bound a body in UTF-8 bytes before login for any body-bearing operation', async () => {
    // Five two-byte letters: 5 UTF-16 code units, 10 bytes. Six are 6 units but 12 bytes.
    const { runtime, calls } = recording(10);
    await expect(
      runtime.run('create', '/synthetic_domain', (value) => value, {}, 'αααααα'),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', operation: 'create', effect: 'not-sent' });
    expect(calls).toHaveLength(0);
    expect(await runtime.run('create', '/synthetic_domain', (value) => value, {}, 'ααααα')).toEqual(
      { ok: true },
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.pathname).toBe('/api/v1/synthetic_domain');
    expect(calls[1]?.init.method).toBe('POST');
    expect(body(calls[1])).toBe('ααααα');
    // An already authenticated runtime still dispatches nothing for an oversized body.
    await expect(
      runtime.run('create', '/synthetic_domain', (value) => value, {}, 'αααααα'),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
    expect(calls).toHaveLength(2);
  });
  it('should apply the same byte bound to create and leave an in-bound body unchanged', async () => {
    const input = { ...invoice(), notes: 'Σημείωση με ελληνικά' };
    const measured = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(observation()),
    );
    await measured.client.invoices.create(input);
    const sent = body(measured.calls[1]) ?? '';
    const bytes = Buffer.byteLength(sent);
    expect(bytes).toBeGreaterThan(sent.length);
    const exact = provider(
      ({ url }) => (url.pathname.endsWith('/login') ? login() : json(observation())),
      { maxRequestBytes: bytes },
    );
    expect((await exact.client.invoices.create(input)).kind).toBe('observed');
    expect(body(exact.calls[1])).toBe(sent);
    // A cap that the string length would satisfy, but the byte length does not.
    for (const cap of [bytes - 1, sent.length]) {
      const { client, calls } = provider(() => login(), { maxRequestBytes: cap });
      await expect(client.invoices.create(input)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'create',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    }
  });
  it('should expose one capability and nothing that reaches credentials or another origin', () => {
    const { runtime } = recording(100, 'synthetic-isolated-key');
    expect(Object.keys(runtime)).toEqual(['run']);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(JSON.stringify(runtime)).not.toContain('synthetic-isolated-key');
    expect(Object.keys(sdk).sort()).toEqual(
      [
        'WrappClient',
        'WrappError',
        'calendarDate',
        'decimal',
        'getProviderDiagnostics',
        'verifyWebhook',
      ].sort(),
    );
  });
  it.each([
    '//evil.invalid/steal',
    'tenant_details',
    '',
    '/',
    '/invoices//generate_pdf',
    '/invoices/../login',
    '/invoices/./x',
    '/invoices/%2e%2e/x',
    '/invoices/%2E/x',
    '/tenant_details#fragment',
    '/tenant details',
    '/tenant_details\r\nX-Injected: 1',
    '/tenant_details\u0000',
    '/τιμολόγια',
  ])('should refuse the non-route path %j before any request', async (path) => {
    const { runtime, calls } = recording(100);
    await expect(runtime.run('tenant', path, (value) => value)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'tenant',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it.each([
    '/tenant_details',
    '/invoices/find_all_invoices?page=1&start_date=2026-01-01',
    '/invoices/%CE%94%CE%BF%CE%BA%CE%B9%CE%BC%CE%AE/find_invoice_by_id',
    '/vat_search?vat=synthetic%2Bvat%2F+%26%3F&country_code=EL',
    '/invoices/a.b..c/generate_pdf',
  ])('should send the encoded route %s on the fixed origin', async (path) => {
    const { runtime, calls } = recording(100);
    await runtime.run('tenant', path, (value) => value);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.origin).toBe('https://staging.wrapp.ai');
    const url = calls[1]?.url;
    expect((url?.pathname ?? '') + (url?.search ?? '')).toBe('/api/v1' + path);
  });
  it('should freeze the client and every resource, and expose nothing but resources', () => {
    const { client } = provider(() => login());
    expect(Object.keys(client).sort()).toEqual(
      ['billingBooks', 'branches', 'digitalClienteles', 'invoices', 'tenant', 'vat'].sort(),
    );
    expect(Object.getOwnPropertySymbols(client)).toEqual([]);
    expect(Object.isFrozen(client)).toBe(true);
    // A member is an operation, or a frozen namespace of operations such as invoices.drafts.
    const operationsOnly = (holder: object) => {
      expect(Object.isFrozen(holder)).toBe(true);
      for (const member of Object.values(holder)) {
        if (typeof member === 'function') continue;
        expect(typeof member).toBe('object');
        operationsOnly(member as object);
      }
    };
    for (const resource of Object.values(client)) operationsOnly(resource as object);
    expect(JSON.stringify(client)).not.toContain(credentials.apiKey);
  });
  it('should share one login across every resource of a client', async () => {
    const { client, calls } = provider(({ url }) => {
      if (url.pathname.endsWith('/login')) return login();
      return json(
        url.pathname.endsWith('/find_all_invoices')
          ? { invoices: [], total_count: 0, total_pages: 0, current_page: 1 }
          : [],
      );
    });
    await Promise.all([
      client.branches.list(),
      client.billingBooks.list(),
      client.vat.exemptions(),
      client.invoices.list(),
    ]);
    expect(calls.filter((call) => call.url.pathname.endsWith('/login'))).toHaveLength(1);
    expect(calls).toHaveLength(5);
  });
  it('should give each client its own runtime, session and token', async () => {
    const first = recording(100, 'synthetic-key-one');
    const second = recording(100, 'synthetic-key-two');
    await Promise.all([
      first.runtime.run('tenant', '/tenant_details', (value) => value),
      first.runtime.run('branches', '/branches', (value) => value),
      second.runtime.run('tenant', '/tenant_details', (value) => value),
    ]);
    const bearer = (call: RecordedRequest) =>
      (call.init.headers as Record<string, string>).Authorization;
    expect(first.calls.filter((call) => call.url.pathname.endsWith('/login'))).toHaveLength(1);
    expect(second.calls.filter((call) => call.url.pathname.endsWith('/login'))).toHaveLength(1);
    for (const call of first.calls.slice(1))
      expect(bearer(call)).toBe('Bearer token.for.synthetic-key-one');
    expect(bearer(second.calls[1] as RecordedRequest)).toBe('Bearer token.for.synthetic-key-two');
    expect(body(first.calls[0])).toContain('synthetic-key-one');
    expect(body(first.calls[0])).not.toContain('synthetic-key-two');
  });
  it('should perform no request at construction', () => {
    const { calls } = recording(100);
    expect(calls).toHaveLength(0);
  });
});
