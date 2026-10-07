# Invoice type capabilities

The provider reference (v1.18.0) lists 52 invoice type codes. `invoices.create` accepts four of
them. This page lists all 52, so that "not accepted" is a visible, deliberate state and not an
oversight.

A code is accepted only when its whole request profile and every response it can produce are
implemented and tested. Naming a code in a type or a table is not support, and the SDK does
not widen `invoice_type_code` to an arbitrary string. A code that is not accepted fails with
`INVALID_INPUT` before any request, including login.

Two things this page cannot tell you:

- **Whether your account may issue a type.** That is decided by the provider and the tax
  authority for each tenant. Local acceptance means the request is well formed, nothing more.
- **Which type is fiscally correct.** The SDK makes no tax decision.

| Code  | SDK status   | Counterpart rule, or why it is not accepted                                                                              |
| ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1.1   | Not accepted | The reference gives some rule or an example specific to this type, but not its complete profile                          |
| 1.2   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 1.3   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 1.4   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 1.5   | Not accepted | The reference gives some rule or an example specific to this type, but not its complete profile                          |
| 1.6   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 2.1   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                |
| 2.2   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                |
| 2.3   | Supported    | Counterpart name, country code, VAT number, city, street, number and postal code required                                |
| 2.4   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 3.1   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 3.2   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 5.1   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 5.2   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 6.1   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 6.2   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 7.1   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 8.1   | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 8.2   | Not accepted | The reference gives some rule or an example specific to this type, but not its complete profile                          |
| 8.4   | Not accepted | The reference gives some rule or an example specific to this type, but not its complete profile                          |
| 8.5   | Not accepted | The reference gives some rule or an example specific to this type, but not its complete profile                          |
| 8.6   | Not accepted | The reference shows catering examples that conflict with its general field rules; open provider question                 |
| 9.2   | Not accepted | The reference states rules for this type in field notes but shows no request for it; not accepted until one is evidenced |
| 9.3   | Not accepted | The reference states rules for this type in field notes but shows no request for it; not accepted until one is evidenced |
| 10.1  | Not accepted | The reference states rules for this type in field notes but shows no request for it; not accepted until one is evidenced |
| 10.2  | Not accepted | The reference states rules for this type in field notes but shows no request for it; not accepted until one is evidenced |
| 11.1  | Not accepted | The reference gives some rule or an example specific to this type, but not its complete profile                          |
| 11.2  | Supported    | Counterpart name required; the other counterpart fields optional                                                         |
| 11.3  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 11.4  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 11.5  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 13.1  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 13.2  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 13.3  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 13.4  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 13.30 | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 13.31 | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 14.1  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 14.2  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 14.3  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 14.4  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 14.5  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 14.30 | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 14.31 | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 15.1  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 16.1  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 17.1  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 17.2  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 17.3  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 17.4  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 17.5  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |
| 17.6  | Not accepted | The reference lists the code without any type-specific rule; open provider question                                      |

Supported profiles are documentation-derived and covered by regression tests; they are not
provider-certified.

Types 9.2, 9.3 (delivery notes) and 10.1, 10.2 (quantity receipt notes) are a separate case.
The reference states rules for them in field notes: zero VAT, total and payable amounts; the
delivery flag for 9.2 and 9.3; a fixed line representation for 9.3; a name-and-address
counterpart for 9.2; a receipt purpose for 10.1 and 10.2, with the mark of the received
delivery note on 10.1. It shows no request for any of them, so their whole profile is not
known: which counterpart fields 9.3, 10.1 and 10.2 need, how their lines are classified,
whether a receipt note may carry delivery fields. The stated rules are implemented and
tested inside the SDK, but the types stay not accepted until a real request for each is
evidenced. A delivery note can still be issued on a supported type with
`is_delivery_note: true`; see the [API reference](api-reference.md).

Three more input rules apply to every supported type and are described in
the [API reference](api-reference.md): the request code sets for VAT rate, quantity type and
VAT exemption; the exact-decimal amount rules; and the fields that are rejected because their
profile is not implemented (drafts, invoice-level taxes, POS refunds and preloaded POS
transactions).
