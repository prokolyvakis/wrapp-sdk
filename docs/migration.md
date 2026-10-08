# Migration guide

Changes that need action when you upgrade, newest first. The SDK is on the 0.x line, where a
breaking change ships as a minor release with a note here; see
[compatibility.md](compatibility.md) for the policy.

## From 0.1 to the next minor

This release makes six changes. The first five can require code edits: each corrects a
behavior, and each is breaking because it changes a result shape, a discriminant or which
input is accepted. The sixth is additive, with one case that needs attention.

### 1. `invoices.getStatus` returns a tagged outcome

A status lookup can now report a pending invoice or a draft, so its result is a union. Switch
on `kind` before reading `invoice`.

Before:

```ts
const { invoice, identity } = await client.invoices.getStatus(reference);
record(invoice.my_data_mark, identity);
```

After:

```ts
const status = await client.invoices.getStatus(reference);
switch (status.kind) {
  case 'observed':
    record(status.invoice.my_data_mark, status.identity);
    break;
  case 'pending':
    // Not issued yet. status.invoice is present only when the provider returned its evidence
    // with the pending status; it may already hold a number, a UID and a QR URL.
    schedule(status.invoiceId);
    break;
  case 'draft':
    // Saved, not issued. The answer names no invoice: there is no record to read.
    break;
}
```

Previously a pending answer and a draft answer made `getStatus` fail with `PROTOCOL_ERROR`. A provider
rejection, including not-found, is still a `PROVIDER_REJECTED` error.

### 2. A pending outcome carries identity evidence, which can be `'unavailable'`

The pending variant of `CreateOutcome` and of the status outcome is now `PendingInvoiceOutcome`:

```ts
{ kind: 'pending'; invoiceId: string; referenceState: 'unknown';
  identity: 'exact' | 'ascii-case-variant' | 'unavailable'; invoice?: InvoiceObservation }
```

`'unavailable'` means the provider returned only its own invoice id, so nothing could be
compared with your external reference. Do not treat it as a match.

- Code that compares a pending outcome with an exact object needs the new `identity` field:
  `{ kind: 'pending', invoiceId, referenceState: 'unknown', identity: 'unavailable' }`.
- An exhaustive `switch` over `CreateOutcome['kind']` needs no change: the kinds are the same.
- Create now accepts the provider's enriched pending answer (a pending status alongside the
  full observation), which it used to reject. It stays `pending`: a number or a QR URL is
  not a registration mark.

### 3. Webhook kinds name the validated body, and two more events are supported

`VerifiedWebhook['kind']` changed, and every result now repeats the unsigned header as
`eventTypeHint`.

| Event-Type header   | 0.1 kind         | New kind              | `eventTypeHint`     |
| ------------------- | ---------------- | --------------------- | ------------------- |
| `issued-invoice`    | `issued-invoice` | `invoice-observation` | `issued-invoice`    |
| `invoice-pdf`       | `invoice-pdf`    | `pdf`                 | `invoice-pdf`       |
| `thermal-print-pdf` | not supported    | `pdf`                 | `thermal-print-pdf` |
| `pos-payment`       | not supported    | `pos-payment-error`   | `pos-payment`       |

Before:

```ts
const event = verifyWebhook(input);
if (event.kind === 'issued-invoice') onIssued(event.invoice);
if (event.kind === 'invoice-pdf') onPdf(event.invoiceId, event.downloadUrl);
```

After:

```ts
const event = verifyWebhook(input);
switch (event.kind) {
  case 'invoice-observation':
    onIssued(event.invoice);
    break;
  case 'pdf': // event.eventTypeHint says which header arrived; it is not authenticated
    onPdf(event.invoiceId, event.downloadUrl);
    break;
  case 'pos-payment-error':
    onPosError(event.invoiceId, event.providerMessage);
    break;
}
```

The two PDF headers share one kind because their bodies are identical: nothing signed says
which format a link points to. If you previously rejected `thermal-print-pdf` or
`pos-payment` by catching `WEBHOOK_INVALID`, those events now verify.

### 4. Three line codes and the exchange rate are validated before any request

`invoices.create` now fails with `INVALID_INPUT`, before login, when:

