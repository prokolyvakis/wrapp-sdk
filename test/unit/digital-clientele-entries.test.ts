import { describe, expect, it } from 'vitest';
import { calendarDate, decimal, getProviderDiagnostics, WrappError } from '../../src/index.js';
import type { RequestOptions, WrappClient } from '../../src/index.js';
import { json, login, provider } from '../fixtures/provider.js';
import type { RecordedRequest } from '../fixtures/provider.js';

// Reading, creating, updating and cancelling a digital clientele entry. The provider's
// reference shows these answers with strings and empty text; the bodies here are synthetic
// values in the shapes the provider was observed to return (JSON null, real booleans).
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
const dispatched = (calls: readonly RecordedRequest[]) =>
  calls.filter((call) => !call.url.pathname.endsWith('/login'));
function only(calls: readonly RecordedRequest[]): RecordedRequest {
  const [call, ...rest] = dispatched(calls);
  if (call === undefined || rest.length > 0) throw new Error('Expected exactly one dispatch');
  return call;
}
const sent = (calls: readonly RecordedRequest[]): unknown =>
  JSON.parse(only(calls).init.body as string);
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
const rejected = { kind: 'rejected', errorCount: 1, rejectionSource: 'unknown' };
// The 45 keys of an entry as observed on a new parking entry: null wherever nothing is set.
const textKeys = [
  'entity_vat_number',
  'from_agreed_period_date',
  'to_agreed_period_date',
  'customer_vat_number',
  'customer_country',
  'correlated_dc_id',
  'comments',
  'foreign_vehicle_registration_number',
  'vehicle_category',
  'vehicle_factory',
  'vehicle_movement_purpose',
  'vehicle_pickup_location',
  'periodicity',
  'periodicity_other',
  'amount',
  'completion_date_time',
  'vehicle_return_location',
  'provided_service_category',
  'provided_service_category_other',
  'invoice_kind',
  'off_site_provided_service',
  'exit_date_time',
  'cooperating_vat_number',
  'other_branch',
  'reason_non_issue_type',
  'invoice_counterparty',
  'invoice_counterparty_country',
  'cancellation_id',
];
const flagKeys = [
  'recurring_service',
  'continuous_service',
  'continuous_lease_service',
  'transmission_failure',
  'is_diff_veh_pickup_location',
  'entry_completion',
  'non_issue_invoice',
  'is_diff_veh_return_location',
];
const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'clientele-one',
  iddcl: '100000000000001',
  client_service_type: 'parkingcarwash',
  creation_date_time: '2026-09-21T10:00:00.000+03:00',
  branch: '0',
  mixed_service: false,
  status: 'pending',
  vehicle_registration_number: 'ABC1234',
  updated_iddcl: null,
  ...Object.fromEntries([...textKeys, ...flagKeys].map((key) => [key, null])),
  ...overrides,
});
const parking = {
  client_service_type: 'parkingcarwash',
  branch: '0',
  vehicle_registration_number: 'ABC1234',
};
const rental = {
  ...parking,
  client_service_type: 'rental',
  vehicle_movement_purpose: 'vmp_rental',
};

interface Operation {
  readonly name: string;
  readonly operation: string;
  readonly method: string;
  readonly path: string;
  readonly effect: 'unknown' | 'not-sent';
  readonly success: unknown;
  readonly call: (client: WrappClient, id: unknown, options?: RequestOptions) => Promise<unknown>;
}
const operations: readonly Operation[] = [
  {
    name: 'digitalClienteles.get',
    operation: 'clientele',
    method: 'GET',
    path: '/api/v1/digital_clienteles/clientele-one',
    effect: 'not-sent',
    success: entry(),
    call: (client, id, options) => client.digitalClienteles.get(id as string, options),
  },
  {
    name: 'digitalClienteles.update',
    operation: 'clienteleUpdate',
    method: 'POST',
    path: '/api/v1/digital_clienteles/clientele-one',
    effect: 'unknown',
    success: entry(),
    call: (client, id, options) =>
      client.digitalClienteles.update(id as string, { comments: 'Synthetic' }, options),
  },
  {
    name: 'digitalClienteles.cancel',
    operation: 'clienteleCancel',
    method: 'POST',
    path: '/api/v1/digital_clienteles/clientele-one/cancel',
    effect: 'unknown',
    success: { notice: 'Cancelled successfully.', cancellation_id: '100000000000002' },
    call: (client, id, options) => client.digitalClienteles.cancel(id as string, options),
  },
];

