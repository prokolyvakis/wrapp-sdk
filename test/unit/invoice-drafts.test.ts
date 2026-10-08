import { describe, expect, it } from 'vitest';
import { WrappError } from '../../src/index.js';
import type { RequestOptions, WrappClient } from '../../src/index.js';
import {
  enrichedPending,
  fullDetails,
  fullObservation,
  invoice,
  json,
  login,
  observation,
  pending,
  provider,
} from '../fixtures/provider.js';
import type { RecordedRequest } from '../fixtures/provider.js';

// Draft invoices. The provider's reference documents no answer for saving, issuing or listing
// a draft; these bodies are synthetic values in the shapes the provider was observed to
// return. Methods and paths are written literally, never read from the operation registry.
const token = 'synthetic.jwt.token';
function answering(respond: (url: URL) => Response | Promise<Response>, timeoutMs?: number) {
  return provider(
    ({ url }) => (url.pathname.endsWith('/login') ? login(token) : respond(url)),
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
const saved = { status: 'successfully saved as draft', invoice_id: 'draft-one' };
// A draft as the listing returns it: the full-detail shape with nothing that an issued
// document carries.
const draftRow = (overrides: Record<string, unknown> = {}) =>
  fullDetails({
    id: 'draft-one',
    code: '',
    my_data_mark: '',
    my_data_uid: '',
    authentication_code: '',
    ...overrides,
  });
const page = (rows: readonly unknown[], meta: Record<string, unknown> = {}) => ({
  invoices: rows,
  total_count: rows.length,
  total_pages: rows.length === 0 ? 0 : 1,
  current_page: 1,
  ...meta,
});

describe('invoices.drafts.create', () => {
  const create = (client: WrappClient, input: unknown, options?: RequestOptions) =>
    client.invoices.drafts.create(input as never, options);
  it('should send exactly one authenticated POST to the create route', async () => {
    const { client, calls } = answering(() => json(saved));
    await create(client, invoice());
    const call = only(calls);
    expect(call.init.method).toBe('POST');
    expect(call.url.href).toBe('https://staging.wrapp.ai/api/v1/invoices');
    expect(call.init.redirect).toBe('error');
    expect(headers(call.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    });
  });
  it('should send the body an ordinary create sends, with draft true added and nothing else', async () => {
    const drafted = answering(() => json(saved));
    await create(drafted.client, invoice());
    const issued = answering(() => json(observation()));
    await issued.client.invoices.create(invoice());
    const ordinary = only(issued.calls).init.body as string;
    expect(ordinary).not.toContain('draft');
    expect(only(drafted.calls).init.body).toBe(ordinary.slice(0, -1) + ',"draft":true}');
  });
  it.each([
    ['draft: true, which the method adds itself', { draft: true }],
    ['draft: false', { draft: false }],
    ['generate_pdf: true', { generate_pdf: true }],
    ['generate_pdf: false', { generate_pdf: false }],
    ['mark_as_paid: true', { mark_as_paid: true }],
    ['mark_as_paid: false', { mark_as_paid: false }],
    ['an unknown key', { status: 'draft' }],
    ['no lines', { invoice_lines: [] }],
    ['no billing book', { billing_book_id: undefined }],
  ])('should refuse an input with %s before any request', async (_label, patch) => {
    const { client, calls } = answering(() => json(saved));
    expect(await failure(create(client, { ...invoice(), ...patch }))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'createDraft',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it.each([null, undefined, 'draft', [], 5])(
    'should refuse the input %j before any request',
    async (input) => {
      const { client, calls } = answering(() => json(saved));
      expect(await failure(create(client, input))).toMatchObject({
        code: 'INVALID_INPUT',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it('should treat an explicit undefined for a key it does not take as omitted', async () => {
    const { client, calls } = answering(() => json(saved));
    await create(client, { ...invoice(), generate_pdf: undefined, mark_as_paid: undefined });
    const body = only(calls).init.body as string;
    expect(body).not.toContain('generate_pdf');
    expect(body).not.toContain('mark_as_paid');
    expect(body.endsWith(',"draft":true}')).toBe(true);
  });
  it('should return the saved draft with the provider id and nothing an issued invoice has', async () => {
    const { client } = answering(() => json({ ...saved, extra: 'additive' }));
    const outcome = await create(client, invoice());
    expect(outcome).toEqual({ kind: 'saved', invoiceId: 'draft-one' });
    expect(Object.isFrozen(outcome)).toBe(true);
  });
  it.each([
    ['an errors list', refusal, rejected],
    [
      'a validation envelope',
      { status: 'Invoice Errors', errors: [{ title: 'a' }, { title: 'b' }] },
      { kind: 'rejected', errorCount: 2, rejectionSource: 'invoice-errors' },
    ],
    [
      'a tax-authority envelope',
      { status: 'myData Errors', errors: [{ title: 'a' }] },
      { kind: 'rejected', errorCount: 1, rejectionSource: 'mydata-errors' },
    ],
  ])('should return %s as a rejected result', async (_label, body, expected) => {
    const { client, calls } = answering(() => json(body));
    const outcome = await create(client, invoice());
    expect(outcome).toEqual(expected);
    expect(outcome).not.toHaveProperty('invoiceId');
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each([
    ['a pending transmission, which is not a saved draft', pending({ invoice_id: 'draft-one' })],
    ['an issued invoice', observation()],
    ['an issued invoice without a mark: a missing mark is not a saved draft', enrichedPending()],
    ['the saved status beside issued evidence', { ...observation(), ...saved }],
    ['the saved status without an invoice id', { status: saved.status }],
    ['an invoice id without a status', { invoice_id: 'draft-one' }],
    ['another status text', { status: 'saved', invoice_id: 'draft-one' }],
    ['the status in another case', { status: 'Successfully saved as draft', invoice_id: 'd' }],
    ['the status of a draft lookup', { status: 'draft', invoice_id: 'draft-one' }],
    ['an invoice id that is not text', { status: saved.status, invoice_id: 7 }],
    ['an errors list beside the saved status', { ...saved, errors: [] }],
    ['an empty object', {}],
    ['null', null],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(create(client, invoice()))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'createDraft',
      effect: 'unknown',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(create(client, invoice()));
      expect(error).toMatchObject({ code, operation: 'createDraft', effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
});

describe('ordinary create and drafts', () => {
  it('should still send generate_pdf and mark_as_paid on an ordinary create', async () => {
    const { client, calls } = answering(() => json(observation()));
    await client.invoices.create({ ...invoice(), generate_pdf: true, mark_as_paid: false });
    const body = only(calls).init.body as string;
    expect(body).toContain('"generate_pdf":true');
    expect(body).toContain('"mark_as_paid":false');
    expect(body).not.toContain('draft');
  });
  it.each([true, false])(
    'should refuse a caller draft key (%j) before any request',
    async (draft) => {
      const { client, calls } = answering(() => json(observation()));
      expect(await failure(client.invoices.create({ ...invoice(), draft } as never))).toMatchObject(
        { code: 'INVALID_INPUT', operation: 'create', effect: 'not-sent' },
      );
      expect(calls).toHaveLength(0);
    },
  );
  it.each([
    ['the saved-draft answer', saved],
    ['the status of a draft lookup', { status: 'draft' }],
  ])('should never report %s as an outcome of an ordinary create', async (_label, body) => {
    const { client } = answering(() => json(body));
    expect(await failure(client.invoices.create(invoice()))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'create',
      effect: 'unknown',
    });
  });
});

describe('invoices.getStatus on a draft', () => {
  it.each([
    ['its provider id', { kind: 'invoiceId', value: 'draft-one' }],
    ['its external reference', { kind: 'externalId', value: 'reference-one' }],
  ] as const)('should report a draft looked up by %s', async (_label, reference) => {
    const { client, calls } = answering(() => json({ status: 'draft' }));
    const outcome = await client.invoices.getStatus(reference);
    expect(outcome).toEqual({ kind: 'draft', identity: 'unavailable' });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(only(calls).url.pathname).toBe('/api/v1/invoices/' + reference.value);
  });
  it.each([
    ['a draft status beside a registration mark', { ...observation(), status: 'draft' }],
    ['a draft status beside a null mark', { status: 'draft', my_data_mark: null }],
    ['the status in another case', { status: 'Draft' }],
    ['the saved-draft text', { status: 'successfully saved as draft' }],
    ['a status that is not text', { status: 1 }],
  ])('should treat %s as a protocol error', async (_label, body) => {
    const { client } = answering(() => json(body));
    expect(
      await failure(client.invoices.getStatus({ kind: 'invoiceId', value: 'invoice-one' })),
    ).toMatchObject({ code: 'PROTOCOL_ERROR', operation: 'status', effect: 'not-sent' });
  });
  it('should keep reporting an issued and a pending invoice as before', async () => {
    const issued = answering(() => json(observation()));
    const reference = { kind: 'invoiceId', value: 'invoice-one' } as const;
    expect((await issued.client.invoices.getStatus(reference)).kind).toBe('observed');
    const waiting = answering(() => json(pending()));
    expect(await waiting.client.invoices.getStatus(reference)).toEqual({
      kind: 'pending',
      invoiceId: 'invoice-one',
      referenceState: 'unknown',
      identity: 'exact',
    });
  });
});

describe('invoices.drafts.issue', () => {
  // A bare value addresses the draft by provider id; an object is passed as the reference.
  const issue = (client: WrappClient, id: unknown, input?: unknown, options?: RequestOptions) =>
    client.invoices.drafts.issue(
      (id !== null && typeof id === 'object' ? id : { kind: 'invoiceId', value: id }) as never,
      input as never,
      options,
    );
  const byReference = { kind: 'externalId', value: 'reference-one' } as const;
  // What the provider was observed to answer: the issued observation and one more field.
  const issued = () =>
    fullObservation({ id: 'draft-one', issued_at_datetime: '2026-09-21T10:00:00.000+03:00' });
  const everyField = {
    pos_device_id: 'device-one',
    customer_emails: ['one@example.invalid', 'two@example.invalid'],
    email_locale: 'en',
    email_subject: 'Invoice {{invoice_number}}',
    email_body: 'Line one\n{{invoice_url}}\r\n  Line three ',
    generate_pdf: false,
  };
  it('should send exactly one authenticated POST with no body when no input is given', async () => {
    const { client, calls } = answering(() => json(issued()));
    await issue(client, 'draft-one');
    const call = only(calls);
    expect(call.init.method).toBe('POST');
    expect(call.url.href).toBe('https://staging.wrapp.ai/api/v1/invoices/draft-one/issue_draft');
    expect(call.init.body).toBeUndefined();
    expect(call.init.redirect).toBe('error');
    expect(headers(call.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    });
  });
  it.each([
    ['an empty input', {}],
    ['only undefined fields', { customer_emails: undefined, generate_pdf: undefined }],
  ])('should send no body for %s', async (_label, input) => {
    const { client, calls } = answering(() => json(issued()));
    await issue(client, 'draft-one', input);
    expect(only(calls).init.body).toBeUndefined();
  });
  it('should send the six fields in a JSON body under their exact names, text kept literally', async () => {
    const { client, calls } = answering(() => json(issued()));
    await issue(client, 'draft-one', everyField);
    const call = only(calls);
    expect(JSON.parse(call.init.body as string)).toEqual(everyField);
    expect(call.url.search).toBe('');
    expect(headers(call.init)['content-type']).toBe('application/json');
  });
  it.each(Object.entries(everyField))(
    'should send %s alone when it alone is given',
    async (key, value) => {
      const { client, calls } = answering(() => json(issued()));
      await issue(client, 'draft-one', { [key]: value });
      expect(JSON.parse(only(calls).init.body as string)).toEqual({ [key]: value });
    },
  );
  it('should send generate_pdf true and an empty email list as given', async () => {
    const { client, calls } = answering(() => json(issued()));
    await issue(client, 'draft-one', { generate_pdf: true, customer_emails: [] });
    expect(only(calls).init.body).toBe('{"customer_emails":[],"generate_pdf":true}');
  });
  it.each([
    ['payment_method_type, which issuing does not take', { payment_method_type: 1 }],
    ['a draft key', { draft: false }],
    ['an unknown key', { email: 'one@example.invalid' }],
    ['an email locale outside el and en', { email_locale: 'fr' }],
    ['emails that are not a list', { customer_emails: 'one@example.invalid' }],
    ['an empty email', { customer_emails: [''] }],
    ['more than 100 emails', { customer_emails: Array.from({ length: 101 }, () => 'a@b.invalid') }],
    ['a generate_pdf that is not a boolean', { generate_pdf: 'true' }],
    ['an empty device id', { pos_device_id: '' }],
    ['an unsafe device id', { pos_device_id: 'a/b' }],
    ['a subject that is not text', { email_subject: 5 }],
    ['a null field', { email_body: null }],
    ['null', null],
    ['a list', []],
    ['text', 'issue'],
  ])('should refuse an input with %s before any request', async (_label, input) => {
    const { client, calls } = answering(() => json(issued()));
    expect(await failure(issue(client, 'draft-one', input))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'issueDraft',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it.each(badIds)('should refuse the invoice id %j before any request', async (id) => {
    const { client, calls } = answering(() => json(issued()));
    expect(await failure(issue(client, id))).toMatchObject({
      code: 'INVALID_INPUT',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it.each([null, undefined, 'draft-one', { kind: 'other', value: 'draft-one' }, { value: 'x' }])(
    'should refuse the reference %j before any request',
    async (reference) => {
      const { client, calls } = answering(() => json(issued()));
      expect(await failure(client.invoices.drafts.issue(reference as never))).toMatchObject({
        code: 'INVALID_INPUT',
        operation: 'issueDraft',
        effect: 'not-sent',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it('should address a draft by its external reference on the same route', async () => {
    const { client, calls } = answering(() => json(issued()));
    const outcome = await issue(client, byReference);
    expect(only(calls).url.pathname).toBe('/api/v1/invoices/reference-one/issue_draft');
    expect(outcome).toMatchObject({ kind: 'observed', identity: 'exact' });
  });
  it.each([
    ['in another ASCII case, as a case variant', 'REFERENCE-ONE', 'ascii-case-variant'],
    ['exactly', 'reference-one', 'exact'],
  ])('should report a reference echoed %s', async (_label, echoed, identity) => {
    const { client } = answering(() => json(fullObservation({ id: 'p', external_id: echoed })));
    expect(await issue(client, byReference)).toMatchObject({ kind: 'observed', identity });
  });
  it('should refuse an issued invoice that echoes another reference', async () => {
    const { client } = answering(() => json(fullObservation({ external_id: 'another' })));
    expect(await failure(issue(client, byReference))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'issueDraft',
      effect: 'unknown',
    });
  });
  it('should leave identity unavailable for a pending answer to a reference', async () => {
    const { client } = answering(() => json(pending({ invoice_id: 'provider-id' })));
    expect(await issue(client, byReference)).toEqual({
      kind: 'pending',
      invoiceId: 'provider-id',
      referenceState: 'unknown',
      identity: 'unavailable',
    });
  });
  it('should percent-encode an external reference once', async () => {
    const reference = { kind: 'externalId', value: 'a+b&c=d' } as const;
    const { client, calls } = answering(() =>
      json(fullObservation({ id: 'p', external_id: reference.value })),
    );
    expect(await issue(client, reference)).toMatchObject({ kind: 'observed', identity: 'exact' });
    expect(only(calls).url.pathname).toBe('/api/v1/invoices/a%2Bb%26c%3Dd/issue_draft');
  });
  it.each([
    ['exactly', 'reference-one', 'exact'],
    ['in another ASCII case', 'Reference-One', 'ascii-case-variant'],
  ])(
    'should keep a pending answer with its evidence pending, the reference echoed %s',
    async (_label, echoed, identity) => {
      const { client } = answering(() =>
        json(enrichedPending({ id: 'p', invoice_id: 'p', external_id: echoed })),
      );
      expect(await issue(client, byReference)).toMatchObject({
        kind: 'pending',
        invoiceId: 'p',
        identity,
        invoice: { my_data_mark: null },
      });
    },
  );
  it('should refuse a pending answer whose evidence echoes another reference', async () => {
    const { client } = answering(() =>
      json(enrichedPending({ id: 'p', invoice_id: 'p', external_id: 'another' })),
    );
    expect(await failure(issue(client, byReference))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
  });
  it('should percent-encode the invoice id once', async () => {
    const { client, calls } = answering(() => json(fullObservation({ id: 'a+b&c=d' })));
    await issue(client, 'a+b&c=d');
    expect(only(calls).url.pathname).toBe('/api/v1/invoices/a%2Bb%26c%3Dd/issue_draft');
  });
  it('should return the issued invoice the provider answers with, dropping fields it does not know', async () => {
    const { client } = answering(() => json(issued()));
    const outcome = await issue(client, 'draft-one');
    expect(outcome).toMatchObject({
      kind: 'observed',
      identity: 'exact',
      invoice: {
        id: 'draft-one',
        external_id: 'reference-one',
        my_data_mark: '90071992547409931234',
        series: 'S',
        num: '1',
        issued_at: '2026-09-21',
        transmission_failure: null,
      },
    });
    expect(outcome.kind === 'observed' && 'issued_at_datetime' in outcome.invoice).toBe(false);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(outcome.kind === 'observed' && Object.isFrozen(outcome.invoice)).toBe(true);
  });
  it('should keep an issued answer without a mark as it came, claiming no registration', async () => {
    const { client } = answering(() =>
      json(fullObservation({ id: 'draft-one', my_data_mark: null, transmission_failure: 1 })),
    );
    const outcome = await issue(client, 'draft-one');
    expect(outcome).toMatchObject({
      kind: 'observed',
      invoice: { my_data_mark: null, transmission_failure: '1' },
    });
  });
  it('should return a pending answer as pending, with the reference state unknown', async () => {
    const { client } = answering(() => json(pending({ invoice_id: 'draft-one' })));
    expect(await issue(client, 'draft-one', { pos_device_id: 'device-one' })).toEqual({
      kind: 'pending',
      invoiceId: 'draft-one',
      referenceState: 'unknown',
      identity: 'exact',
    });
  });
  it('should return an errors list as a rejected result', async () => {
    const { client, calls } = answering(() => json(refusal));
    expect(await issue(client, 'draft-one')).toEqual(rejected);
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each([
    ['an issued invoice with another id', fullObservation({ id: 'another' })],
    ['a pending answer for another id', pending({ invoice_id: 'another' })],
    ['a status that is still draft: no issuance is assumed', { status: 'draft' }],
    ['the saved-draft answer', { ...saved }],
    ['a bare acknowledgement', { status: 'Draft issued' }],
    ['a message without an invoice', { message: 'ok' }],
    ['an issued invoice without its number', fullObservation({ id: 'draft-one', num: undefined })],
    [
      'an errors list beside an issued invoice',
      { ...fullObservation({ id: 'draft-one' }), errors: [] },
    ],
    ['an empty object', {}],
    ['null', null],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(issue(client, 'draft-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'issueDraft',
      effect: 'unknown',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(issue(client, 'draft-one', { generate_pdf: true }));
      expect(error).toMatchObject({ code, operation: 'issueDraft', effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      // One request and nothing after it: no status read, no second attempt, no download.
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
  it('should report an abort after dispatch with unknown effect', async () => {
    const abort = new AbortController();
    const { client, calls } = answering(() => {
      abort.abort();
      return new Promise<Response>(() => undefined);
    });
    expect(
      await failure(issue(client, 'draft-one', undefined, { signal: abort.signal })),
    ).toMatchObject({ code: 'ABORTED', operation: 'issueDraft', effect: 'unknown' });
    expect(dispatched(calls)).toHaveLength(1);
  });
});

describe('invoices.drafts.list', () => {
  it('should send one authenticated GET for drafts, page 1 by default', async () => {
    const { client, calls } = answering(() => json(page([draftRow()])));
    await client.invoices.drafts.list();
    const call = only(calls);
    expect(call.init.method).toBe('GET');
    expect(call.url.href).toBe(
      'https://staging.wrapp.ai/api/v1/invoices/find_all_invoices?status=draft&page=1',
    );
    expect(call.init.body).toBeUndefined();
    expect(headers(call.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    });
  });
  it('should send the requested page beside the draft status', async () => {
    const { client, calls } = answering(() =>
      json(page([draftRow()], { current_page: 3, total_pages: 3, total_count: 101 })),
    );
    await client.invoices.drafts.list({ page: 3 });
    expect(only(calls).url.search).toBe('?status=draft&page=3');
  });
  it.each([
    ['a status of its own', { status: 'issued' }],
    ['a date filter, which is not offered for drafts', { start_date: '2026-01-01' }],
    ['page 0', { page: 0 }],
    ['a fractional page', { page: 1.5 }],
    ['a page given as text', { page: '1' }],
    ['null', null],
  ])('should refuse a filter with %s before any request', async (_label, filters) => {
    const { client, calls } = answering(() => json(page([])));
    expect(await failure(client.invoices.drafts.list(filters as never))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'listDrafts',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it('should return a draft without a document code, a mark or any issued classification', async () => {
    const { client } = answering(() => json(page([draftRow()])));
    const result = await client.invoices.drafts.list();
    const [draft] = result.invoices;
    expect(result).toMatchObject({ total_count: 1, total_pages: 1, current_page: 1 });
    expect(draft).toMatchObject({
      id: 'draft-one',
      external_id: 'reference-one',
      invoice_type_code: '2.1',
      billing_book_id: 'book-one',
      issued_at: '2026-09-21 10:00:00 +0300',
      net_total_amount: '10',
      total_amount: '12.4',
      payment_method: '3',
    });
    for (const key of [
      'code',
      'my_data_mark',
      'my_data_uid',
      'authentication_code',
      'num',
      'series',
      'kind',
      'status',
    ])
      expect(draft, key).not.toHaveProperty(key);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(draft)).toBe(true);
  });
  it.each([
    ['no date', { issued_at: undefined }],
    ['a null date', { issued_at: null }],
  ])('should fail rather than invent a date for a draft with %s', async (_label, patch) => {
    const { client } = answering(() => json(page([draftRow(patch)])));
    expect(await failure(client.invoices.drafts.list())).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'listDrafts',
    });
  });
  it.each(['code', 'my_data_mark', 'my_data_uid'])(
    'should accept a row as a draft only with an empty %s: absent or null is not that evidence',
    async (key) => {
      for (const value of [undefined, null]) {
        const { client } = answering(() => json(page([draftRow({ [key]: value })])));
        expect(await failure(client.invoices.drafts.list())).toMatchObject({
          code: 'PROTOCOL_ERROR',
          operation: 'listDrafts',
          effect: 'not-sent',
        });
      }
    },
  );
  it.each([
    ['a registration mark', { my_data_mark: '400000000000001' }],
    ['a registration uid', { my_data_uid: 'uid-one' }],
    ['a document code', { code: 'S.1' }],
    ['a mark that is not text', { my_data_mark: 400000000000001 }],
    ['no id', { id: undefined }],
    ['an unsafe id', { id: 'a/b' }],
    ['a date that is not a timestamp', { issued_at: 'today' }],
    ['no lines', { invoice_lines: [] }],
    ['no billing book', { billing_book_id: undefined }],
    ['an amount that is not numeric', { total_amount: 'twelve' }],
  ])('should treat a row with %s as a protocol error: it is not a draft', async (_label, patch) => {
    const { client } = answering(() =>
      json(page([draftRow(), draftRow({ id: 'draft-two', ...patch })])),
    );
    expect(await failure(client.invoices.drafts.list())).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'listDrafts',
      effect: 'not-sent',
    });
  });
  it('should accept the empty answer and refuse page metadata that contradicts the request', async () => {
    const empty = answering(() =>
      json({ invoices: [], total_count: 0, total_pages: 0, current_page: 1 }),
    );
    expect(await empty.client.invoices.drafts.list()).toEqual({
      invoices: [],
      total_count: 0,
      total_pages: 0,
      current_page: 1,
    });
    for (const meta of [{ current_page: 2 }, { total_count: 0 }, { total_pages: 0 }]) {
      const { client } = answering(() => json(page([draftRow()], meta)));
      expect(await failure(client.invoices.drafts.list())).toMatchObject({
        code: 'PROTOCOL_ERROR',
      });
    }
  });
  it('should treat an errors list as a provider rejection and a status as a protocol error', async () => {
    const refusing = answering(() => json(refusal));
    expect(await failure(refusing.client.invoices.drafts.list())).toMatchObject({
      code: 'PROVIDER_REJECTED',
      effect: 'not-sent',
    });
    const odd = answering(() => json({ ...page([draftRow()]), status: 'draft' }));
    expect(await failure(odd.client.invoices.drafts.list())).toMatchObject({
      code: 'PROTOCOL_ERROR',
    });
  });
  it.each(failures)(
    'should dispatch once and report not-sent after $label: it is a read',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(client.invoices.drafts.list());
      expect(error).toMatchObject({ code, operation: 'listDrafts', effect: 'not-sent' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
});

describe('invoices.drafts.iterate', () => {
  const paged = (pages: number) =>
    answering((url) => {
      const current = Number(url.searchParams.get('page'));
      return json(
        page([draftRow({ id: 'draft-' + String(current) })], {
          total_count: pages,
          total_pages: pages,
          current_page: current,
        }),
      );
    });
  it('should request nothing before the first read and one page per step', async () => {
    const { client, calls } = paged(3);
    const iterator = client.invoices.drafts.iterate({}, { maxPages: 3 })[Symbol.asyncIterator]();
    expect(calls).toHaveLength(0);
    expect((await iterator.next()).value).toMatchObject({ id: 'draft-1' });
    expect(dispatched(calls)).toHaveLength(1);
    expect((await iterator.next()).value).toMatchObject({ id: 'draft-2' });
    expect(dispatched(calls)).toHaveLength(2);
  });
  it('should send the draft status on every page', async () => {
    const { client, calls } = paged(3);
    const ids: string[] = [];
    for await (const draft of client.invoices.drafts.iterate({}, { maxPages: 5 }))
      ids.push(draft.id);
    expect(ids).toEqual(['draft-1', 'draft-2', 'draft-3']);
    expect(dispatched(calls).map((call) => call.url.search)).toEqual([
      '?status=draft&page=1',
      '?status=draft&page=2',
      '?status=draft&page=3',
    ]);
  });
  it('should start from the requested page', async () => {
    const { client, calls } = paged(3);
    const ids: string[] = [];
    for await (const draft of client.invoices.drafts.iterate({ page: 2 }, { maxPages: 5 }))
      ids.push(draft.id);
    expect(ids).toEqual(['draft-2', 'draft-3']);
    expect(dispatched(calls)).toHaveLength(2);
  });
  it('should fail explicitly at the page limit instead of stopping quietly', async () => {
    const { client } = paged(3);
    const iterator = client.invoices.drafts.iterate({}, { maxPages: 1 })[Symbol.asyncIterator]();
    await iterator.next();
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'PAGINATION_LIMIT',
      operation: 'listDrafts',
    });
  });
  it('should fail on a repeated page instead of deduplicating it', async () => {
    const { client } = answering((url) =>
      json(
        page([draftRow()], {
          total_count: 2,
          total_pages: 2,
          current_page: Number(url.searchParams.get('page')),
        }),
      ),
    );
    const iterator = client.invoices.drafts.iterate({}, { maxPages: 2 })[Symbol.asyncIterator]();
    await iterator.next();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it('should stop on an abort between records and request no further page', async () => {
    const abort = new AbortController();
    const { client, calls } = paged(3);
    const iterator = client.invoices.drafts
      .iterate({}, { maxPages: 3, signal: abort.signal })
      [Symbol.asyncIterator]();
    await iterator.next();
    abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'ABORTED' });
    expect(dispatched(calls)).toHaveLength(1);
  });
  it.each([
    ['no page limit', {}],
    ['a page limit of 0', { maxPages: 0 }],
    ['an unknown option', { maxPages: 1, status: 'draft' }],
  ])('should refuse options with %s before any request', async (_label, options) => {
    const { client, calls } = paged(1);
    const iterator = client.invoices.drafts.iterate({}, options as never)[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('issued listing beside drafts', () => {
  it('should keep the issued listing on its route without a status and with its own records', async () => {
    const { client, calls } = answering(() => json(page([fullDetails()])));
    const result = await client.invoices.list();
    expect(only(calls).url.search).toBe('?page=1');
    expect(result.invoices[0]).toMatchObject({ id: 'invoice-one', code: 'S.1' });
  });
  it('should refuse a status filter on the issued listing', async () => {
    const { client, calls } = answering(() => json(page([])));
    await expect(client.invoices.list({ status: 'draft' } as never)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(calls).toHaveLength(0);
  });
  it('should expose create, delete, issue, iterate and list on the drafts namespace and nothing else', () => {
    const { client } = provider(() => login(token));
    expect(Object.keys(client.invoices.drafts).sort()).toEqual(
      ['create', 'delete', 'issue', 'iterate', 'list'].sort(),
    );
    expect(Object.isFrozen(client.invoices.drafts)).toBe(true);
  });
});
