import { describe, expect, it } from 'vitest';
import { decimal, WrappError } from '../../src/index.js';
import type { CreateInvoiceInput, RequestOptions, WrappClient } from '../../src/index.js';
import { invoice, json, login, observation, provider } from '../fixtures/provider.js';
import type { RecordedRequest } from '../fixtures/provider.js';

// Operations whose wire contract was established by observing the provider, where its
// reference is ambiguous: the billing-book number update, the PDF locale, the catering
// transfer. Bodies are synthetic values in the observed shapes; methods and paths are
// written literally and never read from the SDK's operation registry.
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
const badIds = ['', '../x', 'a/b', 'a b', 'a?b', 'a#b', '..', 'x'.repeat(257), 42, null];
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
    timeoutMs: 40,
  },
  {
    label: 'a malformed success body',
    respond: () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    code: 'PROTOCOL_ERROR',
  },
];
const refusal = { errors: [{ title: 'Synthetic refusal' }] };
const rejected = { kind: 'rejected', errorCount: 1, rejectionSource: 'unknown' };

describe('billingBooks.updateNumber', () => {
  const book = {
    id: 'book-one',
    name: 'Synthetic book',
    series: 'ΣΒ',
    invoice_type_code: '2.1',
    number: 123,
    branches: [],
  };
  const update = (client: WrappClient, id: unknown, input: unknown, options?: RequestOptions) =>
    client.billingBooks.updateNumber(id as string, input as never, options);
  it('should send exactly one authenticated PUT with the number alone in its JSON body', async () => {
    const { client, calls } = answering(() => json(book));
    await update(client, 'book-one', { number: 123 });
    const call = only(calls);
    expect(call.init.method).toBe('PUT');
    expect(call.url.href).toBe('https://staging.wrapp.ai/api/v1/billing_books/book-one');
    expect(call.init.body).toBe('{"number":123}');
    expect(call.init.redirect).toBe('error');
    expect(headers(call.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    });
  });
  it.each([0, 1, 123, Number.MAX_SAFE_INTEGER])(
    'should send the number %d as an integer token',
    async (number) => {
      const { client, calls } = answering(() => json({ ...book, number }));
      await update(client, 'book-one', { number });
      expect(only(calls).init.body).toBe('{"number":' + String(number) + '}');
    },
  );
  it.each([
    {},
    { number: '123' },
    { number: -1 },
    { number: 1.5 },
    { number: 2 ** 53 },
    { number: null },
    { number: 123, name: 'Renamed' },
    { name: 'Renamed' },
    null,
    123,
  ])('should refuse the input %j before any request', async (input) => {
    const { client, calls } = answering(() => json(book));
    expect(await failure(update(client, 'book-one', input))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'billingBookUpdateNumber',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it.each(badIds)('should refuse the book id %j before any request', async (id) => {
    const { client, calls } = answering(() => json(book));
    expect(await failure(update(client, id, { number: 1 }))).toMatchObject({
      code: 'INVALID_INPUT',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it('should percent-encode the book id once', async () => {
    const { client, calls } = answering(() => json({ ...book, id: 'a+b&c=d' }));
    await update(client, 'a+b&c=d', { number: 1 });
    expect(only(calls).url.pathname).toBe('/api/v1/billing_books/a%2Bb%26c%3Dd');
  });
  it('should return the frozen book with its number as exact text, dropping additive fields', async () => {
    const { client } = answering(() => json(book));
    const outcome = await update(client, 'book-one', { number: 123 });
    expect(outcome).toEqual({
      kind: 'observed',
      billingBook: {
        id: 'book-one',
        name: 'Synthetic book',
        series: 'ΣΒ',
        invoice_type_code: '2.1',
        number: '123',
      },
    });
    expect(Object.isFrozen(outcome)).toBe(true);
  });
  it('should return an errors list as a rejected result', async () => {
    const { client, calls } = answering(() => json(refusal));
    expect(await update(client, 'book-one', { number: 123 })).toEqual(rejected);
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each([
    ['a book with another id', { ...book, id: 'book-two' }],
    ['an errors list beside a book id', { ...refusal, id: 'book-one' }],
    ['a book with a status', { ...book, status: 'updated' }],
    ['a book without an id', { name: 'Synthetic book' }],
    ['an empty object', {}],
    ['null', null],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client } = answering(() => json(body));
    expect(await failure(update(client, 'book-one', { number: 123 }))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(update(client, 'book-one', { number: 123 }));
      expect(error).toMatchObject({
        code,
        operation: 'billingBookUpdateNumber',
        effect: 'unknown',
      });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
  it('should expose list, create and updateNumber and nothing else', () => {
    const { client } = provider(() => login(token));
    expect(Object.keys(client.billingBooks).sort()).toEqual(['create', 'list', 'updateNumber']);
  });
});

describe('invoices.requestPdf locale', () => {
  const started = { status: 'PDF generation started, webhook will be send upon completion' };
  it.each(['el', 'en'] as const)(
    'should send the locale %s as a query parameter',
    async (locale) => {
      const { client, calls } = answering(() => json(started));
      await client.invoices.requestPdf('invoice-one', { locale });
      const call = only(calls);
      expect(call.init.method).toBe('GET');
      expect(call.url.href).toBe(
        'https://staging.wrapp.ai/api/v1/invoices/invoice-one/generate_pdf?locale=' + locale,
      );
      expect(call.init.body).toBeUndefined();
    },
  );
  it('should send no query at all when no locale is given', async () => {
    const { client, calls } = answering(() => json(started));
    await client.invoices.requestPdf('invoice-one');
    await client.invoices.requestPdf('invoice-one', {});
    await client.invoices.requestPdf('invoice-one', { timeoutMs: 5000 });
    expect(dispatched(calls).map((call) => call.url.href)).toEqual(
      Array.from(
        { length: 3 },
        () => 'https://staging.wrapp.ai/api/v1/invoices/invoice-one/generate_pdf',
      ),
    );
  });
  it('should keep the common request options working beside a locale', async () => {
    const { client, calls } = answering(() =>
      json({ download_url: 'https://example.invalid/pdf' }),
    );
    const outcome = await client.invoices.requestPdf('invoice-one', {
      locale: 'en',
      timeoutMs: 5000,
      signal: new AbortController().signal,
      diagnostics: 'provider-issues',
    });
    expect(outcome).toEqual({ kind: 'available', downloadUrl: 'https://example.invalid/pdf' });
    expect(only(calls).url.search).toBe('?locale=en');
  });
  it.each(['xx', 'EN', '', 5, null])(
    'should refuse the locale %j before any request',
    async (locale) => {
      const { client, calls } = answering(() => json(started));
      expect(
        await failure(client.invoices.requestPdf('invoice-one', { locale } as never)),
      ).toMatchObject({ code: 'INVALID_INPUT', operation: 'pdf', effect: 'not-sent' });
      expect(calls).toHaveLength(0);
    },
  );
  it.each([null, 5, 'en', ['en'], true])(
    'should refuse options that are not an options object (%j) before any request',
    async (options) => {
      const { client, calls } = answering(() => json(started));
      expect(
        await failure(client.invoices.requestPdf('invoice-one', options as never)),
      ).toMatchObject({ code: 'INVALID_INPUT', operation: 'pdf', effect: 'not-sent' });
      expect(calls).toHaveLength(0);
    },
  );
  it('should treat an explicit undefined locale or options as no locale', async () => {
    const { client, calls } = answering(() => json(started));
    await client.invoices.requestPdf('invoice-one', undefined);
    await client.invoices.requestPdf('invoice-one', { locale: undefined } as never);
    expect(dispatched(calls).map((call) => call.url.search)).toEqual(['', '']);
  });
  it('should still refuse unknown options, and a locale on the thermal PDF request', async () => {
    const { client, calls } = answering(() => json(started));
    for (const run of [
      client.invoices.requestPdf('invoice-one', { locale: 'en', unknown: true } as never),
      client.invoices.requestThermalPdf('invoice-one', { locale: 'en' } as never),
    ])
      expect(await failure(run)).toMatchObject({ code: 'INVALID_INPUT', effect: 'not-sent' });
    expect(calls).toHaveLength(0);
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label, with a locale',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(client.invoices.requestPdf('invoice-one', { locale: 'en' }));
      expect(error).toMatchObject({ code, operation: 'pdf', effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
  it('should keep a status answer an acknowledgement of unknown meaning, with a locale', async () => {
    const { client, calls } = answering(() => json(started));
    expect(await client.invoices.requestPdf('invoice-one', { locale: 'el' })).toEqual({
      kind: 'acknowledged',
      status: 'unknown',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
  it('should return a refusal of the parameters as a rejected result', async () => {
    const { client } = answering(() =>
      json({ errors: [{ title: 'Please check your parameters' }] }),
    );
    expect(await client.invoices.requestPdf('invoice-one', { locale: 'en' })).toEqual(rejected);
  });
});

describe('quantity precision', () => {
  function body(calls: readonly RecordedRequest[]): string {
    const sent = calls.at(-1)?.init.body;
    if (typeof sent !== 'string') throw new Error('No JSON body was dispatched');
    return sent;
  }
  function withLine(patch: Record<string, unknown>): CreateInvoiceInput {
    const base = invoice();
    const [line] = base.invoice_lines;
    const patched: unknown = { ...base, invoice_lines: [{ ...line, ...patch }] };
    return patched as CreateInvoiceInput;
  }
  const issuing = () =>
    provider(({ url }) => (url.pathname.endsWith('/login') ? login() : json(observation())));
  it.each(['1', '1.5', '1.25', '1.234', '0.000000000001'])(
    'should send the quantity %s as its exact token: more than two fraction digits are accepted',
    async (quantity) => {
      const { client, calls } = issuing();
      await client.invoices.create(withLine({ quantity: decimal(quantity) }));
      expect(body(calls)).toContain('"quantity":' + quantity + ',');
    },
  );
  it('should keep the three precision rules apart: quantity and unit price wide, exchange rate two digits', async () => {
    const { client, calls } = issuing();
    await client.invoices.create({
      ...withLine({ quantity: decimal('1.234'), unit_price: decimal('10.005') }),
      currency: 'USD',
      exchange_rate: decimal('1.08'),
    });
    expect(body(calls)).toContain('"quantity":1.234,');
    expect(body(calls)).toContain('"unit_price":10.005,');
    await expect(
      client.invoices.create({ ...invoice(), currency: 'USD', exchange_rate: decimal('1.083') }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      client.invoices.create(
        withLine({ quantity: decimal('1'), net_total_price: decimal('10.005') }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it.each([1.234, '1,234', '-1', '1e3', ''])('should refuse the quantity %j', async (quantity) => {
    const { client, calls } = issuing();
    await expect(client.invoices.create(withLine({ quantity }))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('cateringTables.transfer', () => {
  const table = {
    id: 'table-two',
    status: 'open',
    name: 'table2',
    total: 4.5,
    invoices: ['invoice-one'],
    error_message: null,
  };
  const input = {
    current_table: 'table-one',
    target_table: 'table-two',
    marks: ['400000000000001', '400000000000002'],
  };
  const transfer = (client: WrappClient, value: unknown, options?: RequestOptions) =>
    client.cateringTables.transfer(value as never, options);
  it('should send exactly one authenticated GET with the tables and marks as query parameters and no body', async () => {
    const { client, calls } = answering(() => json(table));
    await transfer(client, input);
    const call = only(calls);
    expect(call.init.method).toBe('GET');
    expect(call.url.origin + call.url.pathname).toBe(
      'https://staging.wrapp.ai/api/v1/catering_tables/transfer',
    );
    expect(call.url.search).toBe(
      '?current_table=table-one&target_table=table-two&marks%5B%5D=400000000000001&marks%5B%5D=400000000000002',
    );
    expect(call.init.body).toBeUndefined();
    expect(headers(call.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    });
  });
  it('should send no marks parameter when marks are omitted', async () => {
    const { client, calls } = answering(() => json(table));
    await transfer(client, { current_table: 'table-one', target_table: 'table-two' });
    expect(only(calls).url.search).toBe('?current_table=table-one&target_table=table-two');
  });
  it('should encode each value once', async () => {
    const { client, calls } = answering(() => json({ ...table, id: 'e_f' }));
    await transfer(client, {
      current_table: 'a+b&c=d',
      target_table: 'e f'.replace(' ', '_'),
      marks: ['1&2'],
    });
    expect(only(calls).url.search).toBe(
      '?current_table=a%2Bb%26c%3Dd&target_table=e_f&marks%5B%5D=1%262',
    );
  });
  it.each([
    [
      'an empty marks list, which the wire cannot tell from an omitted one',
      { ...input, marks: [] },
    ],
    ['a marks value that is not a list', { ...input, marks: '400000000000001' }],
    ['an empty mark', { ...input, marks: [''] }],
    ['a numeric mark', { ...input, marks: [400000000000001] }],
    ['more than 100 marks', { ...input, marks: Array.from({ length: 101 }, () => '1') }],
    ['no current table', { target_table: 'table-two' }],
    ['no target table', { current_table: 'table-one' }],
    ['an unsafe table id', { ...input, current_table: 'a/b' }],
    ['an unknown key', { ...input, force: true }],
    ['null', null],
  ])('should refuse %s before any request', async (_label, value) => {
    const { client, calls } = answering(() => json(table));
    expect(await failure(transfer(client, value))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'cateringTableTransfer',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it('should return the target table, which is the one the provider answers with', async () => {
    const { client } = answering(() => json(table));
    const outcome = await transfer(client, input);
    expect(outcome).toEqual({ kind: 'observed', table: { ...table, total: '4.5' } });
    expect(Object.isFrozen(outcome)).toBe(true);
  });
  it.each([
    ['the current table', 'table-one'],
    ['a third table', 'table-three'],
  ])(
    'should treat an answer for %s as a protocol error with unknown effect',
    async (_label, id) => {
      const { client, calls } = answering(() => json({ ...table, id }));
      expect(await failure(transfer(client, input))).toMatchObject({
        code: 'PROTOCOL_ERROR',
        operation: 'cateringTableTransfer',
        effect: 'unknown',
      });
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
  it('should return an errors list as a rejected result and dispatch nothing else', async () => {
    const { client, calls } = answering(() => json(refusal));
    expect(await transfer(client, input)).toEqual(rejected);
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/api/v1/login',
      '/api/v1/catering_tables/transfer',
    ]);
  });
  it('should keep the transfer route out of reach of the table read', async () => {
    const { client, calls } = answering(() => json(table));
    expect(await failure(client.cateringTables.get('transfer'))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'cateringTable',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label: the GET changes state',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(transfer(client, input));
      expect(error).toMatchObject({ code, operation: 'cateringTableTransfer', effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
});
