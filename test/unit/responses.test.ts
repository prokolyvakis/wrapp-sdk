import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhook, WrappError } from '../../src/index.js';
import type {
  CreateOutcome,
  InvoiceDetails,
  InvoiceObservation,
  InvoiceStatusOutcome,
  PendingInvoiceOutcome,
} from '../../src/index.js';
import { decode, invoiceOutcome, observationSchema, parseJson } from '../../src/codecs.js';
import {
  details,
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

// Synthetic values in the response shapes of the Wrapp reference v1.18.0.
const byId = { kind: 'invoiceId', value: 'invoice-one' } as const;
const byReference = { kind: 'externalId', value: 'reference-one' } as const;
function answering(body: unknown) {
  return provider(({ url }) => (url.pathname.endsWith('/login') ? login() : json(body)));
}
// Serves the exact text, so a test controls the wire token rather than a JavaScript value.
function answeringRaw(text: string) {
  return provider(({ url }) =>
    url.pathname.endsWith('/login')
      ? login()
      : new Response(text, { headers: { 'content-type': 'application/json' } }),
  );
}
const placeholder = '__token__';
function withToken(record: unknown, token: string): string {
  const parts = JSON.stringify(record).split(`"${placeholder}"`);
  if (parts.length !== 2) throw new Error('Expected exactly one placeholder in the fixture');
  return parts.join(token);
}
const webhookKey = 'synthetic-webhook-key';
function issuedWebhook(text: string) {
  const body = Buffer.from(text);
  return verifyWebhook({
    body,
    signature: createHmac('sha256', webhookKey).update(body).digest('hex'),
    keys: [webhookKey],
    eventType: 'issued-invoice',
  });
}
function observedInvoice(outcome: CreateOutcome | InvoiceStatusOutcome): InvoiceObservation {
  if (outcome.kind !== 'observed') throw new Error('Expected observed, got ' + outcome.kind);
  return outcome.invoice;
}
function pendingOutcome(outcome: CreateOutcome | InvoiceStatusOutcome): PendingInvoiceOutcome {
  if (outcome.kind !== 'pending') throw new Error('Expected pending, got ' + outcome.kind);
  return outcome;
}
function without(record: Record<string, unknown>, ...keys: string[]) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}
function page(...invoices: unknown[]) {
  return { invoices, total_count: invoices.length, total_pages: 1, current_page: 1 };
}
// References another producer may have stored: free-form text the outbound path policy refuses.
const foreign = ['synthetic order 42', 'order/42', 'order%42', '#42', 'ref?42', ' padded ', 'Ä/ß'];

