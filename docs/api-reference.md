# API reference

What the SDK supports, field by field. Synthetic tests and provider observations are not
production certification; see [provider-evidence.md](provider-evidence.md) for what is
grounded in documentation, what is observed behavior, and what remains an open question.

## Supported operations

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
| branches.create                     | POST /branches                                 | effectful      |
| branches.update                     | PUT /branches/:id                              | effectful      |
| billingBooks.create                 | POST /billing_books                            | effectful      |
| digitalClienteles.correlateByMark   | POST /digital_clienteles/:id/correlate_by_mark | effectful      |
| digitalClienteles.correlateByFim    | POST /digital_clienteles/:id/correlate_by_fim  | effectful      |
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

There is no generic request escape hatch. Origins are explicit staging/production; the
loopback-only test-origin override is visibly an advanced test capability. An injected fetch
must obey fetch semantics; it is a trusted capability, not a sandbox for hostile transport
implementations.

## Input fields

Create uses provider snake_case keys to avoid a second field vocabulary. Required:
external_id, billing_book_id, invoice_type_code, payment_method_type, counterpart,
net_total_amount, vat_total_amount, total_amount, payable_total_amount, invoice_lines.
Optional: branch, payment_details, notes, currency with exchange_rate, correlated_invoices,
customer_emails, email_locale, email_subject, email_body, generate_pdf, mark_as_paid, num,
self_pricing, special_invoice_category, and the invoice-level totals other_taxes_amount,
withholding_total_amount, total_stamp_duty_amount, stamp_duty_amount, deductions_total_amount
and fees_amount, the POS fields pos_device_id, installments and tip_amount, and
fuel_invoice, and the fourteen B2G fields described below. The counterpart also takes an
optional supply_account_no, and a line an optional fuel_code and cpv_code. All other fields
reject pre-I/O.

Invoice types 2.1/2.2/2.3/11.2 only; draft/delivery features, POS refunds and
preloaded POS transactions (refund_invoice_id, aade_preloaded, third_party_collection), the
invoice-level tax mode (taxes_totals), and the line fields the provider defines for invoice
types this SDK does not issue yet (other_taxes_amount, accommodation_tax and
other_taxes_percent_category for type 8.2, invoice_detail_type for type 1.5) are not
supported. All 52 provider type codes and the status of each are listed in
[invoice-capabilities.md](invoice-capabilities.md). Counterpart: name required; country_code, vat, city, street, number, postal_code
also required for B2B service types 2.x; optional for retail 11.2. Email optional.

Each line: line_number, name, quantity, unit_price, net_total_price, vat_rate, vat_total and
subtotal required, plus a classification (below); code, description, quantity_type,
vat_exemption_code, withhold_tax_rate, withhold_tax_code, withholding_total,
stamp_duty_tax_code, stamp_duty_amount, deductions, deductions_amount,
expenses_vat_classification, expense, rec_type and fees_category optional. VAT-zero requires an
exemption; the SDK invents no tax codes.

General invoice and line fields, each sent exactly as given:

- email_subject and email_body override the customer email. Placeholders such as
  $INVOICE_CODE, $COMPANY_NAME and $ISSUE_DATES are substituted by the provider, not the SDK;
  line breaks and surrounding spaces are kept.
- num is a specific invoice number, a positive integer chosen by the caller. The SDK keeps no
  numbering state and does not check it against the billing book.
- special_invoice_category is one of 1 to 13.
- A line is classified by classification_category and classification_type together, or by a
  nonempty classifications array of `{ category, type, amount }`, or by both. When both are
  sent the provider documents that the array overrides the pair; the SDK sends all of it
  unmerged. A line with neither, or with one scalar and no array, is refused. The array's
  amounts are not checked against the line total.
- withhold_tax_rate is a whole percent from 0 to 100; withhold_tax_code is a string from '1'
  to '18'; stamp_duty_tax_code is a string from '1' to '4'. A code is never derived from a
  rate, or the reverse.
- deductions is an array of `{ title?, amount, informational? }`. A line with at least one
  deduction needs deductions_amount, and the invoice then needs deductions_total_amount. An
  empty array is sent as given and requires nothing.
- self_pricing: true needs expenses_vat_classification on every line.
- rec_type marks a fee line and accepts only 2. fees_category is a positive integer. A line
  with either needs fees_amount on the invoice.

