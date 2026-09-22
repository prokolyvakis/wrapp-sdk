# API reference

What the SDK supports, field by field. Synthetic test evidence is not provider certification;
see [provider-evidence.md](provider-evidence.md) for what is grounded in documentation and what
remains an open question.

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

Decimals are nonnegative canonical decimal strings with at most 18 integer digits; no
exponents, leading zeros or rounding. Monetary totals accept at most 2 fraction digits;
quantities, unit prices and exchange rates accept up to 12. These are SDK bounds, not
assertions of provider limits (V07 is open). Exact JSON numeric tokens are emitted through a
lossless serializer. Inbound decimals accept bounded nonnegative numeric tokens (including
exponent notation), preserving their value.

Calendar formats: ISO dates for list input and the tenant charge date, DD-MM-YYYY for the
status response, and a documented timestamp with numeric offset for full details. No
local-time coercion.

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
- Create union: observed, pending, rejected. Every rejected result has referenceState:unknown;
  no conflict inference from English titles. Rejection/not-found never authorizes a new ID.
  Rejections carry rejectionSource — the provider validation family that reported them
  (invoice-errors, mydata-errors or unknown) — as evidence, never as terminality.
- Returned invoice identity is compared; exact or ASCII-case-variant matches are explicitly
  represented. No Unicode folding, no automatic lowercasing, no adoption based on ID alone.
- Full-detail reads expose a validated core projection, not a full fiscal archive. Optional
  provider additions are not copied blindly; consumers need provider export for complete data.
- Iteration is lazy, finite, cancellable, no prefetch; invalid/repeated pages and exceeding
  maxPages fail explicitly. No snapshot guarantee, silent truncation or silent deduplication.
- The PDF URL is data, HTTPS only, never automatically fetched. A status-only PDF response has
  unknown acknowledgement semantics; unsigned prose is not queued/ready evidence.
- Webhooks verify HMAC-SHA256 over the original bytes before strict UTF-8/JSON decoding;
  bounded body and bounded key rotation; malformed/multiple signatures fail closed.
  Event-Type is untrusted; no replay/freshness/tenant-authentication promise.
- All public response trees are frozen copies. Parser types/errors never enter public exports.
- No provider calls, credentials or publishing are required to run the tests.
