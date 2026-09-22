# @prokolyvakis/wrapp-sdk

An unofficial, server-side TypeScript client for the [Wrapp](https://wrapp.ai) invoicing API,
built for applications that issue and read Greek/EU fiscal documents. Its central design goal
is safety around a hard constraint: **invoice issuance is not retryable**, so the SDK never
retries anything, never hides an ambiguous outcome, and never lets binary floating-point
arithmetic near a currency amount.

Not affiliated with or endorsed by Wrapp. Not tax or accounting advice.

**Status: pre-release (0.x).** Behavior is verified with synthetic tests and against
observed provider behavior under authorized testing — no production certification or fiscal
correctness is claimed, and 0.x minor releases may carry breaking changes with migration
notes. See [provider evidence and open questions](docs/provider-evidence.md).

## Install

```sh
npm install @prokolyvakis/wrapp-sdk
```

ESM-only, Node `^22.13.0 || ^24.0.0`. Releases are cut through reviewed release PRs and
published from CI via trusted publishing.

## Quick example

The client is lazy — construction performs no I/O — and credentials stay server-side.

```ts
import { WrappClient, WrappError, decimal } from '@prokolyvakis/wrapp-sdk';

const client = new WrappClient({
  environment: 'staging', // explicit; production requires separately authorized credentials
  credentials: { apiKey, tenant: { kind: 'userId', value: tenantId } },
});

const status = await client.invoices.getStatus({ kind: 'externalId', value: reference });
```

Amounts are exact decimal strings, never floats: `decimal('12.40')`.

Resources: `tenant.get`, `branches.list`, `billingBooks.list`, `vat.search`/`exemptions`,
`invoices.getStatus`/`get`/`list`/`iterate`/`create`/`requestPdf`. Invoice creation supports a
strict service-invoice subset (types 2.1, 2.2, 2.3, 11.2); unsupported fields fail before any
network access. The full operation and field matrix is in the
[API reference](docs/api-reference.md).

## Creating invoices: the ambiguity contract

Creating a fiscal document can end three ways, and the SDK reports exactly what it observed
instead of guessing:

```ts
const outcome = await client.invoices.create(input); // input carries your durable external_id

switch (outcome.kind) {
  case 'observed': // the provider returned the invoice; identity evidence included
    return record(outcome.invoice, outcome.identity); // 'exact' | 'ascii-case-variant'
  case 'pending': // acknowledged but not yet observable
    return schedule(outcome.invoiceId); // reconcile later via getStatus
  case 'rejected': // provider reported errors
    return investigate(outcome.errorCount); // referenceState stays 'unknown'
}
```

The rules behind this shape:

- A rejection, timeout or not-found **never** establishes that your external reference is
  free. `referenceState` is always `'unknown'` on rejection — generating a new reference to
  escape ambiguity is how duplicate fiscal documents happen, so your application must
  reconcile using its durable record instead.
- On errors, `WrappError.effect` distinguishes `'not-sent'` (safe: nothing was dispatched)
  from `'unknown'` (the request may have taken effect). Handle `'unknown'` conservatively.
- There are **no automatic retries of anything**, including reads and login, and no mutation
  replay after 401, 429, 5xx or timeout.

The full rationale is in the [design notes](docs/design.md).

## Safety model

- **Strict parsing.** Network JSON is `unknown` until validated by per-operation codecs;
  responses are returned as deeply frozen copies. Inbound numeric fields keep their exact
  numeric text via a lossless parser.
- **Safe diagnostics.** Errors carry a code, the operation and effect certainty — never raw
  provider bodies, credentials or URLs.
- **Bounded everything.** 30-second default request budget spanning auth through body, 2 MiB
  request/response caps, bounded arrays and strings. These are SDK policies, not claims about
  provider limits.
- **Pinned origins.** `redirect: 'error'` on every request; credentials can never reach a
  redirect target. `advanced.testBaseUrl` accepts loopback only.
- **Webhook verification.** `verifyWebhook` authenticates raw bytes (HMAC-SHA256,
  constant-time, 1–5 rotation keys) before parsing. It does not prove freshness, uniqueness
  or tenant ownership — keep a durable inbox and read back.
- **Explicit iteration.** `invoices.iterate` requires `maxPages` and throws on exhaustion
  instead of silently truncating.
- **PDF links are data.** Returned HTTPS URLs are never fetched by the SDK.

## Compatibility

ESM-only, Node `^22.13.0 || ^24.0.0`, TypeScript 5.8+. Only root exports are public; deep
imports are blocked. A checked-in declaration baseline and a packed-consumer compile matrix
guard the public surface. After 1.0, adding a variant to a closed outcome union counts as
breaking. Details in the [compatibility policy](docs/compatibility.md).

## Development

Use the Node version in `.nvmrc` (with nvm: `nvm install`), then:

```sh
npm ci --ignore-scripts
npm run secrets:install   # checksum-pinned Gitleaks, local to the repo
npm run prepare           # enable git hooks
```

The everyday loop is `npm run check` (format, typed lint, source+test types, coverage,
build). Slower verification, also run by CI:

```sh
npm run check:package     # declaration baseline, exports, type resolution
npm run check:consumers   # packs a tarball, compiles/runs it under TS 5.8 and 6.0
npm run secrets:check     # offline scan of history, index and working files
```

Tests need no provider account: they block non-loopback fetch destinations and run real HTTP
against local servers. See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and the
full gate list, and [SECURITY.md](SECURITY.md) for reporting.

## Documentation

- [API reference](docs/api-reference.md) — supported operations, fields, invariants
- [Design notes](docs/design.md) — why the SDK is shaped this way
- [Compatibility policy](docs/compatibility.md) — what releases must preserve
- [Provider evidence](docs/provider-evidence.md) — what is grounded, what is still open

## License

Apache-2.0 for this repository's original code; preserve third-party license obligations.
Provider documentation is linked, not vendored.