POS fields on an invoice:

- pos_device_id names a registered device (see "POS devices and sessions") for an issuance
  tied to a POS transaction. It is not required for a card payment as such, and the SDK
  never looks the device up.
- installments: true needs pos_device_id. The provider documents installments for Viva
  terminals only and is the one to refuse another terminal; false is sent as given.
- tip_amount is an exact amount with at most 2 fraction digits.

Fuel fields on an invoice:

- fuel_invoice marks a fuel invoice; false is sent as given.
- A line's fuel_code is one of the provider's fuel codes (10 to 15, 20, 21, 30 to 38, 40 to
  44, 50, 60, 61, 70 to 72 and 999) and is accepted only when the invoice sets
  fuel_invoice: true. The provider refuses a fuel code on any other invoice, so the SDK
  refuses it first.
- Code 999 may appear on one line only, and that line's net_total_price may not be greater
  than the sum of the other lines' net_total_price. This is the one comparison of amounts
  the SDK makes, because the provider states it as a validity rule. It is made exactly, in
  hundredths, and compares only those line values: no total is derived or corrected, and
  the invoice totals are not consulted.
- counterpart.supply_account_no is optional. The provider documents that it uses it only on
  a fuel invoice and ignores it, without storing it, on any other; the SDK sends it as given
  in both cases and does not claim it is returned by a read.

B2G (public sector) fields on an invoice:

- b2g: true marks a B2G invoice. It then requires delivery_address_city,
  delivery_address_street, delivery_address_street_number, delivery_address_postal_code,
  delivery_address_party_name, b2g_contracting_authority_id, b2g_contract_identifier,
  b2g_budget_type, b2g_budget_identifier, b2g_payment_details and b2g_due_date, and a
  cpv_code on every line. b2g_buyer_reference and b2g_bt_70 stay optional.
- b2g_budget_type is 1, 2 or 3. b2g_due_date is a real calendar date written YYYY-MM-DD
  (the calendarDate() brand). The other fields are nonempty text.
- The SDK checks presence and form only. It does not look up or verify a contracting
  authority, a contract or a budget, and it applies no procurement rule.
- Without b2g: true none of these fields is required. If they are supplied anyway they are
  still validated and are sent as given, as the provider's own request example does.
- The delivery_address_* fields are the B2G invoice's own address. They are unrelated to a
  delivery note, whose delivery_detail object is not available.

These presence rules are the ones the provider's reference states. They only require a field
to be there: the SDK never sums deductions, derives a total, or compares a total with its
parts, so totals that disagree are sent as given and judged by the provider. The fuel code
999 rule above is the single exception.

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

## Invoice management

Four operations change an existing invoice. Each is dispatched at most once and never retried;
a failure after dispatch carries effect unknown. Each has its own result, and a provider
rejection is a rejected result (errorCount and rejectionSource only), not an error.

- cancelDeliveryNote(invoiceId) cancels a delivery note. The provider offers the route for
  delivery notes only and states that invoices sent through a provider cannot be cancelled;
  it is not a way to reverse an ordinary invoice. The result is observed with the provider's
  cancellation record (id, my_data_mark, my_data_uid, my_data_qr_url, series, num,
  cancelled_by_mark and the two portal links) or rejected. The record's id must equal the
  requested id. Read cancelled_by_mark before concluding anything: the SDK does not turn the
  record into a statement that the cancellation completed.
- setExternalId(invoiceId, { external_id }) assigns an external reference to an invoice that
  has none. The provider never overwrites a reference, so the assignment is permanent. The
  reference follows the outbound rules of create.external_id. The result is acknowledged,
  with invoiceId, the echoed externalId and identity (exact or ascii-case-variant), or
  rejected with referenceState unknown. A rejection never shows whether the reference is
  free or which invoice holds it, whatever its wording, and no other reference is tried.
- markAsPaid(invoiceId) is an effectful GET. acknowledged means the provider answered with
  its status text; it is not verified settlement.
- drafts.delete(invoiceId) deletes a draft; the provider decides whether the invoice is an
  untransmitted draft. acknowledged does not show that the draft's external reference can be
  used again. Creating, issuing and listing drafts are not available.

