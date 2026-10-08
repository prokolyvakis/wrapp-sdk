# Design notes

This page explains why the SDK is shaped the way it is. Read it when you evaluate the SDK, build
an application on it, or change its behavior. The rules themselves, field by field, are in the
[API reference](api-reference.md). What a release must preserve is in the
[compatibility policy](compatibility.md).

One theme recurs: fiscal document issuance is not retryable, so the SDK preserves ambiguity
instead of resolving it optimistically.

Each section opens with the decision in one sentence. The reasoning and the detail follow, and
the section closes with what the decision means for a caller.

The snippets import only from the package root. In them, `client` is a `WrappClient`, `input` is
a `CreateInvoiceInput`, and names such as `record` or `schedule` stand for your application's own
code.

## Contents

- [Boundaries](#boundaries)
- [Parsing](#parsing)
- [Amounts and dates](#amounts-and-dates)
- [Create outcomes](#create-outcomes)
- [Errors and effect certainty](#errors-and-effect-certainty)
- [Provider diagnostics](#provider-diagnostics)
- [Transport and retries](#transport-and-retries)
- [Internal structure](#internal-structure)
- [Authentication concurrency](#authentication-concurrency)
- [External references and reconciliation](#external-references-and-reconciliation)
- [Pagination](#pagination)
- [Webhooks](#webhooks)

## Boundaries

**Decision:** The SDK is a small, predictable, independently reusable server-side client that
makes the remote API safer to consume without claiming to make fiscal workflows transactional.

The SDK owns:

- transport
- authentication
- operation-specific codecs
- validated values
- typed outcomes
- bounded pagination
- webhook verification and parsing

The consuming application owns:

- tax choices
- issuer authority
- durable idempotency records
- orchestration
- reconciliation
- the webhook inbox and deduplication
- archives
- customer authorization
- retention
- notifications

There is deliberately no ORM, tax engine, invoice-number generator, workflow framework, service
locator or queue here, and no consumer-specific fields or dependencies.

**For callers:** everything in the second list stays with your application. A timeout never
becomes an invoice retry, and a rejection never becomes permission to mint a different external
reference.

## Parsing

**Decision:** All external JSON starts as `unknown`, and each operation has its own decoder.

The decoders are per operation because the provider does not use one uniform envelope. The SDK
validates both the HTTP status and the decoded content: a 2xx response carrying an `errors`
object must not become a successful invoice.

These are protocol failures:

- invalid JSON
- HTML
- missing required fields
- mismatched identity
- unknown response variants

Requests and responses follow different rules:

- Request schemas reject unrecognized fields.
- Response schemas tolerate additive properties while preserving required evidence and explicit
  unknown-code handling.
- There is one deliberate exception. The top-level keys `errors`, `error` and `status` are
  reserved envelope discriminators. On a read whose answer is the resource itself, their
  appearance fails closed instead of being ignored. Operations whose documented answer carries
  a `status`, such as the status lookup or a catering table, decode it on their own terms.

Parser-specific errors stay internal, and validation errors never echo raw values, URLs or
payloads.

**For callers:** a value the SDK returns has passed its operation's decoder. The SDK rejects a
request with an unrecognized field. A validation error never echoes a raw value, URL or payload.

## Amounts and dates

**Decision:** The SDK never computes amounts with binary floating-point arithmetic, and dates
never pass through an implicit local timezone.

Amounts:

- Public exact decimal values use canonical decimal strings.
- Codecs emit the provider's required JSON numeric tokens through a lossless serializer
  (`lossless-json`).
- Inbound numeric decoding preserves precision before ordinary JSON parsing can lose it, keeps
  large identifiers as strings, and rejects excess precision rather than rounding.
- The SDK invents no totals, VAT classifications, exchange rates or tax decisions.

```ts
import { decimal } from '@prokolyvakis/wrapp-sdk';

// A canonical decimal string. No float ever holds the value.
const netTotal = decimal('12.40');
```

Dates are validated calendar strings with explicit formats and no implicit local timezone. A
DD-MM-YYYY provider date is never fed into `Date.parse`.

**For callers:** you pass an amount as an exact decimal string, and a returned amount keeps its
precision. Every total, VAT classification, exchange rate and tax decision in a request is one
you supplied: the SDK invents none.

## Create outcomes

**Decision:** The expected outcomes of invoice creation form a closed, deliberately stable union:
an observed invoice, pending, or a provider-reported rejection.

```ts
const outcome = await client.invoices.create(input); // input carries your external_id

switch (outcome.kind) {
  case 'observed':
    // The provider returned the invoice, with identity evidence.
    record(outcome.invoice, outcome.identity);
    break;
  case 'pending':
    // Not issued, even when outcome.invoice already carries a number, a UID or a QR URL.
    schedule(outcome.invoiceId);
    break;
  case 'rejected':
    // The provider reported errors. outcome.referenceState is 'unknown'.
    investigate(outcome.errorCount, outcome.rejectionSource);
    break;
}
```

What an outcome does and does not establish:

- There is no conflict variant. All rejections carry `referenceState` `'unknown'`, regardless of
  the rejection title or its language.
- Rejections do carry the provider's validation family as `rejectionSource`: `'invoice-errors'`,
  `'mydata-errors'`, or `'unknown'` when the envelope names none. The family is matched without
  regard to case, and a family the SDK does not know is a protocol error. It is evidence of
  where the rejection came from, never of what it means.
- Read-back is evidence, never permission to mint a replacement reference after ambiguity. Even a
  subsequent not-found result does not establish that a previous write cannot issue.
- A provider-reported rejection is not a durable guarantee that later repair cannot issue.
- An observed invoice is evidence, not a declaration of jurisdictional compliance.

### Pending invoices

The provider's status discriminator alone decides pending. Create, status lookup and the issue
of a draft all report it.

The provider documents two pending forms:

- a minimal one, carrying only its own invoice id;
- an enriched one, returned on a provider-to-tax-authority connection loss, that already carries
  a number, a date, a UID and a QR URL.

Both stay pending. The SDK validates the enriched evidence and keeps it on the outcome. It never
promotes that evidence to an observed invoice, because a number or a QR URL is not a
registration mark (`my_data_mark`).

The SDK makes every identity comparison the response allows:

- It compares the enriched form with the requested reference.
- A minimal form answering a lookup by provider id must echo that id.
- A minimal form answering an external-reference request echoes no reference. The SDK reports its
  identity as `'unavailable'` instead of inferring it from a provider id.

Pending, like a rejection, leaves the reference state unknown.

**For callers:** switch on `kind`, and treat each outcome as evidence of what the provider
reported. A pending or rejected outcome leaves the reference state unknown, so neither is
permission to mint a replacement external reference.

## Errors and effect certainty

**Decision:** Errors carry separate fields for operation, failure class and effect certainty
(`'not-sent'` / `'unknown'`).

The SDK never equates an HTTP failure with "no side effect", and user cancellation after dispatch
is also potentially ambiguous. That is why effect certainty is a field of its own.

On a `WrappError`, `operation` names the operation, `code` is the failure class and `effect` is
the effect certainty:

```ts
import { WrappError } from '@prokolyvakis/wrapp-sdk';

try {
  await client.invoices.create(input);
} catch (error) {
  if (!(error instanceof WrappError)) throw error;
  switch (error.effect) {
    case 'not-sent':
      // No state-changing request can have taken effect.
      break;
    case 'unknown':
      // A state-changing request was dispatched and may have been applied.
      // Reconcile through your durable record before any repeat.
      reconcile(error.operation, error.code);
      break;
  }
}
```

**For callers:** read `effect` on a caught `WrappError`. An `'unknown'` effect is an ambiguous
outcome, and the SDK reports it as one instead of resolving it.

## Provider diagnostics

**Decision:** Ordinary results and errors stay small and loggable, and a caller that needs the
provider's own words opts in per call.

A rejection reports how many issues the provider raised and which validation family raised them.
It never reports the provider's words, which can name a customer or a document.

When a caller opts in, the SDK holds the detail in a private `WeakMap` keyed by the returned
result or error object. The caller reads it with `getProviderDiagnostics`. Because the detail is
not a property, it cannot leak through serialization, inspection, spreading, cloning or wrapping
the error.

```ts
import { getProviderDiagnostics } from '@prokolyvakis/wrapp-sdk';

const outcome = await client.invoices.create(input, { diagnostics: 'provider-issues' });

if (outcome.kind === 'rejected') {
  // The outcome itself still holds no provider wording.
  const detail = getProviderDiagnostics(outcome);
  if (detail !== undefined) review(detail.issues); // detail.sensitive is always true
}
```

The detail is bounded and marked sensitive:

- The SDK replaces exact occurrences of the active API key and bearer token, and of any request
  value an operation marks as secret, before it shortens any text, so no fragment of a
  credential survives a cut.
- That replacement is a safety net rather than a guarantee. It cannot recognize an encoded or
  split credential, which is why the detail is always sensitive.

On a non-2xx response the opt-in also reads the error body, under the same deadline and byte cap
as any other response. That read is optional detail only. An unreadable, oversized or stalled
body yields no diagnostics and leaves the HTTP failure, its status and its effect certainty
exactly as they would have been.

Login failures carry no diagnostics, because concurrent callers share the login.

**For callers:** diagnostics are for people and for logs you control. Provider wording
never decides that a duplicate matches an earlier request, that a reference is free, or that a
write can be repeated.

## Transport and retries

**Decision:** The SDK performs no automatic retries at all, and every request runs under one
absolute deadline against a fixed origin.

### Effect classification

A readonly operation registry classifies every operation as read or effectful. An effectful
operation is one that changes provider state. The SDK derives no safety decision solely from the
HTTP method, because the provider has effectful GETs.

### No retries, no replay

No automatic retries means none: reads, login, everything.

- The SDK replays no mutation after a 401, 429, 5xx, timeout, connection reset or an unreadable
  success response.
- Refreshing credentials does not authorize replaying a potentially accepted mutation.
- An opt-in bounded read-retry capability is a possible future addition. The registry already
  retains the effect classification it would need.

### Deadlines and limits

Each request has one absolute deadline covering auth, response headers and body. The SDK
propagates `AbortSignal`, cancels body readers and timers, and bounds response bytes (2 MiB by
default), so the client never waits forever on a partial body. Request bodies are bounded the
same way. The default request budget is 30 seconds. These
are SDK policies, not provider guarantees.

### Redirects and origins

- All requests, including login, use `redirect: 'error'` for every redirect status. Credentials
  and bodies can never reach a redirect destination.
- Origins are fixed official HTTPS hosts. The loopback-only test origin is an explicit advanced
  testing capability, not an environment fallback.
- The SDK strictly encodes path segments and query values. It rejects traversal and control
  characters before any I/O.

### Provider URLs are data

Provider-returned download and portal URLs are data only: no authenticated fetch to those hosts,
no automatic PDF download, no secrets in URLs.

**For callers:** the SDK never repeats a call for you, whatever the failure. It hands back a
download or portal URL as data and never fetches it.

## Internal structure

**Decision:** Each client owns exactly one internal runtime, and resource modules receive that
runtime as a single capability.

The runtime holds the transport, the login session, the default deadline and the request-size
limit. The capability is to run a registered operation on a path relative to the fixed origin,
with a decoder. Resource modules cannot read the credentials, reach another origin or issue an
unregistered request.

A call moves through these steps:

1. The operation finishes validating and serializing its input before it calls the runtime.
2. The runtime validates the request options.
3. The runtime bounds the serialized body in UTF-8 bytes.
4. The runtime authenticates.
5. The runtime dispatches once.
6. The runtime hands the parsed value to the operation's own decoder.

The size bound sits in the runtime, before authentication, so every body-bearing operation
inherits it. The SDK registers operations explicitly with their method and effect class. It never
derives the effect from the HTTP verb.

**For callers:** the runtime is not a public export. What you see is its effect: every
body-bearing operation has the same size bound, applied before authentication.

## Authentication concurrency

**Decision:** The SDK acquires tokens lazily and coalesces concurrent logins per immutable
client.

- The API key and token stay memory-only. The SDK never serializes them with errors or logs.
- A 401 invalidates the session only if the rejected token is still the cached token. A delayed
  401 carrying an old token must not evict a newer one.
- A caller's abort stops its own wait, not every caller sharing the login. The shared login has
  its own finite deadline.
- No in-flight operation changes tenant or key mid-request.

**For callers:** credential rotation means constructing a new client. Aborting one call does not
stop the login that other calls are waiting on.

## External references and reconciliation

**Decision:** The SDK requires a caller-supplied external reference for invoice creation even
where the provider makes it optional, and it preserves the exact bytes.

The requirement is an intentional safety constraint. The SDK owns no persistent idempotency
database, so it cannot guarantee at-most-once economic issuance across process crashes or
restores.

A reference conflict is not success: the existing object might have a different body, issuer or
state. There is deliberately:

- no `createOrGet`;
- no automatic alternate-reference retry;
- no treating not-found as proof that a timed-out write failed.

**For callers:** the SDK exposes lookup and identity evidence. Your application compares all
relevant immutable fields.

## Pagination

**Decision:** Pagination returns validated page metadata and a lazy async iterator with finite
`maxPages`, cancellation and repeated-page detection.

```ts
import { calendarDate } from '@prokolyvakis/wrapp-sdk';

const filters = { start_date: calendarDate('2026-01-01'), end_date: calendarDate('2026-01-31') };

// Lazy and finite: the iterator fetches at most maxPages pages.
for await (const invoice of client.invoices.iterate(filters, { maxPages: 5 })) {
  record(invoice);
}
```

**For callers:** pagination does not silently deduplicate records, conceal page limits or promise
snapshot completeness under concurrent writes.

## Webhooks

**Decision:** `verifyWebhook` is a standalone pure utility, independent of `WrappClient` and
without network access, that verifies the signature before it parses the body.

```ts
import { verifyWebhook } from '@prokolyvakis/wrapp-sdk';

const event = verifyWebhook({
  body: rawBody, // the untouched Uint8Array, never re-serialized JSON
  signature: signatureHeader,
  eventType: eventTypeHeader, // unsigned: a routing hint only
  keys: [webhookKey],
});

switch (event.kind) {
  case 'invoice-observation':
    onObservation(event.invoice);
    break;
  case 'pdf':
    // event.eventTypeHint is 'invoice-pdf' or 'thermal-print-pdf', and is not authenticated.
    onPdf(event.invoiceId, event.downloadUrl);
    break;
  case 'pos-payment-error':
    onPosError(event.invoiceId, event.providerMessage);
    break;
}
```

### Input and verification

The input is the untouched `Uint8Array` body, the signature, the event type header, and bounded
caller-selected verification keys. Re-serializing JSON before verification is forbidden.

`verifyWebhook` verifies a strictly validated HMAC-SHA256 hex signature with constant-time
comparison, before parsing. It fails closed on missing, malformed, duplicate or oversized inputs.

### The event type is a hint

The documented `Event-Type` header is outside the signed body, so a valid signature does not
authenticate routing metadata. The event type is a hint, and the SDK validates the corresponding
body against it.

The SDK supports all four documented headers. The result kind names the body that was validated,
not the header:

| `Event-Type` header | Validated body         | Result `kind`           |
| ------------------- | ---------------------- | ----------------------- |
| `issued-invoice`    | an invoice observation | `'invoice-observation'` |
| `pos-payment`       | a POS payment error    | `'pos-payment-error'`   |
| `invoice-pdf`       | a PDF notice           | `'pdf'`                 |
| `thermal-print-pdf` | a PDF notice           | `'pdf'`                 |

`invoice-pdf` and `thermal-print-pdf` both give a PDF notice, because their documented bodies are
identical and nothing signed tells them apart. The header travels with the result as
`eventTypeHint`, marked unauthenticated, so an application can route on it knowing what it is.

### One body, one kind

Each family refuses a body that carries another family's defining fields, instead of trimming it
to fit:

- on an observation: a `download_url`, `invoice_id` or `errors`;
- on a PDF notice: `errors` or an invoice series or number;
- on a POS error: a `download_url` or an invoice series or number.

Because each family also requires its own defining fields, no signed body can verify as two
kinds. The SDK tolerates and drops any other additive field.

Two more rules apply to an `issued-invoice` body:

- The SDK refuses a body carrying a pending envelope, because the provider documents none for
  this event.
- An observation with a transmission failure and no registration mark is an observation, never a
  claim that issuance completed.

**For callers:** with no signed timestamp or event ID, there is no inherent freshness or replay
prevention. Your application needs durable deduplication, and key scope across tenants must be
established before a valid MAC is treated as proof of tenant ownership.
