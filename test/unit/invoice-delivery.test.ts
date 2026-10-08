import { LosslessNumber, parse } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { decimal } from '../../src/index.js';
import type { CreateInvoiceInput } from '../../src/index.js';
import { invoice, json, login, observation, provider } from '../fixtures/provider.js';

// Synthetic values in the request shape of the Wrapp reference v1.18.0. The reference gives a
// field table and one example for the delivery-detail object, and field notes only for invoice
// types 9.2, 9.3, 10.1 and 10.2; these cases are authored from those notes, one rule at a time.
type Patch = Record<string, unknown>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function issuing() {
  return provider(({ url, init }) => {
    if (url.pathname.endsWith('/login')) return login();
    const sentBody: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const reference = isRecord(sentBody) ? sentBody.external_id : undefined;
    return json(observation(typeof reference === 'string' ? { external_id: reference } : {}));
  });
}
// A key set to undefined is removed, at any of the three levels. Deliberately untyped: these
// tests exercise the runtime boundary with values the public types would refuse.
function strip(value: Patch): Patch {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
function build(root: Patch = {}, lines: readonly Patch[] = [{}], counterpart: Patch = {}) {
  const base = invoice();
  const [first] = base.invoice_lines;
  const patched: unknown = strip({
    ...base,
    ...root,
    counterpart: strip({ ...base.counterpart, ...counterpart }),
    invoice_lines: lines.map((patch, index) =>
      strip({ ...first, line_number: index + 1, ...patch }),
    ),
  });
  return patched as CreateInvoiceInput;
}
function wire(value: unknown): unknown {
  if (value instanceof LosslessNumber) return '#' + value.value;
  if (Array.isArray(value)) return value.map(wire);
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)]));
  return value;
}
interface Sent {
  readonly create: Record<string, unknown>;
  readonly counterpart: Record<string, unknown>;
  readonly lines: readonly Record<string, unknown>[];
}
async function accepted(input: CreateInvoiceInput): Promise<Sent> {
  const { client, calls } = issuing();
  expect((await client.invoices.create(input)).kind).toBe('observed');
  expect(calls).toHaveLength(2);
  const body = calls.at(-1)?.init.body;
  const create = wire(typeof body === 'string' ? parse(body) : undefined);
  if (!isRecord(create) || !Array.isArray(create.invoice_lines) || !isRecord(create.counterpart))
    throw new Error('The dispatched body is not a create request');
  return { create, counterpart: create.counterpart, lines: create.invoice_lines.filter(isRecord) };
}
async function refused(input: CreateInvoiceInput): Promise<void> {
  const { client, calls } = issuing();
  await expect(client.invoices.create(input)).rejects.toMatchObject({
    name: 'WrappError',
    code: 'INVALID_INPUT',
    operation: 'create',
    effect: 'not-sent',
  });
  // Not even the login request: validation precedes authentication.
  expect(calls).toHaveLength(0);
}

const detail = {
  dispatch_date: '21-03-2026',
  dispatch_time: '02:30',
  vehicle_number: 'ABC1234',
  purpose_of_movement: '1',
  issuer_of_movement: 'Synthetic Carrier',
  from_address: 'Origin Street',
  from_number: '10',
  from_city: 'Origin City',
  from_zipcode: '12345',
  to_address: 'Destination Street',
  to_number: '20',
  to_city: 'Destination City',
  to_zipcode: '54321',
};
const requiredDetailKeys = Object.keys(detail);
const delivery = (patch: Patch = {}, root: Patch = {}) =>
  build({ is_delivery_note: true, delivery_detail: strip({ ...detail, ...patch }), ...root });
const entity = {
  entity_type: 1,
  vat_number: '000000000',
  country_code: 'GR',
  branch_code: 0,
  name: 'Synthetic Sender',
  street: 'Sender Street',
  number: '5',
  postal_code: '11111',
  city: 'Sender City',
};
const zero = {
  vat_total_amount: decimal('0'),
  total_amount: decimal('0.00'),
  payable_total_amount: decimal('0.0'),
};

