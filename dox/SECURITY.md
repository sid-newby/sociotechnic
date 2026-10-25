# Security policy

Sociotechnic runs coding agents against local repositories. Local execution can
read and change files, run commands and use your saved provider authentication.
Treat a repository, dependency or agent instruction you have not reviewed as
untrusted code. The console is intended for local use; keep it bound to loopback.

## Reporting a vulnerability

Use **Security → Report a vulnerability** on this repository when private
reporting is available. Include the affected version or commit, a minimal
reproduction, the access required and the impact. Use synthetic data and redact
credentials, private paths and project content.

If GitHub does not offer private reporting, open an issue asking the maintainer
for a private contact channel. Include no vulnerability details, exploit code or
sensitive data in that public issue. Wait for a private channel before sending
the report.

Do not test against other people's accounts, repositories or infrastructure.

## Fixes and support

Security fixes target `main` and the latest release. Older releases do not have
a guaranteed backport or response schedule. Include your version in reports so
we can establish which behavior is affected.

If a credential is exposed, revoke it through its provider. Removing a file or
rewriting Git history does not revoke the credential.
