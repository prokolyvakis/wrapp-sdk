import { decimal, WrappClient } from '../../src/index.js';
import type { ClientOptions, CreateInvoiceInput } from '../../src/index.js';

export const credentials = {
  apiKey: 'synthetic-test-key',
  tenant: { kind: 'userId', value: 'tenant-test' },
} as const;
export function observation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-one',
    external_id: 'reference-one',
    my_data_mark: '90071992547409931234',
    my_data_uid: 'uid-one',
    my_data_qr_url: 'https://example.invalid/qr',
    series: 'S',
    num: 1,
    issued_at: '21-09-2026',
    cancelled_by_mark: null,
    transmission_failure: null,
    wrapp_invoice_url: 'https://example.invalid/el',
    wrapp_invoice_url_en: 'https://example.invalid/en',
    ...overrides,
  };
}
export function details(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-one',
    external_id: 'reference-one',
    invoice_type_code: '2.1',
    billing_book_id: 'book-one',
    issued_at: '2026-09-21 10:00:00 +0300',
    code: 'S.1',
    currency: 'EUR',
    net_total_amount: 10,
    vat_total_amount: 2.4,
    total_amount: 12.4,
    payable_total_amount: 12.4,
    counterpart: { name: 'Synthetic Company', country_code: 'GR' },
    invoice_lines: [
      {
        line_number: 1,
        name: 'Synthetic service',
        quantity: 1,
        unit_price: 10,
        net_total_price: 10,
        vat_rate: 24,
        vat_total: 2.4,
        subtotal: 12.4,
        classification_category: 'category1_3',
        classification_type: 'E3_561_001',
      },
    ],
    ...overrides,
  };
}
/** The whole documented observation field set (reference v1.18.0), with synthetic values. */
export function fullObservation(overrides: Record<string, unknown> = {}) {
  return observation({
    catering_table_id: null,
    authentication_code: 'SYNTHETIC-AUTHENTICATION-CODE',
    card_type: 'SYNTHETIC',
    card_number: 'XXXX-XXXX-XXXX-0000',
    transaction_id: 'transaction-one',
    ...overrides,
  });
}
/**
 * The whole documented full-detail field set (reference v1.18.0), with synthetic values. It
 * includes the fields whose populated shape is undocumented, in their documented empty form.
 */
export function fullDetails(overrides: Record<string, unknown> = {}) {
  return details({
    payment_method: 3,
    branch: 0,
    is_delivery_note: false,
    fuel_invoice: false,
    third_party_collection: false,
    exchange_rate: 1,
    other_taxes_amount: 0,
    notes: '',
    withholding_total_amount: 0,
    total_stamp_duty_amount: 0,
    invoice_lines: [
      {
        line_number: 1,
        name: 'Synthetic service',
        code: 'SKU-SYNTHETIC',
        description: '',
        quantity: 1,
        quantity_type: 1,
        unit_price: 10,
        net_total_price: 10,
        vat_rate: 24,
        vat_total: 2.4,
        subtotal: 12.4,
        withhold_tax_rate: '',
        withhold_tax_code: '',
        withholding_total: 0,
        classification_category: 'category1_3',
        classification_type: 'E3_561_001',
        stamp_duty_tax_code: '',
        stamp_duty_amount: 0,
        deductions_amount: 0,
        deductions: [],
      },
    ],
    ...overrides,
  });
}
/** The documented minimal pending envelope: a status and the provider invoice id, nothing else. */
export function pending(overrides: Record<string, unknown> = {}) {
  return { status: 'pending', invoice_id: 'invoice-one', ...overrides };
}
/**
 * The documented enriched pending envelope for transmission failure 2: the whole observation
 * field set, with no MARK yet, plus the pending status and invoice id.
 */
export function enrichedPending(overrides: Record<string, unknown> = {}) {
  return fullObservation({
    my_data_mark: null,
    authentication_code: null,
    card_type: null,
    card_number: null,
    transaction_id: null,
    transmission_failure: 2,
    status: 'pending',
    invoice_id: 'invoice-one',
    ...overrides,
  });
}
export function tenant(overrides: Record<string, unknown> = {}) {
  return {
    wrapp_user_id: 'tenant-test',
    partner_user_id: null,
    issue_invoice_status: true,
    email: 'synthetic@example.invalid',
    has_plan: true,
    plan_name: 'Synthetic',
    next_payment_date: null,
    next_payment_amount: null,
    ...overrides,
  };
}
export function invoice(): CreateInvoiceInput {
  return {
    external_id: 'reference-one',
    billing_book_id: 'book-one',
    invoice_type_code: '2.1',
    payment_method_type: 1,
    counterpart: {
      name: 'Synthetic Company',
      country_code: 'GR',
      vat: 'synthetic-vat',
      city: 'Athens',
      street: 'Synthetic',
      number: '1',
      postal_code: '00000',
    },
    net_total_amount: decimal('10.00'),
    vat_total_amount: decimal('2.40'),
    total_amount: decimal('12.40'),
    payable_total_amount: decimal('12.40'),
    invoice_lines: [
      {
        line_number: 1,
        name: 'Synthetic service',
        quantity: decimal('1'),
        unit_price: decimal('10'),
        net_total_price: decimal('10'),
        vat_rate: 24,
        vat_total: decimal('2.40'),
        subtotal: decimal('12.40'),
        classification_category: 'category1_3',
        classification_type: 'E3_561_001',
      },
    ],
  };
}
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
export function login(token = 'synthetic.jwt.token'): Response {
  return json({ data: { type: 'jwt', attributes: { jwt: token } } });
}
export interface RecordedRequest {
  readonly url: URL;
  readonly init: RequestInit;
}
export function provider(
  handler: (request: RecordedRequest) => Response | Promise<Response>,
  overrides: Partial<ClientOptions> = {},
) {
  const calls: RecordedRequest[] = [];
  const fetcher: typeof fetch = (resource, init = {}) => {
    const request = {
      url: new URL(resource instanceof Request ? resource.url : String(resource)),
      init,
    };
    calls.push(request);
    return Promise.resolve(handler(request));
  };
  const client = new WrappClient({
    environment: 'staging',
    credentials,
    ...overrides,
    advanced: { ...overrides.advanced, fetch: fetcher },
  });
  return { client, calls };
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Not initialized');
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error('Not initialized');
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function ticks() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
