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
- A quantity with 3 fraction digits is likewise accepted and read back unchanged, as a JSON
  string; the documented maximum of 2 digits is not enforced for quantities.
- Empty listing windows return the `total_pages: 0` convention.
- PDF generation is two-phase as documented: an acknowledgement first, then a time-limited
  URL on a later call.
- Additive response fields were observed on the wire, including authentication_code,
  payment_method, branch, delivery/fuel flags, withholding and stamp-duty fields, and
  deductions. Their value types and nullability were recorded in a later observation, listed
  in the next two points, and the SDK decodes them from those observed shapes.
- On full-detail records a line's `code` was null on almost every observed record, and its
  `quantity_type` can be null. On records of types this SDK does not issue, a line can have
  an empty `name` and null `vat_rate`, `classification_category` and `classification_type`,
  and the counterpart `name` can be empty. All are accepted and returned as they came; a
  read that refused null failed on almost every real record.
- Populated shapes of seven full-detail fields: `special_invoice_category` and a line's
  `fuel_code` are JSON numbers; a line's `withhold_tax_rate` is a JSON string, empty when
  unset; a line's `deductions` items are `{title, amount, informational}`;
  `counterpart.supply_account_no` is a string on a fuel invoice; `delivery_details` and
  `b2g_details` are objects whose dates are written DD-MM-YYYY. On records without the
  feature these keys are absent, not null.
- Invoice types 1.1, 11.1, 5.2 and 11.4 are accepted in the ordinary shape; 5.1 is refused
  without a correlated mark. A 9.3 is refused with a nonzero net amount and accepted with all
  four totals and the line values at zero and category3 lines; 9.2, 10.1 and 10.2 are
  accepted in that same shape. A 9.2 is refused without the counterpart's VAT number and
  country, contrary to the reference. 10.1 and 10.2 are refused without a receipt purpose,
  10.2 with purpose 5, 10.1 without a correlated mark, and purpose 7 without a title.
- Delivery-note fields and fuel fields are refused by the tax authority on a 2.1 and accepted
  on a 1.1. A request the authority refuses still appears to use up a number in the series.
- `from_branch` and `to_branch` of a delivery detail are accepted as JSON integers holding a
  branch code and are read back as numbers; omitted, they are read back as null. A code that
  matches no branch of the tenant is accepted and returned as sent.
- The billing-book number update is `PUT /billing_books/:id` with `number` alone in the
  body, answered with the book and its new number. The same request with a name instead of a
  number is refused and changes nothing; the route does not exist for POST.
- `generate_pdf` reads `locale` from the query string. An unknown locale is answered with a
  2xx errors list. Each locale has its own artifact, and a request without a locale returns
  the `el` one.
- The catering transfer is a GET with `current_table`, `target_table` and `marks[]` in the
  query string, answered with a table in the detail shape; the route does not exist for
  POST. The table returned is the target table. Without `marks[]` every open order note of
  the current table moves. A table name in place of an id is answered with HTTP 422.
- The catering table list applies its status and name filters only when they arrive in the
  body of the GET request, not in the query string.
- A catering table created without a name is answered with HTTP 400; a created table is
  open, and its total is a JSON number.
- A digital transport's `my_data_response` can be a JSON string holding an XML document.
- Saving a draft (`draft: true` on create) is answered with a status text and `invoice_id`
  and nothing else: no number, no mark. The status lookup of a draft answers with
  `status: "draft"` alone, by provider id and by external reference.
- A draft appears in `find_all_invoices?status=draft` and in the full-detail lookup in the
  full-detail shape, with `code`, `my_data_mark`, `my_data_uid` and `authentication_code` as
  empty strings and `issued_at` present. Four draft rows were observed, all in that shape.
  Drafts do not appear in the listing without a status.
- `issue_draft` without a body, addressed by provider id, is answered with the issued
  observation plus one field the reference does not list. Issuing the same invoice again is
  answered with HTTP 404. A body with `email_locale` and `generate_pdf` is accepted, and so
  is the draft's external reference in place of the id; the answer then carries the provider
  id and echoes the reference. Not observed: the other four body fields and a pending answer.
- A draft saved with `mark_as_paid` or `generate_pdf` is answered like any saved draft; what
  either does when the draft is issued was not observed.
- The SDK's own requests for the nine added invoice types, the draft operations, the
  billing-book number update, the PDF locale and the catering transfer were each sent to the
  provider and answered as the SDK expects.
- After a draft was deleted, a new draft with the same external reference was accepted.

## Coverage inventory

Implement incrementally, never advertise entire-API support from a small endpoint wrapper.