The status text of an acknowledgement is validated as present and then dropped, like any
other provider wording. Use the diagnostics option to read a rejection's detail.

## Branch and billing-book writes

Three operations change account configuration. Each is dispatched at most once and never
retried; a failure after dispatch carries effect unknown; a provider rejection is a rejected
result (errorCount and rejectionSource only).

- branches.create(input) requires name, code, address, street_number, city and postal_code.
  code is a nonnegative integer on the request. Optional: phone, address_en, city_en,
  default_option, company_activity, company_activity_en. An omitted optional field is not
  sent; an explicit false is sent as false. The result is observed with the branch (id, name,
  code as text) or rejected.
- branches.update(branchId, patch) takes the same fields, all optional, at least one. Only
  the fields given are sent: the SDK never reads the branch first, merges values or fills in
  defaults. The returned branch id must equal the requested one.
- billingBooks.create(input) requires name, series, number and invoice_type_code.
  invoice_type_code is any of the provider's 52 type codes, since a book can exist for a type
  create does not issue. The result is observed with the book (id, name, series,
  invoice_type_code, and number only when the provider returns it) or rejected.

Three provider behaviors are worth knowing before calling these. Setting default_option true
removes the default from every other branch. A billing book's number is the counter invoices
are numbered from: the SDK sends the value given and neither allocates nor reconciles
counters. And the provider stores some types under their family, so a book requested as 1.2
can come back as 1.1; the returned type is kept as given and is not compared with the request.
Updating a billing book's number is not available.

## Digital clientele correlations

Two operations correlate an existing digital clientele entry. Each is dispatched at most once
and never retried, makes no follow-up request, and reports effect unknown after a dispatched
failure.

- digitalClienteles.correlateByMark(clienteleId, { correlate_mark }) correlates the entry with
  an invoice by its registration mark.
- digitalClienteles.correlateByFim(clienteleId, { correlate_fim_number, correlate_fim_aa })
  correlates it with a fiscal device receipt.

The two bodies are distinct and strict: each field is a nonempty string, and neither
operation accepts the other's fields. The result is acknowledged when the provider returns
its notice, or rejected (errorCount and rejectionSource). The provider reports a refusal of
these two operations as a single string, which counts as one issue. Neither the notice nor
the refusal is interpreted: a refusal saying a correlation already exists is still a
rejection, not a finding that the correlation is in place.

Reading, creating, updating and cancelling a digital clientele entry are not available.

## POS devices and sessions

- posDevices.list() returns the registered devices: id and name, with terminal_id and
  merchant_id when the provider sends them (absent and null are kept apart).
