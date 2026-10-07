# API reference

What the SDK supports, field by field. Synthetic tests and provider observations are not
production certification; see [provider-evidence.md](provider-evidence.md) for what is
grounded in documentation, what is observed behavior, and what remains an open question.

## Supported operations

| Resource                | Method/path under /api/v1                | Effect         |
| ----------------------- | ---------------------------------------- | -------------- |
| login (internal)        | POST /login                              | authentication |
| tenant.get              | GET /tenant_details                      | read           |
| vat.search              | GET /vat_search?vat=...&country_code=... | read           |
| vat.exemptions          | GET /vat_exemptions                      | read           |
| branches.list           | GET /branches                            | read           |
| billingBooks.list       | GET /billing_books                       | read           |
| invoices.getStatus      | GET /invoices/:id                        | read           |
| invoices.get            | GET /invoices/:id/find_invoice_by_id     | read           |
| invoices.list / iterate | GET /invoices/find_all_invoices          | read           |
| invoices.create         | POST /invoices                           | effectful      |
| invoices.requestPdf     | GET /invoices/:id/generate_pdf           | effectful      |

There is no generic request escape hatch. Origins are explicit staging/production; the
loopback-only test-origin override is visibly an advanced test capability. An injected fetch
must obey fetch semantics; it is a trusted capability, not a sandbox for hostile transport
implementations.

## Input fields

Create uses provider snake_case keys to avoid a second field vocabulary. Required:
external_id, billing_book_id, invoice_type_code, payment_method_type, counterpart,
net_total_amount, vat_total_amount, total_amount, payable_total_amount, invoice_lines.
Optional: branch, payment_details, notes, currency with exchange_rate, correlated_invoices,
customer_emails, email_locale, generate_pdf, mark_as_paid. All other fields reject pre-I/O.

Invoice types 2.1/2.2/2.3/11.2 only; draft/POS/B2G/delivery/fuel/special-tax features are not
supported. Counterpart: name required; country_code, vat, city, street, number, postal_code
also required for B2B service types 2.x; optional for retail 11.2. Email optional.

Each line: line_number, name, quantity, unit_price, net_total_price, vat_rate, vat_total,
subtotal, classification_category, classification_type required; code, description,
quantity_type, vat_exemption_code optional. VAT-zero requires an exemption; the SDK invents
no tax codes.

Three numeric line codes are checked against the provider's documented request sets before
authentication: vat_rate is one of 0, 3, 4, 6, 9, 13, 17, 24; quantity_type is one of 1 to 6;
vat_exemption_code is one of 1 to 31. The provider documents that it does not refuse an
unlisted VAT rate but issues the invoice as if without VAT, which is why the SDK refuses it
first. The sets describe what the SDK will send. They are not a tax-eligibility decision, the
SDK never picks a code, and they are never applied to values the provider returns.

Decimals are nonnegative canonical decimal strings with at most 18 integer digits; no
exponents, leading zeros or rounding. Monetary totals and the exchange rate accept at most 2
fraction digits; quantities and unit prices accept up to 12. A value with more precision is
rejected, never rounded. The unit-price bound follows observed provider behavior; whether the
provider limits quantity precision is an open question, so the quantity bound is unchanged.
These are SDK bounds, not assertions of provider limits (V07 is open). Exact JSON numeric tokens are emitted through a
lossless serializer. Inbound decimals accept bounded nonnegative numeric tokens (including
exponent notation), preserving their value.

Calendar formats: ISO dates for list input and the tenant charge date, DD-MM-YYYY for the
status response, and a documented timestamp with numeric offset for full details. No
local-time coercion.

## Returned fields

An observation (create, status, the issued-invoice webhook) carries id, external_id,
my_data_mark, my_data_uid, my_data_qr_url, series, num, issued_at, cancelled_by_mark,
transmission_failure and the two portal links, plus five optional fields: authentication_code,
catering_table_id, card_type, card_number and transaction_id. Each of the five is absent when
the provider omits it and null when the provider reports that it does not apply. Absent and
null are kept distinct.

