# Invoice type capabilities

The provider reference (v1.18.0) lists 52 invoice type codes. `invoices.create` accepts 28 of
them. This page lists all 52, so that "not accepted" is a visible, deliberate state and not an
oversight.

## Contents

- [What accepted means](#what-accepted-means)
- [How to read the table](#how-to-read-the-table)
- [All 52 type codes](#all-52-type-codes)
- [What the evidence shows](#what-the-evidence-shows)
- [Rules of the supported types](#rules-of-the-supported-types)
- [Types that are not accepted](#types-that-are-not-accepted)
- [Rules for every supported type](#rules-for-every-supported-type)

## What accepted means

A code is accepted only when its whole request profile and every response it can produce are
implemented and tested. Naming a code in a type or a table is not support, and the SDK does
not widen `invoice_type_code` to an arbitrary string. A code that is not accepted fails with
`INVALID_INPUT` before any request, including login.

Two things this page cannot tell you:

- **Whether your account may issue a type.** That is decided by the provider and the tax
  authority for each tenant. Local acceptance means the request is well formed, nothing more.
- **Which type is fiscally correct.** The SDK makes no tax decision.

## How to read the table

The table has one row for each code. The second column gives the SDK status, and the third
column depends on it.

| SDK status   | What it means                                                                     | What the third column gives                                                                |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Supported    | `invoices.create` accepts the code.                                               | The counterpart rule, then any rules of the type itself, separated by semicolons.          |
| Not accepted | `invoices.create` fails with `INVALID_INPUT` before any request, including login. | The reason. [Types that are not accepted](#types-that-are-not-accepted) explains each one. |

## All 52 type codes

| Code  | SDK status   | Counterpart rule, or why it is not accepted                                                                                                                                                                                                                                                                 |
| ----- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 1.2   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 1.3   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 1.4   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 1.5   | Not accepted | No request shape was found that the provider and the tax authority accept                                                                                                                                                                                                                                   |
| 1.6   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; the mark of the related invoice required                                                                                                                                                                         |
| 2.1   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 2.2   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 2.3   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 2.4   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; the mark of the related invoice required                                                                                                                                                                         |
| 3.1   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; every line marked as an expense; every line at VAT rate 0 with an exemption code                                                                                                                                 |
| 3.2   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; every line marked as an expense; every line at VAT rate 0 with an exemption code                                                                                                                                 |
| 5.1   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; the mark of the related invoice required                                                                                                                                                                         |
| 5.2   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 6.1   | Supported    | Counterpart optional; its name required when one is sent                                                                                                                                                                                                                                                    |
| 6.2   | Supported    | Counterpart optional; its name required when one is sent                                                                                                                                                                                                                                                    |
| 7.1   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 8.1   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; every line at VAT rate 0 without an exemption code                                                                                                                                                               |
| 8.2   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; the other-taxes total and, on every line, the accommodation tax, its category and amount required; net and VAT amounts zero, lines zero-valued at VAT rate 24                                                    |
| 8.4   | Not accepted | The type has request fields of its own that this SDK does not send yet                                                                                                                                                                                                                                      |
| 8.5   | Not accepted | The type has request fields of its own that this SDK does not send yet                                                                                                                                                                                                                                      |
| 8.6   | Supported    | Counterpart optional; its name required when one is sent; catering table id or new table name optional, not both                                                                                                                                                                                            |
| 9.2   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; delivery flag and delivery detail required; net, VAT, total and payable amounts must be zero; every line keeps zero net, VAT rate 24, zero VAT total and subtotal, and category3                                 |
| 9.3   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; delivery flag and delivery detail required; net, VAT, total and payable amounts must be zero; every line keeps zero net, VAT rate 24, zero VAT total and subtotal, and category3                                 |
| 10.1  | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; receiving note purpose and the mark of the received delivery note required; net, VAT, total and payable amounts must be zero; every line keeps zero net, VAT rate 24, zero VAT total and subtotal, and category3 |
| 10.2  | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required; receiving note purpose required, 5 not accepted; net, VAT, total and payable amounts must be zero; every line keeps zero net, VAT rate 24, zero VAT total and subtotal, and category3                            |
| 11.1  | Supported    | Counterpart name required; the other counterpart fields optional; a catering table id accepted with the marks of the order notes it closes                                                                                                                                                                  |
| 11.2  | Supported    | Counterpart name required; the other counterpart fields optional                                                                                                                                                                                                                                            |
| 11.3  | Supported    | Counterpart name required; the other counterpart fields optional                                                                                                                                                                                                                                            |
| 11.4  | Supported    | Counterpart name required; the other counterpart fields optional                                                                                                                                                                                                                                            |
| 11.5  | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                                                                                                                                                                                                   |
| 13.1  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 13.2  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 13.3  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 13.4  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 13.30 | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 13.31 | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 14.1  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 14.2  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 14.3  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 14.4  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 14.5  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 14.30 | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 14.31 | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 15.1  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 16.1  | Not accepted | A document whose issuer is the other party; the tax authority refuses it from the tenant through the provider                                                                                                                                                                                               |
| 17.1  | Not accepted | No request shape was found that the provider and the tax authority accept                                                                                                                                                                                                                                   |
| 17.2  | Not accepted | No request shape was found that the provider and the tax authority accept                                                                                                                                                                                                                                   |
| 17.3  | Not accepted | No request shape was found that the provider and the tax authority accept                                                                                                                                                                                                                                   |
| 17.4  | Not accepted | No request shape was found that the provider and the tax authority accept                                                                                                                                                                                                                                   |
| 17.5  | Not accepted | No request shape was found that the provider and the tax authority accept                                                                                                                                                                                                                                   |
| 17.6  | Not accepted | No request shape was found that the provider and the tax authority accept                                                                                                                                                                                                                                   |

## What the evidence shows

Each supported type was accepted by the provider in the shape described here, in an
authorized test with synthetic data. That shows the request is well formed for the provider
and the tax authority; it is not a certification, and it says nothing about any other shape.

The observations are recorded in [provider-evidence.md](provider-evidence.md).

## Rules of the supported types

### Delivery notes and quantity receipt notes

Types 9.2 and 9.3 (delivery notes) and 10.1 and 10.2 (quantity receipt notes) are accepted in
one fixed shape, the only one observed to work:

- all four totals at zero;
- zero-value lines classified category3;
- the full counterpart;
- the delivery flag and detail on 9.2 and 9.3;
- a receipt purpose on 10.1 and 10.2.

Two points differ from the provider's reference:

- The reference lists only three totals, but a nonzero net amount is refused.
- The reference says 9.2 needs only a name and an address, but the counterpart's VAT number
  and country are required.

### Correlated marks, VAT and counterparts

Other rules that were observed to be enforced:

- 1.6, 2.4 and 5.1 need the mark of the invoice they supplement or credit.
- 3.1 and 3.2 (title deeds) and 8.1 (rent) carry no VAT, the first two with an exemption code
  and expense lines, the third without a code.
- 6.1, 6.2 and the catering order note 8.6 need no counterpart.

### Accommodation-tax receipt

The accommodation-tax receipt 8.2 needs the other-taxes total and, on every line, the
accommodation tax with its category and amount. It is sent only in the shape observed to be
accepted: net and VAT amounts of zero, and lines whose net, VAT and subtotal are zero at VAT
rate 24.

## Types that are not accepted

The codes that are not accepted were all tried against the provider. The table gives one of
three reasons.

- **8.4 and 8.5.** They were issued in a plain shape, but they are card-terminal documents
  whose own fields are still open questions, so the SDK does not send them yet.
- **1.5 and the six 17.x accounting entries.** No accepted request was found.
- **The fifteen types from 13.1 to 16.1.** They are documents received from another party:
  the tax authority refuses them when the tenant transmits them through the provider.

## Rules for every supported type

Three more input rules apply to every supported type and are described in the
[API reference](api-reference.md):

- the request code sets for VAT rate, quantity type and VAT exemption;
- the exact-decimal amount rules;
- the fields that are rejected because their profile is not implemented (invoice-level taxes,
  POS refunds and preloaded POS transactions).

Any supported type can also be saved as a draft with `invoices.drafts.create`.
