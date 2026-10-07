import { LosslessNumber, parse } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { createSchemaFor, encodeJson } from '../../src/codecs.js';
import { decimal } from '../../src/index.js';
import type { CreateInvoiceInput } from '../../src/index.js';
import {
  invoiceTypeCatalogue,
  preparedInvoiceTypeCodes,
  preparedTypeProfiles,
  supportedInvoiceTypeCodes,
} from '../../src/invoice-contracts.js';
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
const noteLine = {
  vat_rate: 24,
  vat_total: decimal('0'),
  subtotal: decimal('0.00'),
  classification_category: 'category3',
  classification_type: '_',
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
    };
    const sent = await accepted(delivery(full));
    expect(Object.keys(full)).toHaveLength(18);
    expect(sent.create.is_delivery_note).toBe(true);
    expect(sent.create.delivery_detail).toEqual({ ...full, reverse_delivery_note_purpose: '#2' });
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
  it.each([
    ['from_branch', 1],
    ['to_branch', 2],
    ['driver', 'Synthetic'],
  ])('should refuse the delivery detail key %s, which is not available', async (key, value) => {
    await refused(delivery({ [key]: value }));
  });
  it.each([null, 'detail', [], [detail]])(
    'should refuse a delivery detail that is not an object (%j)',
    async (value) => {
      await refused(build({ is_delivery_note: true, delivery_detail: value }));
    },
  );
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

// The four types below are NOT accepted by create(): the reference states rules for them in
// field notes and shows no request for any of them. Their stated rules are kept as prepared
// profiles, exercised here through the same validation pipeline built for the prepared codes.
// Passing these tests shows the notes are implemented as written; it is not evidence that the
// provider accepts such a request, and it does not justify accepting a type.
const prepared = createSchemaFor(preparedInvoiceTypeCodes);
type PreparedCode = (typeof preparedInvoiceTypeCodes)[number];
function note(type: PreparedCode, root: Patch = {}, lines?: readonly Patch[]): unknown {
  const receipt = type.startsWith('10.')
    ? { receiving_note_purpose: 1, correlated_invoices: ['400000000000001'] }
    : { is_delivery_note: true, delivery_detail: detail };
  return build(
    { invoice_type_code: type, ...zero, ...receipt, ...root },
    lines ?? [type === '9.3' ? noteLine : {}],
  );
}
function withCounterpart(input: unknown, patch: Patch): unknown {
  if (!isRecord(input) || !isRecord(input.counterpart)) throw new Error('Not a create input');
  return { ...input, counterpart: strip({ ...input.counterpart, ...patch }) };
}
// The literal body the pipeline would serialize, or undefined when it refuses the input.
function profiled(input: unknown): Sent | undefined {
  const result = prepared.safeParse(input);
  if (!result.success) return undefined;
  const create = wire(parse(encodeJson(result.data)));
  if (!isRecord(create) || !Array.isArray(create.invoice_lines) || !isRecord(create.counterpart))
    throw new Error('The serialized value is not a create request');
  return { create, counterpart: create.counterpart, lines: create.invoice_lines.filter(isRecord) };
}
const passes = (input: unknown) => profiled(input) !== undefined;