- posDevices.create(device) registers a device. The input is one of three strict shapes,
  chosen by pos_type: `viva` takes name, terminal_id and merchant_id; `worldline_softpos`
  takes terminal_id and merchant_id (the merchant's email address) and an optional name;
  each of `epay`, `worldline`, `nbg`, `cosmote`, `jcc`, `attica`, `pancreta`, `tora`, `pbt`,
  `mypos`, `nexi-mellon`, `nexi` and `nbg_edps` takes name, terminal_id and
  authorization_code. The other credential, both credentials, or an unknown type is refused
  before any request. The result is observed with the returned device, or rejected.
- posDevices.delete(deviceId) deletes a device permanently; the provider refuses one that has
  a successful transaction. The result is acknowledged or rejected.
- posSessions.abort(invoiceId) aborts the pending POS session of an invoice. The id is the
  invoice's id, not a device or session id. The provider documents it for Viva terminals
  only. The result is acknowledged or rejected.

The three writes are dispatched at most once and never retried, and report effect unknown
after a dispatched failure. That includes registration: for Worldline SoftPOS the provider
reuses an existing account and enables an already attached terminal, answering 200 instead
of 201 with the same body, but that is its behavior, not permission for the SDK to repeat a
call. After an unknown outcome, list the devices before registering again.

A refusal that arrives with an HTTP error status (the provider documents 422 for a device
with transactions) is a thrown HTTP_ERROR, like any non-2xx answer. Registration reports its
refusals as an object of field name to messages; each message counts as one issue, and with
diagnostics: 'provider-issues' each is returned as a title (the field) and a message. The
merchant id and the authorization code of the request are redacted from that retained text,
and neither appears in any error.

## Catering tables and order notes

Tables, on `client.cateringTables`:

- list() returns every table as a summary: id, status, name and total. The provider's status
  and name filters are not available yet.
- get(tableId) returns one table with its details: the summary fields plus invoices (invoice
  ids) and error_message when the provider sends them.
- create({ name? }) creates a table; without a name the provider assigns one, and nothing is
  sent in its place. update(tableId, { name }) renames one.
- open({ id?, name? }) opens a table by id, by name, or by both. At least one is required.
  The provider states no rule for both, so both are sent as given and it decides.
- close(tableId) closes a table. delete(tableId) deletes one; the provider documents deletion
  for an available table.

The five writes are dispatched at most once, never retried, and report effect unknown after a
dispatched failure. create, update, open and close return observed with the table, or
rejected; delete returns acknowledged or rejected. An answer for another table than the one
addressed by id is a protocol error.

A table's status is data, returned verbatim. The provider documents available, open, closed
and alert; another value is returned as received. The SDK never treats a status as a failure
and never acts on one: closing a table does not issue or cancel anything through the SDK.
error_message is likewise the provider's text about the table, returned as data. total is
exact numeric text, and a table the provider named with a number has that number as text.

Order notes, on `client.invoices`:

- listOpenCateringOrderNotes({ page? }) returns one page of open order notes as summaries
  (id, my_data_mark, issued_at, catering_table_id) with total_pages and current_page. It is
  its own page shape: up to 20 records, no total count, and not full invoice records.
  issued_at is the provider's timestamp text, verbatim.
- cancelCateringOrderNotes({ billing_book_id, correlated_invoices, catering_table_id? })
  cancels order notes by their registration marks (1 to 100). The provider does this by
  issuing a new invoice of type 8.6, so it is a fiscal creation: dispatched at most once,
  never retried, effect unknown after a dispatched failure. The result is observed with the
  receipt of that invoice (id, marks, series, num and portal links; no issue date and no
  external reference, because the provider documents none), or rejected.
  catering_table_id is optional: without it the provider resolves the table from the marks.

The cancellation request has no external reference, so the SDK's usual reconciliation handle
does not exist for it. After an unknown outcome, read the open order notes before deciding
anything; do not repeat the call blindly. Nothing follows the dispatch: no table is closed and
no replacement document is issued.

Moving invoices between tables, and creating order notes or other 8.6 invoices through
invoices.create, are not available.

## Digital transports

Eight operations on `client.digitalTransports` cover the movement of a delivery note:

- list({ category?, page? }) returns one page: digital_transports (up to 10 records),
  total_pages and current_page, with no total count. category is `shipping` or `receiving`;
  without it the provider lists the shipping transports.
- get(transportId) returns one record.
- create({ invoice_id, vehicle_number, transport_type, carrier_vat_number }) registers a
  transport for an invoice. transport_type is one of 1 to 7.
- refresh(transportId) asks the provider to fetch the status again and update its record. It
  changes provider state, so it is classified effectful, not a read.
- reject(transportId, { reject_reason? }) rejects a received transport.
- confirmDelivery(transportId, { outcome, delivered_packaging? }) confirms a delivery.
  outcome is `FULL`, `PARTIAL` or `NONE`, exactly as written. Each packaging row has a
  packaging_type from 1 to 6, a nonnegative integer quantity and an optional
  other_packaging_title. The title is optional for every type: the provider says it applies
  to type 6 and states no rule that requires it there or refuses it elsewhere.
- confirmReturn(transportId) completes a transport on the return of undelivered goods.
- transfer(transportId, { vehicle_number, transport_type, carrier_vat_number }) declares a
  new leg.

The six writes are dispatched at most once, never retried, and report effect unknown after a
dispatched failure. Each returns observed with the record, or rejected.

Eligibility belongs to the provider. It requires an issued delivery note with a registration
mark for create, the issuer and particular states for confirmReturn, and a transport in
transit for transfer; it does not accept confirmDelivery for a reverse delivery note the
caller issued. The SDK checks none of this beforehand, makes no preliminary read, and after a
refusal attempts nothing else: a refused confirmDelivery is not turned into confirmReturn.

A record carries id, category and status, and, when the provider sends them, invoice_id,
invoice_issued_at, invoice_code and last_status_update_at (absent and null are kept apart;
timestamps are the provider's text, verbatim). status is also the provider's text. Its
reference shows pending, delivered, rejected, COMPLETED and IN_TRANSIT in different answers
without relating them, so the SDK does not map them onto one lifecycle, and a value it has
never seen is returned as received. No status is treated as a finished delivery by the SDK.

An answer is refused as a protocol error when it is about another transport than the one
addressed, when a created transport names another invoice than the one requested, or when a
record arrives beside an error field.

### Opaque provider evidence

my_data_response is the tax authority's answer as the provider stored it. The provider does
not document its contents, so the SDK returns it as `ProviderJson`: a tree that keeps the
structure and nothing else. Each node has a `kind`: `null`, `boolean` (value), `string`
(value), `number` (text), `array` (items) or `object` (entries, an ordered list of
`{ key, value }`). A number keeps the exact text of its JSON token, sign, fraction and
exponent included, and is never converted to a JavaScript number; the number 1 and the string
"1" stay different nodes. An object is a list of entries, not a JavaScript object, so a key
such as `constructor` is only a key. The tree is deeply frozen.

Bounds, which are SDK policy and not provider limits: 20 levels of nesting, 10 000 nodes, and
4096 UTF-16 code units for each string, key and number token. A larger value fails the read
with a protocol error. An absent my_data_response stays absent; an explicit JSON null is a
node of kind `null`.

Nothing inside the tree is read by the SDK: an error-shaped or status-shaped value in it does
not change the outcome of an operation. Treat it the same way unless the provider documents
its fields to you.

Importing a transport by mark or by QR URL is not available.

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
accepts. These nine SDK policies are intentional and remain in force; each narrows what the
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
5. Local size bounds: text at most 4096 code units (email_subject and email_body included),
   at most 1000 invoice lines with unique line numbers from 1 to 1000, at most 100 correlated
   marks, 100 customer emails, and 100 classifications and 100 deductions per line,
   identifiers at most 256. These are SDK bounds, not known provider maxima.
6. Country and currency codes are checked for shape only, not against an ISO list;
   classification strings and emails only need to be nonempty. Choosing them is the caller's
   tax and business decision.
7. unit_price accepts up to 12 fraction digits although the provider documents 2. This follows
   provider behavior recorded in [provider-evidence.md](provider-evidence.md).
8. num is at least 1 and withhold_tax_rate is a whole percent from 0 to 100. The provider
   documents both only as integers.
9. Two fields are covered without a rule the reference leaves unsettled. It documents two
   stamp-duty totals, stamp_duty_amount ("required when stamp duty present") and
   total_stamp_duty_amount, while its own example sends line stamp duty with only the second;
   the SDK accepts both, requires neither and never treats one as the other. It gives no code
   table for fees_category, so any positive integer is sent and the provider decides.

## Invariants and failure modes

- Unknown inputs rejected; additive response fields ignored, required evidence validated.
  Exception: the top-level keys errors, error and status are reserved envelope discriminators —
  their appearance on a read response is treated as a provider error report, never as an
  additive field.
- A provider body or webhook body that carries a `__proto__` key, at any depth and however
  the key is escaped, is refused as malformed. Such a key is never honored and never
  silently dropped.
- A provider body or webhook body nested more than 64 levels deep is refused as malformed
  before it is parsed. This is an SDK bound; no documented answer comes near it.
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
  nothing was retained. errors[], a field-keyed errors object (one issue per message,
  titled with its field) and a single error string are decoded when present.
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
- requestThermalPdf follows the same rules as requestPdf on its own route and operation name:
  one effectful GET, the same available, acknowledged and rejected outcomes, no download, no
  polling. It takes no locale.
- issuedCount returns the tenant's issued-invoice count as exact integer text (issuedCount),
  up to 30 digits. A count that is not a nonnegative JSON integer token is a protocol error;
  nothing is narrowed to a floating-point number.
- Webhooks verify HMAC-SHA256 over the original bytes before strict UTF-8/JSON decoding;
  bounded body and bounded key rotation; malformed/multiple signatures fail closed.
  Event-Type is untrusted; no replay/freshness/tenant-authentication promise.
- All public response trees are frozen copies. Parser types/errors never enter public exports.
- No provider calls, credentials or publishing are required to run the tests.