| Family                                                                                                                                                                        | Initial disposition                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Login, tenant details                                                                                                                                                         | Core                                                                                              |
| VAT search/exemptions, branch/billing-book reads                                                                                                                              | Core read capabilities                                                                            |
| Invoice create/status/full lookup/list                                                                                                                                        | Core, supported-field matrix required                                                             |
| Create fields for email overrides, number, self pricing, special category, withholding, stamp duty, deductions, fee lines, classification arrays, fuel invoices, B2G invoices | Core; request shapes from documentation, unobserved                                               |
| Delivery-note fields on the supported invoice types (flag, delivery detail, other correlated entities)                                                                        | Core; shapes from documentation and its one example, unobserved                                   |
| Invoice types 1.1, 11.1, 5.1, 5.2, 11.4, 9.2, 9.3, 10.1, 10.2                                                                                                                 | Core; each accepted in the shape observed to be accepted by the provider                          |
| PDF request + issued/PDF webhook parsing                                                                                                                                      | Core, side-effect rules apply                                                                     |
| Branch create/update, billing-book create                                                                                                                                     | Core; shapes from documentation, unobserved                                                       |
| Billing-book number update                                                                                                                                                    | Core; method, body and answer observed                                                            |
| Thermal PDF request, issued count                                                                                                                                             | Core; shapes from documentation, unobserved                                                       |
| Delivery-note cancellation, reference assignment, mark-as-paid, draft deletion                                                                                                | Core; shapes from documentation, unobserved                                                       |
| Draft save, issue and listing, draft status                                                                                                                                   | Core; answers observed. Issue options and the pending answer follow the documentation, unobserved |
| Thermal PDF/POS-error callbacks                                                                                                                                               | Core typed events; body shapes from documentation, unobserved                                     |
| POS device list/create/delete, POS session abort, invoice POS device, installments and tip fields                                                                             | Core; shapes from documentation, unobserved                                                       |
| Viva payment links, preloaded POS transactions, POS refunds                                                                                                                   | Deferred                                                                                          |
| Catering table list/get/create/update/open/close/delete, open order-note list, order-note cancellation                                                                        | Core; shapes from documentation, unobserved                                                       |
| Catering order-note transfer                                                                                                                                                  | Core; method, parameters and answer observed                                                      |
| Catering table list filters                                                                                                                                                   | Not offered: the provider reads them only from a GET request body                                 |
| Catering invoice (8.6) creation                                                                                                                                               | Blocked on provider questions                                                                     |
| Digital clientele correlation by mark and by FIM                                                                                                                              | Core; shapes from documentation, unobserved                                                       |
| Digital transport list/get/create/refresh/reject/confirm delivery/confirm return/transfer                                                                                     | Core; shapes from documentation, unobserved; my_data_response returned as opaque evidence         |
| Digital clientele read/create/update/cancel, digital transport imports                                                                                                        | Blocked on provider questions                                                                     |

Endpoint paths and parameter schemas must be transcribed and tested per implemented operation
against the linked source. Do not copy the complete vendor document or sample payloads into
this repository without confirming reuse rights. Use independently authored synthetic fixtures.

## Questions requiring vendor answers or authorized staging evidence

Items already settled by observed provider behavior have moved to the section above; the
original numbering is retained for the remainder.

| ID  | Uncertainty                                                                                                                                                                                        | Consequence / evidence required                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V01 | Official maintained SDK or authoritative machine schema; redistribution rights                                                                                                                     | Confirm before maintaining generated/copied plumbing. No official TypeScript SDK was verified in the search, not proof none exists.                          |
| V02 | External-reference retention and concurrency (uniqueness and case scope are observed)                                                                                                              | Concurrent create/read-back experiments; same reference/different body; never infer matching payload from duplicate text.                                    |
| V03 | Visibility of pending/rejected objects (observed-create and saved-draft visibility are confirmed)                                                                                                  | Missing read is not permission to issue under a new reference; test visibility delays and retained failures.                                                 |
| V04 | Rate limits and Retry-After (core statuses and envelopes are observed)                                                                                                                             | Capture redacted outcomes; do not infer limits from example headings.                                                                                        |
| V05 | Which rejection outcomes are final, whether later UI repair can issue                                                                                                                              | SDK exposes evidence, not terminality guesses. Mutation retry remains caller-owned.                                                                          |
| V06 | Webhook event IDs/timestamps/retries/order, key scope/rotation and unsigned Event-Type                                                                                                             | No SDK freshness or deduplication guarantee without evidence; integrate durable inbox and read-back externally.                                              |
| V07 | Identifier size limits and remaining field nullability (amount precision is observed)                                                                                                              | Exact serialization and schema fixtures per field; never silently round or coerce.                                                                           |
| V08 | Approved PDF artifact origins, expiry and redirects (the locale parameter and its separate artifacts are observed)                                                                                 | Return links as data initially; downloading is outside v1.                                                                                                   |
| V09 | Pagination under concurrent writes and historical completeness (empty shape observed)                                                                                                              | No snapshot/export-completeness promise; callers use overlap and deduplication.                                                                              |
| V11 | Version announcements, deprecation windows, server schema/version headers                                                                                                                          | Establish monitoring and contact; do not invent an API-version header.                                                                                       |
| V12 | Destructive/corrective endpoint semantics and console repair                                                                                                                                       | Separate gates before exposing management operations.                                                                                                        |
| V13 | Which stamp-duty total is required beside line stamp duty (stamp_duty_amount, total_stamp_duty_amount or both), and the code table for fees_category                                               | The SDK accepts both totals, requires neither, and sends any positive fees_category. Tighten only on a provider answer.                                      |
| V14 | Other shapes of types 9.2, 10.1 and 10.2 (a nonzero net, ordinary lines, delivery fields on a receipt note), and a name-only counterpart on 9.3                                                    | Not observed. The SDK sends these types only in the one shape observed to be accepted. Loosen only on evidence.                                              |
| V15 | Other shapes of a draft row (a null or missing code, mark, uid or date) and of the saved-draft status text; the four unobserved issue fields; what `mark_as_paid` and `generate_pdf` do to a draft | Four draft rows and one status text were observed. The SDK accepts those shapes only and refuses the two create options on a draft. Loosen only on evidence. |

Every future verification record must identify SDK SHA, date, environment, operation, synthetic
test identity, authorization, expected outcome, observed response and cleanup restrictions.
Drafts and staging writes still mutate provider state and require explicit approval.
Never use real customer data or test production as a substitute for missing staging access.

V01 local disposition (2026-09-21): proceed with original hand-written codecs, not generated
or copied vendor code. Revisit if an official maintained SDK/schema is supplied. No vendor
answer is claimed by this disposition.
