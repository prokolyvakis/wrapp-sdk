# API reference

This page lists every operation the SDK supports and the rules of each one, field by field. It
says what the SDK does: [design.md](design.md) explains why,
[invoice-capabilities.md](invoice-capabilities.md) lists every invoice type and its status, and
[migration.md](migration.md) covers upgrading. Synthetic tests and provider observations are
not production certification; see [provider-evidence.md](provider-evidence.md) for what is
grounded in documentation, what is observed behavior, and what remains an open question.

## Contents

- [Supported operations](#supported-operations)
- [Creating invoices](#creating-invoices)
  - [Create outcomes](#create-outcomes)
  - [Pending outcomes](#pending-outcomes)
  - [Required fields](#required-fields)
  - [Optional invoice fields](#optional-invoice-fields)
  - [Supported invoice types](#supported-invoice-types)
  - [Fields that are not supported](#fields-that-are-not-supported)
  - [Counterpart](#counterpart)
  - [Lines and classification](#lines-and-classification)
  - [General invoice and line fields](#general-invoice-and-line-fields)
  - [POS fields](#pos-fields)
  - [Fuel fields](#fuel-fields)
  - [B2G fields](#b2g-fields)
  - [Delivery notes](#delivery-notes)
  - [Invoice types with rules of their own](#invoice-types-with-rules-of-their-own)
  - [Presence rules and totals](#presence-rules-and-totals)
  - [Decimals and code sets](#decimals-and-code-sets)
- [Invoice management](#invoice-management)
- [Drafts](#drafts)
- [PDFs](#pdfs)
- [Branches and billing books](#branches-and-billing-books)
- [Digital clientele](#digital-clientele)
  - [Entries](#entries)
  - [Correlations](#correlations)
- [POS devices and sessions](#pos-devices-and-sessions)
- [Catering tables and order notes](#catering-tables-and-order-notes)
  - [Tables](#tables)
  - [Order notes](#order-notes)
- [Digital transports](#digital-transports)
  - [Opaque provider evidence](#opaque-provider-evidence)
- [Reading invoices](#reading-invoices)
- [Returned fields](#returned-fields)
- [Webhook events](#webhook-events)
- [Deliberate differences from the provider API](#deliberate-differences-from-the-provider-api)
- [Invariants and failure modes](#invariants-and-failure-modes)

## Supported operations

The table lists every operation with the provider route it calls. A resource is a property of
the client: `invoices.create` is called as `client.invoices.create(...)`.

| Resource                            | Method/path under /api/v1                      | Effect         |
| ----------------------------------- | ---------------------------------------------- | -------------- |
| login (internal)                    | POST /login                                    | authentication |
| tenant.get                          | GET /tenant_details                            | read           |
| vat.search                          | GET /vat_search?vat=...&country_code=...       | read           |
| vat.exemptions                      | GET /vat_exemptions                            | read           |
| branches.list                       | GET /branches                                  | read           |
| billingBooks.list                   | GET /billing_books                             | read           |
| invoices.getStatus                  | GET /invoices/:id                              | read           |
| invoices.get                        | GET /invoices/:id/find_invoice_by_id           | read           |
| invoices.list / iterate             | GET /invoices/find_all_invoices                | read           |
| invoices.create                     | POST /invoices                                 | effectful      |
| invoices.requestPdf                 | GET /invoices/:id/generate_pdf                 | effectful      |
| invoices.requestThermalPdf          | GET /invoices/:id/generate_thermal_pdf         | effectful      |
| invoices.issuedCount                | GET /invoices/issued_count                     | read           |
| invoices.cancelDeliveryNote         | DELETE /invoices/:id/cancel                    | effectful      |
| invoices.setExternalId              | PUT /invoices/:invoice_id/set_external_id      | effectful      |
| invoices.markAsPaid                 | GET /invoices/:invoice_id/mark_as_paid         | effectful      |
| invoices.drafts.delete              | DELETE /invoices/:invoice_id/delete_draft      | effectful      |
| invoices.drafts.create              | POST /invoices                                 | effectful      |
| invoices.drafts.issue               | POST /invoices/:invoice_id/issue_draft         | effectful      |
| invoices.drafts.list / iterate      | GET /invoices/find_all_invoices?status=draft   | read           |
| branches.create                     | POST /branches                                 | effectful      |
| branches.update                     | PUT /branches/:id                              | effectful      |
| billingBooks.create                 | POST /billing_books                            | effectful      |
| billingBooks.updateNumber           | PUT /billing_books/:id                         | effectful      |
| digitalClienteles.correlateByMark   | POST /digital_clienteles/:id/correlate_by_mark | effectful      |
| digitalClienteles.correlateByFim    | POST /digital_clienteles/:id/correlate_by_fim  | effectful      |
| digitalClienteles.get               | GET /digital_clienteles/:id                    | read           |
| digitalClienteles.create            | POST /digital_clienteles                       | effectful      |
| digitalClienteles.update            | POST /digital_clienteles/:id                   | effectful      |
| digitalClienteles.cancel            | POST /digital_clienteles/:id/cancel            | effectful      |
| posDevices.list                     | GET /pos_devices                               | read           |
| posDevices.create                   | POST /pos_devices                              | effectful      |
| posDevices.delete                   | DELETE /pos_devices/:id                        | effectful      |
| posSessions.abort                   | POST /pos_sessions/:id/abort_session           | effectful      |
| cateringTables.list                 | GET /catering_tables                           | read           |
| cateringTables.get                  | GET /catering_tables/:id                       | read           |
| cateringTables.create               | POST /catering_tables                          | effectful      |
| cateringTables.update               | PATCH /catering_tables/:id                     | effectful      |
| cateringTables.open                 | POST /catering_tables/open_table               | effectful      |
| cateringTables.close                | POST /catering_tables/:id/close                | effectful      |
| cateringTables.transfer             | GET /catering_tables/transfer                  | effectful      |
| cateringTables.delete               | DELETE /catering_tables/:id                    | effectful      |
| invoices.listOpenCateringOrderNotes | GET /invoices/list_open_catering_order_notes   | read           |
| invoices.cancelCateringOrderNotes   | POST /invoices/cancel_catering_order_note      | effectful      |
| digitalTransports.list              | GET /digital_transports                        | read           |
| digitalTransports.get               | GET /digital_transports/:id                    | read           |
| digitalTransports.create            | POST /digital_transports                       | effectful      |
| digitalTransports.refresh           | POST /digital_transports/:id/refresh           | effectful      |
| digitalTransports.reject            | POST /digital_transports/:id/reject            | effectful      |
| digitalTransports.confirmDelivery   | POST /digital_transports/:id/confirm_delivery  | effectful      |
| digitalTransports.confirmReturn     | POST /digital_transports/:id/confirm_return    | effectful      |
| digitalTransports.transfer          | POST /digital_transports/:id/transfer          | effectful      |

Three notes on the surface as a whole:

- There is no generic request escape hatch.
- Origins are explicit: staging or production. The test-origin override
  (`advanced.testBaseUrl`) accepts loopback only and is visibly an advanced test capability.
- An injected fetch (`advanced.fetch`) must obey fetch semantics. It is a trusted capability,
  not a sandbox for hostile transport implementations.

The effect class does not follow the HTTP method: `invoices.requestPdf`,
`invoices.requestThermalPdf`, `invoices.markAsPaid` and `cateringTables.transfer` are GET
requests and are effectful. The rules that hold for every operation are under
[Invariants and failure modes](#invariants-and-failure-modes).

## Creating invoices

`invoices.create(invoice)` sends one invoice to the provider and reports what it observed. The
input uses the provider's snake_case keys, to avoid a second field vocabulary.

```ts
import { WrappClient, decimal, type CreateInvoiceInput } from '@prokolyvakis/wrapp-sdk';

const client = new WrappClient({
  environment: 'staging',
  credentials: { apiKey, tenant: { kind: 'userId', value: tenantId } },
});

const invoice: CreateInvoiceInput = {
  external_id: 'reference-one',
  billing_book_id: 'book-one',
  invoice_type_code: '2.1',
  payment_method_type: 1,
  counterpart: {
    name: 'Synthetic Company',
    country_code: 'GR',
    vat: 'synthetic-vat',
    city: 'Synthetic City',
    street: 'Synthetic Street',
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
      // Classification strings are the caller's tax decision; these are placeholders.
      classification_category: 'category1_3',
      classification_type: 'E3_561_001',
    },
  ],
};

const outcome = await client.invoices.create(invoice);

switch (outcome.kind) {
  case 'observed':
    // outcome.invoice, outcome.identity
    break;
  case 'pending':
    // outcome.invoiceId, outcome.identity, and outcome.invoice when the provider sent one
    break;
  case 'rejected':
    // outcome.errorCount, outcome.rejectionSource, outcome.referenceState
    break;
}
```

The later examples on this page reuse this `client` and this `invoice`. All values are
synthetic.

### Create outcomes

`create` returns one of three results: `observed`, `pending` or `rejected`. Switch on `kind`.

| `kind`     | Carries                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| `observed` | `invoice`, an observation (see [Returned fields](#returned-fields)), and `identity`       |
| `pending`  | `invoiceId`, `referenceState`, `identity`, and sometimes `invoice` (see the next section) |
| `rejected` | `errorCount`, `rejectionSource` and `referenceState`                                      |

- Every rejected result has `referenceState: 'unknown'`.
- The SDK infers no conflict from English titles.
- A rejection or a not-found never authorizes a new ID.
- `rejectionSource` names the provider validation family that reported the rejection:
  `invoice-errors`, `mydata-errors` or `unknown`. It is evidence, never terminality.
- The call dispatches at most one invoice and is never retried: see
  [Invariants and failure modes](#invariants-and-failure-modes).

### Pending outcomes

A status lookup reports a pending invoice as follows. `create` reports pending the same way, and
so does `drafts.issue`.

- A pending result carries `invoiceId`, `referenceState: 'unknown'` and `identity`.
- `identity` is `exact`, `ascii-case-variant`, or `unavailable` when the provider returned only
  its own invoice id for an external-reference request.
- When the provider returns the full observation with the pending status, the SDK validates it
  and keeps it as `invoice`.
- The outcome stays pending whatever number, date, UID or QR URL it carries.

### Required fields

Every invoice needs these fields:

- `external_id`
- `billing_book_id`
- `invoice_type_code`
- `payment_method_type`
- `counterpart`, except on types 6.1, 6.2 and 8.6
- `net_total_amount`, `vat_total_amount`, `total_amount` and `payable_total_amount`
- `invoice_lines`

### Optional invoice fields

| Group                | Fields                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| General              | `branch`, `payment_details`, `notes`, `correlated_invoices`, `num`, `self_pricing`, `special_invoice_category`                             |
| Currency             | `currency` with `exchange_rate`                                                                                                            |
| Customer email       | `customer_emails`, `email_locale`, `email_subject`, `email_body`                                                                           |
| PDF and payment      | `generate_pdf`, `mark_as_paid`                                                                                                             |
| Invoice-level totals | `other_taxes_amount`, `withholding_total_amount`, `total_stamp_duty_amount`, `stamp_duty_amount`, `deductions_total_amount`, `fees_amount` |
| POS                  | `pos_device_id`, `installments`, `tip_amount`                                                                                              |
| Fuel                 | `fuel_invoice`                                                                                                                             |
| B2G                  | the fourteen fields under [B2G fields](#b2g-fields)                                                                                        |

Later sections describe seven more invoice fields:

- `is_delivery_note`, `delivery_detail` and `other_correlated_entities`, under
  [Delivery notes](#delivery-notes);
- `catering_table_id`, `catering_table_name`, `receiving_note_purpose` and
  `other_receiving_note_purpose_title`, under
  [Invoice types with rules of their own](#invoice-types-with-rules-of-their-own).

Every other field is rejected before any I/O.

### Supported invoice types

Twenty-eight invoice types are accepted: 1.1, 1.2, 1.3, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2,
5.1, 5.2, 6.1, 6.2, 7.1, 8.1, 8.2, 8.6, 9.2, 9.3, 10.1, 10.2, 11.1, 11.2, 11.3, 11.4 and 11.5.

All 52 provider type codes and the status of each are listed in
[invoice-capabilities.md](invoice-capabilities.md).

### Fields that are not supported

| Not supported                              | Fields                                                          | Note                                                          |
| ------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------- |
| The draft key                              | `draft`                                                         | A draft is saved with `invoices.drafts.create`, which sets it |
| POS refunds and preloaded POS transactions | `refund_invoice_id`, `aade_preloaded`, `third_party_collection` |                                                               |
| The invoice-level tax mode                 | `taxes_totals`                                                  |                                                               |
| The line field of type 1.5                 | `invoice_detail_type`                                           | Type 1.5 is not issued                                        |

### Counterpart

Which counterpart fields are required depends on the invoice type.

| Types                     | `counterpart` | `name`                              | `country_code`, `vat`, `city`, `street`, `number`, `postal_code` |
| ------------------------- | ------------- | ----------------------------------- | ---------------------------------------------------------------- |
| 6.1, 6.2 and 8.6          | optional      | required when a counterpart is sent | optional                                                         |
| 11.1, 11.2, 11.3 and 11.4 | required      | required                            | optional                                                         |
| every other type          | required      | required                            | required                                                         |

- `email` is optional.
- `supply_account_no` is optional; see [Fuel fields](#fuel-fields).

### Lines and classification

Each line needs eight fields and a classification.

| Line fields    | Names                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required       | `line_number`, `name`, `quantity`, `unit_price`, `net_total_price`, `vat_rate`, `vat_total`, `subtotal`                                                                                                                                                                                                    |
| Classification | `classification_category` with `classification_type`, or `classifications`, or both                                                                                                                                                                                                                        |
| Optional       | `code`, `description`, `quantity_type`, `vat_exemption_code`, `withhold_tax_rate`, `withhold_tax_code`, `withholding_total`, `stamp_duty_tax_code`, `stamp_duty_amount`, `deductions`, `deductions_amount`, `expenses_vat_classification`, `expense`, `rec_type`, `fees_category`, `fuel_code`, `cpv_code` |

Type 8.2 adds three line fields of its own; see
[Invoice types with rules of their own](#invoice-types-with-rules-of-their-own).

VAT rules:

- A line with `vat_rate` 0 requires an exemption (`vat_exemption_code`), except on type 8.1.
- The SDK invents no tax codes.

Classification rules:

- A line is classified by `classification_category` and `classification_type` together, or by a
  nonempty `classifications` array of `{ category, type, amount }`, or by both.
- When both are sent, the provider documents that the array overrides the pair. The SDK sends
  all of it unmerged.
- A line with neither, or with one scalar and no array, is refused.
- The array's amounts are not checked against the line total.

```ts
import { decimal, type InvoiceLine } from '@prokolyvakis/wrapp-sdk';

const line: InvoiceLine = {
  line_number: 1,
  name: 'Synthetic service',
  quantity: decimal('1'),
  unit_price: decimal('10'),
  net_total_price: decimal('10'),
  vat_rate: 24,
  vat_total: decimal('2.40'),
  subtotal: decimal('12.40'),
  classifications: [{ category: 'category1_3', type: 'E3_561_001', amount: decimal('10.00') }],
};
```

### General invoice and line fields

Each of these fields is sent exactly as given. The classification of a line is described under
[Lines and classification](#lines-and-classification).

- `email_subject` and `email_body` override the customer email. Placeholders such as
  `$INVOICE_CODE`, `$COMPANY_NAME` and `$ISSUE_DATES` are substituted by the provider, not the
  SDK. Line breaks and surrounding spaces are kept.
- `num` is a specific invoice number, a positive integer chosen by the caller. The SDK keeps no
  numbering state and does not check it against the billing book.
- `special_invoice_category` is one of 1 to 13.
- `withhold_tax_rate` is a whole percent from 0 to 100.
- `withhold_tax_code` is a string from `'1'` to `'18'`.
- `stamp_duty_tax_code` is a string from `'1'` to `'4'`.
- A code is never derived from a rate, or the reverse.
- `deductions` is an array of `{ title?, amount, informational? }`.
  - A line with at least one deduction needs `deductions_amount`, and the invoice then needs
    `deductions_total_amount`.
  - An empty array is sent as given and requires nothing.
- `self_pricing: true` needs `expenses_vat_classification` on every line.
- `rec_type` marks a fee line and accepts only 2.
- `fees_category` is a positive integer.
- A line with `rec_type` or `fees_category` needs `fees_amount` on the invoice.

### POS fields

The POS fields on an invoice are `pos_device_id`, `installments` and `tip_amount`.

- `pos_device_id` names a registered device (see
  [POS devices and sessions](#pos-devices-and-sessions)) for an issuance tied to a POS
  transaction. It is not required for a card payment as such, and the SDK never looks the
  device up.
- `installments: true` needs `pos_device_id`. The provider documents installments for Viva
  terminals only and is the one to refuse another terminal. `installments: false` is sent as
  given.
- `tip_amount` is an exact amount with at most 2 fraction digits.

### Fuel fields

- `fuel_invoice` marks a fuel invoice. `fuel_invoice: false` is sent as given.
- A line's `fuel_code` is one of the provider's fuel codes: 10 to 15, 20, 21, 30 to 38, 40 to
  44, 50, 60, 61, 70 to 72 and 999.
- A `fuel_code` is accepted only when the invoice sets `fuel_invoice: true`. The provider
  refuses a fuel code on any other invoice, so the SDK refuses it first.
- Code 999 may appear on one line only, and that line's `net_total_price` may not be greater
  than the sum of the other lines' `net_total_price`.
  - This is the one comparison of amounts the SDK makes, because the provider states it as a
    validity rule.
  - It is made exactly, in hundredths, and compares only those line values. No total is derived
    or corrected, and the invoice totals are not consulted.
- `counterpart.supply_account_no` is optional. The provider documents that it uses it only on a
  fuel invoice and ignores it, without storing it, on any other. The SDK sends it as given in
  both cases and does not claim it is returned by a read.

### B2G fields

`b2g: true` marks a B2G (public sector) invoice. The flag then requires most of the fourteen B2G
fields.

| With `b2g: true`        | Fields                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required on the invoice | `delivery_address_city`, `delivery_address_street`, `delivery_address_street_number`, `delivery_address_postal_code`, `delivery_address_party_name`, `b2g_contracting_authority_id`, `b2g_contract_identifier`, `b2g_budget_type`, `b2g_budget_identifier`, `b2g_payment_details`, `b2g_due_date` |
| Required on every line  | `cpv_code`                                                                                                                                                                                                                                                                                        |
| Optional                | `b2g_buyer_reference`, `b2g_bt_70`                                                                                                                                                                                                                                                                |

- `b2g_budget_type` is 1, 2 or 3.
- `b2g_due_date` is a real calendar date written YYYY-MM-DD (the `calendarDate()` brand).
- The other fields are nonempty text.
- The SDK checks presence and form only. It does not look up or verify a contracting authority,
  a contract or a budget, and it applies no procurement rule.
- Without `b2g: true` none of these fields is required. If they are supplied anyway they are
  still validated and are sent as given, as the provider's own request example does.
- The `delivery_address_*` fields are the B2G invoice's own address. They are unrelated to a
  delivery note and do not stand in for its `delivery_detail`.

### Delivery notes

Any supported invoice can be marked as a delivery note.

- `is_delivery_note: true` marks the invoice as a delivery note and needs `delivery_detail`.
- `delivery_detail` needs `is_delivery_note: true`.
- One without the other is refused, and no default stands in for either.

```ts
import type { DeliveryDetail } from '@prokolyvakis/wrapp-sdk';

const delivery_detail: DeliveryDetail = {
  dispatch_date: '31-01-2026', // DD-MM-YYYY text, not a calendarDate()
  dispatch_time: '09:30',
  vehicle_number: 'SYNTHETIC1',
  purpose_of_movement: '1',
  issuer_of_movement: 'Synthetic Carrier',
  from_address: 'Origin Street',
  from_number: '1',
  from_city: 'Origin City',
  from_zipcode: '00000',
  to_address: 'Destination Street',
  to_number: '2',
  to_city: 'Destination City',
  to_zipcode: '00000',
};
```

Fields of `delivery_detail`:

| Field                                                           | Required | Form or rule                                                                   |
| --------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `dispatch_date`                                                 | yes      | A real calendar date written DD-MM-YYYY                                        |
| `dispatch_time`                                                 | yes      | HH:MM, 00:00 to 23:59                                                          |
| `vehicle_number`, `issuer_of_movement`                          | yes      |                                                                                |
| `purpose_of_movement`                                           | yes      | A string from `'1'` to `'20'` without `'6'`, `'15'`, `'16'`, `'17'` and `'18'` |
| `from_address`, `from_number`, `from_city`, `from_zipcode`      | yes      |                                                                                |
| `to_address`, `to_number`, `to_city`, `to_zipcode`              | yes      |                                                                                |
| `purpose_of_movement_custom_title`                              | no       | Needed when `purpose_of_movement` is `'19'`                                    |
| `reverse_delivery_note`                                         | no       | `reverse_delivery_note: true` needs `reverse_delivery_note_purpose`            |
| `reverse_delivery_note_purpose`                                 | no       | 1 to 5                                                                         |
| `non_obligated_recipient`, `without_digital_transport_tracking` | no       | Cannot both be `true`                                                          |
| `from_branch`, `to_branch`                                      | no       | Branch codes: nonnegative integers                                             |

More about the tracking flags and the branch codes:

- `non_obligated_recipient` and `without_digital_transport_tracking` both change how the
  provider tracks the transport. With the second, the provider marks the delivery note completed
  on issue.
- `from_branch` and `to_branch` are branch codes, the `code` of a branch and not its id. Each is
  optional on its own and sent as a JSON integer as given.
  - The SDK checks no code against the tenant's branches and looks none up.
  - Neither does the provider: a code that no branch has was observed to be issued and returned
    as sent.
  - An omitted code is not sent, and the provider then records none.

`other_correlated_entities` is a list of parties. Each party has these fields, all required:

| Field                                                | Form                  |
| ---------------------------------------------------- | --------------------- |
| `entity_type`                                        | 1 to 6                |
| `vat_number`                                         | text                  |
| `country_code`                                       |                       |
| `branch_code`                                        | a nonnegative integer |
| `name`, `street`, `number`, `postal_code` and `city` |                       |

### Invoice types with rules of their own

Each rule was observed to be enforced by the provider or the tax authority, or is the one shape
in which the type was observed to be accepted.

| Type                                             | Needs or takes                                                                                                                                                                                                                                                       | What is refused                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1.2 and 1.3                                      | The full counterpart, and no rule of their own: the SDK checks neither the counterpart's country nor the VAT rate                                                                                                                                                    |                                                                                            |
| 1.6 and 2.4 (supplementary invoices)             | `correlated_invoices` holding the mark of the invoice they supplement                                                                                                                                                                                                | The tax authority refuses either without one                                               |
| 3.1 and 3.2 (title deeds)                        | Every line carries `expense: true` and `vat_rate` 0, and with it the exemption code of a zero-rate line                                                                                                                                                              | The authority refuses VAT on these types                                                   |
| 5.1 (correlated credit invoice)                  | `correlated_invoices` holding the mark of the invoice it credits                                                                                                                                                                                                     |                                                                                            |
| 6.1 and 6.2 (self-delivery and self-use records) | No counterpart, a name alone, or a full one                                                                                                                                                                                                                          |                                                                                            |
| 8.1 (rent)                                       | Every line carries `vat_rate` 0 and no `vat_exemption_code`                                                                                                                                                                                                          | The authority refuses VAT on this type, and refuses an exemption code on it too            |
| 8.2 (accommodation-tax receipt)                  | `other_taxes_amount` on the invoice; `accommodation_tax`, `other_taxes_percent_category` and `other_taxes_amount` on every line; zero `net_total_amount` and `vat_total_amount`; every line keeps `net_total_price` 0, `vat_rate` 24, `vat_total` 0 and `subtotal` 0 | The three line fields on every other type                                                  |
| 8.6 (catering order note)                        | No counterpart, a name alone, or a full one; at most one of `catering_table_id` and `catering_table_name`                                                                                                                                                            | `catering_table_id` and `catering_table_name` together                                     |
| 9.2 and 9.3 (delivery notes)                     | The full counterpart; the zero totals and the zero-value line described below; `is_delivery_note: true`, and so the delivery detail                                                                                                                                  | A `classifications` array on a line                                                        |
| 10.1 and 10.2 (quantity receipt notes)           | The full counterpart; the zero totals and the zero-value line described below; `receiving_note_purpose`; on 10.1 also `correlated_invoices` holding the mark of the delivery note being received                                                                     | The delivery flag; a `classifications` array on a line; `receiving_note_purpose` 5 on 10.2 |
| 11.1                                             | Takes `catering_table_id` together with `correlated_invoices` holding the marks of order notes                                                                                                                                                                       | `catering_table_name`                                                                      |

The details behind the table, type by type:

- **1.2 and 1.3.**
  - They were observed to be accepted with a counterpart in another EU country (1.2) or outside
    the EU (1.3) and zero-rate lines with an exemption code.
  - The provider keeps their billing books under type 1.1.
- **5.1.** Types 5.2 and 11.4 do not require `correlated_invoices`.
- **8.2.**
  - `other_taxes_percent_category` is one of `'6'` to `'10'`, `'17'`, `'20'` to `'30'`.
  - The type was observed to be accepted with zero net and VAT amounts and zero-value lines at
    `vat_rate` 24, the tax appearing only in those fields and in the totals. It is sent only so.
  - Another shape is unverified.
- **8.6.**
  - `catering_table_id` names an open table. `catering_table_name` names a table the provider
    creates and opens for this order note.
  - With neither, the provider opens a table under a name of its own.
  - The observed result carries `catering_table_id` either way.
  - The provider accepts both fields together and then uses the id. The SDK refuses the pair, as
    the provider's reference tells callers to.
  - The reference's examples use `payment_method_type` 0.
- **9.2, 9.3, 10.1 and 10.2.**
  - `net_total_amount`, `vat_total_amount`, `total_amount` and `payable_total_amount` must be
    zero. `'0'`, `'0.0'` and `'0.00'` are all zero.
  - Every line keeps `net_total_price` 0, `vat_rate` 24, `vat_total` 0, `subtotal` 0 and
    `classification_category` `'category3'`, without a `classifications` array.
  - The provider's reference names three of the totals; the tax authority also refuses a nonzero
    net.
  - These are exact-value rules: nothing is computed.
  - All four types take the full counterpart. The provider's reference says 9.2 needs only a
    name and an address; the provider refuses a 9.2 without the VAT number and country.
- **10.1 and 10.2.**
  - `receiving_note_purpose` is 1 to 7. The value 5 is accepted on 10.1 only, and the value 7
    needs `other_receiving_note_purpose_title` of at most 150 characters.
  - `receiving_note_purpose` and `other_receiving_note_purpose_title` are refused on every other
    type.
- **11.1.**
  - With `catering_table_id` and the marks of order notes in `correlated_invoices`, this is the
    receipt that closes them. The table stays open; closing it is `cateringTables.close`.
  - A `catering_table_id` on an 11.1 that names no mark in `correlated_invoices` is refused.
  - An 11.1 with `correlated_invoices` and no table id is an ordinary receipt, as it always was:
    the SDK does not know whether a mark belongs to an order note.
  - Both catering fields are refused on every type other than 8.6 and 11.1, and
    `catering_table_name` is refused on 11.1.

What was observed about fields that depend on the type:

- The tax authority refuses the delivery-note fields and the fuel fields on a 2.1, and accepts
  both on a 1.1.
- The SDK does not refuse them by type. A request the authority refuses comes back as a rejected
  result, and was observed to use up a number in the series.

### Presence rules and totals

The presence rules above are the ones the provider's reference states. They only require a
field to be there:

- The SDK never sums deductions, derives a total, or compares a total with its parts.
- Totals that disagree are sent as given and judged by the provider.
- The fuel code 999 rule under [Fuel fields](#fuel-fields) is the single exception.

### Decimals and code sets

Three numeric line codes are checked against the provider's documented request sets before
authentication.

| Line field           | Accepted values           |
| -------------------- | ------------------------- |
| `vat_rate`           | 0, 3, 4, 6, 9, 13, 17, 24 |
| `quantity_type`      | 1 to 6                    |
| `vat_exemption_code` | 1 to 31                   |

- The provider documents that it does not refuse an unlisted VAT rate but issues the invoice as
  if without VAT, which is why the SDK refuses it first.
- The sets describe what the SDK will send. They are not a tax-eligibility decision, and the SDK
  never picks a code.
- The sets are never applied to values the provider returns.

Decimals are nonnegative canonical decimal strings with at most 18 integer digits. There are no
exponents, no leading zeros and no rounding.

| Value                                 | Fraction digits |
| ------------------------------------- | --------------- |
| Monetary totals and the exchange rate | at most 2       |
| Quantities and unit prices            | up to 12        |

- A value with more precision is rejected, never rounded.
- The quantity and unit-price bounds follow observed provider behavior: a value of either with
  more than 2 fraction digits is accepted and returned unchanged, although the reference states
  a maximum of 2 digits.
- These are SDK bounds, not assertions of provider limits.
- Exact JSON numeric tokens are emitted through a lossless serializer.
- Inbound decimals accept bounded nonnegative numeric tokens (including exponent notation),
  preserving their value.

## Invoice management

Four operations on `client.invoices` change an existing invoice.

| Operation                                   | What it does                                              | Result                       |
| ------------------------------------------- | --------------------------------------------------------- | ---------------------------- |
| `cancelDeliveryNote(invoiceId)`             | Cancels a delivery note                                   | `observed` or `rejected`     |
| `setExternalId(invoiceId, { external_id })` | Assigns an external reference to an invoice that has none | `acknowledged` or `rejected` |
| `markAsPaid(invoiceId)`                     | Asks the provider to mark an invoice as paid              | `acknowledged` or `rejected` |
| `drafts.delete(invoiceId)`                  | Deletes a draft                                           | `acknowledged` or `rejected` |

```ts
const cancelled = await client.invoices.cancelDeliveryNote('invoice-one');
if (cancelled.kind === 'observed') {
  // Read cancelled.cancellation.cancelled_by_mark before concluding anything.
}

await client.invoices.setExternalId('invoice-one', { external_id: 'reference-one' });
await client.invoices.markAsPaid('invoice-one');
await client.invoices.drafts.delete('invoice-one');
```

Rules shared by the four:

- Each is dispatched at most once and never retried.
- A failure after dispatch carries effect `unknown`.
- Each has its own result. A provider rejection is a rejected result (`errorCount` and
  `rejectionSource` only), not an error.
- The status text of an acknowledgement is validated as present and then dropped, like any other
  provider wording.
- Use the `diagnostics` option to read a rejection's detail.

### `cancelDeliveryNote(invoiceId)`

- The provider offers the route for delivery notes only and states that invoices sent through a
  provider cannot be cancelled. It is not a way to reverse an ordinary invoice.
- The result is `observed` with the provider's cancellation record, or `rejected`.
- The record carries `id`, `my_data_mark`, `my_data_uid`, `my_data_qr_url`, `series`, `num`,
  `cancelled_by_mark` and the two portal links.
- The record's `id` must equal the requested id.
- Read `cancelled_by_mark` before concluding anything: the SDK does not turn the record into a
  statement that the cancellation completed.

### `setExternalId(invoiceId, { external_id })`

- The provider never overwrites a reference, so the assignment is permanent.
- The reference follows the outbound rules of `create.external_id`.
- The result is `acknowledged`, with `invoiceId`, the echoed `externalId` and `identity` (`exact`
  or `ascii-case-variant`), or `rejected` with `referenceState` `unknown`.
- A rejection never shows whether the reference is free or which invoice holds it, whatever its
  wording, and no other reference is tried.

### `markAsPaid(invoiceId)`

- It is an effectful GET.
- `acknowledged` means the provider answered with its status text. It is not verified
  settlement.

### `drafts.delete(invoiceId)`

- The provider decides whether the invoice is an untransmitted draft.
- `acknowledged` does not show that the draft's external reference can be used again.

## Drafts

A draft is an invoice saved with the provider and not issued: it has no number, no registration
mark and is not sent to the tax authority. The operations are on `client.invoices.drafts`.

The provider's reference documents no answer for saving, issuing or listing a draft. What
follows is the behavior observed on the provider, and each operation accepts only the answers
named here.

```ts
const saved = await client.invoices.drafts.create(invoice);
// saved.kind is 'saved' (with saved.invoiceId) or 'rejected'

const issued = await client.invoices.drafts.issue(
  { kind: 'externalId', value: 'reference-one' },
  { email_locale: 'en', generate_pdf: true },
);
// issued.kind is 'observed', 'pending' or 'rejected'

for await (const draft of client.invoices.drafts.iterate({}, { maxPages: 5 })) {
  // draft is the full-detail projection without `code`
}
```

### `drafts.create(invoice)`

- Saves a draft.
- The input is that of `invoices.create` without `generate_pdf` and `mark_as_paid`, which are
  refused for a draft. A PDF is asked for when the draft is issued.
- The input is validated exactly as an ordinary create. The method then adds `draft: true` to
  the body.
- A caller-supplied `draft` key is refused, here and on `invoices.create`.
- The result is `saved` with `invoiceId`, the provider's id of the draft, or `rejected`.
- The provider's answer has the shape of a pending answer and is told apart by its exact status
  text alone. Any other 2xx answer (a pending status, an issued invoice, another wording) is a
  protocol error with effect `unknown`, never a saved draft.

### `drafts.issue(reference, input?)`

- Issues a draft, addressed like a status lookup: by the provider's id or by the draft's
  external reference.
- `input` is optional. It takes `pos_device_id`, `customer_emails` (at most 100), `email_locale`
  (`el` or `en`), `email_subject`, `email_body` and `generate_pdf`.
- Each field is optional and sent as given, with placeholders and line breaks untouched.
- It takes no payment method.
- Without any field no body is sent.
- The result is `observed` with the issued invoice and its identity evidence, `pending` as on
  create, or `rejected`.
  - On `observed`, the returned id or reference must match the request. Read `my_data_mark` and
    `transmission_failure` before concluding anything.
  - Any other answer, such as a bare status, is a protocol error: nothing is assumed to be
    issued.

Observed on the provider: the request without a body, a body with `email_locale` and
`generate_pdf`, and both ways of addressing. The other four fields and a pending answer follow
the provider's reference.

### `drafts.list({ page? })` and `drafts.iterate({ page? }, { maxPages })`

- `list` returns one page of drafts. `iterate` walks them with the rules of `invoices.iterate`.
- Each draft is the full-detail projection without `code`: a draft has no document code.
- `issued_at` is the date the provider holds for the draft. It is not an issue time, and a row
  without one fails the read rather than being given a date.
- A row is accepted as a draft only in the shape that was observed, with its document code,
  registration mark and uid present and empty. A row that carries a value in one of them, or
  lacks one, fails the read with a protocol error.
- Unknown additional fields of an answer are ignored, as everywhere.
- Date filters are not offered for drafts.
- `invoices.list` and `invoices.iterate` return issued invoices only and take no status.

Deleting a draft is `drafts.delete(invoiceId)`, described under
[Invoice management](#invoice-management).

### After a draft write

- `create` and `issue` are dispatched at most once and never retried.
- Nothing follows either: saving does not issue, and issuing reads nothing back.
- After a failure whose effect is `unknown`, read `invoices.getStatus` by the same reference
  before repeating a save or an issue.
- The provider was observed to answer the issue of an invoice that is no longer a draft with
  HTTP 404. It arrives as an `HTTP_ERROR` with effect `unknown`, like any other failure after
  dispatch.

### Reading a draft

- `invoices.getStatus` reports a draft as `{ kind: 'draft', identity: 'unavailable' }`, by
  provider id or by external reference. The provider answers with the status alone, so there is
  no record and nothing to compare the reference with.
- `invoices.get` also returns a draft's record, with an empty `code`.

## PDFs

Two operations on `client.invoices` ask the provider for a PDF of an invoice: `requestPdf` and
`requestThermalPdf`. Each is one effectful GET.

```ts
const pdf = await client.invoices.requestPdf('invoice-one', { locale: 'en' });

switch (pdf.kind) {
  case 'available':
    // pdf.downloadUrl is data; the SDK never fetches it
    break;
  case 'acknowledged':
    // pdf.status is 'unknown'
    break;
  case 'rejected':
    // pdf.errorCount, pdf.rejectionSource
    break;
}

const thermal = await client.invoices.requestThermalPdf('invoice-one');
```

| Operation                           | Locale                 | Outcomes                                |
| ----------------------------------- | ---------------------- | --------------------------------------- |
| `requestPdf(invoiceId, { locale })` | optional: `el` or `en` | `available`, `acknowledged`, `rejected` |
| `requestThermalPdf(invoiceId)`      | none                   | `available`, `acknowledged`, `rejected` |

Rules for `requestPdf`:

- It asks for the document in `el` or `en` through a `locale` query parameter, beside the common
  request options.
- Without a locale no query is sent and the provider uses its default, observed to be `el`.
- Another value is refused before any request.
- Each locale has its own artifact: the two links differ.

Rules for `requestThermalPdf`:

- It follows the same rules as `requestPdf` on its own route and operation name: one effectful
  GET, the same `available`, `acknowledged` and `rejected` outcomes, no download, no polling.
- It takes no locale.

Rules for the answer:

- The PDF URL is data, HTTPS only, never automatically fetched.
- A status-only PDF response has unknown acknowledgement semantics. Unsigned prose is not
  evidence that a document is queued or ready.

## Branches and billing books

Four operations change account configuration: two on `client.branches` and two on
`client.billingBooks`.

```ts
const branch = await client.branches.create({
  name: 'Synthetic branch',
  code: 1,
  address: 'Synthetic Street',
  street_number: '1',
  city: 'Synthetic City',
  postal_code: '00000',
});

await client.branches.update('branch-one', { phone: '0000000000' });

const book = await client.billingBooks.create({
  name: 'Synthetic book',
  series: 'S',
  number: 0,
  invoice_type_code: '2.1',
});

await client.billingBooks.updateNumber('book-one', { number: 10 });
```

Rules shared by the four:

- Each is dispatched at most once and never retried.
- A failure after dispatch carries effect `unknown`.
- A provider rejection is a rejected result (`errorCount` and `rejectionSource` only).

### `branches.create(input)`

| Fields   | Names                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| Required | `name`, `code`, `address`, `street_number`, `city`, `postal_code`                             |
| Optional | `phone`, `address_en`, `city_en`, `default_option`, `company_activity`, `company_activity_en` |

- `code` is a nonnegative integer on the request.
- An omitted optional field is not sent. An explicit `false` is sent as `false`.
- The result is `observed` with the branch (`id`, `name`, `code` as text) or `rejected`.

### `branches.update(branchId, patch)`

- It takes the same fields, all optional, at least one.
- Only the fields given are sent: the SDK never reads the branch first, merges values or fills
  in defaults.
- The returned branch id must equal the requested one.

### `billingBooks.create(input)`

- `name`, `series`, `number` and `invoice_type_code` are required.
- `invoice_type_code` is any of the provider's 52 type codes, since a book can exist for a type
  `create` does not issue.
- The result is `observed` with the book (`id`, `name`, `series`, `invoice_type_code`, and
  `number` only when the provider returns it) or `rejected`.

### `billingBooks.updateNumber(billingBookId, { number })`

- It sets the number of a book, a nonnegative integer.
- `number` is the one field the provider lets a book change, so the input takes nothing else.
- The provider issues the book's next document from this number. The SDK chooses no number,
  keeps no counter and does not check the value against documents already issued, so repeated or
  skipped numbers are the caller's to prevent.
- It is one PUT, never retried, with effect `unknown` after a dispatched failure.
- The result is `observed` with the book as the provider returned it, or `rejected`. The book's
  `number` is the provider's and is not compared with the request.
- A book with another id is a protocol error.

### Provider behaviors to know first

Three provider behaviors are worth knowing before calling these operations:

- Setting `default_option` `true` removes the default from every other branch.
- A billing book's `number` is the counter invoices are numbered from. The SDK sends the value
  given and neither allocates nor reconciles counters.
- The provider stores some types under their family, so a book requested as 1.2 can come back as
  1.1. The returned type is kept as given and is not compared with the request.

## Digital clientele

`client.digitalClienteles` reads, creates, updates, cancels and correlates digital clientele
entries.

```ts
const created = await client.digitalClienteles.create({
  client_service_type: 'rental',
  branch: '0',
  vehicle_registration_number: 'SYNTHETIC1',
  vehicle_movement_purpose: 'vmp_rental',
});

const entry = await client.digitalClienteles.get('clientele-one');

// Completing an entry is an update.
await client.digitalClienteles.update('clientele-one', { entry_completion: true });

await client.digitalClienteles.correlateByMark('clientele-one', {
  correlate_mark: 'synthetic-mark',
});

await client.digitalClienteles.cancel('clientele-one');
```

### Entries

The provider's reference shows an entry with every value as text (`"true"`, `"false"`, empty
strings). The provider was observed to do otherwise, and the SDK follows the observation:

- Requests carry JSON booleans.
- An entry comes back with JSON `null` where nothing is set, and with real booleans.

#### `get(clienteleId)`

- Returns the entry: `id`, `client_service_type` and `status`, and 42 further fields that are
  absent when the provider omits them and `null` when it has no value.
- Flags are booleans. A flag that arrives as text fails the read and is never read as `true` or
  `false`.
- `amount` is exact numeric text.
- `status` is returned verbatim (`pending`, `complete` and `cancelled` were observed), as are
  codes, dates and timestamps.
- The entry's `id` must equal the one read.

#### `create(input)`

Creates an entry. Required fields:

- `client_service_type`: `rental`, `parkingcarwash` or `garage`
- `branch` (text)
- at least one of `vehicle_registration_number` and `foreign_vehicle_registration_number`; both
  may be given

The reference's presence rules are applied before any request:

| When the entry has         | It needs                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ |
| a foreign registration     | `vehicle_category` and `vehicle_factory`                                       |
| a rental                   | `vehicle_movement_purpose`: `vmp_rental`, `vmp_self_use` or `vmp_free_service` |
| `continuous_service: true` | `from_agreed_period_date` and `to_agreed_period_date`, ISO calendar dates      |
| `recurring_service: true`  | `customer_vat_number` and `customer_country`                                   |

A field the reference limits to one context is refused outside it:

| Field                                                                                   | Refused                                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `mixed_service`                                                                         | on anything but a parking entry                                 |
| the pickup flag and location (`is_diff_veh_pickup_location`, `vehicle_pickup_location`) | on anything but a rental, and the location without the flag set |
| `creation_date_time` (a timestamp with Z or an offset)                                  | without `transmission_failure: true`                            |
| `periodicity` and `periodicity_other`                                                   | without `continuous_lease_service: true`                        |

Nothing is filled in for the caller.

#### `update(clienteleId, patch)`

It sends only the fields given, at least one:

| Field                                                                                                                                                 | Rule                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `entry_completion`                                                                                                                                    | Completing an entry is an update with `entry_completion: true` |
| `non_issue_invoice`                                                                                                                                   |                                                                |
| `amount`                                                                                                                                              | An exact decimal with at most 2 fraction digits                |
| `is_diff_veh_return_location`                                                                                                                         |                                                                |
| `vehicle_return_location`                                                                                                                             | Only with that flag set                                        |
| `provided_service_category`                                                                                                                           |                                                                |
| `provided_service_category_other`                                                                                                                     | Only with the category `other`                                 |
| `invoice_kind`, `cooperating_vat_number`, `other_branch`, `reason_non_issue_type`, `comments`, `invoice_counterparty`, `invoice_counterparty_country` |                                                                |

- Rules that depend on the entry's service type are the provider's to apply: the SDK never reads
  the entry to learn its type.
- The provider updates with a POST on the entry's route.
- `off_site_provided_service` is not offered: the reference gives it two incompatible value
  forms and neither was confirmed.

#### `cancel(clienteleId)`

- Cancels an entry, with no body.
- The provider cancels a complete entry only, and was observed to answer the cancellation of
  another with HTTP 404.

#### Results of the entry writes

- `create` and `update` return `observed` with the entry, or `rejected`.
- `cancel` returns `acknowledged` with `cancellationId`, the id the provider returned beside its
  notice, or `rejected`.
- A refusal arrives as a list or as a single string, and neither is interpreted.
- The three writes are dispatched at most once and never retried.
- They report effect `unknown` after a dispatched failure, which includes the provider's HTTP 422
  for a refused entry.

### Correlations

Two operations correlate an existing digital clientele entry.

| Operation                                                                 | Correlates the entry with            |
| ------------------------------------------------------------------------- | ------------------------------------ |
| `correlateByMark(clienteleId, { correlate_mark })`                        | an invoice, by its registration mark |
| `correlateByFim(clienteleId, { correlate_fim_number, correlate_fim_aa })` | a fiscal device receipt              |

- Each is dispatched at most once and never retried, makes no follow-up request, and reports
  effect `unknown` after a dispatched failure.
- The two bodies are distinct and strict: each field is a nonempty string, and neither operation
  accepts the other's fields.
- The result is `acknowledged` when the provider returns its notice, or `rejected` (`errorCount`
  and `rejectionSource`).
- The provider reports a refusal of these two operations as a single string, which counts as one
  issue.
- Neither the notice nor the refusal is interpreted: a refusal saying a correlation already
  exists is still a rejection, not a finding that the correlation is in place.

## POS devices and sessions

`client.posDevices` manages registered POS devices, and `client.posSessions` aborts a pending
POS session.

```ts
const registered = await client.posDevices.create({
  pos_type: 'viva',
  name: 'Synthetic terminal',
  terminal_id: 'terminal-one',
  merchant_id: 'merchant-one',
});

const devices = await client.posDevices.list();

await client.posDevices.delete('device-one');
await client.posSessions.abort('invoice-one');
```

| Operation                      | What it does                                 | Result                       |
| ------------------------------ | -------------------------------------------- | ---------------------------- |
| `posDevices.list()`            | Returns the registered devices               | the devices                  |
| `posDevices.create(device)`    | Registers a device                           | `observed` or `rejected`     |
| `posDevices.delete(deviceId)`  | Deletes a device permanently                 | `acknowledged` or `rejected` |
| `posSessions.abort(invoiceId)` | Aborts the pending POS session of an invoice | `acknowledged` or `rejected` |

### `posDevices.list()`

- Each device has `id` and `name`, with `terminal_id` and `merchant_id` when the provider sends
  them. Absent and `null` are kept apart.

### `posDevices.create(device)`

The input is one of three strict shapes, chosen by `pos_type`:

| `pos_type`                                                                                                                               | Takes                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `viva`                                                                                                                                   | `name`, `terminal_id` and `merchant_id`                                                |
| `worldline_softpos`                                                                                                                      | `terminal_id` and `merchant_id` (the merchant's email address), and an optional `name` |
| each of `epay`, `worldline`, `nbg`, `cosmote`, `jcc`, `attica`, `pancreta`, `tora`, `pbt`, `mypos`, `nexi-mellon`, `nexi` and `nbg_edps` | `name`, `terminal_id` and `authorization_code`                                         |

- The other credential, both credentials, or an unknown type is refused before any request.
- The result is `observed` with the returned device, or `rejected`.

### `posDevices.delete(deviceId)`

- Deletes a device permanently. The provider refuses one that has a successful transaction.
- The result is `acknowledged` or `rejected`.

### `posSessions.abort(invoiceId)`

- The id is the invoice's id, not a device or session id.
- The provider documents it for Viva terminals only.
- The result is `acknowledged` or `rejected`.

### After a POS write

- The three writes are dispatched at most once and never retried, and report effect `unknown`
  after a dispatched failure.
- That includes registration. For Worldline SoftPOS the provider reuses an existing account and
  enables an already attached terminal, answering 200 instead of 201 with the same body. That is
  its behavior, not permission for the SDK to repeat a call.
- After an unknown outcome, list the devices before registering again.

### POS refusals

- A refusal that arrives with an HTTP error status is a thrown `HTTP_ERROR`, like any non-2xx
  answer. The provider documents 422 for a device with transactions.
- Registration reports its refusals as an object of field name to messages. Each message counts
  as one issue.
- With `diagnostics: 'provider-issues'`, each is returned as a title (the field) and a message.
- The merchant id and the authorization code of the request are redacted from that retained
  text, and neither appears in any error.

## Catering tables and order notes

An order note itself is issued with `invoices.create` as type 8.6, and settled by a retail
receipt 11.1 that names its mark. Both are described under
[Invoice types with rules of their own](#invoice-types-with-rules-of-their-own). The operations
below manage the tables and the open order notes.

```ts
const table = await client.cateringTables.create({ name: 'Table one' });
await client.cateringTables.open({ id: 'table-one' });

await client.cateringTables.transfer({
  current_table: 'table-one',
  target_table: 'table-two',
  marks: ['synthetic-mark'],
});

const openNotes = await client.invoices.listOpenCateringOrderNotes({ page: 1 });

const cancellation = await client.invoices.cancelCateringOrderNotes({
  billing_book_id: 'book-one',
  correlated_invoices: ['synthetic-mark'],
});
```

### Tables

The table operations are on `client.cateringTables`.

| Operation                                           | What it does                                                      | Result                       |
| --------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------- |
| `list()`                                            | Returns every table as a summary: `id`, `status`, `name`, `total` | the summaries                |
| `get(tableId)`                                      | Returns one table with its details                                | the table                    |
| `create({ name })`                                  | Creates a table with that name                                    | `observed` or `rejected`     |
| `update(tableId, { name })`                         | Renames a table                                                   | `observed` or `rejected`     |
| `open({ id?, name? })`                              | Opens a table by id, by name, or by both                          | `observed` or `rejected`     |
| `close(tableId)`                                    | Closes a table                                                    | `observed` or `rejected`     |
| `transfer({ current_table, target_table, marks? })` | Moves order notes from one table to another                       | `observed` or `rejected`     |
| `delete(tableId)`                                   | Deletes a table                                                   | `acknowledged` or `rejected` |

Rules by operation:

- `list()`: the provider's status and name filters are not offered. The provider was observed to
  read them only from the body of the GET request, which a fetch client cannot send.
- `get(tableId)`: the details are the summary fields plus `invoices` (invoice ids) and
  `error_message` when the provider sends them. `get` refuses the id `transfer`, which names the
  transfer route.
- `create({ name })`: the name is required. The provider was observed to answer a create without
  one with HTTP 400.
- `open({ id?, name? })`: at least one of the two is required. The provider states no rule for
  both, so both are sent as given and it decides.
- `delete(tableId)`: the provider documents deletion for an available table.

Rules for `transfer`:

- `marks` holds the registration marks of the notes to move, 1 to 100. The count is an SDK
  bound.
- Without `marks` every open order note of the current table moves.
- An empty list is refused, because a query cannot tell it from an omitted one.
- Both tables are addressed by id. The provider does not resolve a table name here.
- The provider serves this as a GET with the input as query parameters (`marks[]` once per
  mark). The SDK treats it as the write it is.
- `transfer` returns the target table, and an answer for any other table is a protocol error.

Rules for the six writes:

- They are dispatched at most once, never retried, and report effect `unknown` after a dispatched
  failure.
- `create`, `update`, `open`, `close` and `transfer` return `observed` with the table, or
  `rejected`. `delete` returns `acknowledged` or `rejected`.
- An answer for another table than the one addressed by id is a protocol error.

What a table carries:

- A table's `status` is data, returned verbatim. The provider documents `available`, `open`,
  `closed` and `alert`; another value is returned as received.
- The SDK never treats a status as a failure and never acts on one: closing a table does not
  issue or cancel anything through the SDK.
- `error_message` is likewise the provider's text about the table, returned as data.
- `total` is exact numeric text.
- A table the provider named with a number has that number as text.

### Order notes

The order-note operations are on `client.invoices`.

#### `listOpenCateringOrderNotes({ page? })`

- Returns one page of open order notes as summaries (`id`, `my_data_mark`, `issued_at`,
  `catering_table_id`) with `total_pages` and `current_page`.
- It is its own page shape: up to 20 records, no total count, and not full invoice records.
- `issued_at` is the provider's timestamp text, verbatim.

#### `cancelCateringOrderNotes({ billing_book_id, correlated_invoices, catering_table_id? })`

- Cancels order notes by their registration marks (1 to 100).
- The provider does this by issuing a new invoice of type 8.6, so it is a fiscal creation:
  dispatched at most once, never retried, effect `unknown` after a dispatched failure.
- The result is `observed` with the receipt of that invoice, or `rejected`.
- The receipt carries `id`, the marks, `series`, `num` and the portal links. It has no issue date
  and no external reference, because the provider documents none.
- `catering_table_id` is optional: without it the provider resolves the table from the marks.

After a cancellation request:

- The request has no external reference, so the SDK's usual reconciliation handle does not exist
  for it.
- After an unknown outcome, read the open order notes before deciding anything. Do not repeat
  the call blindly.
- Nothing follows the dispatch: no table is closed and no replacement document is issued.

An order note itself is created with `invoices.create` as type 8.6; see
[Invoice types with rules of their own](#invoice-types-with-rules-of-their-own).

## Digital transports

Eight operations on `client.digitalTransports` cover the movement of a delivery note.

```ts
const registered = await client.digitalTransports.create({
  invoice_id: 'invoice-one',
  vehicle_number: 'SYNTHETIC1',
  transport_type: 1,
  carrier_vat_number: 'synthetic-vat',
});

const page = await client.digitalTransports.list({ category: 'receiving', page: 1 });

await client.digitalTransports.confirmDelivery('transport-one', {
  outcome: 'PARTIAL',
  delivered_packaging: [{ packaging_type: 1, quantity: 2 }],
});
```

| Operation                                                                       | What it does                                                      | Effect    |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------- |
| `list({ category?, page? })`                                                    | Returns one page of transports                                    | read      |
| `get(transportId)`                                                              | Returns one record                                                | read      |
| `create({ invoice_id, vehicle_number, transport_type, carrier_vat_number })`    | Registers a transport for an invoice                              | effectful |
| `refresh(transportId)`                                                          | Asks the provider to fetch the status again and update its record | effectful |
| `reject(transportId, { reject_reason? })`                                       | Rejects a received transport                                      | effectful |
| `confirmDelivery(transportId, { outcome, delivered_packaging? })`               | Confirms a delivery                                               | effectful |
| `confirmReturn(transportId)`                                                    | Completes a transport on the return of undelivered goods          | effectful |
| `transfer(transportId, { vehicle_number, transport_type, carrier_vat_number })` | Declares a new leg                                                | effectful |

Rules by operation:

- `list`: the page carries `digital_transports` (up to 10 records), `total_pages` and
  `current_page`, with no total count. `category` is `shipping` or `receiving`; without it the
  provider lists the shipping transports.
- `create`: `transport_type` is one of 1 to 7.
- `refresh`: it changes provider state, so it is classified effectful, not a read.
- `confirmDelivery`: `outcome` is `FULL`, `PARTIAL` or `NONE`, exactly as written.
  - Each packaging row has a `packaging_type` from 1 to 6, a nonnegative integer `quantity` and
    an optional `other_packaging_title`.
  - The title is optional for every type: the provider says it applies to type 6 and states no
    rule that requires it there or refuses it elsewhere.

Rules for the six writes:

- They are dispatched at most once, never retried, and report effect `unknown` after a dispatched
  failure.
- Each returns `observed` with the record, or `rejected`.

### Eligibility

Eligibility belongs to the provider.

| Operation         | What the provider requires                                 |
| ----------------- | ---------------------------------------------------------- |
| `create`          | An issued delivery note with a registration mark           |
| `confirmReturn`   | The issuer and particular states                           |
| `transfer`        | A transport in transit                                     |
| `confirmDelivery` | Not accepted for a reverse delivery note the caller issued |

- The SDK checks none of this beforehand and makes no preliminary read.
- After a refusal it attempts nothing else: a refused `confirmDelivery` is not turned into
  `confirmReturn`.

### Transport records

- A record carries `id`, `category` and `status`.
- When the provider sends them, it also carries `invoice_id`, `invoice_issued_at`,
  `invoice_code` and `last_status_update_at`. Absent and `null` are kept apart, and timestamps
  are the provider's text, verbatim.
- `status` is also the provider's text. Its reference shows `pending`, `delivered`, `rejected`,
  `COMPLETED` and `IN_TRANSIT` in different answers without relating them, so the SDK does not
  map them onto one lifecycle.
- A value the SDK has never seen is returned as received.
- No status is treated as a finished delivery by the SDK.

An answer is refused as a protocol error in three cases:

- it is about another transport than the one addressed;
- a created transport names another invoice than the one requested;
- a record arrives beside an error field.

### Opaque provider evidence

`my_data_response` is the tax authority's answer as the provider stored it. The provider does
not document its contents, so the SDK returns it as `ProviderJson`: a tree that keeps the
structure and nothing else. Each node has a `kind`.

| `kind`    | Carries                                        |
| --------- | ---------------------------------------------- |
| `null`    | nothing                                        |
| `boolean` | `value`                                        |
| `string`  | `value`                                        |
| `number`  | `text`                                         |
| `array`   | `items`                                        |
| `object`  | `entries`, an ordered list of `{ key, value }` |

- A number keeps the exact text of its JSON token, sign, fraction and exponent included, and is
  never converted to a JavaScript number. The number 1 and the string "1" stay different nodes.
- An object is a list of entries, not a JavaScript object, so a key such as `constructor` is
  only a key.
- The tree is deeply frozen.
- An absent `my_data_response` stays absent. An explicit JSON `null` is a node of kind `null`.

Bounds, which are SDK policy and not provider limits:

| What                      | Bound                    |
| ------------------------- | ------------------------ |
| Levels of nesting         | 20                       |
| Nodes                     | 10 000                   |
| Each string value         | 65 536 UTF-16 code units |
| Each key and number token | 4096 UTF-16 code units   |

- One string value can hold a whole document, such as an XML answer of the tax authority.
- A larger value fails the read with a protocol error.

Nothing inside the tree is read by the SDK: an error-shaped or status-shaped value in it does
not change the outcome of an operation. Treat it the same way unless the provider documents its
fields to you.

Importing a transport by mark or by QR URL is not available.

## Reading invoices

This section covers `getStatus`, `get`, `list`, `iterate` and `issuedCount` on `client.invoices`.

```ts
import { calendarDate } from '@prokolyvakis/wrapp-sdk';

const status = await client.invoices.getStatus({ kind: 'externalId', value: 'reference-one' });

switch (status.kind) {
  case 'observed':
    // status.invoice, status.identity
    break;
  case 'pending':
    // status.invoiceId, status.identity, and status.invoice when the provider sent one
    break;
  case 'draft':
    // no record; status.identity is 'unavailable'
    break;
}

const details = await client.invoices.get({ kind: 'invoiceId', value: 'invoice-one' });
// details.invoice, details.identity

const firstPage = await client.invoices.list({
  start_date: calendarDate('2026-01-01'),
  end_date: calendarDate('2026-01-31'),
});

for await (const record of client.invoices.iterate({}, { maxPages: 10 })) {
  // record is a full-detail record
}

const { issuedCount } = await client.invoices.issuedCount();
```

### Status lookup

- `getStatus` returns `observed`, `pending` or `draft`. Switch on `kind` before reading
  `invoice`.
- A draft status beside any field of an issued invoice is a protocol error.
- A pending result is described under [Pending outcomes](#pending-outcomes), and a draft result
  under [Drafts](#drafts).
- A status rejection, including not-found, remains a `PROVIDER_REJECTED` error.

### Full details, lists and iteration

- `get`, `list` and `iterate` return full-detail records; see
  [Returned fields](#returned-fields).
- `invoices.list` and `invoices.iterate` return issued invoices only and take no status.
- Iteration is lazy, finite and cancellable, with no prefetch.
- Invalid or repeated pages and exceeding `maxPages` fail explicitly.
- There is no snapshot guarantee, no silent truncation and no silent deduplication.

### Issued count

- `issuedCount` returns the tenant's issued-invoice count as exact integer text (`issuedCount`),
  up to 30 digits.
- A count that is not a nonnegative JSON integer token is a protocol error.
- Nothing is narrowed to a floating-point number.

### Calendar formats

| Where                                 | Format                                     |
| ------------------------------------- | ------------------------------------------ |
| List input and the tenant charge date | ISO dates                                  |
| The status response                   | DD-MM-YYYY                                 |
| Full details                          | A documented timestamp with numeric offset |

There is no local-time coercion.

## Returned fields

This section describes the fields of an observation and of a full-detail record.

### Observation

An observation comes from `create`, a status lookup and the `issued-invoice` webhook.

- It carries `id`, `external_id`, `my_data_mark`, `my_data_uid`, `my_data_qr_url`, `series`,
  `num`, `issued_at`, `cancelled_by_mark`, `transmission_failure` and the two portal links.
- It has five optional fields: `authentication_code`, `catering_table_id`, `card_type`,
  `card_number` and `transaction_id`.
- Each of the five optional fields is absent when the provider omits it and `null` when the
  provider reports that it does not apply.
- Absent and `null` are kept distinct.

### Full-detail record

A full-detail record comes from `get`, `list` and `iterate`. It adds these optional fields, each
absent when the provider omits it:

| Where         | Fields                                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On the record | `payment_method`, `branch`, `is_delivery_note`, `fuel_invoice`, `third_party_collection`, `exchange_rate`, `other_taxes_amount`, `notes`, `withholding_total_amount`, `total_stamp_duty_amount` |
| On each line  | `code`, `description`, `quantity_type`, `withhold_tax_code`, `withholding_total`, `stamp_duty_tax_code`, `stamp_duty_amount`, `deductions_amount`                                               |

- Returned numeric codes (`payment_method`, `branch`, `quantity_type`) are exact decimal text,
  not numbers.
- They are not checked against the request code sets, so an unfamiliar code is kept rather than
  refused.
- The two tax-code fields (`withhold_tax_code` and `stamp_duty_tax_code`) are plain text, empty
  when unused.
- The provider returns `null` for a field it has no value for (a line's `code` is `null` on most
  records). Each of these fields is `null` when the provider says `null` and absent when it
  omits the field; the two are kept distinct.
- A value of another type is a protocol error for that read.

### Records of types the SDK does not issue

A read returns every invoice of the tenant, including types this SDK does not issue.

- On some of those the provider returns a line with an empty `name`, or with `null` for
  `vat_rate`, `classification_category` or `classification_type`, and a counterpart with an
  empty `name`.
- These are returned as they came. A line's `vat_rate` and its two classification fields can be
  `null`.

### Fields returned in observed shapes

Seven more fields are returned in the shapes observed on the provider's wire, each absent or
`null` as above.

| Field                                  | Shape                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `special_invoice_category`             | A provider code as exact decimal text                                                                            |
| `fuel_code`, per line                  | A provider code as exact decimal text                                                                            |
| `withhold_tax_rate`, per line          | The exact text of the rate: `'20'` when set, and an empty string when the line has none                          |
| `deductions`, per line                 | A list of `{ title?, amount, informational? }` with `amount` as exact text; an empty list when the line has none |
| `counterpart.supply_account_no`        | Text, present on a fuel invoice                                                                                  |
| `delivery_details`, on a delivery note | See the list below                                                                                               |
| `b2g_details`, on a B2G invoice        | See the list below                                                                                               |

`delivery_details` carries:

- `dispatch_date` (the provider's DD-MM-YYYY text), `dispatch_time`, `vehicle_number`,
  `purpose_of_movement`, `purpose_of_movement_custom_title` and `issuer_of_movement`;
- the `from_` and `to_` address, number, city and zipcode;
- `from_branch` and `to_branch` (exact text, or `null`);
- `reverse_delivery_note`, `reverse_delivery_note_purpose`, `non_obligated_recipient` and
  `without_digital_transport_tracking`.

`b2g_details` uses the provider's own key names:

- `buyer_reference` and the five `delivery_address_` fields;
- `b2g_contracting_authority_id`, `b2g_contract_identifier`, `b2g_budget_type` (exact text) and
  `b2g_budget_identifier`;
- `b2g_due_date` (DD-MM-YYYY text, where the request takes YYYY-MM-DD);
- `b2g_payment_details` and `bt_70`.

### Fields that are not returned

Two documented fields are not returned, because their populated shape is not established:
`pos_device_id` and `pos_type`. They are tolerated on the wire and left out of the result.

### The returned external reference

A returned `external_id` is free-form text another producer may have stored.

- It is decoded as bounded text: at most 4096 UTF-16 code units, well-formed Unicode.
- It is kept exactly as received: not trimmed, case-folded or percent-decoded, and an empty
  string stays empty.
- The stricter rules for a reference the SDK sends (no whitespace, slash, percent, question
  mark, hash, backslash or control characters) apply only to outbound paths and to
  `create.external_id`. A read by invoice id succeeds whatever reference the record holds.
- Identity is still compared after decoding; a mismatched echo is a protocol error.

## Webhook events

`verifyWebhook` authenticates the raw bytes, then decodes the body the `Event-Type` header
points at. The header is not signed, so every result carries it as `eventTypeHint` with
`eventTypeAuthenticated` `false`.

```ts
import { verifyWebhook } from '@prokolyvakis/wrapp-sdk';

const event = verifyWebhook({
  body: rawBody, // a Uint8Array of the bytes as received
  signature: signatureHeader,
  eventType: eventTypeHeader,
  keys: verificationKeys,
});

switch (event.kind) {
  case 'invoice-observation':
    // event.invoice
    break;
  case 'pdf':
    // event.invoiceId, event.downloadUrl
    break;
  case 'pos-payment-error':
    // event.invoiceId, event.providerMessage
    break;
}
```

| `Event-Type` header | Body                              | Result `kind`         | Result fields                  |
| ------------------- | --------------------------------- | --------------------- | ------------------------------ |
| `issued-invoice`    | observation fields                | `invoice-observation` | `invoice`                      |
| `invoice-pdf`       | `invoice_id`, `download_url`      | `pdf`                 | `invoiceId`, `downloadUrl`     |
| `thermal-print-pdf` | `invoice_id`, `download_url`      | `pdf`                 | `invoiceId`, `downloadUrl`     |
| `pos-payment`       | `errors` (one text), `invoice_id` | `pos-payment-error`   | `invoiceId`, `providerMessage` |

- The two PDF headers share one kind because their bodies are identical: only the unsigned hint
  says which format was requested.
- `providerMessage` is the provider's failure text, up to 4096 UTF-16 code units, kept as data.

### Verification

- The SDK verifies HMAC-SHA256 over the original bytes before strict UTF-8 and JSON decoding.
- The body is bounded, and so is key rotation.
- A malformed signature, or more than one signature, fails closed.
- `Event-Type` is untrusted.
- Verification makes no promise about replay, freshness or tenant authentication.

### Refused webhooks

These fail with `WEBHOOK_INVALID`:

- any other header;
- a body under the header of another family;
- a body carrying another family's defining fields, which is refused rather than trimmed.

The defining fields that are refused, by family:

| Body           | Refused fields                         |
| -------------- | -------------------------------------- |
| An observation | `download_url`, `invoice_id`, `errors` |
| A PDF notice   | `errors`, `series`, `num`              |
| A POS error    | `download_url`, `series`, `num`        |
| All of them    | `status`, `error`                      |

- Together with each family's own required fields this guarantees that no signed body verifies
  as two kinds.
- Any other additive field is tolerated and dropped.
- An `issued-invoice` body with a `status` or `invoice_id` is refused because no pending
  envelope is documented for this event.

## Deliberate differences from the provider API

Covering an operation or a field is not the same as accepting everything the provider accepts.
These nine SDK policies are intentional and remain in force. Each narrows what the SDK sends,
never what it tolerates on a read.

1. `external_id` is required on create, although the provider makes it optional. It is the only
   reconciliation handle after an ambiguous outcome.
2. An outbound reference (`create.external_id`, and the reference in a status or detail lookup)
   is 1 to 256 UTF-16 code units with no whitespace, control character, backslash, slash,
   percent, question mark or hash, and is not dot-only. A record whose stored reference breaks
   these rules can still be read by its provider invoice id.
3. `currency` and `exchange_rate` are sent together or not at all. The provider only says the
   rate is required when a currency is given.
4. Amounts are exact decimal strings (the `decimal()` brand): nonnegative, at most 18 integer
   digits, no exponent, sign or leading zero. Plain numbers are refused. Monetary totals and the
   exchange rate take at most 2 fraction digits and are refused, not rounded, beyond that.
5. Local size bounds apply. These are SDK bounds, not known provider maxima.

   | What                                            | Bound                                                 |
   | ----------------------------------------------- | ----------------------------------------------------- |
   | Text, `email_subject` and `email_body` included | at most 4096 code units                               |
   | Invoice lines                                   | at most 1000, with unique line numbers from 1 to 1000 |
   | Correlated marks                                | at most 100                                           |
   | Customer emails                                 | 100                                                   |
   | Classifications per line                        | 100                                                   |
   | Deductions per line                             | 100                                                   |
   | Identifiers                                     | at most 256                                           |

6. Country and currency codes are checked for shape only, not against an ISO list.
   Classification strings and emails only need to be nonempty. Choosing them is the caller's tax
   and business decision.
7. `unit_price` accepts up to 12 fraction digits although the provider documents 2. This follows
   provider behavior recorded in [provider-evidence.md](provider-evidence.md).
8. `num` is at least 1 and `withhold_tax_rate` is a whole percent from 0 to 100. The provider
   documents both only as integers.
9. Two fields are covered without a rule the reference leaves unsettled.
   - The reference documents two stamp-duty totals, `stamp_duty_amount` ("required when stamp
     duty present") and `total_stamp_duty_amount`, while its own example sends line stamp duty
     with only the second. The SDK accepts both, requires neither and never treats one as the
     other.
   - The reference gives no code table for `fees_category`, so any positive integer is sent and
     the provider decides.

## Invariants and failure modes

These rules hold across the SDK.

### Inputs and responses

- Unknown inputs are rejected. Additive response fields are ignored, and required evidence is
  validated.
- Exception: the top-level keys `errors`, `error` and `status` are reserved envelope
  discriminators. Their appearance on a read response is treated as a provider error report,
  never as an additive field.
- A provider body or webhook body that carries a `__proto__` key, at any depth and however the
  key is escaped, is refused as malformed. Such a key is never honored and never silently
  dropped.
- A provider body or webhook body nested more than 64 levels deep is refused as malformed before
  it is parsed. This is an SDK bound; no documented answer comes near it.
- All public response trees are frozen copies.
- Parser types and errors never enter public exports.

### Dispatch, authentication and deadlines

- There is no automatic retry or auth replay of any operation.
- A call dispatches an invoice at most once.
- The login key and tenant go in the JSON body only, and the bearer token in a header only.
- `redirect: 'error'` is set everywhere.
- The absolute request deadline spans the auth wait and the body. The shared login has its own
  finite deadline.
- Aborting one waiter does not cancel other waiters.
- An old-token 401 cannot evict a new token.
- Each client has a private session. Credential rotation means a new client.
- No secrets appear in diagnostics.

### Errors

- All errors carry `code`, `operation` and effect certainty.
- Post-dispatch mutation failures are `unknown`, including abort, timeout, HTTP and protocol
  failures.
- An auth failure before invoice dispatch is `not-sent`.
- Ordinary errors carry no raw cause, payload, URL, key or provider message.
- Rejections carry `rejectionSource`, the provider validation family that reported them
  (`invoice-errors`, `mydata-errors` or `unknown`), as evidence, never as terminality.

### Provider diagnostics

Provider rejection detail is available only on request.

- Pass `diagnostics: 'provider-issues'` in the request options, then call
  `getProviderDiagnostics` with the returned rejected result or the thrown `WrappError`.
- It returns `providerStatus` (when present), `issues` (each with any of `code`, `title`,
  `message`), `truncated` and `sensitive: true`, deeply frozen, or `undefined` when nothing was
  retained.
- `errors[]`, a field-keyed `errors` object (one issue per message, titled with its field) and a
  single `error` string are decoded when present.
- Any other value for the option is rejected before I/O.
- Login failures carry no diagnostics.

```ts
import { WrappError, getProviderDiagnostics } from '@prokolyvakis/wrapp-sdk';

try {
  const result = await client.invoices.create(invoice, { diagnostics: 'provider-issues' });
  if (result.kind === 'rejected') {
    const detail = getProviderDiagnostics(result);
    // detail?.issues, detail?.truncated; treat the detail as sensitive
  }
} catch (error) {
  if (error instanceof WrappError) {
    // error.code, error.operation, error.effect
    const detail = getProviderDiagnostics(error);
  }
}
```

Bounds:

| What                  | Bound                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| Issues                | 100                                                                         |
| Each title or message | 4096 UTF-16 code units                                                      |
| Each code or status   | 256 UTF-16 code units; an overlong code or status is omitted, not shortened |
| Total                 | 64 KiB of UTF-8                                                             |

- `truncated` reports any loss, and `errorCount` is never adjusted.

Redaction:

- Exact occurrences of the active API key and bearer token inside a retained text are redacted
  first, and the bounds apply to the redacted text.
- Redaction is a safety net, not a guarantee: an encoded, re-cased or split credential is not
  recognized, so treat the detail as sensitive.

Where the detail lives:

- The detail is attached to that exact object only: a copy, a spread, a clone or its JSON does
  not carry it.
- With the option, a non-2xx response body is read under the same deadline and byte cap.
  Whatever that read does, the error code, HTTP status and effect certainty are unchanged, and
  nothing is retried.

### Identity

- Returned invoice identity is compared. Exact or ASCII-case-variant matches are explicitly
  represented.
- There is no Unicode folding, no automatic lowercasing, and no adoption based on ID alone.
- The rules for a returned `external_id` are under
  [The returned external reference](#the-returned-external-reference).

### Full-detail reads

- Full-detail reads expose a validated projection, not a full fiscal archive.
- Unknown provider additions and the two fields named under
  [Fields that are not returned](#fields-that-are-not-returned) are not copied; consumers need
  provider export for complete data.

### Tests

- No provider calls, credentials or publishing are required to run the tests.