A full-detail record (get, list, iterate) adds these optional fields, each absent when the
provider omits it: payment_method, branch, is_delivery_note, fuel_invoice,
third_party_collection, exchange_rate, other_taxes_amount, notes, withholding_total_amount and
total_stamp_duty_amount; and per line code, description, quantity_type, withhold_tax_code,
withholding_total, stamp_duty_tax_code, stamp_duty_amount and deductions_amount. Returned
numeric codes (payment_method, branch, quantity_type) are exact decimal text, not numbers, and
are not checked against the request code sets, so an unfamiliar code is kept rather than
refused. The two tax-code fields are plain text, empty when unused. The provider reference
shows these fields populated and does not say whether they can be null. As an SDK decoding
policy, not a provider guarantee, a null or a value of another type in one of them is a
protocol error for that read rather than a second form of absence.

Nine documented fields are not returned, because the provider reference does not establish
their populated shape: the line fields withhold_tax_rate, deductions and fuel_code; the record
fields pos_device_id, pos_type, b2g_details, delivery_details and special_invoice_category; and
counterpart.supply_account_no. They are tolerated on the wire and left out of the result.

## Webhook events

verifyWebhook authenticates the raw bytes, then decodes the body the Event-Type header points
at. The header is not signed, so every result carries it as eventTypeHint with
eventTypeAuthenticated false.

| Event-Type header | Body                          | Result kind         | Result fields              |
| ----------------- | ----------------------------- | ------------------- | -------------------------- |
| issued-invoice    | observation fields            | invoice-observation | invoice                    |
| invoice-pdf       | invoice_id, download_url      | pdf                 | invoiceId, downloadUrl     |
| thermal-print-pdf | invoice_id, download_url      | pdf                 | invoiceId, downloadUrl     |
| pos-payment       | errors (one text), invoice_id | pos-payment-error   | invoiceId, providerMessage |

The two PDF headers share one kind because their bodies are identical: only the unsigned hint
says which format was requested. providerMessage is the provider's failure text, up to 4096
UTF-16 code units, kept as data.

These fail with WEBHOOK_INVALID: any other header; a body under the header of another
family; and a body carrying another family's defining fields, which is refused rather than
trimmed. The defining fields are download_url, invoice_id and errors for an observation;
errors, series and num for a PDF notice; download_url, series and num for a POS error; and
status or error for all of them. Together with each family's own required fields this
guarantees that no signed body verifies as two kinds. Any other additive field is tolerated
and dropped. An issued-invoice body with a status or invoice_id is refused because no
pending envelope is documented for this event.

## Deliberate differences from the provider API

Covering an operation or a field is not the same as accepting everything the provider
accepts. These seven SDK policies are intentional and remain in force; each narrows what the
SDK sends, never what it tolerates on a read.

1. external_id is required on create, although the provider makes it optional. It is the only
   reconciliation handle after an ambiguous outcome.
2. An outbound reference (create.external_id, and the reference in a status or detail lookup)
   is 1 to 256 UTF-16 code units with no whitespace, control character, backslash, slash,
   percent, question mark or hash, and is not dot-only. A record whose stored reference
   breaks these rules can still be read by its provider invoice id.
3. currency and exchange_rate are sent together or not at all. The provider only says the
   rate is required when a currency is given.
4. Amounts are exact decimal strings (the decimal() brand): nonnegative, at most 18 integer
   digits, no exponent, sign or leading zero. Plain numbers are refused. Monetary totals and
   the exchange rate take at most 2 fraction digits and are refused, not rounded, beyond that.
5. Local size bounds: text at most 4096 code units, at most 1000 invoice lines with unique
   line numbers from 1 to 1000, at most 100 correlated marks and 100 customer emails,
   identifiers at most 256. These are SDK bounds, not known provider maxima.
6. Country and currency codes are checked for shape only, not against an ISO list;
   classification strings and emails only need to be nonempty. Choosing them is the caller's
   tax and business decision.
7. unit_price accepts up to 12 fraction digits although the provider documents 2. This follows
   provider behavior recorded in [provider-evidence.md](provider-evidence.md).

## Invariants and failure modes

- Unknown inputs rejected; additive response fields ignored, required evidence validated.
  Exception: the top-level keys errors, error and status are reserved envelope discriminators —
  their appearance on a read response is treated as a provider error report, never as an
  additive field.
