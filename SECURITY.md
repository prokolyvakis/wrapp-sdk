# Security

This is a pre-release core SDK with no production support guarantee.
Do not disclose credentials, customer information or live fiscal records in issues.

## Reporting

Report suspected vulnerabilities privately via GitHub's private vulnerability reporting on
this repository, not in public issues. There is no monitored security address or response
SLA yet; none is invented here.

## Handling expectations

API keys and tokens must remain server-side. Webhook authentication does not prove freshness,
uniqueness, semantic issuance correctness, or authenticated routing headers. The client never
downloads arbitrary returned URLs and never replays ambiguous mutations.

Dependency updates require review and the full compatibility/security checks.
Never run credential-bearing provider tests on untrusted pull requests.

## Secret scanning

Gitleaks 8.30.1 is installed repository-locally from checksum-pinned upstream archives
(`npm run secrets:install`); scanning itself is offline. The history/staged configuration
extends the default rules without path exclusions; worktree scanning excludes only
dependency, Git-internal and local-tooling directories. Inline allow comments and
.gitleaksignore cannot silently waive findings — intentional exceptions require a reviewed
configuration change.

The wrapper suppresses scanner output (which may contain sensitive context) and prints only
the failed scope. Maintainers can inspect locally with Gitleaks's redaction flag, never by
uploading suspect credentials for verification. A clean exit is scoped detection evidence,
not proof that no secret or personal data exists: unfetched or deleted remote refs, Actions
logs and artifacts, images and licensing rights need separate review before any visibility
change.