describe('delivery note fields', () => {
  it('should send none of the delivery or receipt fields when the caller supplies none', async () => {
    const sent = await accepted(build());
    for (const key of [
      'is_delivery_note',
      'delivery_detail',
      'other_correlated_entities',
      'receiving_note_purpose',
      'other_receiving_note_purpose_title',
    ])
      expect(sent.create, key).not.toHaveProperty(key);
  });
  it('should send the whole delivery detail under its exact names and values', async () => {
    const full = {
      ...detail,
      purpose_of_movement: '19',
      purpose_of_movement_custom_title: 'Synthetic purpose',
      reverse_delivery_note: true,
      reverse_delivery_note_purpose: 2,
      non_obligated_recipient: false,
      without_digital_transport_tracking: false,
      from_branch: 0,
      to_branch: 3,
    };
    const sent = await accepted(delivery(full));
    expect(Object.keys(full)).toHaveLength(20);
    expect(sent.create.is_delivery_note).toBe(true);
    expect(sent.create.delivery_detail).toEqual({
      ...full,
      reverse_delivery_note_purpose: '#2',
      from_branch: '#0',
      to_branch: '#3',
    });
  });
  it('should send the thirteen required fields alone and add no default', async () => {
    expect((await accepted(delivery())).create.delivery_detail).toEqual(detail);
  });
  it.each(requiredDetailKeys)('should refuse a delivery detail without %s', async (key) => {
    await refused(delivery({ [key]: undefined }));
  });
  it.each(requiredDetailKeys)('should refuse an empty or non-text %s', async (key) => {
    await refused(delivery({ [key]: '' }));
    await refused(delivery({ [key]: 5 }));
    await refused(delivery({ [key]: null }));
  });
  it('should refuse a delivery detail key the reference does not define', async () => {
    await refused(delivery({ driver: 'Synthetic' }));
  });
  it.each([null, 'detail', [], [detail]])(
    'should refuse a delivery detail that is not an object (%j)',
    async (value) => {
      await refused(build({ is_delivery_note: true, delivery_detail: value }));
    },
  );
});

describe('delivery branch codes', () => {
  const branchKeys = ['from_branch', 'to_branch'] as const;
  it.each(branchKeys)(
    'should send %s alone as an integer token, without the other',
    async (key) => {
      const other = key === 'from_branch' ? 'to_branch' : 'from_branch';
      for (const code of [0, 1, 42, Number.MAX_SAFE_INTEGER]) {
        const sent = (await accepted(delivery({ [key]: code }))).create.delivery_detail;
        expect(sent).toEqual({ ...detail, [key]: '#' + String(code) });
        expect(sent).not.toHaveProperty(other);
      }
    },
  );
  it('should send both codes as given, equal or different, and look no branch up', async () => {
    for (const [from, to] of [
      [0, 0],
      [1, 2],
    ]) {
      const { client, calls } = issuing();
      await client.invoices.create(delivery({ from_branch: from, to_branch: to }));
      // The login and the create: no branch list is fetched to check or translate a code.
      expect(calls.map((call) => call.url.pathname)).toEqual(['/api/v1/login', '/api/v1/invoices']);
      expect(calls.at(-1)?.init.body).toContain(
        '"from_branch":' + String(from) + ',"to_branch":' + String(to),
      );
    }
  });
  it('should treat an explicit undefined as omitted and send no null in its place', async () => {
    const input = build({
      is_delivery_note: true,
      delivery_detail: { ...detail, from_branch: undefined, to_branch: undefined },
    });
    expect((await accepted(input)).create.delivery_detail).toEqual(detail);
  });
  it.each(branchKeys)('should refuse a %s that is not a nonnegative integer', async (key) => {
    for (const value of ['0', '1', -1, 1.5, 2 ** 53, Number.NaN, null, true, [0], 'branch-id'])
      await refused(delivery({ [key]: value }));
  });
  it('should have no place for a branch code on an invoice that is not a delivery note', async () => {
    await refused(build({ from_branch: 0 }));
    await refused(build({ to_branch: 0 }));
  });
});

describe('delivery flag and detail belong together', () => {
  it('should refuse is_delivery_note true without a delivery detail', async () => {
    await refused(build({ is_delivery_note: true }));
  });
  it.each([undefined, false])(
    'should refuse a delivery detail sent with is_delivery_note %j',
    async (flag) => {
      await refused(build({ is_delivery_note: flag, delivery_detail: detail }));
    },
  );
  it('should preserve is_delivery_note false on an invoice that is not a delivery note', async () => {
    const sent = await accepted(build({ is_delivery_note: false }));
    expect(sent.create.is_delivery_note).toBe(false);
    expect(sent.create).not.toHaveProperty('delivery_detail');
  });
  it.each(['true', 1, 0, null])('should refuse is_delivery_note %j', async (flag) => {
    await refused(build({ is_delivery_note: flag, delivery_detail: detail }));
  });
});

