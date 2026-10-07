import { LosslessNumber, parse } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { decimal, getProviderDiagnostics, WrappError } from '../../src/index.js';
import type { CreateInvoiceInput, RequestOptions, WrappClient } from '../../src/index.js';
import {
  invoiceTypeCatalogue,
  supportedInvoiceTypeCodes,
  thirdPartyCollectionTypes,
} from '../../src/invoice-contracts.js';
import {
  invoice,
  invoiceOfType,
  json,
  login,
  observation,
  provider,
} from '../fixtures/provider.js';
import type { RecordedRequest } from '../fixtures/provider.js';

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
const dispatched = (calls: readonly RecordedRequest[]) =>
  calls.filter((call) => !call.url.pathname.endsWith('/login'));
function only(calls: readonly RecordedRequest[]): RecordedRequest {
  const [call, ...rest] = dispatched(calls);
  if (call === undefined || rest.length > 0) throw new Error('Expected exactly one dispatch');
  return call;
}
const badOptions = [
  { timeoutMs: 0 },
  { signal: {} },
  { diagnostics: 'all' },
  { unknown: true },
] as unknown as RequestOptions[];
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
    // The only case that needs a short deadline; the others answer at once.
    timeoutMs: 40,
  },
  {
    label: 'a malformed success body',
    respond: () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    code: 'PROTOCOL_ERROR',
  },
];
const device = {
  id: 'device-one',
  name: 'Front desk',
  terminal_id: '16000001',
  merchant_id: 'merchant-one',
};
const refusal = { errors: [{ title: 'Synthetic refusal' }] };
const rejected = { kind: 'rejected', errorCount: 1, rejectionSource: 'unknown' };
const codeTypes = [
  'epay',
  'worldline',
  'nbg',
  'cosmote',
  'jcc',
  'attica',
  'pancreta',
  'tora',
  'pbt',
  'mypos',
  'nexi-mellon',
  'nexi',
  'nbg_edps',
] as const;
const merchantTypes = ['viva', 'worldline_softpos'] as const;
const viva = {
  pos_type: 'viva',
  name: 'Front desk',
  terminal_id: '16000001',
  merchant_id: 'merchant-one',
};
const softpos = {
  pos_type: 'worldline_softpos',
  terminal_id: '16000002',
  merchant_id: 'merchant@example.invalid',
};
const withCode = (pos_type: string) => ({
  pos_type,
  name: 'Back office',
  terminal_id: '16000003',
  authorization_code: 'synthetic-authorization',
});
const create = (client: WrappClient, input: unknown, options?: RequestOptions) =>
  client.posDevices.create(input as never, options);