- `vat_rate` is not one of 0, 3, 4, 6, 9, 13, 17, 24;
- `quantity_type` is not one of 1 to 6;
- `vat_exemption_code` is not one of 1 to 31;
- `exchange_rate` has more than 2 fraction digits.

Before, any integer from 0 to 100 passed as a VAT rate. The provider documents that it does
not refuse an unlisted rate but issues the invoice as if without VAT, so such an input could
produce a wrong fiscal document. If you computed a rate such as 25 or sent an exchange rate
such as `decimal('1.0834')`, decide the correct value in your application; the SDK does not
round or pick codes. Quantity and unit-price precision are unchanged.

### 5. Reads return more fields, and line fields can be null

Additive for most code: `InvoiceObservation` gains five optional fields. `InvoiceDetails`
gains ten optional fields on the record and eight optional fields on each invoice line. See
"Returned fields" in the [API reference](api-reference.md). Two things can still need
attention:

- A returned `external_id` is now free-form text exactly as the provider stores it. A record
  whose reference contains a space, slash, percent sign, question mark or hash used to make
  the read fail and now succeeds; do not assume a returned reference is safe to use as an
  outbound one.
- The new full-detail fields are validated. If the provider sends one of them with an
  unexpected type, that read fails with `PROTOCOL_ERROR` where 0.1 ignored the field. A
  `null` is not an unexpected type: the provider returns null for a field it has no value
  for, and the SDK returns that null, so each of these fields is typed `T | null` and may
  also be absent.
- `InvoiceDetails` also returns `special_invoice_category`, `delivery_details`,
  `b2g_details` and `counterpart.supply_account_no`, and on each line `withhold_tax_rate`,
  `deductions` and `fuel_code`. Additive. The new types are `InvoiceDeliveryDetails` and
  `InvoiceB2gDetails`.
- A read returns every invoice of the tenant, including types this SDK does not issue. On
  some of those a line has no VAT rate or classification. `vat_rate`,
  `classification_category` and `classification_type` on a returned line are therefore
  `number | null` and `string | null`, a returned line name can be empty, and a returned
  counterpart name can be empty. Code that reads them as always present needs a null check.

### 6. Provider diagnostics are available on request

Additive. `getProviderDiagnostics(resultOrError)`, with the per-call option
`diagnostics: 'provider-issues'`, exposes the provider's rejection detail when you ask for it.
Results and errors are otherwise unchanged: the same codes, operations and effect certainty,
and the same safe serialization.

One case needs an edit: if you assert the package's exact runtime export list, for example
with `Object.keys`, add `getProviderDiagnostics`.

The release also adds these type exports: `InvoiceStatusOutcome`, `PendingInvoiceOutcome`,
`PendingIdentityEvidence`, `ProviderDiagnostics` and `ProviderIssue`. The new operations
below come with their own input and result types, each exported under the name its method
signature shows, such as `CreateDraftInput`, `DraftCreateOutcome`, `IssueDraftInput`,
`DraftIssueOutcome`, `DraftInvoiceDetails` and `DraftInvoicePage` for drafts.

### New operations

Additive. Each is a new method, on an existing resource or on one of the new
`client.digitalClienteles`, `client.posDevices`, `client.posSessions`,
`client.cateringTables` and `client.digitalTransports` resources, and changes nothing you
already call.

- `invoices.requestThermalPdf(invoiceId)` — the thermal-printer PDF, with the outcomes of
  `requestPdf`.
- `invoices.issuedCount()` — the number of issued invoices, as exact integer text.
- `invoices.cancelDeliveryNote(invoiceId)` — delivery notes only.
- `invoices.setExternalId(invoiceId, { external_id })` — permanent reference assignment.
- `invoices.markAsPaid(invoiceId)` — an effectful GET.
- `invoices.drafts.create(invoice)`, `issue(reference, input?)` (the reference is the
  `{ kind: 'invoiceId' | 'externalId', value }` object of `invoices.getStatus`), `list({ page? })`,
  `iterate({ page? }, { maxPages })` and `delete(invoiceId)` — draft invoices. A draft is
  saved through `drafts.create`; `invoices.create` still refuses a `draft` key.
