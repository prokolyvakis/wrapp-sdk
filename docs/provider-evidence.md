# Provider evidence and uncertainty register

Research date: 2026-09-21. No authenticated Wrapp calls were made.
Repository baseline: 4e0d612 (license-only). This is not provider certification.

## Primary source

Wrapp publishes [HTML documentation](https://wrapp.ai/api/documentation) and a
[Markdown counterpart](https://wrapp.ai/api/documentation.md). The HTML identifies
API reference v1.17.0. The downloaded Markdown SHA-256 was
`1f48c184f8038c7984189fbf6c3751e172c13614bec4a5edc03922ea357b57a6`.
The download is a temporary research artifact, not vendored or licensed SDK content.
A document revision is not proof of server-version negotiation or immutable behavior.

## Load-bearing documented facts

- Production and staging use distinct origins and credentials.
- Login accepts an API key with tenant email or user ID; documented JWT lifetime is 24 hours.
- Login credentials are sent in the JSON body (per the example); the QUERY PARAMETERS heading
  is inconsistent and must not cause credential-bearing URLs.
- Invoice creation supports case-insensitive unique external references.
- Status/full lookup accept external references; full lookup is described for issued invoices.
- Creation can return a pending outcome or provider errors.
- PDF generation and mark-as-paid use GET despite having effects.
- Provider-issued invoices have cancellation restrictions.
- Callbacks authenticate raw bytes with API-key HMAC-SHA256; event type is a separate header.
- Invoice listing is paginated; inputs and outputs use multiple date formats.
- Some examples are not valid JSON, and response/error envelopes differ by operation.

These facts are summarized from the [API reference](https://wrapp.ai/api/documentation).
They motivate the SDK policies below; they do not establish operational guarantees.

## Coverage inventory

Implement incrementally, never advertise entire-API support from a small endpoint wrapper.

| Family                                                                             | Initial disposition                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Login, tenant details                                                              | Core                                                         |
| VAT search/exemptions, branch/billing-book reads                                   | Core read capabilities                                       |
| Invoice create/status/full lookup/list                                             | Core, supported-field matrix required                        |
| PDF request + issued/PDF webhook parsing                                           | Core, side-effect rules apply                                |
| Branch/billing-book writes                                                         | Later management tranche                                     |
| Draft issue/delete, reference assignment, mark-as-paid, cancellation, issued count | Later explicit tranche; no generic escape hatch              |
| Thermal PDF/POS-error callbacks                                                    | Later typed event support; unknown events handled safely now |
| POS devices/sessions and Viva links                                                | Deferred                                                     |
| Catering tables/order notes                                                        | Deferred                                                     |
| Digital clienteles/transports                                                      | Deferred                                                     |

Endpoint paths and parameter schemas must be transcribed and tested per implemented operation
against the linked source. Do not copy the complete vendor document or sample payloads into
this repository without confirming reuse rights. Use independently authored synthetic fixtures.

## Questions requiring vendor answers or authorized staging evidence

| ID  | Uncertainty                                                                                              | Consequence / evidence required                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| V01 | Official maintained SDK or authoritative machine schema; redistribution rights                           | Confirm before maintaining generated/copied plumbing. No official TypeScript SDK was verified in the search, not proof none exists. |
| V02 | External-reference uniqueness scope, retention, concurrency, case normalization, length/character limits | Concurrent create/read-back experiments; same reference/different body; never infer matching payload from duplicate text.           |
| V03 | Visibility of pending/draft/rejected objects through status and full lookup                              | Missing read is not permission to issue under a new reference; test visibility delays and retained failures.                        |
| V04 | Actual HTTP statuses, error codes, Content-Type, rate limits and Retry-After                             | Capture redacted outcomes; do not infer status from example headings or English strings.                                            |
| V05 | Which rejection outcomes are final, whether later UI repair can issue                                    | SDK exposes evidence, not terminality guesses. Mutation retry remains caller-owned.                                                 |
| V06 | Webhook event IDs/timestamps/retries/order, key scope/rotation and unsigned Event-Type                   | No SDK freshness or deduplication guarantee without evidence; integrate durable inbox and read-back externally.                     |
| V07 | Decimal precision, numeric JSON/string acceptance, identifier size and nullability                       | Exact serialization and schema fixtures per field; never silently round or coerce.                                                  |
| V08 | PDF locale parameter placement, approved artifact origins, expiry and redirects                          | Return links as data initially; downloading is outside v1.                                                                          |
| V09 | Pagination under concurrent writes, date/time-zone interpretation and historical completeness            | No snapshot/export-completeness promise; callers use overlap and deduplication.                                                     |
| V10 | Account readiness, mandates, supported document purposes and environment parity                          | No live issuance merely because a transport test passes.                                                                            |
| V11 | Version announcements, deprecation windows, server schema/version headers                                | Establish monitoring and contact; do not invent an API-version header.                                                              |
| V12 | Destructive/corrective endpoint semantics and console repair                                             | Separate gates before exposing management operations.                                                                               |

Every future staging record must identify SDK SHA, date, environment, operation, synthetic
test identity, authorization, expected outcome, observed response and cleanup restrictions.
Drafts and staging writes still mutate provider state and require explicit approval.
Never use real customer data or test production as a substitute for missing staging access.

V01 local disposition (2026-09-21): proceed with original hand-written codecs, not generated
or copied vendor code. Revisit if an official maintained SDK/schema is supplied. No vendor
answer or authenticated provider observation is claimed by this disposition.

## Staging observations (2026-09-22, authorized staging account, read-only scopes)

First authenticated observations, recorded per the format above; synthetic staging data only.

- V09 (partial): an empty listing window returns `{ invoices: [], total_count: 0,
total_pages: 0, current_page: 1 }` — the total_pages-0 convention. Behavior under
  concurrent writes remains open.
- V10 (this account): `issue_invoice_status: true`; billing books exist for types 2.1, 11.2
  and credit-note types 5.1, 5.2, 11.4 (the latter three are outside the supported surface).
- Wire deviations from the documentation examples, now in the observation profile:
  branch `code` arrives as a JSON number; full-detail `issued_at` uses ISO 8601 with a `T`
  separator and colon offset (docs show a space-separated form; both are accepted);
  `counterpart.vat` arrives as `""` when absent; a line `quantity` can arrive as a JSON
  string ("1.0") beside numeric amounts — numeric read fields accept either token form,
  always preserving exact text.
- Additive fields observed and ignored as designed: authentication_code, payment_method,
  branch, is_delivery_note, fuel_invoice, other_taxes_amount, withholding fields,
  stamp-duty fields, deductions.

Write-probe observations (same date, authorized staging writes; synthetic documents only):

- V02 (answered): a duplicate external_id create and an ASCII-case-variant create are both
  refused with HTTP 422 — case-insensitive uniqueness confirmed. Reference conflicts arrive
  as HTTP 422, not as a 2xx error envelope; through the SDK that is HTTP_ERROR with
  httpStatus 422 and effect unknown, and reconciliation still runs through read-back.
- V03 (answered for observed creates): a synchronously observed invoice is immediately
  visible through status and full lookup by external reference with exact identity evidence.
- V05 (partial): validation/myDATA rejections arrive as 2xx envelopes. Live staging spells
  the envelope status "myData Errors" (docs: "myDATA Errors"); the known statuses now match
  case-insensitively. Terminality remains unestablished.
- V07 (answered for unit_price): a 3-fraction-digit unit_price (10.005) was accepted and
  preserved verbatim through issuance and read-back — no rejection, no rounding. The
  documented 2-decimal bound is not enforced for unit prices; staging also reformats a
  quantity of 2 as "2.0" (value-preserving).
- generate_pdf behaves as documented: acknowledged first, a presigned time-limited URL on a
  later call once generation completes.