describe('posDevices.list', () => {
  it('should send exactly one authenticated GET with its literal path and no body', async () => {
    const { client, calls } = answering(() => json([device]));
    await client.posDevices.list();
    const call = only(calls);
    expect(call.init.method).toBe('GET');
    expect(call.url.href).toBe('https://staging.wrapp.ai/api/v1/pos_devices');
    expect(call.init.body).toBeUndefined();
    expect(call.init.redirect).toBe('error');
    expect(headers(call.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    });
  });
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json([device]));
    for (const options of badOptions)
      expect(await failure(client.posDevices.list(options))).toMatchObject({
        code: 'INVALID_INPUT',
        effect: 'not-sent',
      });
    expect(calls).toHaveLength(0);
  });
  it('should return the devices deeply frozen, keeping null and absent apart and dropping additive fields', async () => {
    const { client } = answering(() =>
      json([
        device,
        { id: 'device-two', name: 'Mobile', terminal_id: '16000002', merchant_id: null },
        { id: 'device-three', name: '', additive: { nested: true } },
      ]),
    );
    const devices = await client.posDevices.list();
    expect(devices).toEqual([
      device,
      { id: 'device-two', name: 'Mobile', terminal_id: '16000002', merchant_id: null },
      { id: 'device-three', name: '' },
    ]);
    expect(Object.isFrozen(devices)).toBe(true);
    expect(devices.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(devices[2]).not.toHaveProperty('merchant_id');
    expect(devices[2]).not.toHaveProperty('terminal_id');
  });
  it('should return an empty list as an empty frozen array', async () => {
    const { client } = answering(() => json([]));
    const devices = await client.posDevices.list();
    expect(devices).toEqual([]);
    expect(Object.isFrozen(devices)).toBe(true);
  });
  it.each([
    ['an object instead of a list', device],
    ['a device without an id', [{ name: 'Front desk' }]],
    ['a device without a name', [{ id: 'device-one' }]],
    ['a device id that is not path-safe', [{ ...device, id: 'a/b' }]],
    ['a numeric terminal id', [{ ...device, terminal_id: 16000001 }]],
    ['a non-text merchant id', [{ ...device, merchant_id: { email: 'x' } }]],
    ['a non-object entry', ['device-one']],
    ['a status object', { status: 'ok' }],
    ['null', null],
  ])('should treat %s as a protocol error of a read', async (_label, body) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(client.posDevices.list())).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'posDevices',
      effect: 'not-sent',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
  it('should report a rejection envelope as PROVIDER_REJECTED without provider wording', async () => {
    const { client } = answering(() => json(refusal));
    const error = await failure(client.posDevices.list());
    expect(error).toMatchObject({ code: 'PROVIDER_REJECTED', operation: 'posDevices' });
    expect(JSON.stringify(error) + error.message).not.toContain('Synthetic refusal');
  });
  it.each(failures)(
    'should dispatch once and report not-sent after $label, as for any read',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(client.posDevices.list());
      expect(error).toMatchObject({ code, operation: 'posDevices', effect: 'not-sent' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
});

describe('posDevices.create', () => {
  it('should send exactly one authenticated POST with its literal path and JSON body', async () => {
    const { client, calls } = answering(() => json(device, 201));
    await create(client, viva);
    const call = only(calls);
    expect(call.init.method).toBe('POST');
    expect(call.url.href).toBe('https://staging.wrapp.ai/api/v1/pos_devices');
    expect(call.init.redirect).toBe('error');
    expect(headers(call.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    });
    expect(JSON.parse(call.init.body as string)).toEqual(viva);
  });
  it.each(merchantTypes)('should send a %s device with its merchant id', async (pos_type) => {
    const { client, calls } = answering(() => json(device, 201));
    const input = { ...viva, pos_type };
    expect((await create(client, input)).kind).toBe('observed');
    expect(JSON.parse(only(calls).init.body as string)).toEqual(input);
  });
  it.each(codeTypes)('should send a %s device with its authorization code', async (pos_type) => {
    const { client, calls } = answering(() => json(device, 201));
    expect((await create(client, withCode(pos_type))).kind).toBe('observed');
    expect(JSON.parse(only(calls).init.body as string)).toEqual(withCode(pos_type));
  });
  it('should send a worldline_softpos device without a name and add none', async () => {
    const { client, calls } = answering(() => json(device, 201));
    expect((await create(client, softpos)).kind).toBe('observed');
    expect(JSON.parse(only(calls).init.body as string)).toEqual(softpos);
  });
  it('should treat an explicitly undefined optional name as omitted, like every optional input', async () => {
    const { client, calls } = answering(() => json(device, 201));
    expect((await create(client, { ...softpos, name: undefined })).kind).toBe('observed');
    expect(only(calls).init.body).not.toContain('name');
    expect(JSON.parse(only(calls).init.body as string)).toEqual(softpos);
  });
  it.each([
    ['viva without a merchant id', { ...viva, merchant_id: undefined }],
    ['viva without a name', { ...viva, name: undefined }],
    ['viva without a terminal id', { ...viva, terminal_id: undefined }],
    ['viva with an authorization code instead', { ...withCode('viva') }],
    ['viva with both credentials', { ...viva, authorization_code: 'synthetic-authorization' }],
    ['worldline_softpos without a merchant id', { ...softpos, merchant_id: undefined }],
    ['worldline_softpos without a terminal id', { ...softpos, terminal_id: undefined }],
    ['worldline_softpos with an authorization code', { ...softpos, authorization_code: 'x' }],
    ['worldline_softpos with an empty name', { ...softpos, name: '' }],
    ['an empty merchant id', { ...viva, merchant_id: '' }],
    ['an empty terminal id', { ...viva, terminal_id: '' }],
    ['a numeric terminal id', { ...viva, terminal_id: 16000001 }],
    ['an unknown device type', { ...viva, pos_type: 'stripe' }],
    ['a device type in another case', { ...viva, pos_type: 'VIVA' }],
    ['a numeric device type', { ...viva, pos_type: 1 }],
    ['no device type', { ...viva, pos_type: undefined }],
    ['an unknown field', { ...viva, serial: 'x' }],
    ['an oversized name', { ...viva, name: 'x'.repeat(4097) }],
    ['null', null],
    ['a string', 'viva'],
  ])('should refuse %s before any request', async (_label, input) => {
    const { client, calls } = answering(() => json(device, 201));
    expect(await failure(create(client, input))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'posDeviceCreate',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it.each(
    codeTypes.flatMap((pos_type) => [
      [pos_type, 'no authorization code', { ...withCode(pos_type), authorization_code: undefined }],
      [pos_type, 'an empty authorization code', { ...withCode(pos_type), authorization_code: '' }],
      [pos_type, 'a merchant id instead', { ...viva, pos_type }],
      [pos_type, 'both credentials', { ...withCode(pos_type), merchant_id: 'merchant-one' }],
      [pos_type, 'no name', { ...withCode(pos_type), name: undefined }],
      [pos_type, 'no terminal id', { ...withCode(pos_type), terminal_id: undefined }],
    ]),
  )('should refuse a %s device with %s before any request', async (_type, _label, input) => {
    const { client, calls } = answering(() => json(device, 201));
    expect(await failure(create(client, input))).toMatchObject({
      code: 'INVALID_INPUT',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json(device, 201));
    for (const options of badOptions)
      expect(await failure(create(client, viva, options))).toMatchObject({
        code: 'INVALID_INPUT',
        effect: 'not-sent',
      });
    expect(calls).toHaveLength(0);
  });
  it.each([201, 200])(
    'should return the same frozen observed device for HTTP %d',
    async (status) => {
      const { client, calls } = answering(() => json({ ...device, additive: true }, status));
      const outcome = await create(client, softpos);
      expect(outcome).toEqual({ kind: 'observed', device });
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(outcome.kind === 'observed' && Object.isFrozen(outcome.device)).toBe(true);
      // An already attached terminal answers 200; it is still one call, never repeated.
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
  it('should count every message of a field-keyed refusal and return no wording', async () => {
    const { client, calls } = answering(() =>
      json({
        errors: {
          'pos_devices.name': ['Synthetic taken'],
          'pos_devices.terminal_id': ['Synthetic taken', 'Synthetic invalid'],
        },
      }),
    );
    const outcome = await create(client, viva);
    expect(outcome).toEqual({ kind: 'rejected', errorCount: 3, rejectionSource: 'unknown' });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(dispatched(calls)).toHaveLength(1);
  });
  it('should return an errors list as a rejected result', async () => {
    const { client } = answering(() => json(refusal));
    expect(await create(client, viva)).toEqual(rejected);
  });
  it.each([
    ['a field-keyed refusal beside a device id', { errors: { name: ['taken'] }, id: 'device-one' }],
    ['an errors list beside a device id', { ...refusal, id: 'device-one' }],
    ['an empty field-keyed refusal', { errors: {} }],
    ['a field with no messages', { errors: { name: [] } }],
    ['a field whose messages are not text', { errors: { name: [5] } }],
    ['a field whose value is not a list', { errors: { name: 'taken' } }],
    ['a refusal with an unknown status', { errors: { name: ['taken'] }, status: 'bogus' }],
    ['a device without an id', { name: 'Front desk' }],
    ['a device with a status', { ...device, status: 'created' }],
    ['a device id that is not path-safe', { ...device, id: 'a/b' }],
    ['an empty object', {}],
    ['a list', [device]],
    ['null', null],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client, calls } = answering(() => json(body, 201));
    expect(await failure(create(client, viva))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'posDeviceCreate',
      effect: 'unknown',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
  it('should report an HTTP 422 refusal as an error with unknown effect, dispatched once', async () => {
    const { client, calls } = answering(() =>
      json({ errors: { 'pos_devices.name': ['Synthetic taken'] } }, 422),
    );
    const error = await failure(create(client, viva));
    expect(error).toMatchObject({
      code: 'HTTP_ERROR',
      operation: 'posDeviceCreate',
      effect: 'unknown',
      httpStatus: 422,
    });
    expect(getProviderDiagnostics(error)).toBeUndefined();
    expect(dispatched(calls)).toHaveLength(1);
  });
  it('should expose a field-keyed refusal through opt-in diagnostics, field then message', async () => {
    const body = {
      errors: {
        'pos_devices.name': ['Synthetic taken'],
        authorization_code: ['Synthetic wrong code', 'Synthetic used code'],
      },
    };
    const options: RequestOptions = { diagnostics: 'provider-issues' };
    const thrown = await failure(create(answering(() => json(body, 422)).client, viva, options));
    const outcome = await create(answering(() => json(body)).client, viva, options);
    for (const target of [thrown, outcome])
      expect(getProviderDiagnostics(target)).toEqual({
        issues: [
          { title: 'pos_devices.name', message: 'Synthetic taken' },
          { title: 'authorization_code', message: 'Synthetic wrong code' },
          { title: 'authorization_code', message: 'Synthetic used code' },
        ],
        truncated: false,
        sensitive: true,
      });
  });
  it('should redact an echoed merchant id or authorization code from diagnostics', async () => {
    const options: RequestOptions = { diagnostics: 'provider-issues' };
    for (const [input, secret] of [
      [softpos, softpos.merchant_id],
      [withCode('epay'), 'synthetic-authorization'],
    ] as const) {
      const { client } = answering(() =>
        json({ errors: { account: ['Synthetic refusal for ' + secret + '.'] } }, 422),
      );
      const error = await failure(create(client, input, options));
      expect(getProviderDiagnostics(error)?.issues).toEqual([
        { title: 'account', message: 'Synthetic refusal for [REDACTED].' },
      ]);
    }
  });
  it('should keep the merchant id and authorization code out of every error', async () => {
    const secrets = [softpos.merchant_id, 'synthetic-authorization'];
    const errors = [
      await failure(create(answering(() => json({}, 422)).client, softpos)),
      await failure(create(answering(() => json({}, 500)).client, withCode('epay'))),
      await failure(create(answering(() => json(device)).client, { ...softpos, extra: 1 })),
      await failure(
        create(answering(() => json(device)).client, { ...withCode('epay'), merchant_id: 'x' }),
      ),
    ];
    for (const error of errors)
      for (const secret of secrets)
        expect(JSON.stringify(error) + error.message + String(error.stack)).not.toContain(secret);
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(create(client, softpos));
      expect(error).toMatchObject({ code, operation: 'posDeviceCreate', effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
      expect(calls).toHaveLength(2);
    },
  );
});

const acknowledgements = [
  {
    name: 'posDevices.delete',
    operation: 'posDeviceDelete',
    method: 'DELETE',
    path: (id: string) => '/api/v1/pos_devices/' + id,
    success: { status: 'POS device deleted' },
    call: (client: WrappClient, id: string, options?: RequestOptions) =>
      client.posDevices.delete(id, options),
  },
  {
    name: 'posSessions.abort',
    operation: 'posSessionAbort',
    method: 'POST',
    path: (id: string) => '/api/v1/pos_sessions/' + id + '/abort_session',
    success: { message: 'Session aborted successfully' },
    call: (client: WrappClient, id: string, options?: RequestOptions) =>
      client.posSessions.abort(id, options),
  },
];
describe.each(acknowledgements)('$name', (op) => {
  it('should send exactly one authenticated request with its literal method and path and no body', async () => {
    const { client, calls } = answering(() => json(op.success));
    await op.call(client, 'target-one');
    const call = only(calls);
    expect(call.init.method).toBe(op.method);
    expect(call.url.href).toBe('https://staging.wrapp.ai' + op.path('target-one'));
    expect(call.init.body).toBeUndefined();
    expect(call.init.redirect).toBe('error');
    expect(headers(call.init)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    });
  });
  it('should percent-encode the id once', async () => {
    const { client, calls } = answering(() => json(op.success));
    await op.call(client, 'a+b&c=d');
    expect(only(calls).url.pathname).toBe(op.path('a%2Bb%26c%3Dd'));
  });
  it.each(badIds)('should refuse the id %j before any request', async (id) => {
    const { client, calls } = answering(() => json(op.success));
    expect(await failure(op.call(client, id as string))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: op.operation,
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it('should refuse invalid request options before any request', async () => {
    const { client, calls } = answering(() => json(op.success));
    for (const options of badOptions)
      expect(await failure(op.call(client, 'target-one', options))).toMatchObject({
        code: 'INVALID_INPUT',
        effect: 'not-sent',
      });
    expect(calls).toHaveLength(0);
  });
  it('should return a frozen acknowledgement for the documented answer, without its wording', async () => {
    const { client, calls } = answering(() => json({ ...op.success, additive: true }));
    const outcome = await op.call(client, 'target-one');
    expect(outcome).toEqual({ kind: 'acknowledged' });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(dispatched(calls)).toHaveLength(1);
  });
  it('should return an errors list as a rejected result that names nothing', async () => {
    const { client, calls } = answering(() => json(refusal));
    const outcome = await op.call(client, 'target-one');
    expect(outcome).toEqual(rejected);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(dispatched(calls)).toHaveLength(1);
  });
  it('should expose the refusal of a device with transactions or a missing session only through opt-in diagnostics', async () => {
    const { client } = answering(() => json({ errors: [{ title: 'Synthetic refusal' }] }, 422));
    const error = await failure(op.call(client, 'target-one', { diagnostics: 'provider-issues' }));
    expect(error).toMatchObject({ code: 'HTTP_ERROR', httpStatus: 422, effect: 'unknown' });
    expect(JSON.stringify(error) + error.message).not.toContain('Synthetic refusal');
    expect(getProviderDiagnostics(error)?.issues).toEqual([{ title: 'Synthetic refusal' }]);
  });
  it.each([
    ['the answer beside an errors list', (success: object) => ({ ...success, ...refusal })],
    ['the answer beside an error string', (success: object) => ({ ...success, error: 'x' })],
    ['an empty acknowledgement text', (success: object) => emptied(success)],
    ['a non-text acknowledgement', (success: object) => numbered(success)],
    ['an empty object', () => ({})],
    ['a list', (success: object) => [success]],
    ['null', () => null],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client, calls } = answering(() => json(body(op.success)));
    expect(await failure(op.call(client, 'target-one'))).toMatchObject({
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
      const error = await failure(op.call(client, 'target-one'));
      expect(error).toMatchObject({ code, operation: op.operation, effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
      expect(calls).toHaveLength(2);
    },
  );
});
function emptied(success: object): object {
  return Object.fromEntries(Object.keys(success).map((key) => [key, '']));
}
function numbered(success: object): object {
  return Object.fromEntries(Object.keys(success).map((key) => [key, 1]));
}

describe('posSessions.abort', () => {
  it('should refuse a session message beside a status, which no documented answer carries', async () => {
    const { client } = answering(() => json({ message: 'Session aborted', status: 'aborted' }));
    expect(await failure(client.posSessions.abort('invoice-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      effect: 'unknown',
    });
  });
  it('should address the session by the invoice id and make no other request', async () => {
    const { client, calls } = answering(() => json({ message: 'Session aborted successfully' }));
    await client.posSessions.abort('invoice-one');
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/api/v1/login',
      '/api/v1/pos_sessions/invoice-one/abort_session',
    ]);
  });
});

describe('POS resource shape', () => {
  it('should expose the documented device and session operations and nothing else', () => {
    const { client } = provider(() => login(token));
    expect(Object.keys(client.posDevices).sort()).toEqual(['create', 'delete', 'list']);
    expect(Object.keys(client.posSessions)).toEqual(['abort']);
    expect(Object.isFrozen(client.posDevices) && Object.isFrozen(client.posSessions)).toBe(true);
  });
});

// The invoice-side POS fields. Values are synthetic; nothing here decides a payment method.
type Patch = Record<string, unknown>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function issuing(respond?: () => Response) {
  return provider(({ url, init }) => {
    if (url.pathname.endsWith('/login')) return login();
    if (respond !== undefined) return respond();
    const sentBody: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const reference = isRecord(sentBody) ? sentBody.external_id : undefined;
    return json(observation(typeof reference === 'string' ? { external_id: reference } : {}));
  });
}
function build(patch: Patch): CreateInvoiceInput {
  const patched: unknown = { ...invoice(), ...patch };
  return patched as CreateInvoiceInput;
}
async function sent(input: CreateInvoiceInput): Promise<Record<string, unknown>> {
  const { client, calls } = issuing();
  expect((await client.invoices.create(input)).kind).toBe('observed');
  expect(calls).toHaveLength(2);
  const body = calls.at(-1)?.init.body;
  const root = typeof body === 'string' ? parse(body) : undefined;
  if (!isRecord(root)) throw new Error('No JSON body was dispatched');
  return Object.fromEntries(
    Object.entries(root).map(([key, value]) => [
      key,
      value instanceof LosslessNumber ? '#' + value.value : value,
    ]),
  );
}
async function refused(input: CreateInvoiceInput): Promise<void> {
  const { client, calls } = issuing();
  await expect(client.invoices.create(input)).rejects.toMatchObject({
    code: 'INVALID_INPUT',
    operation: 'create',
    effect: 'not-sent',
  });
  expect(calls).toHaveLength(0);
}

describe('invoice POS fields', () => {
  it('should send none of the POS fields when the caller supplies none', async () => {
    const body = await sent(build({}));
    for (const key of ['pos_device_id', 'installments', 'tip_amount', 'refund_invoice_id'])
      expect(body, key).not.toHaveProperty(key);
  });
  it.each(supportedInvoiceTypeCodes)(
    'should send pos_device_id, installments and tip_amount exactly on invoice type %s',
    async (invoice_type_code) => {
      const body = await sent({
        ...invoiceOfType(invoice_type_code),
        pos_device_id: 'device-one',
        installments: true,
        tip_amount: decimal('2.00'),
      });
      expect(body).toMatchObject({
        pos_device_id: 'device-one',
        installments: true,
        tip_amount: '#2.00',
      });
    },
  );
  it.each([5, '', 'a/b', 'a b', 'x'.repeat(257), null, true])(
    'should refuse pos_device_id %j before authentication',
    async (value) => {
      await refused(build({ pos_device_id: value }));
    },
  );
  it('should refuse installments true without a pos_device_id', async () => {
    await refused(build({ installments: true }));
  });
  it('should preserve installments false, with or without a device', async () => {
    expect((await sent(build({ installments: false }))).installments).toBe(false);
    expect(
      (await sent(build({ installments: false, pos_device_id: 'device-one' }))).installments,
    ).toBe(false);
  });
  it.each(['true', 1, 0, null])('should refuse installments %j', async (value) => {
    await refused(build({ installments: value, pos_device_id: 'device-one' }));
  });
  it.each([
    ['0.00', '#0.00'],
    ['2.5', '#2.5'],
    ['9007199254740993.10', '#9007199254740993.10'],
  ])('should send tip_amount %s as the exact token, with no device required', async (tip, wire) => {
    expect((await sent(build({ tip_amount: decimal(tip) }))).tip_amount).toBe(wire);
  });
  it.each([2, '2.005', '-2.00', '', null, true])('should refuse tip_amount %j', async (value) => {
    await refused(build({ tip_amount: value }));
  });
  it('should not demand a device for a card payment that is not a POS issuance', async () => {
    const body = await sent(build({ payment_method_type: 3 }));
    expect(body.payment_method_type).toBe('#3');
    expect(body).not.toHaveProperty('pos_device_id');
  });
  it('should leave the terminal check to the provider: one create, no device lookup, a rejected result', async () => {
    const { client, calls } = issuing(() =>
      json({ status: 'Invoice Errors', errors: [{ title: 'Synthetic non-Viva terminal' }] }),
    );
    const outcome = await client.invoices.create(
      build({ pos_device_id: 'device-one', installments: true }),
    );
    expect(outcome).toMatchObject({ kind: 'rejected', errorCount: 1 });
    expect(calls.map((call) => call.url.pathname)).toEqual(['/api/v1/login', '/api/v1/invoices']);
  });
  it.each(
    supportedInvoiceTypeCodes.flatMap((code) => [
      [code, 'refund_invoice_id', 'invoice-one'],
      [code, 'third_party_collection', true],
      [code, 'third_party_collection', false],
      [code, 'aade_preloaded', true],
      [code, 'aade_preloaded', 'true'],
    ]),
  )(
    'should keep invoice type %s closed to %s %j: no supported profile carries it',
    async (invoice_type_code, key, value) => {
      // The same invoice is accepted without the field, so the field is what is refused.
      expect((await sent(invoiceOfType(invoice_type_code))).invoice_type_code).toBe(
        invoice_type_code,
      );
      const withField: unknown = { ...invoiceOfType(invoice_type_code), [key]: value };
      await refused(withField as CreateInvoiceInput);
    },
  );
  it('should bind third_party_collection to types 8.4 and 8.5, neither of which is issued yet', () => {
    expect(thirdPartyCollectionTypes).toEqual(['8.4', '8.5']);
    const known = invoiceTypeCatalogue.map((entry) => entry.code);
    const supported: readonly string[] = supportedInvoiceTypeCodes;
    for (const code of thirdPartyCollectionTypes) {
      expect(known).toContain(code);
      expect(supported).not.toContain(code);
    }
  });
});