describe('dispatch date, time and purpose of movement', () => {
  it.each(['21-03-2026', '29-02-2028', '31-12-2026', '01-01-2026'])(
    'should send the dispatch date %s as given',
    async (date) => {
      const sent = await accepted(delivery({ dispatch_date: date }));
      expect(sent.create.delivery_detail).toMatchObject({ dispatch_date: date });
    },
  );
  it.each([
    '30-02-2026',
    '29-02-2027',
    '31-04-2026',
    '32-01-2026',
    '00-01-2026',
    '01-13-2026',
    '2026-03-21',
    '1-3-2026',
    '21/03/2026',
    ' 21-03-2026',
  ])('should refuse the dispatch date %j', async (date) => {
    await refused(delivery({ dispatch_date: date }));
  });
  it.each(['00:00', '02:30', '23:59'])(
    'should send the dispatch time %s as given',
    async (time) => {
      const sent = await accepted(delivery({ dispatch_time: time }));
      expect(sent.create.delivery_detail).toMatchObject({ dispatch_time: time });
    },
  );
  it.each(['24:00', '2:30', '12:60', '12:5', '12.30', '12:30:00', ' 12:30'])(
    'should refuse the dispatch time %j',
    async (time) => {
      await refused(delivery({ dispatch_time: time }));
    },
  );
  it.each(['1', '2', '3', '4', '5', '7', '8', '9', '10', '11', '12', '13', '14', '20'])(
    'should send purpose_of_movement "%s" as a string',
    async (purpose) => {
      const sent = await accepted(delivery({ purpose_of_movement: purpose }));
      expect(sent.create.delivery_detail).toMatchObject({ purpose_of_movement: purpose });
    },
  );
  it.each(['6', '15', '16', '17', '18', '0', '21', '01', 1, null])(
    'should refuse purpose_of_movement %j',
    async (purpose) => {
      await refused(delivery({ purpose_of_movement: purpose }));
    },
  );
  it('should require a custom title for purpose 19 and send it', async () => {
    await refused(delivery({ purpose_of_movement: '19' }));
    await refused(delivery({ purpose_of_movement: '19', purpose_of_movement_custom_title: '' }));
    const sent = await accepted(
      delivery({ purpose_of_movement: '19', purpose_of_movement_custom_title: 'Synthetic' }),
    );
    expect(sent.create.delivery_detail).toMatchObject({
      purpose_of_movement: '19',
      purpose_of_movement_custom_title: 'Synthetic',
    });
  });
  it('should send a custom title given with another purpose as it is', async () => {
    const sent = await accepted(delivery({ purpose_of_movement_custom_title: 'Synthetic' }));
    expect(sent.create.delivery_detail).toMatchObject({
      purpose_of_movement: '1',
      purpose_of_movement_custom_title: 'Synthetic',
    });
  });
});

