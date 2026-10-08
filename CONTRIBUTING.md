# Contributing

Thank you for considering a contribution. This page explains how to set up the project, what
a change needs before it can be merged, and how releases are made.

Two things make this project different from most SDKs, and they shape every review:

- **It handles fiscal documents.** A wrong retry or a wrong guess can create a duplicate
  invoice. Changes that touch requests, results or errors are reviewed for exactly that risk.
- **It claims only what is evidenced.** Behavior comes from the provider's documentation or
  from observed provider behavior, and the docs say which. A passing mock is not evidence.

No provider account, credential or network access is needed to build, test or contribute.

## Contents

- [Set up](#set-up)
- [Make a change](#make-a-change)
- [Checks](#checks)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Tests and fixtures](#tests-and-fixtures)
- [Versioning](#versioning)
- [Releases](#releases)
- [Toolchain notes](#toolchain-notes)

## Set up

1. Use the Node version in `.nvmrc`. With nvm: `nvm install`.
2. Install dependencies from the committed lockfile, without running install scripts:

   ```sh
   npm ci --ignore-scripts
   ```

   Inspect the scripts of any new dependency before you let them run.

3. Install the pinned secret scanner, then enable the git hooks:

   ```sh
   npm run secrets:install
   npm run prepare
   ```

Dependencies are local and locked; nothing needs a global install. `.npmrc` enforces exact
versions and the engine range, so a Node version outside 22 and 24 fails fast by design.

## Make a change

1. **Read first.** [docs/design.md](docs/design.md) explains why the SDK behaves as it does,
   [docs/api-reference.md](docs/api-reference.md) what it supports, and
   [docs/compatibility.md](docs/compatibility.md) what a release must preserve.
2. **Write the test before the fix.** Add a regression test that fails against the real
   defect, then make it pass. Cover both the failing and the working path.
3. **Keep the documents true.** If behavior changes, update the API reference. If a consumer
   has to edit code, add the edit to [docs/migration.md](docs/migration.md).
4. **Update the public API report** when the exported surface changes: `npm run api:update`,
   then review the diff in `docs/api/wrapp-sdk.api.md`.
5. **Run the checks** below before you open a pull request.

Please keep documentation, scripts and configuration portable: no absolute checkout or home
paths in repository files.

## Checks

| Command                   | What it proves                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run check`           | Formatting, typed lint, types of source **and** tests, coverage, and the build. The everyday loop. |
| `npm run check:package`   | The declaration baseline, the package exports and type resolution.                                 |
| `npm run check:consumers` | The packed tarball compiles and runs under TypeScript 5.8 and 6.0, in NodeNext and bundler modes.  |
| `npm run secrets:check`   | An offline Gitleaks scan of history, index and working files.                                      |
| `npm run verify:release`  | Everything above in CI order, after installing the pinned scanner, stopping at the first failure.  |

Things worth knowing:

- Source checks are not a substitute for `check:consumers`. Only the packed tarball proves
  what a consumer receives.
- `verify:release` publishes nothing. It is what `prepublishOnly` runs, so `npm publish`
  cannot get past a failing gate. npm still allows `npm publish --ignore-scripts`, which skips
  `prepublishOnly`; never use it. The reviewed release PR and the protected `npm` environment
  are the controls a package script cannot be.
- The hooks are a local convenience. CI repeats every gate, because hooks can be bypassed.
- The hooks never edit files for you. Run `npm run format` deliberately.
- No check needs provider requests, credentials or publishing.
- Do not silence an error with a blanket `any` cast, a test exclusion or `passWithNoTests`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/), parsed by commitlint's
conventional preset:

```text
feat(invoices): add full invoice lookup
fix(auth): avoid invalidating a newer token
test(webhooks): reject body tampering
feat!: change the minimum supported Node version
```

- Use a `BREAKING CHANGE:` footer to explain what a consumer must change.
- All new commits and pull request titles are checked.
- Strict parsing intentionally rejects generated merge and revert subjects, fixup and squash
  subjects, and bare version strings. Reword before merging.
- The initial historical commit is the baseline. Do not rewrite it.

No tool can determine every semantic break. Maintainers review compatibility by hand.

## Pull requests

- Merging is squash-only, with a validated title. The title becomes the commit subject, so
  write it as a Conventional Commit.
- Preserve breaking-change explanations in the squash body.
- Update a pull request branch by rebasing, not by merging the base branch into it.
- Never run credential-bearing provider tests on an untrusted pull request.

## Tests and fixtures

- Test files are typechecked, like the source.
- Record where a fixture comes from: **synthetic**, **documentation-derived** or
  **staging-observed**. Synthetic fixtures and loopback tests are not observed provider
  behavior, and must not be described as such.
- Never put real identities, API keys, taxpayer data or signed download links in a fixture.
- The tests block every non-loopback destination and run real HTTP against local servers.

## Versioning

Versions follow semantic versioning and are computed from the commit history by
release-please:

| Commit                             | Version bump |
| ---------------------------------- | ------------ |
| `fix`                              | patch        |
| `feat`                             | minor        |
| `!` or a `BREAKING CHANGE:` footer | major        |

On the 0.x line, a breaking change lands as a **minor** release with a migration note
(`bump-minor-pre-major`), so no commit can cut a major release by accident. Crossing to 1.0.0
is a deliberate maintainer decision: edit `release-please-config.json` explicitly, and never
rely on a tool default for it.

What counts as breaking is behavioral, not only structural. See
[docs/compatibility.md](docs/compatibility.md).

## Releases

release-please is the only owner of the version and the changelog.

1. Pushes to `main` keep a release pull request up to date from the commit history.
2. Merging that pull request creates the tag and the GitHub release.
3. The publish job then runs the full gates (`prepublishOnly` runs `verify:release`) and
   publishes to npm with provenance through trusted publishing. No npm token exists anywhere.

The publish job checks out the full history, because the secret scan refuses a shallow one,
and runs in the protected `npm` environment. Keep a required reviewer on that environment.

Rules for maintainers:

- To rehearse a release locally, run `npm run verify:release` or `npm run prepublishOnly`.
  Never use `npm publish` or `npm publish --dry-run` as a check.
- Do not attach the gate sequence to `prepare` or `prepack`: the package and consumer gates
  call `npm pack` themselves.
- Do not add semantic-release or Changesets alongside release-please.
- CI does not start automatically on release-please's pull requests, which is a GitHub token
  limitation. Approve the queued workflow run, or close and reopen the pull request.

Historical note: 0.1.0 was bootstrapped with a manual `npm publish`, because npm's trusted
publishing cannot create the first version of a package.

## Toolchain notes

- The toolchain pins TypeScript 6.0.3, because the type-aware linter supports TypeScript
  below 6.1.
- Use the npm scripts for building and typechecking, not a bare `tsc`. The `typescript-5-8`
  compatibility alias may own the shared `tsc` link; the explicit compiler path in the scripts
  keeps development on 6.0.3.
- The development typecheck includes the DOM types that the test runner needs. The SDK build
  overrides that library list to ES2022 only. Do not add browser APIs to the server SDK.