describe.each(operations)('$name', (op) => {
  it('should send exactly one authenticated request with its literal method and path', async () => {
    const { client, calls } = answering(() => json(op.success));
    await op.call(client, 'clientele-one');
    const call = only(calls);
    expect(call.init.method).toBe(op.method);
    expect(call.url.href).toBe('https://staging.wrapp.ai' + op.path);
    expect(call.init.redirect).toBe('error');
  });
  it.each(badIds)('should refuse the entry id %j before any request', async (id) => {
    const { client, calls } = answering(() => json(op.success));
    expect(await failure(op.call(client, id))).toMatchObject({
      code: 'INVALID_INPUT',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it('should percent-encode the entry id once', async () => {
    const { client, calls } = answering(() => json(entry({ id: 'a+b&c=d' })));
    await op.call(client, 'a+b&c=d').catch(() => undefined);
    expect(only(calls).url.pathname).toContain('/digital_clienteles/a%2Bb%26c%3Dd');
  });
  it.each(failures)(
    'should dispatch once and report its effect class after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(op.call(client, 'clientele-one'));
      expect(error).toMatchObject({ code, operation: op.operation, effect: op.effect });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
});

describe('digital clientele entry shape', () => {
  it('should return every observed field, null kept as null and booleans as booleans', async () => {
    const { client } = answering(() => json(entry()));
    const record = await client.digitalClienteles.get('clientele-one');
    expect(record).toEqual(entry());
    expect(Object.keys(record)).toHaveLength(45);
    expect(Object.isFrozen(record)).toBe(true);
  });
  it('should return a completed entry with its amount as exact text and its codes verbatim', async () => {
    const complete = entry({
      status: 'complete',
      entry_completion: true,
      non_issue_invoice: false,
      amount: '1.0',
      provided_service_category: 'by_price_list',
      invoice_kind: 'retail_sales_receipt',
      updated_iddcl: '100000000000003',
      from_agreed_period_date: '2026-10-08',
    });
    const { client } = answering(() => json(complete));
    expect(await client.digitalClienteles.get('clientele-one')).toEqual(complete);
  });
  it.each(['pending', 'complete', 'cancelled', 'a-status-of-a-later-version'])(
    'should return the status "%s" verbatim',
    async (status) => {
      const { client } = answering(() => json(entry({ status })));
      expect((await client.digitalClienteles.get('clientele-one')).status).toBe(status);
    },
  );
  it('should keep an absent field absent and drop a field it does not know', async () => {
    const sparse = {
      id: 'clientele-one',
      client_service_type: 'garage',
      status: 'pending',
      later: 1,
    };
    const { client } = answering(() => json(sparse));
    expect(await client.digitalClienteles.get('clientele-one')).toEqual({
      id: 'clientele-one',
      client_service_type: 'garage',
      status: 'pending',
    });
  });
  it.each([
    ['a flag sent as the text "true": no text is read as a boolean', { mixed_service: 'true' }],
    ['a flag sent as empty text', { entry_completion: '' }],
    ['a flag sent as a number', { non_issue_invoice: 0 }],
    ['an amount that is not numeric', { amount: 'one' }],
    ['no id', { id: undefined }],
    ['no status', { status: undefined }],
    ['an empty status', { status: '' }],
    ['a branch that is not text', { branch: 0 }],
  ])('should treat an entry with %s as a protocol error', async (_label, patch) => {
    const { client } = answering(() => json(entry(patch)));
    expect(await failure(client.digitalClienteles.get('clientele-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'clientele',
      effect: 'not-sent',
    });
  });
  it('should refuse an entry with another id than the one read or updated', async () => {
    const { client } = answering(() => json(entry({ id: 'clientele-two' })));
    expect(await failure(client.digitalClienteles.get('clientele-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
    });
    expect(
      await failure(client.digitalClienteles.update('clientele-one', { comments: 'x' })),
    ).toMatchObject({ code: 'PROTOCOL_ERROR', effect: 'unknown' });
  });
  it('should report a refusal of a read as PROVIDER_REJECTED, in either refusal form', async () => {
    for (const body of [{ errors: 'Not found' }, { errors: [{ code: '1', message: 'No' }] }]) {
      const { client } = answering(() => json(body));
      expect(await failure(client.digitalClienteles.get('clientele-one'))).toMatchObject({
        code: 'PROVIDER_REJECTED',
        effect: 'not-sent',
      });
    }
  });
  it('should expose six operations and nothing else', () => {
    const { client } = provider(() => login(token));
    expect(Object.keys(client.digitalClienteles).sort()).toEqual(
      ['cancel', 'correlateByFim', 'correlateByMark', 'create', 'get', 'update'].sort(),
    );
  });
});

describe('digitalClienteles.create', () => {
  const create = (client: WrappClient, input: unknown, options?: RequestOptions) =>
    client.digitalClienteles.create(input as never, options);
  it('should send exactly one authenticated POST with the minimal entry and nothing added', async () => {
    const { client, calls } = answering(() => json(entry()));
    await create(client, parking);
    const call = only(calls);
    expect(call.init.method).toBe('POST');
    expect(call.url.href).toBe('https://staging.wrapp.ai/api/v1/digital_clienteles');
    expect(call.init.body).toBe(
      '{"client_service_type":"parkingcarwash","branch":"0","vehicle_registration_number":"ABC1234"}',
    );
  });
  it('should send all 24 fields under their exact names, booleans as booleans and dates as given', async () => {
    const full = {
      client_service_type: 'rental',
      creation_date_time: '2026-02-05T10:00:00Z',
      transmission_failure: true,
      entity_vat_number: 'synthetic-vat',
      branch: '0',
      recurring_service: true,
      continuous_service: true,
      continuous_lease_service: true,
      from_agreed_period_date: calendarDate('2026-02-05'),
      to_agreed_period_date: calendarDate('2026-02-07'),
      periodicity: 'monthly',
      periodicity_other: 'Synthetic',
      customer_vat_number: 'synthetic-customer',
      customer_country: 'GR',
      correlated_dc_id: 'entry-zero',
      comments: 'Line one\nLine two',
      vehicle_registration_number: 'ABC1234',
      foreign_vehicle_registration_number: 'XY-123',
      vehicle_category: 'bus',
      vehicle_factory: 'Synthetic',
      vehicle_movement_purpose: 'vmp_self_use',
      is_diff_veh_pickup_location: true,
      vehicle_pickup_location: 'Synthetic place',
    };
    const { client, calls } = answering(() => json(entry({ client_service_type: 'rental' })));
    await create(client, full);
    expect(sent(calls)).toEqual(full);
    const parked = answering(() => json(entry()));
    await create(parked.client, { ...parking, mixed_service: false });
    expect(sent(parked.calls)).toEqual({ ...parking, mixed_service: false });
    expect(Object.keys(full).length + 1).toBe(24);
  });
  it.each(['rental', 'parkingcarwash', 'garage'])(
    'should accept the service type %s',
    async (type) => {
      const { client, calls } = answering(() => json(entry({ client_service_type: type })));
      await create(client, type === 'rental' ? rental : { ...parking, client_service_type: type });
      expect(sent(calls)).toMatchObject({ client_service_type: type });
    },
  );
  it('should accept either plate or both, choosing neither for the caller', async () => {
    const foreign = {
      vehicle_registration_number: undefined,
      foreign_vehicle_registration_number: 'XY-123',
      vehicle_category: 'bus',
      vehicle_factory: 'Synthetic',
    };
    for (const input of [
      { ...parking, ...foreign },
      { ...parking, ...foreign, vehicle_registration_number: 'ABC1234' },
    ]) {
      const { client, calls } = answering(() => json(entry()));
      expect((await create(client, input)).kind).toBe('observed');
      // Exactly the fields that were given: an undefined plate is left out, never sent as null.
      expect(sent(calls)).toEqual(
        Object.fromEntries(Object.entries(input).filter(([, field]) => field !== undefined)),
      );
    }
  });
  it('should keep the wording of a refusal out of the result and retain it only on request', async () => {
    for (const body of [
      { errors: 'Synthetic refusal text' },
      { errors: [{ code: '203', message: 'Synthetic refusal text' }] },
    ]) {
      const silent = answering(() => json(body));
      const plain = await create(silent.client, parking);
      expect(JSON.stringify(plain)).not.toContain('Synthetic');
      expect(getProviderDiagnostics(plain)).toBeUndefined();
      const { client } = answering(() => json(body));
      const outcome = await create(client, parking, { diagnostics: 'provider-issues' });
      expect(outcome).toEqual(rejected);
      const [issue] = getProviderDiagnostics(outcome)?.issues ?? [];
      expect(issue?.message ?? issue?.title).toBe('Synthetic refusal text');
    }
  });
  it('should read a rejection family from a status beside the errors list', async () => {
    const { client } = answering(() => json({ status: 'myData Errors', errors: [{ title: 'a' }] }));
    expect(await create(client, parking)).toEqual({
      ...rejected,
      rejectionSource: 'mydata-errors',
    });
  });
  it.each([
    ['no service type', { ...parking, client_service_type: undefined }],
    ['an unknown service type', { ...parking, client_service_type: 'hotel' }],
    ['no branch', { ...parking, branch: undefined }],
    ['a numeric branch', { ...parking, branch: 0 }],
    ['neither plate', { ...parking, vehicle_registration_number: undefined }],
    [
      'a foreign plate without a category',
      { ...parking, foreign_vehicle_registration_number: 'XY-123', vehicle_factory: 'S' },
    ],
    [
      'a foreign plate without a factory',
      { ...parking, foreign_vehicle_registration_number: 'XY-123', vehicle_category: 'bus' },
    ],
    ['a rental without a movement purpose', { ...rental, vehicle_movement_purpose: undefined }],
    ['an unknown movement purpose', { ...rental, vehicle_movement_purpose: 'vmp_other' }],
    [
      'a continuous service without its start date',
      { ...parking, continuous_service: true, to_agreed_period_date: '2026-02-07' },
    ],
    [
      'a continuous service without its end date',
      { ...parking, continuous_service: true, from_agreed_period_date: '2026-02-05' },
    ],
    [
      'a period date that is not a calendar date',
      {
        ...parking,
        continuous_service: true,
        from_agreed_period_date: '05-02-2026',
        to_agreed_period_date: '2026-02-07',
      },
    ],
    [
      'a recurring service without the customer tax id',
      { ...parking, recurring_service: true, customer_country: 'GR' },
    ],
    [
      'a recurring service without the customer country',
      { ...parking, recurring_service: true, customer_vat_number: 'x' },
    ],
    [
      'a creation time without transmission_failure true',
      { ...parking, creation_date_time: '2026-02-05T10:00:00Z' },
    ],
    [
      'a creation time that is not a timestamp',
      { ...parking, transmission_failure: true, creation_date_time: '2026-02-05' },
    ],
    ['mixed_service on a rental', { ...rental, mixed_service: false }],
    ['a pickup flag on a parking entry', { ...parking, is_diff_veh_pickup_location: true }],
    ['a pickup location without the flag', { ...rental, vehicle_pickup_location: 'Synthetic' }],
    [
      'a pickup location with the flag false',
      { ...rental, is_diff_veh_pickup_location: false, vehicle_pickup_location: 'S' },
    ],
    ['a periodicity without a continuous lease', { ...parking, periodicity: 'monthly' }],
    ['a flag given as text', { ...parking, mixed_service: 'false' }],
    ['an update field', { ...parking, entry_completion: true }],
    ['an unknown key', { ...parking, status: 'pending' }],
    ['null', null],
  ])('should refuse an entry with %s before any request', async (_label, input) => {
    const { client, calls } = answering(() => json(entry()));
    expect(await failure(create(client, input))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'clienteleCreate',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it('should return the created entry, or a refusal in either form as a rejected result', async () => {
    const created = answering(() => json(entry()));
    const outcome = await create(created.client, parking);
    expect(outcome).toEqual({ kind: 'observed', clientele: entry() });
    expect(Object.isFrozen(outcome)).toBe(true);
    for (const [body, errorCount] of [
      [{ errors: 'Refused' }, 1],
      [
        {
          errors: [
            { code: '204', message: 'a' },
            { code: '203', message: 'b' },
          ],
        },
        2,
      ],
    ] as const) {
      const { client } = answering(() => json(body));
      expect(await create(client, parking)).toEqual({ ...rejected, errorCount });
    }
  });
  it.each([
    ['a correlation notice', { notice: 'Correlated' }],
    ['a refusal beside an entry id', { errors: 'Refused', id: 'clientele-one' }],
    ['an entry without an id', entry({ id: undefined })],
    ['an empty object', {}],
    ['null', null],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client } = answering(() => json(body));
    expect(await failure(create(client, parking))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'clienteleCreate',
      effect: 'unknown',
    });
  });
  it.each(failures)(
    'should dispatch once and report unknown effect after $label',
    async ({ respond, code, httpStatus, timeoutMs }) => {
      const { client, calls } = answering(respond, timeoutMs);
      const error = await failure(create(client, parking));
      expect(error).toMatchObject({ code, operation: 'clienteleCreate', effect: 'unknown' });
      expect(error.httpStatus).toBe(httpStatus);
      expect(dispatched(calls)).toHaveLength(1);
    },
  );
});

describe('digitalClienteles.update input', () => {
  const update = (client: WrappClient, patch: unknown) =>
    client.digitalClienteles.update('clientele-one', patch as never);
  it('should send only the fields given, exact decimals included, and read nothing first', async () => {
    const patch = {
      entry_completion: true,
      non_issue_invoice: false,
      amount: decimal('12.50'),
      is_diff_veh_return_location: true,
      vehicle_return_location: 'Synthetic place',
      provided_service_category: 'other',
      provided_service_category_other: 'Synthetic',
      invoice_kind: 'retail_sales_receipt',
      cooperating_vat_number: 'synthetic-vat',
      other_branch: '1',
      reason_non_issue_type: 'no_invoice_free_service',
      comments: 'Synthetic',
      invoice_counterparty: 'synthetic-party',
      invoice_counterparty_country: 'GR',
    };
    const { client, calls } = answering(() => json(entry({ status: 'complete' })));
    const outcome = await update(client, patch);
    expect(outcome).toMatchObject({ kind: 'observed', clientele: { status: 'complete' } });
    expect(only(calls).init.body).toContain('"amount":12.50');
    expect(sent(calls)).toEqual({ ...patch, amount: 12.5 });
    // The login and the update: the entry is never fetched to learn its service type.
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/api/v1/login',
      '/api/v1/digital_clienteles/clientele-one',
    ]);
  });
  it('should send one field alone and an explicit false as false', async () => {
    const { client, calls } = answering(() => json(entry()));
    await update(client, { non_issue_invoice: false });
    expect(only(calls).init.body).toBe('{"non_issue_invoice":false}');
  });
  it.each([
    ['no field', {}],
    ['only undefined fields', { comments: undefined }],
    ['a return location without the flag', { vehicle_return_location: 'Synthetic' }],
    [
      'a return location with the flag false',
      { is_diff_veh_return_location: false, vehicle_return_location: 'S' },
    ],
    ['an unknown service category', { provided_service_category: 'premium' }],
    [
      'another category text without the category "other"',
      { provided_service_category: 'free_service', provided_service_category_other: 'S' },
    ],
    ['an unknown invoice kind', { invoice_kind: 'ticket' }],
    ['an unknown reason', { reason_non_issue_type: 'no_reason' }],
    ['an amount with three fraction digits', { amount: decimal('1.005') }],
    ['an amount given as a number', { amount: 1 }],
    ['a flag given as text', { entry_completion: 'true' }],
    [
      'off_site_provided_service, whose value form is not established',
      { off_site_provided_service: 'to_internal_location' },
    ],
    ['a create field', { client_service_type: 'garage' }],
    ['null', null],
  ])('should refuse a patch with %s before any request', async (_label, patch) => {
    const { client, calls } = answering(() => json(entry()));
    expect(await failure(update(client, patch))).toMatchObject({
      code: 'INVALID_INPUT',
      operation: 'clienteleUpdate',
      effect: 'not-sent',
    });
    expect(calls).toHaveLength(0);
  });
  it('should return a refusal as a rejected result', async () => {
    const { client } = answering(() => json({ errors: [{ code: '205', message: 'No' }] }));
    expect(await update(client, { comments: 'x' })).toEqual(rejected);
  });
});

describe('digitalClienteles.cancel result', () => {
  it('should send no body and return the cancellation id the provider issued', async () => {
    const { client, calls } = answering(() =>
      json({ notice: 'Cancelled successfully.', cancellation_id: '100000000000002' }),
    );
    const outcome = await client.digitalClienteles.cancel('clientele-one');
    expect(only(calls).init.body).toBeUndefined();
    expect(outcome).toEqual({ kind: 'acknowledged', cancellationId: '100000000000002' });
    expect(Object.isFrozen(outcome)).toBe(true);
  });
  it('should return a refusal in the family text form as a rejected result', async () => {
    const { client } = answering(() => json({ errors: 'Needs to be complete' }));
    expect(await client.digitalClienteles.cancel('clientele-one')).toEqual(rejected);
  });
  it.each([
    ['a notice without a cancellation id: that is a correlation answer', { notice: 'Correlated' }],
    ['a cancellation id without a notice', { cancellation_id: '1' }],
    ['a numeric cancellation id', { notice: 'Cancelled', cancellation_id: 1 }],
    ['an empty cancellation id', { notice: 'Cancelled', cancellation_id: '' }],
    ['a notice beside a refusal', { notice: 'Cancelled', cancellation_id: '1', errors: 'No' }],
    ['an entry record', entry({ status: 'cancelled' })],
    ['an empty object', {}],
    ['null', null],
  ])('should treat %s as a protocol error with unknown effect', async (_label, body) => {
    const { client, calls } = answering(() => json(body));
    expect(await failure(client.digitalClienteles.cancel('clientele-one'))).toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'clienteleCancel',
      effect: 'unknown',
    });
    expect(dispatched(calls)).toHaveLength(1);
  });
});
