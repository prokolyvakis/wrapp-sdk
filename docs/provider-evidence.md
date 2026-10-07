# Provider evidence and uncertainty register

Grounded in the provider's public documentation and, for the original surface, in provider
behavior observed under authorized testing in September 2026. This is not provider
certification, and later additions rest on documentation alone.

## Primary source

Wrapp publishes [HTML documentation](https://wrapp.ai/api/documentation) and a
[Markdown counterpart](https://wrapp.ai/api/documentation.md). Two revisions matter here.

- **v1.17.0**, researched 2026-09-21. The register below, the original SDK surface and every
  observed provider behavior date from this revision. The downloaded Markdown SHA-256 was
  `1f48c184f8038c7984189fbf6c3751e172c13614bec4a5edc03922ea357b57a6`.
- **v1.18.0**, published 2026-09-27 and retrieved 2026-10-07 (Markdown SHA-256
  `b7de8d53965fc82c74f78ab368f0acdd773b33cbad3ac51caa6b0eebea4e850f`). Everything added since
  0.1.0 is derived from this revision: the request code sets, pending outcomes, the added
  read fields, the four webhook events, the invoice type catalogue and the invoice
  management, thermal PDF and issued-count operations. None of it was observed on the wire.

A download is a temporary research artifact, not vendored or licensed SDK content.
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

## Observed provider behavior

Verified against live provider responses (authorized testing, synthetic data only) and
pinned by regression tests; where the wire deviates from the documentation examples, the
observation profile follows the wire:

- External-reference uniqueness is case-insensitive, as documented. Duplicate and
  case-variant creates are refused with HTTP 422 — reference conflicts arrive as HTTP
  errors, while validation/myDATA rejections arrive as 2xx error envelopes.
- The rejection envelope status is spelled "myData Errors" on the wire (docs: "myDATA
  Errors"); the known statuses match case-insensitively.
- A synchronously observed create is immediately visible through status and full lookup.
- Full-detail timestamps use ISO 8601 with a `T` separator and colon offset; the documented
  space-separated form is also accepted.
- Branch codes can arrive as JSON numbers; a line quantity can arrive as a JSON string
  beside numeric amounts; `counterpart.vat` arrives as `""` when absent. All are accepted
  with exact text preserved.
- A unit price with more than 2 fraction digits is accepted and preserved verbatim through
  issuance and read-back; the documented 2-decimal bound is not enforced for unit prices.
- Empty listing windows return the `total_pages: 0` convention.
- PDF generation is two-phase as documented: an acknowledgement first, then a time-limited
  URL on a later call.
- Additive response fields were observed on the wire, including authentication_code,
  payment_method, branch, delivery/fuel flags, withholding and stamp-duty fields, and
  deductions. Their presence was observed; their value types and nullability were not
  recorded. The SDK now decodes most of them from the shapes in reference v1.18.0
  (documentation-derived, not re-observed); deductions and the line withholding rate stay
  ignored until their populated shape is established.

## Coverage inventory

Implement incrementally, never advertise entire-API support from a small endpoint wrapper.

| Family                                                                                                                                           | Initial disposition                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Login, tenant details                                                                                                                            | Core                                                                                      |
| VAT search/exemptions, branch/billing-book reads                                                                                                 | Core read capabilities                                                                    |
| Invoice create/status/full lookup/list                                                                                                           | Core, supported-field matrix required                                                     |
| Create fields for email overrides, number, self pricing, special category, withholding, stamp duty, deductions, fee lines, classification arrays | Core; request shapes from documentation, unobserved                                       |
| PDF request + issued/PDF webhook parsing                                                                                                         | Core, side-effect rules apply                                                             |
| Branch create/update, billing-book create                                                                                                        | Core; shapes from documentation, unobserved                                               |
| Billing-book number update                                                                                                                       | Blocked: method and body are not established                                              |
| Thermal PDF request, issued count                                                                                                                | Core; shapes from documentation, unobserved                                               |
| Delivery-note cancellation, reference assignment, mark-as-paid, draft deletion                                                                   | Core; shapes from documentation, unobserved                                               |
| Draft save, issue and listing                                                                                                                    | Blocked on undocumented response contracts                                                |
| Thermal PDF/POS-error callbacks                                                                                                                  | Core typed events; body shapes from documentation, unobserved                             |
| POS device list/create/delete, POS session abort, invoice POS device, installments and tip fields                                                | Core; shapes from documentation, unobserved                                               |
| Viva payment links, preloaded POS transactions, POS refunds                                                                                      | Deferred                                                                                  |
| Catering table list/get/create/update/open/close/delete, open order-note list, order-note cancellation                                           | Core; shapes from documentation, unobserved                                               |
| Catering table filters and transfer, catering invoice (8.6) creation                                                                             | Blocked on provider questions                                                             |
| Digital clientele correlation by mark and by FIM                                                                                                 | Core; shapes from documentation, unobserved                                               |
| Digital transport list/get/create/refresh/reject/confirm delivery/confirm return/transfer                                                        | Core; shapes from documentation, unobserved; my_data_response returned as opaque evidence |
| Digital clientele read/create/update/cancel, digital transport imports                                                                           | Blocked on provider questions                                                             |

Endpoint paths and parameter schemas must be transcribed and tested per implemented operation
against the linked source. Do not copy the complete vendor document or sample payloads into
this repository without confirming reuse rights. Use independently authored synthetic fixtures.

## Questions requiring vendor answers or authorized staging evidence

Items already settled by observed provider behavior have moved to the section above; the
original numbering is retained for the remainder.

| ID  | Uncertainty                                                                                                                                          | Consequence / evidence required                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| V01 | Official maintained SDK or authoritative machine schema; redistribution rights                                                                       | Confirm before maintaining generated/copied plumbing. No official TypeScript SDK was verified in the search, not proof none exists. |
| V02 | External-reference retention and concurrency (uniqueness and case scope are observed)                                                                | Concurrent create/read-back experiments; same reference/different body; never infer matching payload from duplicate text.           |
| V03 | Visibility of pending/draft/rejected objects (observed-create visibility is confirmed)                                                               | Missing read is not permission to issue under a new reference; test visibility delays and retained failures.                        |
| V04 | Rate limits and Retry-After (core statuses and envelopes are observed)                                                                               | Capture redacted outcomes; do not infer limits from example headings.                                                               |
| V05 | Which rejection outcomes are final, whether later UI repair can issue                                                                                | SDK exposes evidence, not terminality guesses. Mutation retry remains caller-owned.                                                 |
| V06 | Webhook event IDs/timestamps/retries/order, key scope/rotation and unsigned Event-Type                                                               | No SDK freshness or deduplication guarantee without evidence; integrate durable inbox and read-back externally.                     |
| V07 | Identifier size limits and remaining field nullability (amount precision is observed)                                                                | Exact serialization and schema fixtures per field; never silently round or coerce.                                                  |
| V08 | PDF locale parameter placement, approved artifact origins, expiry and redirects                                                                      | Return links as data initially; downloading is outside v1.                                                                          |
| V09 | Pagination under concurrent writes and historical completeness (empty shape observed)                                                                | No snapshot/export-completeness promise; callers use overlap and deduplication.                                                     |
| V11 | Version announcements, deprecation windows, server schema/version headers                                                                            | Establish monitoring and contact; do not invent an API-version header.                                                              |
| V12 | Destructive/corrective endpoint semantics and console repair                                                                                         | Separate gates before exposing management operations.                                                                               |
| V13 | Which stamp-duty total is required beside line stamp duty (stamp_duty_amount, total_stamp_duty_amount or both), and the code table for fees_category | The SDK accepts both totals, requires neither, and sends any positive fees_category. Tighten only on a provider answer.             |

Every future verification record must identify SDK SHA, date, environment, operation, synthetic
test identity, authorization, expected outcome, observed response and cleanup restrictions.
Drafts and staging writes still mutate provider state and require explicit approval.
Never use real customer data or test production as a substitute for missing staging access.

V01 local disposition (2026-09-21): proceed with original hand-written codecs, not generated
or copied vendor code. Revisit if an official maintained SDK/schema is supplied. No vendor
answer is claimed by this disposition.
