# Compatibility and API evolution policy

Status: binding pre-release SDK contract, enforced locally by the packed-consumer and
declaration-baseline checks; no public release or provider certification exists yet.

## Separate four version axes

1. SDK SemVer: the contract consumers install.
2. Wrapp API path/version: the remote interface, not controlled by this project.
3. Provider observation profile: reviewed fixtures and decoder rules with a dated source hash.
4. Consumer/runtime matrix: supported Node, TypeScript, bundlers and module format.

Do not force these version numbers to match. A new documentation hash does not itself mean
a breaking SDK release. A remote breaking change is not made compatible by a version label.

## Initial supported surface

- Server-side Node 22.13+ within 22.x and Node 24.x; development pinned by .nvmrc.
- ESM-only with explicit package exports; no undocumented deep imports.
- Build with the pinned compatible TypeScript toolchain; proposed consumer declaration floor
  is TypeScript 5.8, exercised against the tarball alongside the development compiler.
- NodeNext and bundler-resolution consumer fixtures are required.
- CJS users may use supported dynamic import or a proven bundler path. Native require()
  compatibility is not promised by ESM packaging.
- Browser/Dart/Deno/Bun support is not claimed. API credentials stay on the server.
- Test on the lowest advertised Node version, current supported LTS lines, and actual package
  tarballs. An engines field or passing source tests is not compatibility evidence.
- First Aidvo integration needs a separate runtime and Lambda-bundling check. Do not silently
  rely on its older Node 20 baseline or upgrade the application from this repository.

Adding CJS later requires a decision and dual-package identity/type tests, not another
unverified build output. Dropping a runtime/module format or raising the TS floor is breaking.

## Backward-compatible remote additions

Request validation is strict for documented supported inputs; reject typos and unsupported
features before I/O. It is not a tax-compliance validator.

Response parsing allows additional object properties but validates the required known shape.
New provider enum values are represented explicitly as unknown values with the original
bounded value retained, never silently mapped to success, paid, issued or false.
Missing required evidence or conflicting shapes produces a protocol error.

Do not export generated vendor enums as closed unions that expand unexpectedly in a minor
release. Keep normalized result discriminants stable. Provider code unions include an unknown
variant from the first release. An additive returned property can be tolerated without being
added immediately to the public API.

Existing supported payloads must retain their normalization behavior. Keep old synthetic
fixtures and consumer examples in regression tests. Never silently accept a different type
such as number-for-string unless a documented profile explicitly permits it.

Preserve null versus absent where meaningful. Public response values are immutable copies;
do not expose mutable parser objects or allow future callbacks to mutate earlier results.
Retain raw sensitive evidence only through an explicitly documented caller opt-in, not logs.

## Breaking changes include behavior

After 1.0, the following normally require a major release:

- Removing/renaming exports, fields, methods, overloads, error codes or result variants.
- Adding a required request field, tightening accepted valid inputs or narrowing output types.
- Changing amount/date/identifier representation or nullability.
- Changing mutation retry, authentication replay, deadline or default environment semantics.
- Adding a new variant to an exhaustively consumed public discriminated union.
- Changing minimum runtime/TS support, exports or supported module format.

New optional capabilities are normally minor; equivalent internal corrections normally patch.
Do not disguise a behavioral break as refactoring. Security fixes may require urgent action:
document the impact and advisory instead of pretending compatibility is unchanged.

During 0.x, announce incompatible changes in a minor release with a migration note and
explicit breaking-change commit marker. Do not use pre-1.0 as permission for silent churn.

## Deprecation and migration

Keep deprecated APIs for the rest of their supported major version, with @deprecated,
migration examples and tests. Initial policy supports the current stable major and the previous
major for 90 days after a new stable major, subject to what Wrapp continues serving.
This is a proposed maintainer commitment requiring confirmation before publication.

A provider shutdown may make a client version unusable regardless of local compatibility.
Document that separately; never switch a client to another API profile automatically.
No URL/version guessing, feature probing through mutations, or fallback to production.

For a renamed field, implement a deliberate versioned adapter after confirming semantics.
Test old/new/error fixtures and reject conflicting aliases rather than choosing arbitrarily.
Known version selection belongs to construction/configuration, not a hidden per-request heuristic.

## Change monitoring and release process

1. Manually establish a dated baseline and vendor contact.
2. Later run a scheduled read-only documentation/schema fingerprint check. Changes create a
   review report; they never regenerate, merge, publish or trigger provider writes automatically.
3. Classify schema, examples, runtime behavior and tax-policy changes separately.
4. Reproduce with synthetic HTTP fixtures; obtain authorized staging evidence where needed.
5. Update the operation contract and compatibility fixtures, then review SemVer impact.
6. Produce a reviewed release PR with release-please as the sole version/changelog owner.
7. Release only after tarball, consumer, security, provenance and explicit publication gates.

Commitlint parses Conventional Commits but cannot prove semantic compatibility.
CI must compile representative previous-consumer programs against the new packed declarations,
run regression behavior tests, compare reviewed public API reports, and exercise supported runtimes.
A generated API diff is review input, not an automatic SemVer oracle.

Publication is currently blocked by private:true and prepublishOnly. No npm credential,
automatic release workflow or public repository setting is introduced by this bootstrap.
When explicitly approved, use a protected release environment, narrowly scoped trusted
publishing where available, and verified source-to-tarball provenance. Verify support for
private-repository provenance rather than assuming it matches public repositories.

## Sources

- [Node support lifecycle](https://nodejs.org/en/about/previous-releases)
- [Node package exports](https://nodejs.org/api/packages.html)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [release-please](https://github.com/googleapis/release-please)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
