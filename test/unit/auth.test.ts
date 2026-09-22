import { describe, expect, it } from 'vitest';
import {
  deferred,
  invoice,
  json,
  login,
  observation,
  provider,
  tenant,
  ticks,
} from '../fixtures/provider.js';

describe('auth', () => {
  it('should coalesce login, isolate callers and use credentials only in JSON', async () => {
    const pending = deferred<Response>();
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? pending.promise : json(tenant()),
    );
    const aborted = new AbortController();
    const a = client.tenant.get({ signal: aborted.signal });
    const checked = expect(a).rejects.toMatchObject({ code: 'ABORTED', effect: 'not-sent' });
    const b = client.tenant.get();
    expect(calls).toHaveLength(1);
    aborted.abort();
    await checked;
    pending.resolve(login());
    await b;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.search).toBe('');
    expect(calls[0]?.init.body).toBe(
      '{"api_key":"synthetic-test-key","wrapp_user_id":"tenant-test"}',
    );
    expect(calls[0]?.init.redirect).toBe('error');
  });
  it('should recover after failed login and never dispatch the blocked invoice', async () => {
    let count = 0;
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? ++count === 1
          ? json({ errors: [{ title: 'bad key' }] }, 401)
          : login()
        : json(observation()),
    );
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(1);
    expect((await client.invoices.create(invoice())).kind).toBe('observed');
    expect(calls).toHaveLength(3);
  });
  it('should refresh near expiry and prevent a late old-token 401 from evicting a new session', async () => {
    let now = 0,
      logins = 0;
    const delayed = deferred<Response>();
    let hold = true;
    const { client, calls } = provider(
      ({ url, init }) => {
        if (url.pathname.endsWith('/login'))
          return login(++logins === 1 ? 'old.token' : 'new.token');
        const authorization = new Headers(init.headers).get('authorization');
        if (authorization === 'Bearer old.token' && hold) {
          hold = false;
          return delayed.promise;
        }
        return json(tenant());
      },
      { advanced: { now: () => now } },
    );
    const old = client.tenant.get();
    const checked = expect(old).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    await ticks();
    now = 86_400_000;
    await client.tenant.get();
    delayed.resolve(json({}, 401));
    await checked;
    await client.tenant.get();
    expect(logins).toBe(2);
    expect(calls.at(-1)?.init.headers).toMatchObject({ Authorization: 'Bearer new.token' });
    now = -1;
    await client.tenant.get();
    expect(logins).toBe(3);
  });
  it('should not replay mutations after expired-token responses', async () => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json({}, 401),
    );
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      effect: 'unknown',
    });
    expect(calls).toHaveLength(2);
  });
  it('should isolate separate clients and support email tenant identity', async () => {
    const a = provider(
      ({ url }) => (url.pathname.endsWith('/login') ? login('a.token') : json(tenant())),
      { credentials: { apiKey: 'key-a', tenant: { kind: 'email', value: 'a@example.invalid' } } },
    );
    const b = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login('b.token') : json(tenant()),
    );
    await Promise.all([a.client.tenant.get(), b.client.tenant.get()]);
    expect(a.calls[0]?.init.body).toContain('"email":"a@example.invalid"');
    expect(b.calls[1]?.init.headers).toMatchObject({ Authorization: 'Bearer b.token' });
  });
  it('should avoid auth entirely for a pre-aborted request', async () => {
    const { client, calls } = provider(() => login());
    const abort = new AbortController();
    abort.abort();
    await expect(client.invoices.create(invoice(), { signal: abort.signal })).rejects.toMatchObject(
      { effect: 'not-sent', code: 'ABORTED' },
    );
    expect(calls).toHaveLength(0);
  });
  it('should bound a shared login even after all callers abandon it and permit recovery', async () => {
    let fail = true;
    const pending = deferred<Response>();
    const { client, calls } = provider(
      ({ url }) =>
        url.pathname.endsWith('/login') ? (fail ? pending.promise : login()) : json(tenant()),
      { timeoutMs: 25 },
    );
    await expect(client.tenant.get()).rejects.toMatchObject({
      code: 'TIMEOUT',
      effect: 'not-sent',
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    fail = false;
    await client.tenant.get();
    expect(calls.filter((v) => v.url.pathname.endsWith('/login'))).toHaveLength(2);
    pending.resolve(login());
  });
});
