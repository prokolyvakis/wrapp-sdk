import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { getProviderDiagnostics, WrappError } from '../../src/index.js';
import type { ClientOptions, RequestOptions } from '../../src/index.js';
import { credentials, invoice, json, login, provider } from '../fixtures/provider.js';

// Synthetic rejection bodies in the documented error shapes of the Wrapp reference v1.18.0.
const optIn = { diagnostics: 'provider-issues' } as const;
const byId = { kind: 'invoiceId', value: 'invoice-one' } as const;
const token = 'synthetic.jwt.token';
const sentinel = 'CUSTOMER-SENTINEL-0000';
function answering(body: unknown, status = 200, overrides: Partial<ClientOptions> = {}) {
  return provider(
    ({ url }) => (url.pathname.endsWith('/login') ? login(token) : json(body, status)),
    overrides,
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
const classification = {
  status: 'myData Errors',
  errors: [{ code: '313', message: 'Synthetic classification conflict for ' + sentinel }],
};
const transmission = {
  status: 'myData Errors',
  errors: [{ code: '104', message: 'Synthetic transmission refusal' }],
};

describe('provider diagnostics', () => {
  it('should keep two rejections identical as results and distinct as opt-in diagnostics', async () => {
    const first = await answering(classification).client.invoices.create(invoice(), optIn);
    const second = await answering(transmission).client.invoices.create(invoice(), optIn);
    const safe = {
      kind: 'rejected',
      errorCount: 1,
      rejectionSource: 'mydata-errors',
      referenceState: 'unknown',
    };
    expect(first).toEqual(safe);
    expect(second).toEqual(safe);
    expect(getProviderDiagnostics(first)).toEqual({
      providerStatus: 'myData Errors',
      issues: [{ code: '313', message: 'Synthetic classification conflict for ' + sentinel }],
      truncated: false,
      sensitive: true,
    });
    expect(getProviderDiagnostics(second)).toEqual({
      providerStatus: 'myData Errors',
      issues: [{ code: '104', message: 'Synthetic transmission refusal' }],
      truncated: false,
      sensitive: true,
    });
  });
  it('should retain nothing unless the call opts in', async () => {
    const rejected = await answering(classification).client.invoices.create(invoice());
    expect(rejected.kind).toBe('rejected');
    expect(getProviderDiagnostics(rejected)).toBeUndefined();
    const error = await failure(
      answering({ errors: [{ title: 'Record not found' }] }).client.invoices.getStatus(byId),
    );
    expect(error.code).toBe('PROVIDER_REJECTED');
    expect(getProviderDiagnostics(error)).toBeUndefined();
    const refused = await failure(
      answering({ errors: [{ title: 'x' }] }, 422).client.invoices.create(invoice()),
    );
    expect(getProviderDiagnostics(refused)).toBeUndefined();
  });
  it.each([
    { label: 'an unknown value', value: 'everything' },
    { label: 'a boolean', value: true },
    { label: 'null', value: null },
  ])('should refuse $label for the diagnostics option before any request', async ({ value }) => {
    const { client, calls } = answering(classification);
    const options = { diagnostics: value } as unknown as RequestOptions;
    await expect(client.invoices.create(invoice(), options)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'create',
      effect: 'not-sent',
    });
    await expect(client.tenant.get(options)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(calls).toHaveLength(0);
  });
  it('should tell a duplicate-reference 422 from another 422 only through diagnostics', async () => {
    const duplicate = await failure(
      answering(
        {
          status: 'Invoice Errors',
          errors: [{ title: 'external_id is already used by another invoice' }],
        },
        422,
      ).client.invoices.create(invoice(), optIn),
    );
    const other = await failure(
      answering(
        { status: 'Invoice Errors', errors: [{ title: 'Synthetic unrelated validation' }] },
        422,
      ).client.invoices.create(invoice(), optIn),
    );
    for (const error of [duplicate, other])
      expect(error).toMatchObject({
        code: 'HTTP_ERROR',
        operation: 'create',
        effect: 'unknown',
        httpStatus: 422,
      });
    expect(JSON.stringify(duplicate)).toBe(JSON.stringify(other));
    expect(duplicate.message).toBe(other.message);
    expect(getProviderDiagnostics(duplicate)?.issues).toEqual([
      { title: 'external_id is already used by another invoice' },
    ]);
    expect(getProviderDiagnostics(other)?.issues).toEqual([
      { title: 'Synthetic unrelated validation' },
    ]);
    expect(getProviderDiagnostics(duplicate)?.providerStatus).toBe('Invoice Errors');
  });
  it('should dispatch a refused create once and never retry it because of its diagnostics', async () => {
    const { client, calls } = answering(
      { errors: [{ title: 'external_id is already used by another invoice' }] },
      422,
    );
    await failure(client.invoices.create(invoice(), optIn));
    expect(calls.filter((call) => call.url.pathname.endsWith('/invoices'))).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
  it('should keep provider text, customer data and credentials out of every ordinary surface', async () => {
    const leaky = {
      status: 'Invoice Errors',
      errors: [
        {
          title: `Refused for ${sentinel} with key ${credentials.apiKey} and bearer ${token}`,
          message: `again ${credentials.apiKey}${token}`,
          code: token,
        },
      ],
    };
    const rejected = await answering(leaky).client.invoices.create(invoice(), optIn);
    const refused = await failure(answering(leaky, 422).client.invoices.create(invoice(), optIn));
    const notFound = await failure(answering(leaky).client.invoices.getStatus(byId, optIn));
    const surfaces = [
      JSON.stringify(rejected),
      inspect(rejected, { showHidden: true, depth: null }),
      Object.keys(rejected).join(),
      ...[refused, notFound].flatMap((error) => [
        error.message,
        String(error),
        error.stack ?? '',
        JSON.stringify(error),
        Object.keys(error).join(),
        Object.getOwnPropertyNames(error).join(),
        inspect(error, { showHidden: true, depth: null }),
        JSON.stringify(error.cause ?? null),
      ]),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain(sentinel);
      expect(surface).not.toContain('Refused for');
      expect(surface).not.toContain(credentials.apiKey);
      expect(surface).not.toContain(token);
    }
    // The opt-in detail keeps the provider text and still never repeats the active credentials.
    for (const target of [rejected, refused, notFound]) {
      const detail = getProviderDiagnostics(target);
      expect(detail?.issues[0]?.title).toBe(
        `Refused for ${sentinel} with key [REDACTED] and bearer [REDACTED]`,
      );
      expect(detail?.issues[0]?.message).toBe('again [REDACTED][REDACTED]');
      expect(detail?.issues[0]?.code).toBe('[REDACTED]');
      expect(JSON.stringify(detail)).not.toContain(credentials.apiKey);
      expect(JSON.stringify(detail)).not.toContain(token);
      expect(detail?.sensitive).toBe(true);
    }
  });
  it('should hand back one deeply frozen snapshot, only for the exact result or error', async () => {
    const rejected = await answering(classification).client.invoices.create(invoice(), optIn);
    const detail = getProviderDiagnostics(rejected);
    expect(detail).toBeDefined();
    expect(getProviderDiagnostics(rejected)).toBe(detail);
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail?.issues)).toBe(true);
    expect(Object.isFrozen(detail?.issues[0])).toBe(true);
    expect(getProviderDiagnostics({ ...rejected })).toBeUndefined();
    expect(getProviderDiagnostics(structuredClone(rejected))).toBeUndefined();
    expect(getProviderDiagnostics(JSON.parse(JSON.stringify(rejected)))).toBeUndefined();
    const error = await failure(
      answering({ error: 'Invoice not found' }).client.invoices.get(byId, optIn),
    );
    expect(getProviderDiagnostics(error)?.issues).toEqual([{ message: 'Invoice not found' }]);
    expect(
      getProviderDiagnostics(new WrappError(error.code, error.operation, error.effect)),
    ).toBeUndefined();
    for (const value of [null, undefined, 'text', 42, Symbol('x'), () => undefined])
      expect(getProviderDiagnostics(value)).toBeUndefined();
  });
  it('should attach diagnostics to rejections of every operation shape', async () => {
    const notIssued = { errors: [{ title: 'Synthetic not issued' }] };
    const pdf = await answering(notIssued).client.invoices.requestPdf('invoice-one', optIn);
    expect(pdf).toEqual({ kind: 'rejected', errorCount: 1, rejectionSource: 'unknown' });
    expect(getProviderDiagnostics(pdf)?.issues).toEqual([{ title: 'Synthetic not issued' }]);
    const { client } = answering(notIssued);
    const runs = [
      client.tenant.get(optIn),
      client.branches.list(optIn),
      client.billingBooks.list(optIn),
      client.vat.exemptions(optIn),
      client.vat.search({ vat: 'synthetic', country_code: 'GR' }, optIn),
      client.invoices.getStatus(byId, optIn),
      client.invoices.get(byId, optIn),
      client.invoices.list({}, optIn),
      client.invoices
        .iterate({}, { maxPages: 1, ...optIn })
        [Symbol.asyncIterator]()
        .next(),
    ];
    for (const run of runs) {
      const error = await failure(run);
      expect(error).toMatchObject({ code: 'PROVIDER_REJECTED', effect: 'not-sent' });
      expect(getProviderDiagnostics(error)?.issues).toEqual([{ title: 'Synthetic not issued' }]);
    }
  });
  it.each([
    {
      label: 'an HTML body',
      respond: () => new Response('<html>refused</html>', { status: 422 }),
    },
    {
      label: 'malformed JSON',
      respond: () =>
        new Response('{"errors":[', {
          status: 422,
          headers: { 'content-type': 'application/json' },
        }),
    },
    {
      label: 'a body over the response cap',
      respond: () => json({ errors: [{ title: 'x'.repeat(2000) }] }, 422),
    },
    { label: 'a JSON body with no recognizable issues', respond: () => json({ detail: 'x' }, 422) },
    { label: 'a JSON array', respond: () => json([{ title: 'x' }], 422) },
    { label: 'an empty error list', respond: () => json({ errors: [] }, 422) },
    { label: 'no body at all', respond: () => new Response(null, { status: 422 }) },
  ])('should keep the HTTP failure primary when the 4xx body is $label', async ({ respond }) => {
    const { client, calls } = provider(
      ({ url }) => (url.pathname.endsWith('/login') ? login(token) : respond()),
      { maxResponseBytes: 1000 },
    );
    const error = await failure(client.invoices.create(invoice(), optIn));
    expect(error).toMatchObject({
      code: 'HTTP_ERROR',
      operation: 'create',
      effect: 'unknown',
      httpStatus: 422,
    });
    expect(getProviderDiagnostics(error)).toBeUndefined();
    expect(calls).toHaveLength(2);
  });
  it('should invalidate only the rejected token after a 401, with or without a readable body', async () => {
    let logins = 0;
    let reject: 'unreadable' | 'readable' | undefined = 'unreadable';
    const { client } = provider(({ url }) => {
      if (url.pathname.endsWith('/login')) return login('token.' + String(++logins));
      if (reject === 'unreadable') return new Response('<html>', { status: 401 });
      if (reject === 'readable') return json({ errors: [{ title: 'Synthetic expired' }] }, 401);
      return json({ errors: [{ title: 'Synthetic rejection' }] });
    });
    const unreadable = await failure(client.tenant.get(optIn));
    expect(unreadable).toMatchObject({ code: 'AUTH_ERROR', httpStatus: 401, effect: 'not-sent' });
    expect(getProviderDiagnostics(unreadable)).toBeUndefined();
    expect(logins).toBe(1);
    reject = 'readable';
    const readable = await failure(client.tenant.get(optIn));
    expect(readable).toMatchObject({ code: 'AUTH_ERROR', httpStatus: 401 });
    expect(getProviderDiagnostics(readable)?.issues).toEqual([{ title: 'Synthetic expired' }]);
    expect(logins).toBe(2);
    reject = undefined;
    await failure(client.tenant.get(optIn));
    await failure(client.tenant.get(optIn));
    // Two 401s cost two fresh logins; the calls after them reuse the third token.
    expect(logins).toBe(3);
  });
  it.each([
    { errors: [{ title: 'x' }], id: 'invoice-one' },
    { errors: [{ title: 'x' }], invoice_id: 'invoice-one' },
    { errors: [{ title: 'x' }], status: 'surprise' },
    { error: 'x', download_url: 'https://example.invalid/pdf' },
  ])('should not let diagnostics reinterpret the contradictory 2xx body %j', async (body) => {
    const created = await failure(answering(body).client.invoices.create(invoice(), optIn));
    expect(created).toMatchObject({ code: 'PROTOCOL_ERROR', effect: 'unknown' });
    expect(getProviderDiagnostics(created)).toBeUndefined();
    const read = await failure(answering(body).client.invoices.getStatus(byId, optIn));
    expect(read).toMatchObject({ code: 'PROTOCOL_ERROR' });
    expect(getProviderDiagnostics(read)).toBeUndefined();
  });
  it('should bound the number of issues and report the loss without changing errorCount', async () => {
    const hundred = Array.from({ length: 100 }, (_, index) => ({ code: String(index) }));
    const rejected = await answering({ errors: hundred }).client.invoices.create(invoice(), optIn);
    expect(rejected).toMatchObject({ kind: 'rejected', errorCount: 100 });
    expect(getProviderDiagnostics(rejected)).toMatchObject({ truncated: false });
    expect(getProviderDiagnostics(rejected)?.issues).toHaveLength(100);
    const many = Array.from({ length: 150 }, (_, index) => ({ code: String(index) }));
    const refused = await failure(
      answering({ errors: many }, 422).client.invoices.create(invoice(), optIn),
    );
    const detail = getProviderDiagnostics(refused);
    expect(detail?.issues).toHaveLength(100);
    expect(detail?.issues[99]).toEqual({ code: '99' });
    expect(detail?.truncated).toBe(true);
  });
  it('should bound each field: shorten text, omit an overlong code or status, and say so', async () => {
    const body = {
      status: 's'.repeat(257),
      errors: [
        { title: 't'.repeat(4097), message: 'm'.repeat(4096), code: 'c'.repeat(257) },
        { title: 'kept', code: 'c'.repeat(256) },
        { code: 'c'.repeat(300) },
        { title: 42, message: null, code: ['x'] },
        'not an object',
      ],
    };
    const detail = getProviderDiagnostics(
      await failure(answering(body, 422).client.invoices.create(invoice(), optIn)),
    );
    expect(detail).toEqual({
      issues: [
        { title: 't'.repeat(4096), message: 'm'.repeat(4096) },
        { title: 'kept', code: 'c'.repeat(256) },
      ],
      truncated: true,
      sensitive: true,
    });
    const exact = getProviderDiagnostics(
      await failure(
        answering(
          { status: 's'.repeat(256), errors: [{ title: 't'.repeat(4096) }] },
          422,
        ).client.invoices.create(invoice(), optIn),
      ),
    );
    expect(exact).toEqual({
      providerStatus: 's'.repeat(256),
      issues: [{ title: 't'.repeat(4096) }],
      truncated: false,
      sensitive: true,
    });
  });
  it('should cap the retained text at 64 KiB of UTF-8 in total', async () => {
    // Greek letters take two UTF-8 bytes each: every issue below weighs 8 000 bytes.
    const errors = Array.from({ length: 20 }, () => ({ message: 'α'.repeat(4000) }));
    const detail = getProviderDiagnostics(
      await failure(answering({ errors }, 422).client.invoices.create(invoice(), optIn)),
    );
    expect(detail?.issues).toHaveLength(8);
    expect(detail?.truncated).toBe(true);
    const bytes = Buffer.byteLength(detail?.issues.map((issue) => issue.message).join('') ?? '');
    expect(bytes).toBeLessThanOrEqual(65_536);
  });
  it('should redact credentials before shortening so no fragment of a key survives the cut', async () => {
    const title = 'x'.repeat(4090) + credentials.apiKey;
    const detail = getProviderDiagnostics(
      await failure(
        answering({ errors: [{ title }] }, 422).client.invoices.create(invoice(), optIn),
      ),
    );
    const kept = detail?.issues[0]?.title ?? '';
    expect(kept).toHaveLength(4096);
    expect(kept.endsWith('x[REDAC')).toBe(true);
    expect(kept).not.toContain(credentials.apiKey.slice(0, 4));
    expect(detail?.truncated).toBe(true);
  });
  it('should decode every recognized source: the errors list and the single error string', async () => {
    const both = getProviderDiagnostics(
      await failure(
        answering(
          { errors: [{ title: 'from the list' }], error: 'from the string' },
          422,
        ).client.invoices.create(invoice(), optIn),
      ),
    );
    expect(both?.issues).toEqual([{ title: 'from the list' }, { message: 'from the string' }]);
    for (const errors of [{}, 'text', 42, null, []]) {
      const single = getProviderDiagnostics(
        await failure(
          answering({ errors, error: 'from the string' }, 422).client.invoices.create(
            invoice(),
            optIn,
          ),
        ),
      );
      expect(single?.issues).toEqual([{ message: 'from the string' }]);
    }
  });
  it('should retain nothing when a body names a status but no usable issue', async () => {
    for (const body of [
      { status: 'Invoice Errors', errors: [{}] },
      { status: 's'.repeat(300), errors: [{ code: 'c'.repeat(300) }] },
      { status: 'Invoice Errors' },
    ])
      expect(
        getProviderDiagnostics(
          await failure(answering(body, 422).client.invoices.create(invoice(), optIn)),
        ),
      ).toBeUndefined();
  });
  it('should apply the bounds after redaction, which can lengthen a text', async () => {
    // A two-character key becomes a ten-character marker: the text grows past the bound.
    const { client } = provider(
      ({ url }) =>
        url.pathname.endsWith('/login')
          ? login(token)
          : json({ errors: [{ title: 'zq'.repeat(2048) }] }, 422),
      { credentials: { ...credentials, apiKey: 'zq' } },
    );
    const detail = getProviderDiagnostics(await failure(client.invoices.create(invoice(), optIn)));
    expect(detail?.issues[0]?.title).toBe('[REDACTED]'.repeat(410).slice(0, 4096));
    expect(detail?.truncated).toBe(true);
  });
  it('should never leave half a surrogate pair at a shortened boundary', async () => {
    const title = 'x'.repeat(4095) + '😀';
    const detail = getProviderDiagnostics(
      await failure(
        answering({ errors: [{ title }] }, 422).client.invoices.create(invoice(), optIn),
      ),
    );
    expect(detail?.issues[0]?.title).toBe('x'.repeat(4095));
    expect(detail?.truncated).toBe(true);
  });
});