describe('returned external references', () => {
  it.each(foreign)(
    'should preserve the returned reference %j on reads by invoice id',
    async (id) => {
      const status = await answering(observation({ external_id: id })).client.invoices.getStatus(
        byId,
      );
      expect(observedInvoice(status).external_id).toBe(id);
      expect(status.identity).toBe('exact');
      const full = await answering(details({ external_id: id })).client.invoices.get(byId);
      expect(full.invoice.external_id).toBe(id);
      expect(full.identity).toBe('exact');
    },
  );
  it('should list and iterate records whose references the outbound policy would refuse', async () => {
    const records = foreign.map((id, index) =>
      details({ id: 'invoice-' + String(index), external_id: id }),
    );
    const { client } = answering(page(...records));
    expect((await client.invoices.list()).invoices.map((record) => record.external_id)).toEqual(
      foreign,
    );
    const seen: (string | null)[] = [];
    for await (const record of client.invoices.iterate({}, { maxPages: 1 }))
      seen.push(record.external_id);
    expect(seen).toEqual(foreign);
  });
  it('should keep null, empty and absent references distinct', async () => {
    expect(
      (await answering(details({ external_id: null })).client.invoices.get(byId)).invoice
        .external_id,
    ).toBeNull();
    expect(
      (await answering(details({ external_id: '' })).client.invoices.get(byId)).invoice.external_id,
    ).toBe('');
    await expect(
      answering(without(details(), 'external_id')).client.invoices.get(byId),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    await expect(
      answering(without(observation(), 'external_id')).client.invoices.getStatus(byId),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  // Raw JSON tokens: a number, a boolean, an array, an overlong string and a lone surrogate.
  it.each(['42', 'true', '["reference-one"]', JSON.stringify('x'.repeat(4097)), '"\\ud800"'])(
    'should reject the malformed returned reference token %s',
    async (token) => {
      const raw = JSON.stringify(details({ external_id: '__reference__' })).replace(
        '"__reference__"',
        token,
      );
      const { client } = provider(({ url }) =>
        url.pathname.endsWith('/login')
          ? login()
          : new Response(raw, { headers: { 'content-type': 'application/json' } }),
      );
      await expect(client.invoices.get(byId)).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    },
  );
  it.each(['unrelated', 'reference one', 'reference-one ', '', null])(
    'should still reject the mismatched echo %j for a read by external reference',
    async (echo) => {
      await expect(
        answering(observation({ external_id: echo })).client.invoices.getStatus(byReference),
      ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
      await expect(
        answering(details({ external_id: echo })).client.invoices.get(byReference),
      ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    },
  );
  it('should still reject a create whose echoed reference differs, with unknown effect', async () => {
    const { client, calls } = answering(observation({ external_id: 'reference one' }));
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'create',
      effect: 'unknown',
    });
    expect(calls).toHaveLength(2);
  });
});

// Every supported path that returns an issued observation, plus the shared codec itself.
async function observations(text: string): Promise<InvoiceObservation[]> {
  const created = await answeringRaw(text).client.invoices.create(invoice());
  const status = await answeringRaw(text).client.invoices.getStatus(byId);
  const hook = issuedWebhook(text);
  if (!('invoice' in hook)) throw new Error('fixture');
  return [
    observedInvoice(created),
    observedInvoice(status),
    hook.invoice,
    decode(observationSchema, parseJson(text), 'test'),
  ];
}
async function refusesObservation(text: string): Promise<void> {
  await expect(answeringRaw(text).client.invoices.create(invoice())).rejects.toMatchObject({
    code: 'PROTOCOL_ERROR',
    effect: 'unknown',
  });
  await expect(answeringRaw(text).client.invoices.getStatus(byId)).rejects.toMatchObject({
    code: 'PROTOCOL_ERROR',
  });
  expect(() => issuedWebhook(text)).toThrow(WrappError);
}
const observationFields = [
  'authentication_code',
  'catering_table_id',
  'card_type',
  'card_number',
  'transaction_id',
] as const;
describe.each(observationFields)('observation field %s', (field) => {
  it('should stay absent when the provider omits it', async () => {
    for (const record of await observations(JSON.stringify(observation())))
      expect(field in record).toBe(false);
  });
  it.each([
    { label: 'a nonempty string', token: '"SYNTHETIC-VALUE"' },
    { label: 'an empty string', token: '""' },
    { label: 'non-ASCII text', token: '"Ελληνικά XXXX-0000"' },
    { label: 'a 4096-unit string', token: JSON.stringify('x'.repeat(4096)) },
    { label: 'an explicit null', token: 'null' },
  ])('should preserve $label on every observation surface', async ({ token }) => {
    const expected: unknown = JSON.parse(token);
    const records = await observations(withToken(observation({ [field]: placeholder }), token));
    expect(records).toHaveLength(4);
    for (const record of records) {
      expect(field in record).toBe(true);
      expect(record[field]).toBe(expected);
      expect(Object.isFrozen(record)).toBe(true);
    }
  });
  it.each([
    { label: 'a number', token: '42' },
    { label: 'a boolean', token: 'true' },
    { label: 'an object', token: '{}' },
    { label: 'an array', token: '["x"]' },
    { label: 'a 4097-unit string', token: JSON.stringify('x'.repeat(4097)) },
  ])('should reject $label on every observation surface', async ({ token }) => {
    await refusesObservation(withToken(observation({ [field]: placeholder }), token));
  });
});

// Every supported path that returns a full-detail record.
async function detailRecords(text: string): Promise<InvoiceDetails[]> {
  const pageText = `{"invoices":[${text}],"total_count":1,"total_pages":1,"current_page":1}`;
  const iterated: InvoiceDetails[] = [];
  for await (const record of answeringRaw(pageText).client.invoices.iterate({}, { maxPages: 1 }))
    iterated.push(record);
  return [
    (await answeringRaw(text).client.invoices.get(byId)).invoice,
    ...(await answeringRaw(pageText).client.invoices.list()).invoices,
    ...iterated,
  ];
}
async function refusesDetails(text: string): Promise<void> {
  const pageText = `{"invoices":[${text}],"total_count":1,"total_pages":1,"current_page":1}`;
  await expect(answeringRaw(text).client.invoices.get(byId)).rejects.toMatchObject({
    code: 'PROTOCOL_ERROR',
  });
  await expect(answeringRaw(pageText).client.invoices.list()).rejects.toMatchObject({
    code: 'PROTOCOL_ERROR',
  });
  await expect(
    answeringRaw(pageText)
      .client.invoices.iterate({}, { maxPages: 1 })
      [Symbol.asyncIterator]()
      .next(),
  ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
}
type Place = 'root' | 'line' | 'counterpart';
function detailWith(at: Place, field: string, token: string): string {
  const base = details();
  const [line] = base.invoice_lines;
  return withToken(
    at === 'root'
      ? { ...base, [field]: placeholder }
      : at === 'counterpart'
        ? { ...base, counterpart: { ...base.counterpart, [field]: placeholder } }
        : { ...base, invoice_lines: [{ ...line, [field]: placeholder }] },
    token,
  );
}
function holder(record: InvoiceDetails, at: Place): object {
  const [line] = record.invoice_lines;
  if (!line) throw new Error('fixture');
  return at === 'root' ? record : at === 'counterpart' ? record.counterpart : line;
}
// Wire tokens per codec. A code is an integer token kept as exact text; an amount keeps the
// provider's numeric text in either token form; text is bounded and otherwise untouched.
interface Sample {
  readonly label: string;
  readonly token: string;
  readonly value?: string | boolean | null;
}
// The provider returns null for a field it has no value for: a line's `code` is null on
// almost every record. Null is therefore a value to keep, apart from absence.
const reportedNull: Sample = { label: 'null', token: 'null', value: null };
type Codec = 'code' | 'flag' | 'amount' | 'text' | 'rate';
const wire: Record<Codec, { valid: readonly Sample[]; invalid: readonly Sample[] }> = {
  code: {
    valid: [
      { label: 'zero', token: '0', value: '0' },
      { label: 'a small code', token: '3', value: '3' },
      { label: 'a 30-digit code', token: '9'.repeat(30), value: '9'.repeat(30) },
      reportedNull,
    ],
    invalid: [
      { label: 'a JSON string', token: '"3"' },
      { label: 'a negative number', token: '-1' },
      { label: 'a fraction', token: '1.5' },
      { label: 'an exponent', token: '1e2' },
      { label: 'a 31-digit code', token: '9'.repeat(31) },
      { label: 'a boolean', token: 'true' },
    ],
  },
  flag: {
    valid: [
      { label: 'true', token: 'true', value: true },
      { label: 'false', token: 'false', value: false },
      reportedNull,
    ],
    invalid: [
      { label: 'a JSON string', token: '"true"' },
      { label: 'a number', token: '0' },
    ],
  },
  amount: {
    valid: [
      { label: 'a zero with a fraction', token: '0.0', value: '0.0' },
      {
        label: 'a value beyond double precision',
        token: '9007199254740993.12',
        value: '9007199254740993.12',
      },
      { label: 'a numeric string', token: '"1.50"', value: '1.50' },
      reportedNull,
    ],
    invalid: [
      { label: 'a negative number', token: '-1' },
      { label: 'non-numeric text', token: '"abc"' },
      { label: 'thirteen fraction digits', token: '1.1234567890123' },
      { label: 'a boolean', token: 'true' },
    ],
  },
  // Provider-observed: the withholding rate arrives as a JSON string, "20" when set and ""
  // when the line has none. A numeric token is accepted too; either keeps its exact text.
  rate: {
    valid: [
      { label: 'a rate as a string', token: '"20"', value: '20' },
      { label: 'an empty string', token: '""', value: '' },
      { label: 'a fractional rate as a string', token: '"7.5"', value: '7.5' },
      { label: 'a rate as a number', token: '20', value: '20' },
      reportedNull,
    ],
    invalid: [
      { label: 'non-numeric text', token: '"twenty"' },
      { label: 'a negative number', token: '-1' },
      { label: 'a boolean', token: 'true' },
      { label: 'an array', token: '["20"]' },
    ],
  },
  text: {
    valid: [
      { label: 'an empty string', token: '""', value: '' },
      {
        label: 'multi-line non-ASCII text',
        token: '"Ελληνικά\\nκείμενο"',
        value: 'Ελληνικά\nκείμενο',
      },
      {
        label: 'a 4096-unit string',
        token: JSON.stringify('x'.repeat(4096)),
        value: 'x'.repeat(4096),
      },
      reportedNull,
    ],
    invalid: [
      { label: 'a number', token: '42' },
      { label: 'an array', token: '["x"]' },
      { label: 'a 4097-unit string', token: JSON.stringify('x'.repeat(4097)) },
    ],
  },
};
const detailFields = [
  { at: 'root', field: 'payment_method', codec: 'code' },
  { at: 'root', field: 'branch', codec: 'code' },
  { at: 'root', field: 'is_delivery_note', codec: 'flag' },
  { at: 'root', field: 'fuel_invoice', codec: 'flag' },
  { at: 'root', field: 'third_party_collection', codec: 'flag' },
  { at: 'root', field: 'exchange_rate', codec: 'amount' },
  { at: 'root', field: 'other_taxes_amount', codec: 'amount' },
  { at: 'root', field: 'notes', codec: 'text' },
  { at: 'root', field: 'withholding_total_amount', codec: 'amount' },
  { at: 'root', field: 'total_stamp_duty_amount', codec: 'amount' },
  { at: 'line', field: 'code', codec: 'text' },
  { at: 'line', field: 'description', codec: 'text' },
  { at: 'line', field: 'quantity_type', codec: 'code' },
  { at: 'line', field: 'withhold_tax_code', codec: 'text' },
  { at: 'line', field: 'withholding_total', codec: 'amount' },
  { at: 'line', field: 'stamp_duty_tax_code', codec: 'text' },
  { at: 'line', field: 'stamp_duty_amount', codec: 'amount' },
  { at: 'line', field: 'deductions_amount', codec: 'amount' },
  { at: 'root', field: 'special_invoice_category', codec: 'code' },
  { at: 'line', field: 'fuel_code', codec: 'code' },
  { at: 'line', field: 'withhold_tax_rate', codec: 'rate' },
  { at: 'counterpart', field: 'supply_account_no', codec: 'text' },
] as const;
describe.each(detailFields)('full-detail $at field $field', ({ at, field, codec }) => {
  it('should stay absent when the provider omits it', async () => {
    const records = await detailRecords(JSON.stringify(details()));
    expect(records).toHaveLength(3);
    for (const record of records) expect(field in holder(record, at)).toBe(false);
  });
  it.each(wire[codec].valid)(
    'should preserve $label through get, list and iterate',
    async (sample) => {
      const records = await detailRecords(detailWith(at, field, sample.token));
      expect(records).toHaveLength(3);
      for (const record of records) {
        const target = holder(record, at);
        const value: unknown = Reflect.get(target, field);
        expect(value).toBe(sample.value);
        expect(Object.isFrozen(target)).toBe(true);
      }
    },
  );
  it.each(wire[codec].invalid)(
    'should reject $label through get, list and iterate',
    async (sample) => {
      await refusesDetails(detailWith(at, field, sample.token));
    },
  );
});
describe('read shapes of records the SDK does not issue', () => {
  // A list returns every invoice of the tenant, whatever its type. These are the shapes the
  // provider returns for types with no counterpart or with lines that carry no name, VAT rate
  // or classification: one such record must not make the whole read fail.
  const [line] = details().invoice_lines;
  const sparse = {
    ...details(),
    counterpart: { name: '', vat: '', city: '', street: '', number: '', postal_code: '' },
    invoice_lines: [
      {
        ...line,
        name: '',
        code: null,
        quantity_type: null,
        vat_rate: null,
        classification_category: null,
        classification_type: null,
      },
    ],
  };
  it('should decode a record with an empty counterpart name and null line fields, keeping them as they came', async () => {
    const records = await detailRecords(JSON.stringify(sparse));
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.counterpart.name).toBe('');
      expect(record.invoice_lines[0]).toMatchObject({
        name: '',
        code: null,
        quantity_type: null,
        vat_rate: null,
        classification_category: null,
        classification_type: null,
      });
    }
  });
  it.each([
    ['a numeric line name', { name: 5 }],
    ['a null line name', { name: null }],
    ['a textual VAT rate', { vat_rate: '24' }],
    ['a fractional VAT rate', { vat_rate: 24.5 }],
    ['a numeric classification category', { classification_category: 1 }],
    ['a numeric classification type', { classification_type: 1 }],
  ])('should still reject %s', async (_label, patch) => {
    await refusesDetails(JSON.stringify({ ...details(), invoice_lines: [{ ...line, ...patch }] }));
  });
  it('should still reject a counterpart without a name', async () => {
    await refusesDetails(
      JSON.stringify({ ...details(), counterpart: { vat: '', city: 'Athens' } }),
    );
  });
});
describe('documented read shapes', () => {
  it('should decode the whole documented observation field set', async () => {
    for (const record of await observations(JSON.stringify(fullObservation())))
      expect(record).toMatchObject({
        catering_table_id: null,
        authentication_code: 'SYNTHETIC-AUTHENTICATION-CODE',
        card_type: 'SYNTHETIC',
        card_number: 'XXXX-XXXX-XXXX-0000',
        transaction_id: 'transaction-one',
      });
  });
  it('should decode the whole documented full-detail field set with codes and amounts as exact text', async () => {
    const text = JSON.stringify(fullDetails())
      .replace('"exchange_rate":1,', '"exchange_rate":1.0,')
      .replace('"withholding_total":0,', '"withholding_total":0.0,');
    for (const record of await detailRecords(text)) {
      expect(record).toMatchObject({
        payment_method: '3',
        branch: '0',
        is_delivery_note: false,
        fuel_invoice: false,
        third_party_collection: false,
        exchange_rate: '1.0',
        other_taxes_amount: '0',
        notes: '',
        withholding_total_amount: '0',
        total_stamp_duty_amount: '0',
      });
      expect(record.invoice_lines[0]).toMatchObject({
        code: 'SKU-SYNTHETIC',
        description: '',
        quantity_type: '1',
        withhold_tax_code: '',
        withholding_total: '0.0',
        stamp_duty_tax_code: '',
        stamp_duty_amount: '0',
        deductions_amount: '0',
      });
    }
  });
  it('should tolerate the two fields with unresolved output contracts without projecting them', async () => {
    const body = {
      ...fullDetails(),
      pos_device_id: 'device-one',
      pos_type: 1,
      future_field: { nested: [1, 2, 3] },
    };
    for (const record of await detailRecords(JSON.stringify(body)))
      for (const key of ['pos_device_id', 'pos_type', 'future_field'])
        expect(key in record).toBe(false);
  });
});

// The three structured fields, in the shapes the provider returns for a B2G invoice, a
// delivery note and a line with deductions. Values are synthetic.
const deliveryDetails = {
  dispatch_date: '08-10-2026',
  dispatch_time: '10:30',
  vehicle_number: 'ABC1234',
  purpose_of_movement: '1',
  purpose_of_movement_custom_title: '',
  issuer_of_movement: 'Synthetic Carrier',
  from_address: 'Origin Street',
  from_number: '1',
  from_city: 'Origin City',
  from_zipcode: '10431',
  from_branch: 0,
  to_address: 'Destination Street',
  to_number: '2',
  to_city: 'Destination City',
  to_zipcode: '10432',
  to_branch: null,
  reverse_delivery_note: false,
  reverse_delivery_note_purpose: null,
  non_obligated_recipient: false,
  without_digital_transport_tracking: true,
};
const b2gDetails = {
  buyer_reference: '',
  delivery_address_city: 'Synthetic City',
  delivery_address_street: 'Synthetic Street',
  delivery_address_street_number: '1',
  delivery_address_postal_code: '10431',
  delivery_address_party_name: 'Synthetic Authority',
  b2g_contracting_authority_id: '1000.E00001.00001',
  b2g_contract_identifier: '26SYMV000000001',
  b2g_budget_type: 1,
  b2g_budget_identifier: 'SYNTHETIC-ADA',
  b2g_due_date: '06-11-2026',
  b2g_payment_details: 'Synthetic payment details',
  bt_70: '',
};
function withLine(patch: Record<string, unknown>): string {
  const base = details();
  const [line] = base.invoice_lines;
  return JSON.stringify({ ...base, invoice_lines: [{ ...line, ...patch }] });
}
describe('full-detail structured fields', () => {
  it('should return delivery_details whole, codes as exact text, null and false kept', async () => {
    const records = await detailRecords(
      JSON.stringify({ ...details(), delivery_details: { ...deliveryDetails, additive: 1 } }),
    );
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.delivery_details).toEqual({ ...deliveryDetails, from_branch: '0' });
      expect(Object.isFrozen(record.delivery_details)).toBe(true);
    }
  });
  it('should keep a populated destination branch and reverse purpose as exact text', async () => {
    const text = JSON.stringify({
      ...details(),
      delivery_details: {
        to_branch: 7,
        reverse_delivery_note: true,
        reverse_delivery_note_purpose: 5,
      },
    }).replace('"to_branch":7', '"to_branch":9007199254740993');
    for (const record of await detailRecords(text))
      expect(record.delivery_details).toEqual({
        to_branch: '9007199254740993',
        reverse_delivery_note: true,
        reverse_delivery_note_purpose: '5',
      });
  });
  it('should return b2g_details whole, the budget type as exact text and the due date as the provider wrote it', async () => {
    for (const record of await detailRecords(
      JSON.stringify({ ...details(), b2g_details: { ...b2gDetails, additive: 1 } }),
    )) {
      expect(record.b2g_details).toEqual({ ...b2gDetails, b2g_budget_type: '1' });
      expect(Object.isFrozen(record.b2g_details)).toBe(true);
    }
  });
  it('should return line deductions with exact amounts, and an omitted item field as absent', async () => {
    const text = withLine({
      deductions: [
        { title: 'Synthetic deduction', amount: 5, informational: false },
        { amount: '2.50' },
      ],
    }).replace('"amount":5,', '"amount":5.00,');
    for (const record of await detailRecords(text)) {
      const [line] = record.invoice_lines;
      expect(line?.deductions).toEqual([
        { title: 'Synthetic deduction', amount: '5.00', informational: false },
        { amount: '2.50' },
      ]);
      expect(Object.isFrozen(line?.deductions)).toBe(true);
      expect(line?.deductions?.every((item) => Object.isFrozen(item))).toBe(true);
    }
  });
  it('should keep an empty deductions list as empty, apart from an absent one', async () => {
    for (const record of await detailRecords(withLine({ deductions: [] })))
      expect(record.invoice_lines[0]?.deductions).toEqual([]);
    for (const record of await detailRecords(JSON.stringify(details())))
      expect('deductions' in (record.invoice_lines[0] ?? {})).toBe(false);
  });
  it.each(['delivery_details', 'b2g_details'] as const)(
    'should keep %s absent when omitted and null when the provider says null',
    async (field) => {
      for (const record of await detailRecords(JSON.stringify(details())))
        expect(field in record).toBe(false);
      for (const record of await detailRecords(JSON.stringify({ ...details(), [field]: null })))
        expect(record[field]).toBeNull();
    },
  );
  it('should accept a sparse object: every member is optional and may be null', async () => {
    const sparse = { ...details(), delivery_details: { dispatch_date: null }, b2g_details: {} };
    for (const record of await detailRecords(JSON.stringify(sparse))) {
      expect(record.delivery_details).toEqual({ dispatch_date: null });
      expect(record.b2g_details).toEqual({});
    }
  });
  it.each([
    ['delivery_details as text', { delivery_details: 'none' }],
    ['delivery_details as a list', { delivery_details: [deliveryDetails] }],
    [
      'a numeric dispatch date',
      { delivery_details: { ...deliveryDetails, dispatch_date: 8102026 } },
    ],
    ['a textual branch', { delivery_details: { ...deliveryDetails, from_branch: 'main' } }],
    [
      'a textual tracking flag',
      { delivery_details: { ...deliveryDetails, non_obligated_recipient: 'false' } },
    ],
    ['b2g_details as text', { b2g_details: 'none' }],
    ['a textual budget type', { b2g_details: { ...b2gDetails, b2g_budget_type: 'regular' } }],
    [
      'a numeric authority id',
      { b2g_details: { ...b2gDetails, b2g_contracting_authority_id: 1000 } },
    ],
  ])('should reject %s', async (_label, patch) => {
    await refusesDetails(JSON.stringify({ ...details(), ...patch }));
  });
  it.each([
    ['deductions as text', { deductions: 'none' }],
    ['a deduction without an amount', { deductions: [{ title: 'Synthetic deduction' }] }],
    ['a non-numeric deduction amount', { deductions: [{ amount: 'five' }] }],
    ['a numeric deduction title', { deductions: [{ title: 5, amount: 1 }] }],
    ['a textual informational flag', { deductions: [{ amount: 1, informational: 'no' }] }],
    ['a deduction that is not an object', { deductions: [5] }],
  ])('should reject %s on a line', async (_label, patch) => {
    await refusesDetails(withLine(patch));
  });
});

describe('pending outcomes', () => {
  it('should report a minimal pending create with unavailable identity and no invoice', async () => {
    const outcome = await answering(pending()).client.invoices.create(invoice());
    expect(outcome).toEqual({
      kind: 'pending',
      invoiceId: 'invoice-one',
      referenceState: 'unknown',
      identity: 'unavailable',
    });
    expect('invoice' in outcome).toBe(false);
  });
  it('should report a minimal pending status by invoice id as an exact id match', async () => {
    expect(await answering(pending()).client.invoices.getStatus(byId)).toEqual({
      kind: 'pending',
      invoiceId: 'invoice-one',
      referenceState: 'unknown',
      identity: 'exact',
    });
  });
  it('should never compare an external reference with the provider id of a minimal pending status', async () => {
    // Even an invoice id spelled like the requested reference proves nothing about the reference.
    for (const invoiceId of ['invoice-one', 'reference-one']) {
      expect(
        await answering(pending({ invoice_id: invoiceId })).client.invoices.getStatus(byReference),
      ).toEqual({
        kind: 'pending',
        invoiceId,
        referenceState: 'unknown',
        identity: 'unavailable',
      });
    }
  });
  it('should keep the enriched evidence of a transmission-failure pending on create and status', async () => {
    const evidence = {
      id: 'invoice-one',
      external_id: 'reference-one',
      my_data_mark: null,
      my_data_uid: 'uid-one',
      my_data_qr_url: 'https://example.invalid/qr',
      series: 'S',
      num: '1',
      issued_at: '2026-09-21',
      transmission_failure: '2',
      authentication_code: null,
      catering_table_id: null,
      card_type: null,
      card_number: null,
      transaction_id: null,
    };
    const created = await answering(enrichedPending()).client.invoices.create(invoice());
    const statusById = await answering(enrichedPending()).client.invoices.getStatus(byId);
    const statusByReference =
      await answering(enrichedPending()).client.invoices.getStatus(byReference);
    for (const outcome of [created, statusById, statusByReference].map(pendingOutcome)) {
      expect(outcome).toMatchObject({
        kind: 'pending',
        invoiceId: 'invoice-one',
        referenceState: 'unknown',
        identity: 'exact',
        invoice: evidence,
      });
      // The envelope keys are not part of the retained observation.
      expect(outcome.invoice && 'status' in outcome.invoice).toBe(false);
      expect(outcome.invoice && 'invoice_id' in outcome.invoice).toBe(false);
    }
  });
  it('should carry every documented optional observation field through an enriched pending', async () => {
    const body = enrichedPending({
      authentication_code: 'SYNTHETIC-AUTHENTICATION-CODE',
      catering_table_id: 'table-one',
      card_type: 'SYNTHETIC',
      card_number: 'XXXX-XXXX-XXXX-0000',
      transaction_id: 'transaction-one',
    });
    for (const outcome of [
      await answering(body).client.invoices.create(invoice()),
      await answering(body).client.invoices.getStatus(byId),
    ].map(pendingOutcome)) {
      expect(outcome.invoice).toMatchObject({
        authentication_code: 'SYNTHETIC-AUTHENTICATION-CODE',
        catering_table_id: 'table-one',
        card_type: 'SYNTHETIC',
        card_number: 'XXXX-XXXX-XXXX-0000',
        transaction_id: 'transaction-one',
      });
    }
  });
  it('should surface an ASCII case variant of the reference on an enriched pending', async () => {
    const body = enrichedPending({ external_id: 'REFERENCE-ONE' });
    expect(await answering(body).client.invoices.create(invoice())).toMatchObject({
      kind: 'pending',
      identity: 'ascii-case-variant',
    });
    expect(await answering(body).client.invoices.getStatus(byReference)).toMatchObject({
      kind: 'pending',
      identity: 'ascii-case-variant',
    });
  });
  it.each([
    { label: 'a failure code of 2', code: 2, kept: '2' },
    { label: 'a failure code of 1', code: 1, kept: '1' },
    { label: 'an unfamiliar failure code', code: 99, kept: '99' },
    { label: 'no failure code', code: null, kept: null },
  ])(
    'should stay pending with $label, whatever number and date it carries',
    async ({ code, kept }) => {
      const body = enrichedPending({ transmission_failure: code, my_data_mark: 'mark-one' });
      for (const outcome of [
        await answering(body).client.invoices.create(invoice()),
        await answering(body).client.invoices.getStatus(byId),
      ].map(pendingOutcome)) {
        expect(outcome).toMatchObject({ referenceState: 'unknown' });
        expect(outcome.invoice).toMatchObject({
          num: '1',
          issued_at: '2026-09-21',
          my_data_mark: 'mark-one',
          transmission_failure: kept,
        });
      }
    },
  );
  it.each([
    {
      label: 'an enriched id differing from invoice_id',
      body: enrichedPending({ id: 'invoice-two' }),
    },
    {
      label: 'an enriched invoice_id differing from id',
      body: enrichedPending({ invoice_id: 'invoice-two' }),
    },
    {
      label: 'an enriched id differing only in case',
      body: enrichedPending({ invoice_id: 'INVOICE-ONE' }),
    },
    { label: 'an unknown status', body: pending({ status: 'processing' }) },
    { label: 'a status of another type', body: pending({ status: true }) },
    { label: 'an empty invoice_id', body: pending({ invoice_id: '' }) },
    { label: 'a missing invoice_id', body: { status: 'pending' } },
    { label: 'one stray observation field', body: pending({ my_data_uid: 'uid-one' }) },
    { label: 'only an id beside the envelope', body: pending({ id: 'invoice-one' }) },
    { label: 'an explicit null observation field', body: pending({ my_data_mark: null }) },
    {
      label: 'a malformed known observation field',
      body: enrichedPending({ my_data_qr_url: 'http://example.invalid/qr' }),
    },
    { label: 'a malformed optional observation field', body: enrichedPending({ card_type: 42 }) },
    { label: 'an enriched body missing a required field', body: without(enrichedPending(), 'num') },
    { label: 'errors beside an id', body: { ...enrichedPending(), errors: [{ title: 'x' }] } },
    { label: 'errors beside an invoice_id', body: { ...pending(), errors: [{ title: 'x' }] } },
    { label: 'an error string beside a pending envelope', body: { ...pending(), error: 'x' } },
  ])('should fail closed on $label for create and status', async ({ body }) => {
    const { client, calls } = answering(body);
    await expect(client.invoices.create(invoice())).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'create',
      effect: 'unknown',
    });
    expect(calls).toHaveLength(2);
    await expect(client.invoices.getStatus(byId)).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
      operation: 'status',
      effect: 'not-sent',
    });
  });
  it('should reject a minimal pending status whose invoice id is not the one requested', async () => {
    for (const invoiceId of ['invoice-two', 'INVOICE-ONE'])
      await expect(
        answering(pending({ invoice_id: invoiceId })).client.invoices.getStatus(byId),
      ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR', operation: 'status' });
  });
  it.each(['unrelated', null, 'reference one', ''])(
    'should reject an enriched pending whose reference echo is %j',
    async (echo) => {
      const body = enrichedPending({ external_id: echo });
      await expect(answering(body).client.invoices.create(invoice())).rejects.toMatchObject({
        code: 'PROTOCOL_ERROR',
        effect: 'unknown',
      });
      await expect(answering(body).client.invoices.getStatus(byReference)).rejects.toMatchObject({
        code: 'PROTOCOL_ERROR',
      });
    },
  );
  it('should accept an enriched pending read by invoice id whatever reference the record holds', async () => {
    for (const echo of ['unrelated', null, 'reference one', ''])
      expect(
        await answering(enrichedPending({ external_id: echo })).client.invoices.getStatus(byId),
      ).toMatchObject({ kind: 'pending', identity: 'exact', invoice: { external_id: echo } });
  });
  it('should tolerate unrelated additive properties on every envelope', async () => {
    const extra = { future_field: { nested: true }, another: 1 };
    expect(await answering(pending(extra)).client.invoices.getStatus(byReference)).toEqual({
      kind: 'pending',
      invoiceId: 'invoice-one',
      referenceState: 'unknown',
      identity: 'unavailable',
    });
    expect(await answering(enrichedPending(extra)).client.invoices.create(invoice())).toMatchObject(
      { kind: 'pending', identity: 'exact' },
    );
    const observed = await answering(observation(extra)).client.invoices.getStatus(byReference);
    expect(observed).toMatchObject({ kind: 'observed', identity: 'exact' });
    expect('future_field' in observedInvoice(observed)).toBe(false);
  });
  it('should keep an observation without a pending status observed, even with a failure code', async () => {
    const body = observation({ transmission_failure: 2, my_data_mark: null });
    expect(await answering(body).client.invoices.getStatus(byId)).toMatchObject({
      kind: 'observed',
      identity: 'exact',
      invoice: { transmission_failure: '2', my_data_mark: null },
    });
    expect(await answering(body).client.invoices.create(invoice())).toMatchObject({
      kind: 'observed',
    });
  });
  it('should keep a status rejection an error and a create rejection a result', async () => {
    const body = { errors: [{ title: 'Record not found' }] };
    await expect(answering(body).client.invoices.getStatus(byId)).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
      operation: 'status',
      effect: 'not-sent',
    });
    expect(await answering(body).client.invoices.create(invoice())).toEqual({
      kind: 'rejected',
      errorCount: 1,
      rejectionSource: 'unknown',
      referenceState: 'unknown',
    });
  });
  it.each([
    { label: 'HTTP 401', respond: () => json({}, 401), code: 'AUTH_ERROR' },
    { label: 'HTTP 429', respond: () => json({}, 429), code: 'HTTP_ERROR' },
    { label: 'HTTP 500', respond: () => json({}, 500), code: 'HTTP_ERROR' },
    {
      label: 'a malformed body',
      respond: () => new Response('{', { headers: { 'content-type': 'application/json' } }),
      code: 'PROTOCOL_ERROR',
    },
    {
      label: 'a response that never arrives',
      respond: () => new Promise<Response>(() => undefined),
      code: 'TIMEOUT',
      // The only case that needs a short deadline; the others answer at once.
      timeoutMs: 50,
    },
  ])(
    'should dispatch a create once and report unknown effect after $label',
    async ({ respond, code, timeoutMs }) => {
      const { client, calls } = provider(
        ({ url }) => (url.pathname.endsWith('/login') ? login() : respond()),
        timeoutMs === undefined ? {} : { timeoutMs },
      );
      await expect(client.invoices.create(invoice())).rejects.toMatchObject({
        code,
        operation: 'create',
        effect: 'unknown',
      });
      expect(calls.filter((call) => call.url.pathname.endsWith('/invoices'))).toHaveLength(1);
      expect(calls).toHaveLength(2);
    },
  );
  it('should return deeply frozen outcomes', async () => {
    const outcomes = [
      await answering(pending()).client.invoices.create(invoice()),
      await answering(enrichedPending()).client.invoices.create(invoice()),
      await answering(enrichedPending()).client.invoices.getStatus(byId),
      await answering(observation()).client.invoices.getStatus(byId),
    ];
    for (const outcome of outcomes) {
      expect(Object.isFrozen(outcome)).toBe(true);
      if (outcome.kind !== 'rejected' && outcome.invoice)
        expect(Object.isFrozen(outcome.invoice)).toBe(true);
      expect(() => {
        Object.assign(outcome, { kind: 'observed' });
      }).toThrow(TypeError);
    }
  });
  it.each([
    { label: 'a minimal pending', body: pending() },
    { label: 'an enriched pending', body: enrichedPending() },
    { label: 'an observation', body: observation() },
  ])('should build $label outcome that shares nothing with the parsed response', ({ body }) => {
    const parsed = parseJson(JSON.stringify(body));
    const outcome = invoiceOutcome(parsed, byId, 'status');
    // The parser's own object is left alone: not returned, not nested, not frozen.
    expect(Object.isFrozen(parsed)).toBe(false);
    expect(outcome).not.toBe(parsed);
    expect(outcome.invoice).not.toBe(parsed);
    const before = JSON.stringify(outcome);
    Object.assign(parsed as object, { series: 'changed', invoice_id: 'changed', id: 'changed' });
    expect(JSON.stringify(outcome)).toBe(before);
  });
});