describe('prepared profiles are not accepted by create', () => {
  it('should prepare exactly the four codes and keep each of them unaccepted', () => {
    expect([...preparedInvoiceTypeCodes]).toEqual(['9.2', '9.3', '10.1', '10.2']);
    expect(Object.keys(preparedTypeProfiles)).toEqual([...preparedInvoiceTypeCodes]);
    const supported: readonly string[] = supportedInvoiceTypeCodes;
    for (const code of preparedInvoiceTypeCodes) {
      expect(supported).not.toContain(code);
      expect(invoiceTypeCatalogue.find((entry) => entry.code === code)).toEqual({
        code,
        supported: false,
        reason: 'field-notes-only',
      });
    }
  });
  it.each(preparedInvoiceTypeCodes)(
    'should refuse a well-formed type %s request before authentication',
    async (type) => {
      // The prepared pipeline accepts this very input; the public operation does not.
      expect(passes(note(type))).toBe(true);
      await refused(note(type) as CreateInvoiceInput);
    },
  );
  it.each(supportedInvoiceTypeCodes)(
    'should refuse a receiving note purpose or its title on invoice type %s',
    async (type) => {
      await refused(build({ invoice_type_code: type, receiving_note_purpose: 1 }));
      await refused(
        build({ invoice_type_code: type, other_receiving_note_purpose_title: 'Synthetic' }),
      );
    },
  );
  it.each(supportedInvoiceTypeCodes)(
    'should leave invoice type %s without zero-total or category rules, with an optional delivery note',
    async (type) => {
      const plain = await accepted(build({ invoice_type_code: type }));
      expect(plain.create.total_amount).toBe('#12.40');
      const asNote = await accepted(delivery({}, { invoice_type_code: type }));
      expect(asNote.create).toMatchObject({ is_delivery_note: true, total_amount: '#12.40' });
    },
  );
});

describe.each(preparedInvoiceTypeCodes)('prepared type %s totals', (type) => {
  it('should pass with its three totals at zero, in any spelling of zero', () => {
    expect(profiled(note(type))?.create).toMatchObject({
      invoice_type_code: type,
      vat_total_amount: '#0',
      total_amount: '#0.00',
      payable_total_amount: '#0.0',
      net_total_amount: '#10.00',
    });
  });
  it.each(['vat_total_amount', 'total_amount', 'payable_total_amount'])(
    'should fail when %s is not exactly zero',
    (key) => {
      expect(passes(note(type, { [key]: decimal('0.01') }))).toBe(false);
      expect(passes(note(type, { [key]: decimal('10.00') }))).toBe(false);
    },
  );
});

describe('prepared type 9.3', () => {
  it('should serialize the documented line representation exactly', () => {
    const sent = profiled(note('9.3'));
    expect(sent?.create.is_delivery_note).toBe(true);
    expect(sent?.create.delivery_detail).toEqual(detail);
    expect(sent?.lines[0]).toMatchObject({
      vat_rate: '#24',
      vat_total: '#0',
      subtotal: '#0.00',
      classification_category: 'category3',
      classification_type: '_',
    });
  });
  it.each([
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
  ])('should fail a line with %s', (_label, patch) => {
    expect(passes(note('9.3', {}, [{ ...noteLine, ...patch }]))).toBe(false);
    expect(passes(note('9.3', {}, [noteLine, { ...noteLine, ...patch }]))).toBe(false);
  });
  it('should fail without the delivery flag or without the delivery detail', () => {
    expect(passes(note('9.3', { is_delivery_note: undefined, delivery_detail: undefined }))).toBe(
      false,
    );
    expect(passes(note('9.3', { is_delivery_note: false, delivery_detail: undefined }))).toBe(
      false,
    );
    expect(passes(note('9.3', { delivery_detail: undefined }))).toBe(false);
  });
  it.each(['vat', 'country_code', 'city', 'street', 'number', 'postal_code'])(
    'should keep the general counterpart rule: fail without %s',
    (key) => {
      expect(passes(withCounterpart(note('9.3'), { [key]: undefined }))).toBe(false);
    },
  );
});

describe('prepared type 9.2', () => {
  const address = { vat: undefined, country_code: undefined };
  it('should pass with a counterpart that has a name and an address and no tax id', () => {
    expect(profiled(withCounterpart(note('9.2'), address))?.counterpart).toEqual({
      name: 'Synthetic Company',
      city: 'Athens',
      street: 'Synthetic',
      number: '1',
      postal_code: '00000',
    });
  });
  it.each(['name', 'city', 'street', 'number', 'postal_code'])(
    'should fail a counterpart without %s',
    (key) => {
      expect(passes(withCounterpart(note('9.2'), { ...address, [key]: undefined }))).toBe(false);
    },
  );
  it('should leave a supplied tax id as given: the reference says the provider transmits zeros', () => {
    expect(profiled(note('9.2'))?.counterpart.vat).toBe('synthetic-vat');
  });
  it('should fail without the delivery flag or without the delivery detail', () => {
    expect(passes(note('9.2', { is_delivery_note: undefined, delivery_detail: undefined }))).toBe(
      false,
    );
    expect(passes(note('9.2', { delivery_detail: undefined }))).toBe(false);
  });
  it('should keep the ordinary line rules: no category3 representation is required', () => {
    expect(profiled(note('9.2'))?.lines[0]).toMatchObject({
      classification_category: 'category1_3',
      vat_rate: '#24',
    });
  });
});

