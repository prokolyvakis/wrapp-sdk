import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { WrappClient } from '../../src/index.js';
import { credentials, invoice, json, login, observation, provider } from '../fixtures/provider.js';

const closers: (() => Promise<void>)[] = [];
async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const calls: { url: string; method: string; body: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (data: Buffer) => {
      chunks.push(data);
    });
    req.on('end', () => {
      calls.push({
        url: req.url ?? '',
        method: req.method ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
      });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No listening address');
  return { origin: `http://127.0.0.1:${String(address.port)}`, calls };
}
function reply(res: ServerResponse, body: unknown) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
function auth(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.url !== '/api/v1/login') return false;
  reply(res, { data: { type: 'jwt', attributes: { jwt: 'synthetic.jwt.token' } } });
  return true;
}
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

describe('HTTP transport', () => {
  it.each([301, 302, 303, 307, 308])(
    'should never redirect the login body for HTTP %s',
    async (status) => {
      const target = await serve((_req, res) => {
        reply(res, {});
      });
      const source = await serve((_req, res) => {
        res.writeHead(status, { location: target.origin + '/collect' });
        res.end();
      });
      const client = new WrappClient({
        environment: 'staging',
        credentials,
        advanced: { testBaseUrl: source.origin + '/api/v1' },
      });
      await expect(client.invoices.create(invoice())).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
        effect: 'not-sent',
      });
      expect(target.calls).toHaveLength(0);
      expect(source.calls).toHaveLength(1);
      expect(source.calls[0]?.url).toBe('/api/v1/login');
      expect(source.calls[0]?.body).toContain('"api_key":"synthetic-test-key"');
    },
  );
  it.each(['create', 'pdf'] as const)(
    'should never redirect or replay an admitted %s request',
    async (operation) => {
      const target = await serve((_req, res) => {
        reply(res, {});
      });
      const source = await serve((req, res) => {
        if (auth(req, res)) return;
        res.writeHead(307, { location: target.origin + '/collect' });
        res.end();
      });
      const client = new WrappClient({
        environment: 'staging',
        credentials,
        advanced: { testBaseUrl: source.origin + '/api/v1' },
      });
      const run =
        operation === 'create'
          ? client.invoices.create(invoice())
          : client.invoices.requestPdf('invoice-one');
      await expect(run).rejects.toMatchObject({ code: 'NETWORK_ERROR', effect: 'unknown' });
      expect(source.calls).toHaveLength(2);
      expect(target.calls).toHaveLength(0);
    },
  );
  it.each([401, 429, 500, 503])('should never replay after HTTP %s', async (status) => {
    const server = await serve((req, res) => {
      if (auth(req, res)) return;
      res.writeHead(status, { 'Retry-After': '0' });
      res.end();
    });
    const client = new WrappClient({
      environment: 'staging',
      credentials,
      advanced: { testBaseUrl: server.origin + '/api/v1' },
    });
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      effect: 'unknown',
      httpStatus: status,
    });
    expect(server.calls).toHaveLength(2);
  });
  it('should send exact decimal tokens using real fetch and preserve a lost response as unknown', async () => {
    const server = await serve((req, res) => {
      if (!auth(req, res)) res.destroy();
    });
    const client = new WrappClient({
      environment: 'staging',
      credentials,
      advanced: { testBaseUrl: server.origin + '/api/v1' },
    });
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      effect: 'unknown',
    });
    expect(server.calls[1]?.body).toContain('"vat_total_amount":2.40');
    expect(server.calls).toHaveLength(2);
  });
  it('should bound a never-ending body with the overall deadline', async () => {
    const server = await serve((req, res) => {
      if (auth(req, res)) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"id":');
    });
    const client = new WrappClient({
      environment: 'staging',
      credentials,
      timeoutMs: 100,
      advanced: { testBaseUrl: server.origin + '/api/v1' },
    });
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      code: 'TIMEOUT',
      effect: 'unknown',
    });
    expect(server.calls).toHaveLength(2);
  });
  it('should abort after dispatch and preserve uncertainty', async () => {
    const abort = new AbortController();
    const server = await serve((req, res) => {
      if (auth(req, res)) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
      abort.abort();
    });
    const client = new WrappClient({
      environment: 'staging',
      credentials,
      advanced: { testBaseUrl: server.origin + '/api/v1' },
    });
    await expect(client.invoices.create(invoice(), { signal: abort.signal })).rejects.toMatchObject(
      { code: 'ABORTED', effect: 'unknown' },
    );
  });
  it('should apply response size limits to decompressed bytes', async () => {
    const server = await serve((req, res) => {
      if (auth(req, res)) return;
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(gzipSync(JSON.stringify({ ...observation(), padding: 'x'.repeat(10_000) })));
    });
    const client = new WrappClient({
      environment: 'staging',
      credentials,
      maxResponseBytes: 1000,
      advanced: { testBaseUrl: server.origin + '/api/v1' },
    });
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
      effect: 'unknown',
    });
  });
  it.each([
    () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response('{"a":1,"a":2}', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    () => new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }),
  ])('should reject malformed or missing bodies without exposing them', async (response) => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : response(),
    );
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
    expect(calls).toHaveLength(2);
  });
  it.each(['huge', '99999999'])(
    'should reject invalid or oversized content lengths',
    async (length) => {
      const { client } = provider(({ url }) =>
        url.pathname.endsWith('/login')
          ? login()
          : new Response('{}', {
              headers: { 'content-type': 'application/json', 'content-length': length },
            }),
      );
      await expect(client.invoices.create(invoice())).rejects.toMatchObject({
        code: 'RESPONSE_TOO_LARGE',
        effect: 'unknown',
      });
    },
  );
  it('should consume a valid JSON media type and redact transport exceptions', async () => {
    let fail = false;
    const { client } = provider(({ url }) => {
      if (url.pathname.endsWith('/login')) return login();
      if (fail) throw new Error('synthetic-test-key https://secret.invalid/body private-customer');
      return new Response(JSON.stringify(observation()), {
        headers: { 'content-type': 'application/vnd.test+json; charset=utf-8' },
      });
    });
    expect((await client.invoices.create(invoice())).kind).toBe('observed');
    fail = true;
    try {
      await client.invoices.create(invoice());
      throw new Error('expected failure');
    } catch (error) {
      expect(JSON.stringify(error)).not.toMatch(
        /synthetic-test-key|secret.invalid|private-customer/,
      );
      expect(error).toMatchObject({ code: 'NETWORK_ERROR', effect: 'unknown' });
    }
  });
  it('should count authentication time in the caller deadline', async () => {
    const server = await serve((req, res) => {
      setTimeout(() => {
        if (!auth(req, res)) reply(res, observation());
      }, 200).unref();
    });
    const client = new WrappClient({
      environment: 'staging',
      credentials,
      timeoutMs: 500,
      advanced: { testBaseUrl: server.origin + '/api/v1' },
    });
    await expect(client.invoices.create(invoice(), { timeoutMs: 300 })).rejects.toMatchObject({
      code: 'TIMEOUT',
      effect: 'unknown',
    });
  });
  it('should preserve a JSON error under HTTP success as a rejection', async () => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json({
            status: 'myDATA Errors',
            errors: [{ code: '313', message: 'synthetic rejection' }],
          }),
    );
    expect(await client.invoices.create(invoice())).toEqual({
      kind: 'rejected',
      errorCount: 1,
      rejectionSource: 'mydata-errors',
      referenceState: 'unknown',
    });
  });
});
