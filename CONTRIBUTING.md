# Contributing

## Setup

Use the Node version in .nvmrc (with nvm: `nvm install`) and npm with the committed lockfile.
Install using `npm ci --ignore-scripts`, inspect new dependency scripts, then `npm run prepare`
to enable the git hooks. Install the pinned local secret scanner with `npm run secrets:install`
before running the full checks or hooks.

Dependencies are local and locked; nothing needs a global install. `.npmrc` enforces exact
versions and the engine range, so Node outside 22/24 fails fast by design.

## Commits

Use Conventional Commits, parsed by commitlint's conventional preset:

- feat(invoices): add full invoice lookup
- fix(auth): avoid invalidating a newer token
- test(webhooks): reject body tampering
- feat!: change the minimum supported Node version

Use a BREAKING CHANGE footer for the migration explanation. The initial historical commit is
the baseline; do not rewrite it. All new commits and PR titles are checked. Merge policy is
squash-only with a validated PR title; preserve breaking-change explanations in the squash
body. Update PR branches by rebasing, not by generating merge commits. Strict parsing
intentionally rejects generated merge/revert subjects, fixup/squash subjects and bare version
strings; reword before merging. No tool can determine every semantic break: maintainers must
review compatibility.

## Quality gates

- `npm run check` — formatting, typed lint, source AND test types, coverage and build.
- `npm run check:package` — declaration baseline, package exports and type resolution.
- `npm run check:consumers` — compiles and runs the packed tarball under TypeScript 5.8 and
  6.0 in NodeNext and bundler modes. Source checks are not a substitute for this proof.
- `npm run secrets:check` — offline Gitleaks scan of history, index and working files.

Hooks are local convenience; CI repeats every gate because hooks can be bypassed. No provider
requests, credentials or publishing are required for any check. No fix-up edits are performed
automatically by the hooks — run `npm run format` deliberately.

The toolchain pins TypeScript 6.0.3 because the type-aware linter supports TypeScript below
6.1. Use the npm build/typecheck scripts, not a bare `tsc`: the `typescript-5-8` compatibility
alias may own the shared tsc link, and the explicit compiler path keeps development on 6.0.3.

The development typecheck includes DOM types required by the test runner; the SDK build
overrides that library list to ES2022 only. Do not add browser APIs to the server SDK.
Do not silence errors with blanket any casts, test exclusions or passWithNoTests.

Keep documentation, scripts and configuration portable: no absolute checkout or home paths
in repository files.

## Tests and fixtures

Add a regression test that fails against the real defect; test both the red and the green
path. Test files are typechecked. Record fixture provenance as synthetic,
documentation-derived or staging-observed — synthetic fixtures and loopback tests are not
observed Wrapp behavior. Never include real identities, API keys, taxpayer data or signed
download links in fixtures.

## Releases

The package stays private and publishing is blocked pending explicit approval. Use one
release owner: release-please is proposed for reviewed release PRs once a usable SDK exists;
it is not activated yet. Do not add semantic-release or Changesets alongside it.
See [docs/compatibility.md](docs/compatibility.md) for what a release must preserve.
