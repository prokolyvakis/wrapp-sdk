# Wrapp SDK for TypeScript

[![SDK checks](https://github.com/prokolyvakis/wrapp-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/prokolyvakis/wrapp-sdk/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@prokolyvakis/wrapp-sdk)](https://www.npmjs.com/package/@prokolyvakis/wrapp-sdk)
[![Node](https://img.shields.io/node/v/@prokolyvakis/wrapp-sdk)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

An unofficial, server-side TypeScript client for the [Wrapp](https://wrapp.ai) invoicing API,
for applications that issue and read Greek fiscal documents through myDATA.

Issuing an invoice is not something you can safely try twice. This SDK is built around that
fact: it sends every request once, tells you exactly what it saw, and never lets a currency
amount pass through floating-point arithmetic.

> **Unofficial.** This project is not affiliated with or endorsed by Wrapp, and nothing in it is
> tax, accounting or legal advice.

## Contents

- [Why this SDK](#why-this-sdk)
- [Status](#status)
- [Install](#install)
- [Quick start](#quick-start)
- [What you can do](#what-you-can-do)
- [Outcomes and errors](#outcomes-and-errors)
- [Webhooks](#webhooks)
- [Safety model](#safety-model)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Why this SDK

- **Nothing is retried.** Not invoice creation, not reads, not login, and nothing is replayed
  after a 401, 429, 5xx or timeout. A request that fails after it was sent might still have
  taken effect, so the SDK reports that honestly and leaves the next step to you.
- **Ambiguity is reported, not hidden.** Every write returns a tagged result that says what the
  provider actually answered. A missing answer is never turned into a success or a failure.
- **Amounts stay exact.** You pass amounts as decimal strings and get them back as the exact
  text the provider sent. No rounding, no floats.
- **Provider answers are checked before they are trusted.** Each operation validates the
  response it receives. Anything unexpected is an error, not a best guess.
- **Mistakes are caught before the network.** Unsupported invoice types, unknown fields and
  malformed values fail locally, before the SDK even logs in.

## Status

**Pre-release (0.x).** The behavior is covered by synthetic tests and checked against provider
behavior observed under authorized testing. That is not a production certification, and the
SDK makes no claim of fiscal correctness. Minor releases on the 0.x line may contain breaking
changes; each comes with [migration notes](docs/migration.md).

What rests on the provider's documentation, what was observed, and what is still an open
question is recorded in [provider evidence](docs/provider-evidence.md).

## Install

```sh
npm install @prokolyvakis/wrapp-sdk
```

Requirements: Node `^22.13.0 || ^24.0.0`, ESM only, TypeScript 5.8 or newer. This is a
server-side package: an API key must never reach a browser. Import from the package root only;
deep imports are blocked.

## Quick start

Creating a client performs no I/O. The SDK logs in on the first call and keeps the session in
memory.

```ts
import { WrappClient, decimal } from '@prokolyvakis/wrapp-sdk';

const client = new WrappClient({
  environment: 'staging', // or 'production'; always explicit, never inferred
  credentials: { apiKey, tenant: { kind: 'userId', value: tenantId } },
});

const outcome = await client.invoices.create({
  external_id: 'order-1042', // your own durable reference
  billing_book_id: billingBookId,
  invoice_type_code: '2.1',
  payment_method_type: 1,
  counterpart: {
    name: 'Example Company',
    country_code: 'GR',
    vat: '000000000',
    city: 'Athens',
    street: 'Example Street',
    number: '1',
    postal_code: '10000',
  },
  net_total_amount: decimal('100.00'),
  vat_total_amount: decimal('24.00'),
  total_amount: decimal('124.00'),
  payable_total_amount: decimal('124.00'),
  invoice_lines: [
    {
      line_number: 1,
      name: 'Consulting',
      quantity: decimal('1'),
      unit_price: decimal('100.00'),
      net_total_price: decimal('100.00'),
      vat_rate: 24,
      vat_total: decimal('24.00'),
      subtotal: decimal('124.00'),
      classification_category: 'category1_3',
      classification_type: 'E3_561_001',
    },
  ],
});

switch (outcome.kind) {
  case 'observed': // the provider returned the invoice
    save(outcome.invoice, outcome.identity);
    break;
  case 'pending': // accepted, not issued yet; check again later with getStatus
    scheduleCheck(outcome.invoiceId);
    break;
  case 'rejected': // the provider reported errors
    investigate(outcome.errorCount);
    break;
}
```

The SDK computes nothing for you: totals, VAT and classifications are yours to get right. It
only checks that the request is well formed.

## What you can do

| Area               | On the client                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account            | `tenant.get`, `vat.search`, `vat.exemptions`                                                                                                                      |
| Branches and books | `branches.list` / `create` / `update`, `billingBooks.list` / `create` / `updateNumber`                                                                            |
| Invoices           | `invoices.create`, `getStatus`, `get`, `list`, `iterate`, `issuedCount`                                                                                           |
| Invoice management | `invoices.cancelDeliveryNote`, `setExternalId`, `markAsPaid`                                                                                                      |
| PDFs               | `invoices.requestPdf` (with an optional locale), `requestThermalPdf`                                                                                              |
| Drafts             | `invoices.drafts.create`, `issue`, `list`, `iterate`, `delete`                                                                                                    |
| Catering           | `cateringTables.list` / `get` / `create` / `update` / `open` / `close` / `transfer` / `delete`, `invoices.listOpenCateringOrderNotes`, `cancelCateringOrderNotes` |
| Digital transports | `digitalTransports.list` / `get` / `create` / `refresh` / `reject` / `confirmDelivery` / `confirmReturn` / `transfer`                                             |
| Digital clientele  | `digitalClienteles.get` / `create` / `update` / `cancel` / `correlateByMark` / `correlateByFim`                                                                   |
| POS                | `posDevices.list` / `create` / `delete`, `posSessions.abort`                                                                                                      |
| Webhooks           | `verifyWebhook`                                                                                                                                                   |
| Rejection detail   | `getProviderDiagnostics`                                                                                                                                          |

`invoices.create` accepts 28 of the provider's 52 invoice types, each in a request shape the
provider was observed to accept. The full list, with the rule for each type and the reason
for each type that is not accepted, is in
[invoice type capabilities](docs/invoice-capabilities.md).

Every operation, field and rule is described in the [API reference](docs/api-reference.md).

## Outcomes and errors

Writes return a result you switch on. Failures throw a `WrappError`.

**A rejection never tells you your reference is free.** When `invoices.create` returns
`rejected`, or throws after sending, the invoice may or may not exist. Do not generate a new
`external_id` to get past the problem: that is how duplicate fiscal documents happen. Look the
invoice up by the reference you already used, and decide from what you find. A rejected
result says so itself: its `referenceState` is always `'unknown'`.

```ts
import { WrappError } from '@prokolyvakis/wrapp-sdk';

try {
  await client.invoices.create(input);
} catch (error) {
  if (!(error instanceof WrappError)) throw error;
  if (error.effect === 'not-sent') {
    // Nothing reached the provider. Fix the cause and call again.
  } else {
    // 'unknown': the request was sent and may have taken effect.
    // Read the state back before deciding anything.
    const status = await client.invoices.getStatus({ kind: 'externalId', value: reference });
  }
}
```

| `error.effect` | Meaning                                                                                         | What to do                             |
| -------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| `'not-sent'`   | No state-changing request can have taken effect: nothing was sent, or the operation only reads. | Safe to correct and call again.        |
| `'unknown'`    | A write was dispatched and its result is not known.                                             | Read back first. Never repeat blindly. |

`error.code` names the kind of failure (`INVALID_INPUT`, `AUTH_ERROR`, `HTTP_ERROR`,
`PROVIDER_REJECTED`, `PROTOCOL_ERROR`, `NETWORK_ERROR`, `TIMEOUT`, `ABORTED`, and a few more),
and `error.operation` names the call. Errors never contain provider response bodies,
credentials or URLs. When you need the provider's own wording for a rejection, ask for it on
that call with `diagnostics: 'provider-issues'` and read it with `getProviderDiagnostics`.

`invoices.getStatus` reports `observed`, `pending` or `draft`. Switch on `kind` before reading
`invoice`.

The reasoning behind these shapes is in the [design notes](docs/design.md).

## Webhooks

`verifyWebhook` authenticates the raw request body before parsing it, for all four provider
events.

```ts
import { verifyWebhook } from '@prokolyvakis/wrapp-sdk';

const event = verifyWebhook({
  body: rawBody, // the exact bytes received, as a Uint8Array
  signature: signatureHeader,
  eventType: eventTypeHeader,
  keys: [currentKey, previousKey], // 1 to 5 keys, to allow rotation
});

if (event.kind === 'invoice-observation') record(event.invoice);
```

A body that fails verification throws a `WrappError` with the code `WEBHOOK_INVALID`.

A valid signature proves the body came from someone holding the key. It does not prove the
event is fresh, unique or meant for a particular tenant. The event type header is not signed;
the result returns it as `eventTypeHint`, a hint and nothing more. Keep a durable inbox and read the invoice back before acting on an event.

## Safety model

- **Strict parsing.** Network JSON is treated as unknown until an operation's own validator
  accepts it. Results are deeply frozen. Numbers keep the exact text the provider sent.
- **Bounded everything.** A 30-second default budget covers login through reading the body.
  Requests and responses are capped at 2 MiB, and lists and strings are bounded. These are SDK
  policies, not claims about the provider's limits.
- **Pinned origins.** Every request refuses redirects, so credentials cannot reach another
  host. The `advanced.testBaseUrl` override accepts loopback addresses only.
- **Explicit iteration.** `invoices.iterate` requires `maxPages` and throws when it runs out,
  instead of stopping quietly.
- **Links are data.** PDF and portal URLs are returned to you and never fetched by the SDK.
- **Quiet errors.** Error messages and their JSON form carry a code, the operation and the
  effect. Provider detail is retained only when you opt in, and never serialized.

## Documentation

| Page                                                      | Read it when you want to know                            |
| --------------------------------------------------------- | -------------------------------------------------------- |
| [API reference](docs/api-reference.md)                    | how to call an operation and what its rules are          |
| [Invoice type capabilities](docs/invoice-capabilities.md) | which invoice types are accepted, and why others are not |
| [Migration guide](docs/migration.md)                      | what to change when upgrading                            |
| [Design notes](docs/design.md)                            | why the SDK behaves the way it does                      |
| [Compatibility policy](docs/compatibility.md)             | what a release is allowed to change                      |
| [Provider evidence](docs/provider-evidence.md)            | what is documented, what was observed, what is open      |
| [Changelog](CHANGELOG.md)                                 | what each release contained                              |

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the checks every
change must pass, and how releases are made. The tests need no provider account: they run real
HTTP against local servers and block every other destination.

To report a vulnerability, follow [SECURITY.md](SECURITY.md). Please do not open a public
issue for one.

## License

[Apache-2.0](LICENSE). The provider's documentation is linked from this repository, not copied
into it.