- `branches.create(input)` and `branches.update(branchId, patch)`.
- `billingBooks.create(input)` and `billingBooks.updateNumber(billingBookId, { number })`.
- `digitalClienteles.get`, `create`, `update`, `cancel`, `correlateByMark` and
  `correlateByFim`, on a new `client.digitalClienteles` resource.
- `posDevices.list()`, `posDevices.create(device)` and `posDevices.delete(deviceId)`, on a
  new `client.posDevices` resource.
- `posSessions.abort(invoiceId)`, on a new `client.posSessions` resource.
- `cateringTables.list`, `get`, `create`, `update`, `open`, `close`, `transfer` and `delete`,
  on a new `client.cateringTables` resource. `create` requires a name, and `transfer` is an
  effectful GET.
- `invoices.listOpenCateringOrderNotes({ page? })` and
  `invoices.cancelCateringOrderNotes(input)`. The second issues a cancelling invoice.
- `digitalTransports.list`, `get`, `create`, `refresh`, `reject`, `confirmDelivery`,
  `confirmReturn` and `transfer`, on a new `client.digitalTransports` resource. A record's
  `my_data_response` is returned as the new `ProviderJson` type: an opaque tree with exact
  number text.

`invoices.requestPdf(invoiceId, options)` also accepts `locale: 'el' | 'en'` in its options.
A call without it sends the same request as before.

One case needs an edit: code that implements the exported `InvoiceResource` interface itself,
such as a typed test double, must add the new methods. The same holds for an object typed as
`WrappClient['branches']` or `WrappClient['billingBooks']`, now the exported `BranchResource`
and `BillingBookResource` interfaces.

### New create fields

Additive. `invoices.create` accepts more of the provider's documented request:

- on the invoice: `email_subject`, `email_body`, `num`, `self_pricing`,
  `special_invoice_category`, `other_taxes_amount`, `withholding_total_amount`,
  `total_stamp_duty_amount`, `stamp_duty_amount`, `deductions_total_amount`, `fees_amount`,
  `pos_device_id`, `installments`, `tip_amount`, `fuel_invoice`, `b2g`, the five
  `delivery_address_*` fields and the eight other `b2g_*` fields, `is_delivery_note`,
  `delivery_detail`, `other_correlated_entities`, `receiving_note_purpose`,
  `other_receiving_note_purpose_title`;
- in `delivery_detail`: the branch codes `from_branch` and `to_branch`;
- on the counterpart: `supply_account_no`;
- on a line: `classifications`, `withhold_tax_rate`, `withhold_tax_code`, `withholding_total`,
  `stamp_duty_tax_code`, `stamp_duty_amount`, `deductions`, `deductions_amount`,
  `expenses_vat_classification`, `expense`, `rec_type`, `fees_category`, `fuel_code`,
  `cpv_code`.

A request that was valid before is still valid and is sent unchanged. See "General invoice
and line fields" in the [API reference](api-reference.md) for the presence rules; the SDK
requires the fields the provider's reference says are required and computes no total.

One case needs an edit: `InvoiceLine.classification_category` and `classification_type` are
now optional in the type, because a `classifications` array can replace them. Code that reads
either field from an `InvoiceLine` value gets `string | undefined`. At run time a line still
needs the pair or the array, and is refused before any request without one.

### Nine more invoice types

`invoices.create` now accepts types 1.1 and 11.1 (goods), 5.1, 5.2 and 11.4 (credits), 9.2
and 9.3 (delivery notes) and 10.1 and 10.2 (quantity receipt notes). Some have rules of their
own; see "Invoice types with rules of their own" in the [API reference](api-reference.md).
A request for one of the four earlier types is unaffected.

`CreateInvoiceInput['invoice_type_code']` gains nine members. Under this project's
compatibility policy an added member of a closed union is a breaking type change: code that
switches exhaustively over the union, or maps it with a `Record`, needs the new cases.

### A `__proto__` key in a provider or webhook body is always refused

Hardening, with no effect on a well-formed body. A JSON body carrying a `__proto__` key whose
value was an object was already refused. One whose value was a number, string, boolean or
null lost that key without notice; it is now refused too, with `PROTOCOL_ERROR` for a
response and `WEBHOOK_INVALID` for a webhook.

A body nested more than 64 levels deep is refused the same way, before it is parsed. Such a
body used to fail inside the parser instead.
