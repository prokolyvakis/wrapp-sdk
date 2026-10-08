# Security

This is a pre-release SDK with no production support guarantee. It handles API keys and
fiscal records, so please read this page before reporting a problem or opening an issue.

## Reporting a vulnerability

Report a suspected vulnerability privately, through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository. Please do not use a public issue.

There is no monitored security address and no response-time commitment yet, and none is
invented here.

**Never include credentials, customer information or live fiscal records** in an issue, a
pull request or a report.

## What the SDK does and does not protect

- API keys and tokens must stay on a server. The SDK keeps them in memory only.
- Webhook verification proves that the body was signed with one of your keys. It does not
  prove freshness, uniqueness, that the document was issued correctly, or that the routing
  headers are authentic.
- The client never downloads a URL that the provider returns.
- The client never replays a write whose outcome is unknown.

## For maintainers

- Dependency updates need review and the full compatibility and security checks.
- Never run credential-bearing provider tests on an untrusted pull request.

### Secret scanning

Gitleaks 8.30.1 is installed locally in the repository from checksum-pinned upstream archives
(`npm run secrets:install`). Scanning itself is offline.

- The history and staged configurations extend the default rules without path exclusions.
- Worktree scanning excludes only dependency, Git-internal and local-tooling directories.
- Inline allow comments and `.gitleaksignore` cannot silently waive a finding. An intentional
  exception needs a reviewed configuration change.
- The wrapper suppresses scanner output, which may contain sensitive context, and prints only
  the scope that failed. Inspect a finding locally with Gitleaks's redaction flag, never by
  uploading a suspect credential for verification.

A clean scan is evidence about what was scanned, not proof that no secret or personal data
exists. Unfetched or deleted remote refs, Actions logs and artifacts, images, and licensing
rights need a separate review before any change of visibility.