describe.each(['10.1', '10.2'] as const)('prepared type %s receipt purpose', (type) => {
  it('should fail without a receiving_note_purpose', () => {
    expect(passes(note(type, { receiving_note_purpose: undefined }))).toBe(false);
  });
  it.each([1, 2, 3, 4, 6])(
    'should serialize receiving_note_purpose %d as an integer',
    (purpose) => {
      expect(profiled(note(type, { receiving_note_purpose: purpose }))?.create).toMatchObject({
        receiving_note_purpose: '#' + String(purpose),
      });
    },
  );
  it.each([0, 8, 1.5, '1', null])('should fail receiving_note_purpose %j', (purpose) => {
    expect(passes(note(type, { receiving_note_purpose: purpose }))).toBe(false);
  });
  it('should require a title for purpose 7, of at most 150 characters', () => {
    expect(passes(note(type, { receiving_note_purpose: 7 }))).toBe(false);
    expect(
      passes(note(type, { receiving_note_purpose: 7, other_receiving_note_purpose_title: '' })),
    ).toBe(false);
    const longest = 'τ'.repeat(150);
    expect(
      profiled(
        note(type, { receiving_note_purpose: 7, other_receiving_note_purpose_title: longest }),
      )?.create.other_receiving_note_purpose_title,
    ).toBe(longest);
    expect(
      passes(
        note(type, {
          receiving_note_purpose: 7,
          other_receiving_note_purpose_title: longest + 'τ',
        }),
      ),
    ).toBe(false);
  });
  it('should fail with delivery fields: the reference states none for a receipt note', () => {
    expect(passes(note(type))).toBe(true);
    expect(passes(note(type, { is_delivery_note: true, delivery_detail: detail }))).toBe(false);
    expect(passes(note(type, { delivery_detail: detail }))).toBe(false);
  });
  it.each(['vat', 'country_code', 'city', 'street', 'number', 'postal_code'])(
    'should keep the general counterpart rule: fail without %s',
    (key) => {
      expect(passes(withCounterpart(note(type), { [key]: undefined }))).toBe(false);
    },
  );
});

describe('prepared types 10.1 and 10.2 differ', () => {
  it('should pass purpose 5 on 10.1 only', () => {
    expect(profiled(note('10.1', { receiving_note_purpose: 5 }))?.create).toMatchObject({
      receiving_note_purpose: '#5',
    });
    expect(passes(note('10.2', { receiving_note_purpose: 5 }))).toBe(false);
  });
  it('should require the mark of the received delivery note on 10.1 only', () => {
    expect(passes(note('10.1', { correlated_invoices: undefined }))).toBe(false);
    expect(passes(note('10.1', { correlated_invoices: [] }))).toBe(false);
    expect(profiled(note('10.2', { correlated_invoices: undefined }))?.create).not.toHaveProperty(
      'correlated_invoices',
    );
    expect(profiled(note('10.1'))?.create.correlated_invoices).toEqual(['400000000000001']);
  });
});

describe('receipt fields on prepared delivery types', () => {
  it.each(['9.2', '9.3'] as const)(
    'should fail a receiving note purpose or its title on type %s',
    (type) => {
      expect(passes(note(type))).toBe(true);
      expect(passes(note(type, { receiving_note_purpose: 1 }))).toBe(false);
      expect(passes(note(type, { other_receiving_note_purpose_title: 'Synthetic' }))).toBe(false);
    },
  );
});
