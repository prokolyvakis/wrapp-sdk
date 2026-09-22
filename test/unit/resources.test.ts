import { describe, expect, it } from 'vitest';
import { WrappClient, WrappError, calendarDate, decimal } from '../../src/index.js';
import {
  credentials,
  deferred,
  details,
  invoice,
  json,
  login,
  observation,
  provider,
  tenant,
  ticks,
} from '../fixtures/provider.js';

const ref = { kind: 'externalId', value: 'reference-one' } as const;
describe('resources', () => {
  it('should expose the core reads with exact per-operation decoding and frozen copies', async () => {
    const { client, calls } = provider(({ url }) => {
      switch (url.pathname) {
        case '/api/v1/login':
          return login();
        case '/api/v1/tenant_details':
          return json(tenant({ next_payment_date: '2026-10-01', next_payment_amount: 12.4 }));
        case '/api/v1/branches':
          return json([{ id: 'branch', name: 'Main', code: '001', future: true }]);
        case '/api/v1/billing_books':
          return json([
            { id: 'book', name: 'Service', series: 'S', invoice_type_code: '2.1', number: 4 },
          ]);
        case '/api/v1/vat_search':
          return json({
            vat_no: 'synthetic',
            name: 'Company',
            city: 'Athens',
            address: 'Synthetic',
            postal_code: '00000',
            street_number: '1',
          });
        case '/api/v1/vat_exemptions':
          return json([{ '1': 'Synthetic exemption', category: 'additive metadata' }]);
        default:
          return json({ errors: [{ title: 'wrong route' }] });
      }
    });
    expect((await client.tenant.get()).next_payment_amount).toBe('12.4');
    const branches = await client.branches.list();
    expect(branches).toEqual([{ id: 'branch', name: 'Main', code: '001' }]);
    expect(Object.isFrozen(branches[0])).toBe(true);
    expect((await client.billingBooks.list())[0]?.number).toBe('4');
    expect((await client.vat.search({ vat: 'synthetic+value', country_code: 'EL' })).vat_no).toBe(
      'synthetic',
    );
    expect(await client.vat.exemptions()).toEqual([{ '1': 'Synthetic exemption' }]);
    expect(calls.filter((c) => c.url.pathname.endsWith('/login'))).toHaveLength(1);
    expect(
      calls.find((c) => c.url.pathname.endsWith('vat_search'))?.url.searchParams.get('vat'),
    ).toBe('synthetic+value');
  });
  it('should retain large MARKs and distinguish exact from ASCII-case-variant echoes', async () => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json(observation({ external_id: 'REFERENCE-ONE', future: 42 })),
    );
    const result = await client.invoices.getStatus(ref);
    expect(result.identity).toBe('ascii-case-variant');
    expect(result.invoice.my_data_mark).toBe('90071992547409931234');
    expect(result.invoice.issued_at).toBe('2026-09-21');
    expect(Object.isFrozen(result.invoice)).toBe(true);
    expect(
      (await client.invoices.getStatus({ kind: 'invoiceId', value: 'invoice-one' })).identity,
    ).toBe('exact');
  });
  it.each([null, 'unrelated', 'Σ'])('should reject mismatched reference %s', async (echo) => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(observation({ external_id: echo })),
    );
    await expect(
      client.invoices.getStatus({ kind: 'externalId', value: echo === 'Σ' ? 'σ' : ref.value }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it('should use encoded Unicode references without lowercasing them', async () => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(observation({ external_id: 'Δοκιμή' })),
    );
    expect(
      (await client.invoices.getStatus({ kind: 'externalId', value: 'Δοκιμή' })).identity,
    ).toBe('exact');
    expect(calls[1]?.url.pathname).toBe('/api/v1/invoices/' + encodeURIComponent('Δοκιμή'));
  });
  it.each(['../x', '..', '%2e%2e', 'a/b', 'a?b', 'a#b', 'a\u0000b', '\ud800'])(
    'should reject unsafe references before I/O: %s',
    async (value) => {
      const { client, calls } = provider(() => login());
      await expect(client.invoices.getStatus({ kind: 'externalId', value })).rejects.toThrow(
        WrappError,
      );
      expect(calls).toHaveLength(0);
    },
  );
  it('should return the full-read core projection with exact numeric tokens and additive tolerance', async () => {
    const body = JSON.stringify(details({ future: { x: true } })).replace(
      '"total_amount":12.4',
      '"total_amount":9007199254740993.12',
    );
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : new Response(body, { headers: { 'content-type': 'application/json' } }),
    );
    const result = await client.invoices.get(ref);
    expect(result.invoice.total_amount).toBe('9007199254740993.12');
    expect(result.identity).toBe('exact');
    expect(Object.isFrozen(result.invoice.invoice_lines[0])).toBe(true);
  });
  it.each([{ errors: [{ title: 'not found' }] }, { error: 'not found' }])(
    'should not equate provider errors to reference freedom',
    async (body) => {
      const { client } = provider(({ url }) =>
        url.pathname.endsWith('/login') ? login() : json(body),
      );
      await expect(client.invoices.get(ref)).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' });
    },
  );
  it.each([
    { errors: [] },
    { errors: [{ title: 'x' }], status: 'new-status' },
    { errors: [{ title: 'x' }], id: 'invoice' },
    { error: 42 },
    { status: 'surprise' },
    {},
  ])('should fail closed for malformed or unexplained evidence %j', async (body) => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(body),
    );
    await expect(client.invoices.getStatus(ref)).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it('should issue once with caller-owned reference and exact unquoted decimal tokens', async () => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(observation()),
    );
    const value = {
      ...invoice(),
      net_total_amount: decimal('9007199254740993.12'),
      currency: 'EUR',
      exchange_rate: decimal('1'),
      branch: 'branch',
      notes: 'Synthetic',
      customer_emails: [],
      email_locale: 'en' as const,
      generate_pdf: true,
      mark_as_paid: true,
      correlated_invoices: [],
    };
    expect((await client.invoices.create(value)).kind).toBe('observed');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init.body).toContain('"net_total_amount":9007199254740993.12');
    expect(calls[1]?.init.body).toContain('"external_id":"reference-one"');
    expect(value.net_total_amount).toBe('9007199254740993.12');
  });
  it.each([
    'external_id is already used by another invoice',
    'Υπάρχει ήδη',
    'completely changed wording',
  ])('should leave reference freedom unknown for every rejection title', async (title) => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json({ status: 'Invoice Errors', errors: [{ title }] }),
    );
    expect(await client.invoices.create(invoice())).toEqual({
      kind: 'rejected',
      errorCount: 1,
      rejectionSource: 'invoice-errors',
      referenceState: 'unknown',
    });
  });
  it('should preserve pending without inferring issuance', async () => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json({ status: 'pending', invoice_id: 'pending-one' }),
    );
    expect(await client.invoices.create(invoice())).toEqual({
      kind: 'pending',
      invoiceId: 'pending-one',
      referenceState: 'unknown',
    });
  });
  it.each([
    { status: 'pending', id: 'wrong', invoice_id: 'x' },
    { status: 'future-success' },
    { errors: [{ title: 'no' }], invoice_id: 'x' },
    observation({ external_id: 'wrong' }),
  ])('should preserve unknown effect for invalid post-create evidence', async (body) => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(body),
    );
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
      operation: 'create',
    });
    expect(calls).toHaveLength(2);
  });
  it('should reject unknown create fields, currency gaps and decimal excess before auth', async () => {
    const { client, calls } = provider(() => login());
    // @ts-expect-error Unsupported fields must also fail at runtime.
    await expect(client.invoices.create({ ...invoice(), draft: true })).rejects.toThrow(WrappError);
    await expect(client.invoices.create({ ...invoice(), currency: 'EUR' })).rejects.toThrow(
      WrappError,
    );
    // @ts-expect-error Unvalidated amounts are not part of the public API.
    await expect(client.invoices.create({ ...invoice(), total_amount: '1.234' })).rejects.toThrow(
      WrappError,
    );
    const line = invoice().invoice_lines[0];
    if (!line) throw new Error('fixture');
    await expect(
      client.invoices.create({ ...invoice(), invoice_lines: [{ ...line, vat_rate: 0 }] }),
    ).rejects.toThrow(WrappError);
    await expect(
      client.invoices.create({ ...invoice(), invoice_lines: [line, line] }),
    ).rejects.toThrow(WrappError);
    expect(calls).toHaveLength(0);
  });
  it('should reject an oversized outbound body before auth', async () => {
    const { client, calls } = provider(() => login(), { maxRequestBytes: 10 });
    await expect(client.invoices.create(invoice())).rejects.toThrow(WrappError);
    expect(calls).toHaveLength(0);
  });
  it('should require documented B2B identity fields and allow minimal retail service counterparts', async () => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(observation()),
    );
    await expect(
      client.invoices.create({ ...invoice(), counterpart: { name: 'Only name' } }),
    ).rejects.toThrow(WrappError);
    expect(
      (
        await client.invoices.create({
          ...invoice(),
          invoice_type_code: '11.2',
          counterpart: { name: 'Synthetic Retail' },
        })
      ).kind,
    ).toBe('observed');
  });
  it('should treat PDF as an effectful GET, never automatically download', async () => {
    let body: unknown = { status: 'provider prose with unknown meaning' };
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(body),
    );
    expect(await client.invoices.requestPdf('invoice-one')).toEqual({
      kind: 'acknowledged',
      status: 'unknown',
    });
    body = { download_url: 'https://example.invalid/signed' };
    expect(await client.invoices.requestPdf('invoice-one')).toEqual({
      kind: 'available',
      downloadUrl: 'https://example.invalid/signed',
    });
    body = { errors: [{ title: 'Not issued' }] };
    expect(await client.invoices.requestPdf('invoice-one')).toEqual({
      kind: 'rejected',
      errorCount: 1,
      rejectionSource: 'unknown',
    });
    expect(calls).toHaveLength(4);
    expect(calls[1]?.init.method).toBe('GET');
  });
  it.each([
    { download_url: 'http://evil.invalid/' },
    { download_url: 'https://example.invalid/', status: 'contradiction' },
    {},
  ])('should reject unsafe or conflicting PDF evidence', async (body) => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(body),
    );
    await expect(client.invoices.requestPdf('invoice-one')).rejects.toMatchObject({
      effect: 'unknown',
      code: 'PROTOCOL_ERROR',
    });
  });
  it('should validate list dates and return matching page metadata', async () => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json({ invoices: [details()], total_count: 1, total_pages: 1, current_page: 1 }),
    );
    expect(
      (
        await client.invoices.list({
          start_date: calendarDate('2026-01-01'),
          end_date: calendarDate('2026-12-31'),
        })
      ).total_count,
    ).toBe(1);
    expect(calls[1]?.url.searchParams.get('start_date')).toBe('2026-01-01');
    await expect(
      client.invoices.list({
        start_date: calendarDate('2026-12-31'),
        end_date: calendarDate('2026-01-01'),
      }),
    ).rejects.toThrow(WrappError);
  });
  it('should iterate lazily with no prefetch and stop explicitly at maxPages', async () => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json({
            invoices: [details({ id: 'invoice-' + (url.searchParams.get('page') ?? '') })],
            total_count: 100,
            total_pages: 2,
            current_page: Number(url.searchParams.get('page')),
          }),
    );
    const iterator = client.invoices.iterate({}, { maxPages: 1 })[Symbol.asyncIterator]();
    expect(calls).toHaveLength(0);
    expect((await iterator.next()).value).toMatchObject({ id: 'invoice-1' });
    expect(calls).toHaveLength(2);
    await expect(iterator.next()).rejects.toMatchObject({ code: 'PAGINATION_LIMIT' });
    const all = [];
    for await (const value of client.invoices.iterate({}, { maxPages: 2 })) all.push(value.id);
    expect(all).toEqual(['invoice-1', 'invoice-2']);
  });
  it('should reject repeated pages without silently deduplicating', async () => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json({
            invoices: [details()],
            total_count: 100,
            total_pages: 2,
            current_page: Number(url.searchParams.get('page')),
          }),
    );
    const iter = client.invoices.iterate({}, { maxPages: 2 })[Symbol.asyncIterator]();
    await iter.next();
    await expect(iter.next()).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it.each([
    { invoices: [], total_count: 0, total_pages: 0, current_page: 2 },
    { invoices: [details()], total_count: 0, total_pages: 0, current_page: 1 },
    { invoices: [], total_count: 1, total_pages: 1, current_page: 1 },
  ])('should reject inconsistent pages', async (page) => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(page),
    );
    await expect(client.invoices.list()).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it('should accept an empty inventory and abort between yielded records', async () => {
    let empty = true;
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json(
            empty
              ? { invoices: [], total_count: 0, total_pages: 0, current_page: 1 }
              : {
                  invoices: [details(), details({ id: 'invoice-two' })],
                  total_count: 2,
                  total_pages: 1,
                  current_page: 1,
                },
          ),
    );
    const records = [];
    for await (const record of client.invoices.iterate({}, { maxPages: 1 })) records.push(record);
    expect(records).toEqual([]);
    empty = false;
    const abort = new AbortController();
    const iter = client.invoices
      .iterate({}, { maxPages: 1, signal: abort.signal, timeoutMs: 500 })
      [Symbol.asyncIterator]();
    await iter.next();
    abort.abort();
    await expect(iter.next()).rejects.toMatchObject({ code: 'ABORTED' });
  });
  it('should require explicit valid configuration and never call external hosts in default tests', async () => {
    // @ts-expect-error Environments must be explicit and known.
    expect(() => new WrappClient({ environment: 'other', credentials })).toThrow(WrappError);
    for (const url of [
      'https://evil.invalid/api/v1',
      'http://127.0.0.1/api/v1?key=x',
      'http://user@localhost/api/v1',
      'not-url',
    ]) {
      expect(
        () =>
          new WrappClient({ environment: 'staging', credentials, advanced: { testBaseUrl: url } }),
      ).toThrow(WrappError);
    }
    const client = new WrappClient({ environment: 'production', credentials });
    await expect(client.tenant.get()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(JSON.stringify(client)).not.toContain(credentials.apiKey);
  });
  it.each([
    'http://evil.invalid/api/v1',
    'https://127.0.0.1/api/v1',
    'http://127.0.0.1/other',
    'http://127.0.0.1/api/v1?',
    'http://127.0.0.1/api/v1#',
    'http://127.0.0.1/api/v1#x',
    'http://:pw@127.0.0.1/api/v1',
  ])('should reject a test origin violating exactly one loopback rule: %s', (url) => {
    expect(
      () =>
        new WrappClient({ environment: 'staging', credentials, advanced: { testBaseUrl: url } }),
    ).toThrow(WrappError);
  });
  it('should accept the IPv6 loopback origin', async () => {
    const client = new WrappClient({
      environment: 'staging',
      credentials,
      advanced: { testBaseUrl: 'http://[::1]:9/api/v1' },
    });
    await expect(client.tenant.get()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  it('should accept an empty collection reported as one empty page', async () => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json({ invoices: [], total_count: 0, total_pages: 1, current_page: 1 }),
    );
    expect((await client.invoices.list()).total_count).toBe(0);
  });
  it('should treat a case-variant provider id as protocol error, not identity evidence', async () => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json(observation({ id: 'INVOICE-ONE', external_id: null })),
    );
    await expect(
      client.invoices.getStatus({ kind: 'invoiceId', value: 'invoice-one' }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it('should surface the provider validation family as evidence, never semantics', async () => {
    let body: unknown = { status: 'myDATA Errors', errors: [{ title: 'x' }] };
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(body),
    );
    expect(await client.invoices.create(invoice())).toMatchObject({
      kind: 'rejected',
      rejectionSource: 'mydata-errors',
    });
    body = { error: 'prose failure' };
    expect(await client.invoices.create(invoice())).toMatchObject({
      kind: 'rejected',
      errorCount: 1,
      rejectionSource: 'unknown',
    });
  });
  it.each([
    { error: 'x', download_url: 'https://example.invalid/pdf' },
    { error: 'x', invoice_id: 'pending-one' },
    { error: 'x', status: 'surprise' },
  ])('should fail closed on contradictory singular error evidence %j', async (body) => {
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(body),
    );
    await expect(client.invoices.requestPdf('invoice-one')).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
  });
  it('should dispatch each concurrent create exactly once over one shared login', async () => {
    const gate = deferred<Response>();
    const body = (init: RequestInit) => (typeof init.body === 'string' ? init.body : '');
    const { client, calls } = provider(({ url, init }) =>
      url.pathname.endsWith('/login')
        ? gate.promise
        : json(
            observation({
              external_id: (JSON.parse(body(init)) as { external_id: string }).external_id,
            }),
          ),
    );
    const first = client.invoices.create(invoice());
    const second = client.invoices.create({ ...invoice(), external_id: 'reference-two' });
    await ticks();
    gate.resolve(login());
    expect((await first).kind).toBe('observed');
    expect((await second).kind).toBe('observed');
    expect(calls.filter((c) => c.url.pathname.endsWith('/login'))).toHaveLength(1);
    const bodies = calls
      .filter((c) => c.url.pathname.endsWith('/invoices'))
      .map((c) => body(c.init));
    expect(bodies).toHaveLength(2);
    expect(bodies.join()).toContain('reference-two');
  });
  it('should accept high-precision rates and quantities while keeping totals at two decimals', async () => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login') ? login() : json(observation()),
    );
    const line = invoice().invoice_lines[0];
    if (!line) throw new Error('fixture');
    const outcome = await client.invoices.create({
      ...invoice(),
      currency: 'USD',
      exchange_rate: decimal('1.0834'),
      invoice_lines: [{ ...line, quantity: decimal('2.505'), unit_price: decimal('3.9920') }],
    });
    expect(outcome.kind).toBe('observed');
    expect(calls[1]?.init.body).toContain('"exchange_rate":1.0834');
    await expect(
      client.invoices.create({ ...invoice(), total_amount: decimal('1.234') }),
    ).rejects.toThrow(WrappError);
    expect(calls).toHaveLength(2);
  });
  it('should bound diagnostics when trusted seams throw raw errors', async () => {
    const { client, calls } = provider(() => login(), {
      advanced: {
        now: () => {
          throw new Error('secret-clock');
        },
      },
    });
    const failure = await client.tenant.get().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: 'WrappError',
      code: 'PROTOCOL_ERROR',
      effect: 'not-sent',
    });
    expect(JSON.stringify(failure)).not.toContain('secret-clock');
    expect(calls).toHaveLength(0);
  });
  it('should reject prototype-injecting JSON rather than honor inherited evidence', async () => {
    const raw = '{"__proto__":{"download_url":"https://example.invalid/forged"}}';
    const { client } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : new Response(raw, { headers: { 'content-type': 'application/json' } }),
    );
    await expect(client.invoices.requestPdf('invoice-one')).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
  });
  it('should decode the staging-observed shape variants (2026-09-22 evidence)', async () => {
    // Real staging deviates from the documented examples: branch code as a JSON number,
    // ISO "T"/colon-offset timestamps, vat: "" for VAT-less counterparts, and a line
    // quantity serialized as a JSON string beside numeric amounts.
    const listBody = JSON.stringify({
      invoices: [
        {
          ...details({ issued_at: '2026-09-18T14:28:41+03:00', external_id: null }),
          counterpart: { name: 'Ιδιώτης πελάτης', vat: '', city: 'ΘΕΣΣΑΛΟΝΙΚΗ' },
        },
      ],
      total_count: 1,
      total_pages: 1,
      current_page: 1,
    }).replace('"quantity":1', '"quantity":"1.0"');
    const { client } = provider(({ url }) => {
      if (url.pathname.endsWith('/login')) return login();
      if (url.pathname.endsWith('/branches'))
        return json([{ id: '4ddce104-7b53-4aed-a08c-5bf15229cfee', name: 'Έδρα', code: 0 }]);
      return new Response(listBody, { headers: { 'content-type': 'application/json' } });
    });
    expect(await client.branches.list()).toEqual([
      { id: '4ddce104-7b53-4aed-a08c-5bf15229cfee', name: 'Έδρα', code: '0' },
    ]);
    const page = await client.invoices.list();
    expect(page.invoices[0]?.issued_at).toBe('2026-09-18T14:28:41+03:00');
    expect(page.invoices[0]?.invoice_lines[0]?.quantity).toBe('1.0');
    expect(page.invoices[0]?.counterpart.vat).toBe('');
  });
  it('should carry date filters onto every iterated page', async () => {
    const { client, calls } = provider(({ url }) =>
      url.pathname.endsWith('/login')
        ? login()
        : json({
            invoices: [details({ id: 'invoice-' + (url.searchParams.get('page') ?? '') })],
            total_count: 100,
            total_pages: 2,
            current_page: Number(url.searchParams.get('page')),
          }),
    );
    for await (const record of client.invoices.iterate(
      { start_date: calendarDate('2026-01-01') },
      { maxPages: 2 },
    )) {
      expect(record.id).toContain('invoice-');
    }
    const pages = calls.filter((c) => c.url.pathname.endsWith('/find_all_invoices'));
    expect(pages).toHaveLength(2);
    for (const page of pages) expect(page.url.searchParams.get('start_date')).toBe('2026-01-01');
  });
});
