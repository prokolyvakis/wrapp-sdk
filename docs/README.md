# Documentation

Start with the [project README](../README.md) for installation and a first example. The pages
here go deeper.

## Using the SDK

| Page                                                 | What it answers                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| [API reference](api-reference.md)                    | How do I call an operation, which fields does it take, and what are its rules? |
| [Invoice type capabilities](invoice-capabilities.md) | Which of the provider's 52 invoice types can I create, and why not the others? |
| [Migration guide](migration.md)                      | What do I have to change when I upgrade?                                       |

## Understanding the SDK

| Page                                      | What it answers                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| [Design notes](design.md)                 | Why does the SDK never retry, why are results tagged, why are amounts strings?         |
| [Compatibility policy](compatibility.md)  | What is a release allowed to change, and what counts as breaking?                      |
| [Provider evidence](provider-evidence.md) | What rests on the provider's documentation, what was observed, and what is still open? |

## Reference material

- [`api/wrapp-sdk.api.md`](api/wrapp-sdk.api.md) is the generated report of the public
  TypeScript surface. It is checked in so that every change to an exported type shows up in
  review. Read it when you need an exact signature.
- [Changelog](../CHANGELOG.md) lists what each release contained.
- [Contributing](../CONTRIBUTING.md) and [Security](../SECURITY.md) cover how to work on the
  project and how to report a vulnerability.

## How to read these pages

The SDK is careful about what it claims, and the documentation follows the same rule. Three
phrases have a fixed meaning throughout:

- **Documented** means the provider's reference says so.
- **Observed** means the provider was seen to behave that way under authorized testing with
  synthetic data. An observation is not a guarantee, and it says nothing about cases that were
  not tried.
- **Not established** means neither of the above. Where it matters, the SDK refuses such a
  case before sending anything, or returns the provider's answer without interpreting it.
