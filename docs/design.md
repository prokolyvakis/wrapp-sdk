# Design notes

Why the SDK is shaped the way it is. The recurring theme: fiscal document issuance is not
retryable, so the SDK preserves ambiguity instead of resolving it optimistically.

## Boundaries

The SDK is a small, predictable, independently reusable server-side client that makes the
remote API safer to consume without claiming to make fiscal workflows transactional.

It owns transport, authentication, operation-specific codecs, validated values, typed
outcomes, bounded pagination and webhook verification/parsing. The consuming application owns
tax choices, issuer authority, durable idempotency records, orchestration, reconciliation,
webhook inbox/deduplication, archives, customer authorization, retention and notifications.

There is deliberately no ORM, tax engine, invoice-number generator, workflow framework,
service locator or queue here, and no consumer-specific fields or dependencies. A timeout
never becomes an invoice retry, and a rejection never becomes permission to mint a different
external reference.

## Parsing and amounts

All external JSON starts as unknown. Each operation has its own decoder; the provider does
not use one uniform envelope. Both the HTTP status and the decoded content are validated: a
2xx response carrying an errors object must not become a successful invoice. Invalid JSON,
HTML, missing required fields, mismatched identity and unknown response variants are protocol
failures.

Request schemas reject unrecognized fields. Response schemas tolerate additive properties
while preserving required evidence and explicit unknown-code handling — with one deliberate
exception: the top-level keys errors, error and status are reserved envelope discriminators,
so their appearance on a read response fails closed instead of being ignored. Parser-specific
errors stay internal, and validation errors never echo raw values, URLs or payloads.

Amounts are never computed with binary floating-point arithmetic. Public exact decimal values
use canonical decimal strings; codecs emit the provider's required JSON numeric tokens through
a lossless serializer (lossless-json). Inbound numeric decoding preserves precision before
ordinary JSON parsing can lose it, keeps large identifiers as strings, and rejects excess
precision rather than rounding. The SDK invents no totals, VAT classifications, exchange
rates or tax decisions.

Dates are validated calendar strings with explicit formats and no implicit local timezone —
a DD-MM-YYYY provider date is never fed into Date.parse.

## Create outcomes

Expected create outcomes are a closed, deliberately stable union: an observed invoice, pending,
or a provider-reported rejection. There is no conflict variant: all rejections carry
referenceState unknown, regardless of the rejection title or its language. Rejections do carry
the provider's validation family verbatim as rejectionSource (invoice-errors vs mydata-errors)
— evidence of where the rejection came from, never of what it means. Read-back is
evidence, never permission to mint a replacement reference after ambiguity; even a subsequent
not-found result does not establish that a previous write cannot issue. A provider-reported
rejection is not a durable guarantee that later repair cannot issue, and an observed invoice
is evidence, not a declaration of jurisdictional compliance.

Pending is decided by the provider's status discriminator alone, and both create and status
lookup report it. The provider documents two pending forms: a minimal one carrying only its
own invoice id, and an enriched one, returned on a provider-to-tax-authority connection loss,
that already carries a number, a date, a UID and a QR URL. Both stay pending. The enriched
evidence is validated and kept on the outcome, and is never promoted to an observed invoice,
because a number or a QR URL is not a registration mark. Every identity comparison the
response allows is made: the enriched form is compared with the requested reference, and a
minimal form answering a lookup by provider id must echo that id. A minimal form answering an
external-reference request echoes no reference, so its identity is reported as unavailable
instead of being inferred from a provider id. Pending, like a rejection, leaves the reference
state unknown.

Errors carry separate fields for operation, failure class and effect certainty (not-sent /
unknown). HTTP failure is never equated with "no side effect", and user cancellation after
dispatch is also potentially ambiguous.

## Provider diagnostics

Ordinary results and errors stay small and loggable: a rejection reports how many issues the
provider raised and which validation family raised them, never the provider's words, which can
name a customer or a document. A caller that needs those words opts in per call. The detail is
then held in a private WeakMap keyed by the returned result or error object and read with
getProviderDiagnostics. Because it is not a property, it cannot leak through serialization,
inspection, spreading, cloning or wrapping the error.

The detail is bounded and marked sensitive. Exact occurrences of the active API key and
bearer token are replaced before any text is shortened, so no fragment of a credential
survives a cut. That replacement is a safety net rather than a guarantee, since it cannot
recognize an encoded or split credential, which is why the detail is always sensitive. On a
non-2xx response the opt-in also reads the error body, under the same deadline and byte cap as
any other response. That read is optional detail only: an unreadable, oversized or stalled
body yields no diagnostics and leaves the HTTP failure, its status and its effect certainty
exactly as they would have been. Login failures carry no diagnostics, because the login is
shared between concurrent callers.

