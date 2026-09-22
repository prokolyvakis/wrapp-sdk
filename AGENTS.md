# Agent instructions

This repository is an independent, unofficial Wrapp SDK, not an Aidvo application module.
Read docs/design.md, docs/api-reference.md and docs/compatibility.md before changing behavior;
CONTRIBUTING.md covers workflow and quality gates.

- Keep the package private and publication disabled until explicit release approval.
- Never call production or create provider documents/accounts without explicit authority.
- Do not add application tax policy, databases, queues, invoice numbering or business workflows.
- No automatic retries of effectful operations, including effectful GETs. Preserve ambiguous
  outcomes; never claim a duplicate means a matching issued document.
- Treat network JSON as unknown; do not assert unvalidated payloads into trusted types.
- Never log tokens, credentials, full requests, customer details or provider document URLs.
- Compatibility includes runtime/type exports, error codes, validation, retry behavior and
  wire semantics — an added variant to a closed union is breaking.
- Do not commit, push, publish, deploy or change remote repository settings without authorization.
