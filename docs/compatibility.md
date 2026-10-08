# Compatibility and API evolution policy

This page is the policy for what a release of the SDK must preserve. Maintainers follow it when
they change or release the SDK. Developers who use the SDK can read it to see what an upgrade may
change.

**Status:** binding SDK contract on the pre-1.0 line, enforced by the packed-consumer and
declaration-baseline checks; released as 0.x with no provider certification.

## Contents

- [At a glance](#at-a-glance)
- [Four version axes](#four-version-axes)
- [Initial supported surface](#initial-supported-surface)
- [Backward-compatible remote additions](#backward-compatible-remote-additions)
- [Breaking changes](#breaking-changes)
  - [What counts as breaking](#what-counts-as-breaking)
  - [What does not count as breaking](#what-does-not-count-as-breaking)
  - [During 0.x](#during-0x)
- [Deprecation and migration](#deprecation-and-migration)
- [Change monitoring and release process](#change-monitoring-and-release-process)
- [Sources](#sources)

## At a glance

Each row restates a rule from the sections below. The sections are the policy; the table only
helps you find the rule.

| Change                                                                                      | Breaking?     | What the policy says                                  |
| ------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------- |
| Removing or renaming exports, fields, methods, overloads, error codes or result variants    | Yes           | After 1.0, normally requires a major release          |
| Adding a required request field, tightening accepted valid inputs or narrowing output types | Yes           | After 1.0, normally requires a major release          |
| Changing amount, date or identifier representation or nullability                           | Yes           | After 1.0, normally requires a major release          |
| Changing mutation retry, authentication replay, deadline or default environment semantics   | Yes           | After 1.0, normally requires a major release          |
| Adding a new variant to an exhaustively consumed public discriminated union                 | Yes           | After 1.0, normally requires a major release          |
| Changing minimum runtime or TS support, exports or supported module format                  | Yes           | After 1.0, normally requires a major release          |
| Dropping a runtime or module format, or raising the TS floor                                | Yes           | Stated as breaking with the initial supported surface |
| Adding a new optional capability                                                            | No            | Normally a minor release                              |
| Making an equivalent internal correction                                                    | No            | Normally a patch release                              |
| Recording a new documentation hash                                                          | Not by itself | It does not itself mean a breaking SDK release        |

During 0.x, maintainers announce an incompatible change in a minor release, with a migration note
and an explicit breaking-change commit marker. See [During 0.x](#during-0x).

## Four version axes

Keep four version axes separate:

1. **SDK SemVer:** the contract consumers install.
2. **Wrapp API path/version:** the remote interface, not controlled by this project.
3. **Provider observation profile:** reviewed fixtures and decoder rules with a dated source
   hash.
4. **Consumer/runtime matrix:** supported Node, TypeScript, bundlers and module format.

In practice:

- Do not force these version numbers to match.
- A new documentation hash does not itself mean a breaking SDK release.
- A version label does not make a remote breaking change compatible.

## Initial supported surface

This section lists what the SDK supports, what counts as evidence of that support, and what
changing it requires.

### Runtime and module format

- Server-side Node 22.13+ within 22.x and Node 24.x. Development is pinned by `.nvmrc`.
- ESM-only with explicit package exports. No undocumented deep imports.
- CJS users may use supported dynamic import or a proven bundler path. ESM packaging does not
  promise native `require()` compatibility.
- The SDK does not claim browser, Dart, Deno or Bun support. API credentials stay on the server.

### TypeScript

- Build with the pinned compatible TypeScript toolchain.
- The proposed consumer declaration floor is TypeScript 5.8. It is exercised against the tarball
  alongside the development compiler.
- NodeNext and bundler-resolution consumer fixtures are required.

### Evidence of support

- Test on the lowest advertised Node version, current supported LTS lines, and actual package
  tarballs.
- An `engines` field or passing source tests is not compatibility evidence.
- A first consuming application needs a separate runtime and Lambda-bundling check. Do not
  silently rely on its older Node 20 baseline or upgrade the application from this repository.

### Changing the supported surface

- Adding CJS later requires a decision and dual-package identity and type tests, not another
  unverified build output.
- Dropping a runtime or module format, or raising the TS floor, is breaking.

## Backward-compatible remote additions

These rules cover how the SDK validates requests, parses responses and handles what the provider
adds.

### Requests

- Request validation is strict for documented supported inputs. Reject typos and unsupported
  features before I/O.
- Request validation is not a tax-compliance validator.

### Responses

- Response parsing allows additional object properties but validates the required known shape.
- The SDK represents new provider enum values explicitly as unknown values and retains the
  original bounded value. It never silently maps them to success, paid, issued or false.
- Missing required evidence or conflicting shapes produces a protocol error.

### Public types

- Do not export generated vendor enums as closed unions that expand unexpectedly in a minor
  release.
- Keep normalized result discriminants stable.
- Provider code unions include an unknown variant from the first release.
- The SDK can tolerate an additive returned property without adding it immediately to the public
  API.

### Existing payloads

- Existing supported payloads must retain their normalization behavior.
- Keep old synthetic fixtures and consumer examples in regression tests.
- Never silently accept a different type such as number-for-string unless a documented profile
  explicitly permits it.

### Returned values

- Preserve null versus absent where meaningful.
- Public response values are immutable copies. Do not expose mutable parser objects or allow
  future callbacks to mutate earlier results.
- Retain raw sensitive evidence only through an explicitly documented caller opt-in, not logs.

## Breaking changes

Breaking changes include behavior.

### What counts as breaking

After 1.0, the following normally require a major release:

- Removing or renaming exports, fields, methods, overloads, error codes or result variants.
- Adding a required request field, tightening accepted valid inputs or narrowing output types.
- Changing amount, date or identifier representation or nullability.
- Changing mutation retry, authentication replay, deadline or default environment semantics.
- Adding a new variant to an exhaustively consumed public discriminated union.
- Changing minimum runtime or TS support, exports or supported module format.

The [initial supported surface](#initial-supported-surface) states one more rule: dropping a
runtime or module format, or raising the TS floor, is breaking.

Two rules apply to how a break is handled:

- Do not disguise a behavioral break as refactoring.
- Security fixes may require urgent action: document the impact and advisory instead of
  pretending compatibility is unchanged.

### What does not count as breaking

- New optional capabilities are normally minor.
- Equivalent internal corrections are normally patch.
- A new documentation hash does not itself mean a breaking SDK release. See
  [Four version axes](#four-version-axes).

For what the provider adds on its side, see
[Backward-compatible remote additions](#backward-compatible-remote-additions).

### During 0.x

- During 0.x, announce incompatible changes in a minor release with a migration note and an
  explicit breaking-change commit marker.
- Do not use pre-1.0 as permission for silent churn.
- Migration notes live in [migration.md](migration.md), one section per release that needs
  action, with before and after code for each change.

## Deprecation and migration

### Deprecated APIs

Keep deprecated APIs for the rest of their supported major version, with `@deprecated`,
migration examples and tests.

### Supported majors

Initial policy supports the current stable major and the previous major for 90 days after a new
stable major, subject to what Wrapp continues serving. This is a proposed maintainer commitment
requiring confirmation before publication.

### Provider shutdowns

- A provider shutdown may make a client version unusable regardless of local compatibility.
  Document that separately.
- Never switch a client to another API profile automatically.
- No URL/version guessing, feature probing through mutations, or fallback to production.

### Renamed fields and version selection

- For a renamed field, implement a deliberate versioned adapter after confirming semantics.
- Test old, new and error fixtures, and reject conflicting aliases rather than choosing
  arbitrarily.
- Known version selection belongs to construction/configuration, not a hidden per-request
  heuristic.

## Change monitoring and release process

### Process

1. Manually establish a dated baseline and vendor contact.
2. Later run a scheduled read-only documentation/schema fingerprint check. Changes create a
   review report; they never regenerate, merge, publish or trigger provider writes
   automatically.
3. Classify schema, examples, runtime behavior and tax-policy changes separately.
4. Reproduce with synthetic HTTP fixtures; obtain authorized staging evidence where needed.
5. Update the operation contract and compatibility fixtures, then review SemVer impact.
6. Produce a reviewed release PR with release-please as the sole version/changelog owner.
7. Release only after tarball, consumer, security, provenance and explicit publication gates.

### What the checks prove

- Commitlint parses Conventional Commits but cannot prove semantic compatibility.
- CI must compile representative previous-consumer programs against the new packed declarations,
  run regression behavior tests, compare reviewed public API reports, and exercise supported
  runtimes.
- A generated API diff is review input, not an automatic SemVer oracle.

### Publication

Publication runs only through the release workflow:

- a reviewed release-please PR;
- the protected npm environment;
- trusted publishing over OIDC (no stored npm credential);
- npm provenance from the public repository.

`prepublishOnly` runs `verify:release` for every `npm publish` that runs lifecycle scripts, a
manual one included. `verify:release` runs the pinned scanner install, the full-history secret
scan, and the quality, package and packed-consumer gates, in the order CI runs them.

`npm publish --ignore-scripts` would skip it. That npm-level bypass is why the protected
environment and the reviewed release PR remain the binding controls.

## Sources

- [Node support lifecycle](https://nodejs.org/en/about/previous-releases)
- [Node package exports](https://nodejs.org/api/packages.html)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [release-please](https://github.com/googleapis/release-please)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