- No automatic retry or auth replay of any operation. One invoice dispatch maximum per call.
- Login key/tenant in JSON body only, bearer token in header only; redirect:error everywhere.
- Absolute request deadline spans auth wait and body; shared login has its own finite deadline.
  Aborting one waiter does not cancel other waiters. An old-token 401 cannot evict a new token.
  Per-client private session; credential rotation means a new client. No secrets in diagnostics.
- All errors carry code, operation and effect certainty; post-dispatch mutation failures are
  unknown, including abort/timeout/HTTP/protocol failures. Auth failure before invoice dispatch
  is not-sent. No raw cause, payload, URL, key or provider message in ordinary errors.
- Provider rejection detail is available only on request: pass diagnostics:'provider-issues' in
  the request options, then call getProviderDiagnostics with the returned rejected result or
  the thrown WrappError. It returns providerStatus (when present), issues (each with any of
  code, title, message), truncated and sensitive:true, deeply frozen, or undefined when
  nothing was retained. Both errors[] and a single error string are decoded when present.
  Bounds: 100 issues, 4096 UTF-16 code units per title or message, 256 per code or status (an
  overlong code or status is omitted, not shortened), 64 KiB of UTF-8 in total; truncated
  reports any loss and errorCount is never adjusted. Exact occurrences of the active API key
  and bearer token inside a retained text are redacted first, and the bounds apply to the
  redacted text. Redaction is a safety net, not a guarantee: an encoded, re-cased or split
  credential is not recognized, so treat the detail as sensitive. The detail is attached to
  that exact object only: a copy, a spread, a clone or its JSON does not carry it. With the
  option, a non-2xx response body is read under the same deadline and byte cap; whatever that
  read does, the error code, HTTP status and effect certainty are unchanged, and nothing is
  retried. Any other value for the option is rejected before I/O. Login failures carry no
  diagnostics.
- Create union: observed, pending, rejected. Every rejected result has referenceState:unknown;
  no conflict inference from English titles. Rejection/not-found never authorizes a new ID.
- Status lookup returns observed or pending; switch on kind before reading invoice. Pending
  carries invoiceId, referenceState:unknown and identity: exact, ascii-case-variant, or
  unavailable when the provider returned only its own invoice id for an external-reference
  request. When the provider returns the full observation with the pending status, it is
  validated and kept as invoice; the outcome stays pending whatever number, date, UID or QR
  URL it carries. Create reports pending the same way. A status rejection, including
  not-found, remains a PROVIDER_REJECTED error.
  Rejections carry rejectionSource — the provider validation family that reported them
  (invoice-errors, mydata-errors or unknown) — as evidence, never as terminality.
- Returned invoice identity is compared; exact or ASCII-case-variant matches are explicitly
  represented. No Unicode folding, no automatic lowercasing, no adoption based on ID alone.
- A returned external_id is free-form text another producer may have stored. It is decoded as
  bounded text (at most 4096 UTF-16 code units, well-formed Unicode) and kept exactly as
  received: not trimmed, case-folded or percent-decoded, and an empty string stays empty.
  The stricter rules for a reference the SDK sends (no whitespace, slash, percent, question
  mark, hash, backslash or control characters) apply only to outbound paths and to
  create.external_id, so a read by invoice id succeeds whatever reference the record holds.
  Identity is still compared after decoding; a mismatched echo is a protocol error.
- Full-detail reads expose a validated projection, not a full fiscal archive. Unknown provider
  additions and the nine unresolved fields above are not copied; consumers need provider export
  for complete data.
- Iteration is lazy, finite, cancellable, no prefetch; invalid/repeated pages and exceeding
  maxPages fail explicitly. No snapshot guarantee, silent truncation or silent deduplication.
- The PDF URL is data, HTTPS only, never automatically fetched. A status-only PDF response has
  unknown acknowledgement semantics; unsigned prose is not queued/ready evidence.
- Webhooks verify HMAC-SHA256 over the original bytes before strict UTF-8/JSON decoding;
  bounded body and bounded key rotation; malformed/multiple signatures fail closed.
  Event-Type is untrusted; no replay/freshness/tenant-authentication promise.
- All public response trees are frozen copies. Parser types/errors never enter public exports.
- No provider calls, credentials or publishing are required to run the tests.
