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

Errors carry separate fields for operation, failure class and effect certainty (not-sent /
unknown). HTTP failure is never equated with "no side effect", and user cancellation after
dispatch is also potentially ambiguous.

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
validated against it. With no signed timestamp or event ID, there is no inherent freshness or
replay prevention — applications need durable deduplication, and key scope across tenants
must be established before a valid MAC is treated as proof of tenant ownership.