describe('reverse delivery note and tracking flags', () => {
  it.each([1, 2, 3, 4, 5])(
    'should send a reverse delivery note with purpose %d as an integer',
    async (purpose) => {
      const sent = await accepted(
        delivery({ reverse_delivery_note: true, reverse_delivery_note_purpose: purpose }),
      );
      expect(sent.create.delivery_detail).toMatchObject({
        reverse_delivery_note: true,
        reverse_delivery_note_purpose: '#' + String(purpose),
      });
    },
  );
  it('should refuse a reverse delivery note without its purpose', async () => {
    await refused(delivery({ reverse_delivery_note: true }));
  });
  it.each([0, 6, 1.5, '1', null])(
    'should refuse reverse_delivery_note_purpose %j',
    async (purpose) => {
      await refused(
        delivery({ reverse_delivery_note: true, reverse_delivery_note_purpose: purpose }),
      );
    },
  );
  it('should preserve reverse_delivery_note false and require no purpose for it', async () => {
    const sent = await accepted(delivery({ reverse_delivery_note: false }));
    expect(sent.create.delivery_detail).toMatchObject({ reverse_delivery_note: false });
    expect(sent.create.delivery_detail).not.toHaveProperty('reverse_delivery_note_purpose');
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    'should send non_obligated_recipient %j with without_digital_transport_tracking %j',
    async (recipient, tracking) => {
      const flags = {
        non_obligated_recipient: recipient,
        without_digital_transport_tracking: tracking,
      };
      expect((await accepted(delivery(flags))).create.delivery_detail).toMatchObject(flags);
    },
  );
  it('should refuse both tracking flags set to true', async () => {
    await refused(
      delivery({ non_obligated_recipient: true, without_digital_transport_tracking: true }),
    );
  });
  it.each([
    'non_obligated_recipient',
    'without_digital_transport_tracking',
    'reverse_delivery_note',
  ])('should refuse a non-boolean %s', async (key) => {
    await refused(delivery({ [key]: 'true' }));
    await refused(delivery({ [key]: 1 }));
  });
  it('should have no place for a tracking flag on an invoice that is not a delivery note', async () => {
    await refused(build({ without_digital_transport_tracking: true }));
    await refused(
      build({ delivery_detail: { ...detail, without_digital_transport_tracking: true } }),
    );
  });
});

describe('other correlated entities', () => {
  it('should send an entity under its nine exact names, tax id as text and codes as integers', async () => {
    const sent = await accepted(build({ other_correlated_entities: [entity, entity] }));
    const expected = { ...entity, entity_type: '#1', branch_code: '#0' };
    expect(Object.keys(entity)).toHaveLength(9);
    expect(sent.create.other_correlated_entities).toEqual([expected, expected]);
  });
  it.each(Object.keys(entity))('should refuse an entity without %s', async (key) => {
    await refused(build({ other_correlated_entities: [strip({ ...entity, [key]: undefined })] }));
  });
  it.each([1, 2, 3, 4, 5, 6])('should send entity_type %d as an integer', async (type) => {
    const sent = await accepted(
      build({ other_correlated_entities: [{ ...entity, entity_type: type }] }),
    );
    expect(sent.create.other_correlated_entities).toMatchObject([
      { entity_type: '#' + String(type) },
    ]);
  });
  it.each([
    ['an entity type of 0', { entity_type: 0 }],
    ['an entity type of 7', { entity_type: 7 }],
    ['a text entity type', { entity_type: '1' }],
    ['a numeric tax id', { vat_number: 123456789 }],
    ['an empty tax id', { vat_number: '' }],
    ['a lowercase country code', { country_code: 'gr' }],
    ['a three-letter country code', { country_code: 'GRC' }],
    ['a negative branch code', { branch_code: -1 }],
    ['a fractional branch code', { branch_code: 1.5 }],
    ['a text branch code', { branch_code: '0' }],
    ['an empty name', { name: '' }],
    ['an empty street', { street: '' }],
    ['a numeric street number', { number: 5 }],
    ['an empty postal code', { postal_code: '' }],
    ['an empty city', { city: '' }],
    ['an unknown key', { email: 'x@example.invalid' }],
  ])('should refuse an entity with %s', async (_label, patch) => {
    await refused(build({ other_correlated_entities: [{ ...entity, ...patch }] }));
  });
  it('should send an empty list as given and refuse a value that is not a list', async () => {
    expect((await accepted(build({ other_correlated_entities: [] }))).create).toMatchObject({
      other_correlated_entities: [],
    });
    await refused(build({ other_correlated_entities: entity }));
    await refused(build({ other_correlated_entities: [null] }));
    await refused(build({ other_correlated_entities: Array.from({ length: 101 }, () => entity) }));
  });
});

// Delivery notes (9.2, 9.3) and quantity receipt notes (10.1, 10.2). Each is sent in the one
// shape the provider was observed to accept: all four totals at zero, zero-value category3
// lines, a full counterpart; the delivery flag and detail on 9.x; a receipt purpose on 10.x.
// The cases below pin each rule separately. Values are synthetic.
const noteTypes = ['9.2', '9.3', '10.1', '10.2'] as const;
type NoteType = (typeof noteTypes)[number];
const zeroLine = {
  unit_price: decimal('0'),
  net_total_price: decimal('0'),
  vat_rate: 24,
  vat_total: decimal('0'),
  subtotal: decimal('0.00'),
  classification_category: 'category3',
  classification_type: '_',
};
const zeroTotals = { net_total_amount: decimal('0'), ...zero };
function note(type: NoteType, root: Patch = {}, lines?: readonly Patch[], counterpart: Patch = {}) {
  const receipt = type.startsWith('10.')
    ? { receiving_note_purpose: 1, correlated_invoices: ['400000000000001'] }
    : { is_delivery_note: true, delivery_detail: detail };
  return build(
    { invoice_type_code: type, ...zeroTotals, ...receipt, ...root },
    lines ?? [zeroLine],
    counterpart,
  );
}

describe.each(noteTypes)('invoice type %s shape', (type) => {
  it('should send the type with all four totals at zero and a zero-value category3 line', async () => {
    const sent = await accepted(note(type));
    expect(sent.create).toMatchObject({
      invoice_type_code: type,
      net_total_amount: '#0',
      vat_total_amount: '#0',
      total_amount: '#0.00',
      payable_total_amount: '#0.0',
    });
    expect(sent.lines[0]).toMatchObject({
      net_total_price: '#0',
      vat_rate: '#24',
      vat_total: '#0',
      subtotal: '#0.00',
      classification_category: 'category3',
      classification_type: '_',
    });
  });
  it.each(['net_total_amount', 'vat_total_amount', 'total_amount', 'payable_total_amount'])(
    'should refuse a %s that is not exactly zero',
    async (key) => {
      await refused(note(type, { [key]: decimal('0.01') }));
      await refused(note(type, { [key]: decimal('10.00') }));
    },
  );
  it.each([
    ['a net price above zero', { net_total_price: decimal('10.00') }],
    ['a VAT rate other than 24', { vat_rate: 13 }],
    ['a zero VAT rate with an exemption', { vat_rate: 0, vat_exemption_code: 1 }],
    ['a line VAT total above zero', { vat_total: decimal('0.01') }],
    ['a line subtotal above zero', { subtotal: decimal('12.40') }],
    ['another classification category', { classification_category: 'category1_3' }],
    ['no classification category', { classification_category: undefined }],
    [
      'a classifications array, which would override category3',
      { classifications: [{ category: 'category1_3', type: 'E3_561_001', amount: decimal('0') }] },
    ],
    [
      'a classifications array even of category3',
      { classifications: [{ category: 'category3', type: '_', amount: decimal('0') }] },
    ],
  ])('should refuse a line with %s', async (_label, patch) => {
    await refused(note(type, {}, [{ ...zeroLine, ...patch }]));
    await refused(note(type, {}, [zeroLine, { ...zeroLine, ...patch }]));
  });
  it.each(['vat', 'country_code', 'city', 'street', 'number', 'postal_code'])(
    'should require the full counterpart: refuse it without %s',
    async (key) => {
      await refused(note(type, {}, undefined, { [key]: undefined }));
    },
  );
});

describe.each(['9.2', '9.3'] as const)('delivery note type %s', (type) => {
  it('should send the delivery flag and detail', async () => {
    const sent = await accepted(note(type));
    expect(sent.create.is_delivery_note).toBe(true);
    expect(sent.create.delivery_detail).toEqual(detail);
  });
  it('should refuse the type without the delivery flag or without the delivery detail', async () => {
    await refused(note(type, { is_delivery_note: undefined, delivery_detail: undefined }));
    await refused(note(type, { is_delivery_note: false, delivery_detail: undefined }));
    await refused(note(type, { delivery_detail: undefined }));
  });
  it('should refuse a receiving note purpose or its title', async () => {
    await refused(note(type, { receiving_note_purpose: 1 }));
    await refused(note(type, { other_receiving_note_purpose_title: 'Synthetic' }));
  });
});

describe.each(['10.1', '10.2'] as const)('quantity receipt note type %s', (type) => {
  it('should refuse the type without a receiving_note_purpose', async () => {
    await refused(note(type, { receiving_note_purpose: undefined }));
  });
  it.each([1, 2, 3, 4, 6])(
    'should send receiving_note_purpose %d as an integer',
    async (purpose) => {
      const sent = await accepted(note(type, { receiving_note_purpose: purpose }));
      expect(sent.create.receiving_note_purpose).toBe('#' + String(purpose));
    },
  );
  it.each([0, 8, 1.5, '1', null])('should refuse receiving_note_purpose %j', async (purpose) => {
    await refused(note(type, { receiving_note_purpose: purpose }));
  });
  it('should require a title for purpose 7, of at most 150 characters', async () => {
    await refused(note(type, { receiving_note_purpose: 7 }));
    await refused(
      note(type, { receiving_note_purpose: 7, other_receiving_note_purpose_title: '' }),
    );
    const longest = 'τ'.repeat(150);
    const sent = await accepted(
      note(type, { receiving_note_purpose: 7, other_receiving_note_purpose_title: longest }),
    );
    expect(sent.create.other_receiving_note_purpose_title).toBe(longest);
    await refused(
      note(type, { receiving_note_purpose: 7, other_receiving_note_purpose_title: longest + 'τ' }),
    );
  });
  it('should refuse delivery fields: none was observed on a receipt note', async () => {
    await refused(note(type, { is_delivery_note: true, delivery_detail: detail }));
    await refused(note(type, { delivery_detail: detail }));
  });
});

describe('quantity receipt note types differ', () => {
  it('should accept purpose 5 on 10.1 only', async () => {
    expect((await accepted(note('10.1', { receiving_note_purpose: 5 }))).create).toMatchObject({
      receiving_note_purpose: '#5',
    });
    await refused(note('10.2', { receiving_note_purpose: 5 }));
  });
  it('should require the mark of the received delivery note on 10.1 only', async () => {
    await refused(note('10.1', { correlated_invoices: undefined }));
    await refused(note('10.1', { correlated_invoices: [] }));
    const sent = await accepted(note('10.2', { correlated_invoices: undefined }));
    expect(sent.create).not.toHaveProperty('correlated_invoices');
    expect((await accepted(note('10.1'))).create.correlated_invoices).toEqual(['400000000000001']);
  });
});

const ordinaryTypes = ['1.1', '2.1', '2.2', '2.3', '5.2', '11.1', '11.2', '11.4'] as const;
describe('types without rules of their own', () => {
  it.each(ordinaryTypes)(
    'should send invoice type %s with ordinary amounts and lines',
    async (type) => {
      const sent = await accepted(build({ invoice_type_code: type }));
      expect(sent.create).toMatchObject({ invoice_type_code: type, total_amount: '#12.40' });
      expect(sent.lines[0]).toMatchObject({ classification_category: 'category1_3' });
    },
  );
  it.each([...ordinaryTypes, '5.1'] as const)(
    'should refuse a receiving note purpose or its title on invoice type %s',
    async (type) => {
      const marks = type === '5.1' ? { correlated_invoices: ['400000000000001'] } : {};
      await refused(build({ invoice_type_code: type, ...marks, receiving_note_purpose: 1 }));
      await refused(
        build({
          invoice_type_code: type,
          ...marks,
          other_receiving_note_purpose_title: 'Synthetic',
        }),
      );
    },
  );
  it.each(['11.1', '11.2', '11.4'] as const)(
    'should accept a name-only counterpart on retail type %s',
    async (type) => {
      const input = build({ invoice_type_code: type });
      const patched: unknown = { ...input, counterpart: { name: 'Synthetic Person' } };
      expect((await accepted(patched as CreateInvoiceInput)).counterpart).toEqual({
        name: 'Synthetic Person',
      });
    },
  );
  it.each(['1.1', '5.1', '5.2'] as const)(
    'should require the full counterpart on type %s',
    async (type) => {
      const marks = type === '5.1' ? { correlated_invoices: ['400000000000001'] } : {};
      await refused(build({ invoice_type_code: type, ...marks }, [{}], { vat: undefined }));
    },
  );
});

describe('credit invoice type 5.1', () => {
  it('should send the mark of the credited invoice', async () => {
    const sent = await accepted(
      build({ invoice_type_code: '5.1', correlated_invoices: ['400000000000001'] }),
    );
    expect(sent.create.correlated_invoices).toEqual(['400000000000001']);
  });
  it('should refuse the type without a correlated mark', async () => {
    await refused(build({ invoice_type_code: '5.1' }));
    await refused(build({ invoice_type_code: '5.1', correlated_invoices: [] }));
  });
  it('should leave the correlation optional on the uncorrelated credit types', async () => {
    for (const type of ['5.2', '11.4'] as const)
      expect((await accepted(build({ invoice_type_code: type }))).create).not.toHaveProperty(
        'correlated_invoices',
      );
  });
});