Diagnostics are for people and for logs the caller controls. Provider wording is never used to
decide that a duplicate matches an earlier request, that a reference is free, or that a write
can be repeated.

## Transport and retries

A readonly operation registry classifies every operation as read or effectful; no safety
decision is derived solely from the HTTP method (the provider has effectful GETs).

The implementation performs no automatic retries at all — reads, login, everything. No
mutation replay after 401/429/5xx/timeout/connection reset or an unreadable success response.
Refreshing credentials does not authorize replaying a potentially accepted mutation. An opt-in
bounded read-retry capability is a possible future addition; the registry already retains the
effect classification it would need.

Each request has one absolute deadline covering auth, response headers and body. AbortSignal
is propagated, body readers and timers are cancelled, and response bytes are bounded (2 MiB)
— the client never waits forever on a partial body. Defaults: 30-second request budget.
These are SDK policies, not provider guarantees.

All requests, including login, use redirect:error for every redirect status; credentials and
bodies can never reach a redirect destination. Origins are fixed official HTTPS hosts; the
loopback-only test origin is an explicit advanced testing capability, not an environment
fallback. Path segments and query values are strictly encoded; traversal and control
characters are rejected pre-I/O.

Provider-returned download/portal URLs are data only: no authenticated fetch to those hosts,
no automatic PDF download, no secrets in URLs.

## Internal structure

Each client owns exactly one internal runtime, which holds the transport, the login session,
the default deadline and the request-size limit. Resource modules receive that runtime as a
single capability: run a registered operation on a path relative to the fixed origin, with a
decoder. They cannot read the credentials, reach another origin or issue an unregistered
request, and the runtime is not a public export.

An operation finishes validating and serializing its input before it calls the runtime. The
runtime then validates the request options, bounds the serialized body in UTF-8 bytes,
authenticates, dispatches once and hands the parsed value to the operation's own decoder. The
size bound sits in the runtime, before authentication, so every body-bearing operation
inherits it. Operations are registered explicitly with their method and effect class; the
effect is never derived from the HTTP verb.

## Authentication concurrency

Tokens are acquired lazily and concurrent logins are coalesced per immutable client. The API
key and token stay memory-only and are never serialized with errors or logs. A 401 invalidates
the session only if the rejected token is still the cached token — a delayed 401 carrying an
old token must not evict a newer one. A caller's abort stops its own wait, not every caller
sharing the login; the shared login has its own finite deadline. Credential rotation means
constructing a new client; no in-flight operation changes tenant or key mid-request.

## External references and reconciliation

The SDK requires a caller-supplied external reference for invoice creation even where the
provider makes it optional — an intentional safety constraint. It preserves the exact bytes.

The SDK owns no persistent idempotency database, so it cannot guarantee at-most-once economic
issuance across process crashes or restores. A reference conflict is not success: the existing
object might have a different body, issuer or state. The SDK exposes lookup and identity
evidence; applications compare all relevant immutable fields. There is deliberately no
createOrGet, no automatic alternate-reference retry, and no treating not-found as proof that
a timed-out write failed.

Pagination returns validated page metadata and a lazy async iterator with finite maxPages,
cancellation and repeated-page detection. It does not silently deduplicate records, conceal
page limits or promise snapshot completeness under concurrent writes.

## Webhooks

verifyWebhook is a standalone pure utility, independent of WrappClient and without network
access. Input is the untouched Uint8Array body, the signature, and bounded caller-selected
verification keys; re-serializing JSON before verification is forbidden. It verifies a
strictly validated HMAC-SHA256 hex signature with constant-time comparison, before parsing,
and fails closed on missing, malformed, duplicate or oversized inputs.

The documented Event-Type header is outside the signed body, so a valid signature does not
authenticate routing metadata: the event type is a hint, and the corresponding body is
validated against it.

All four documented headers are supported. The result kind names the body that was validated,
not the header: issued-invoice gives an invoice observation, pos-payment a POS payment error,
and invoice-pdf and thermal-print-pdf both give a PDF notice, because their documented bodies
are identical and nothing signed tells them apart. The header travels with the result as
eventTypeHint, marked unauthenticated, so an application can route on it knowing what it is.
Each family refuses a body that carries another family's defining fields, instead of
trimming it to fit: a download_url, invoice_id or errors on an observation, errors or an
invoice series or number on a PDF notice, a download_url or an invoice series or number on a
POS error. Because each family also requires its own defining fields, no signed body can
verify as two kinds. Any other additive field is tolerated and dropped. An issued-invoice body carrying a pending
envelope is refused, because the provider documents none for this event; an observation with
a transmission failure and no registration mark is an observation, never a claim that
issuance completed. With no signed timestamp or event ID, there is no inherent freshness or
replay prevention — applications need durable deduplication, and key scope across tenants
must be established before a valid MAC is treated as proof of tenant ownership.
