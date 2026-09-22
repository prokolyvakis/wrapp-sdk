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
