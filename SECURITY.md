# Security Policy

## Supported versions

Only the latest release of AlwaysOnlineTab receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on this repository (private vulnerability reporting).
Do not open a public issue for security problems. You will get a response within 7 days.

## Design guarantees

- No remote code: every script is bundled in the extension; CSP is `script-src 'self'; object-src 'none'; base-uri 'none'`.
- No data collection and no third-party requests.
- Host permissions are optional and granted per site by the user; revoked when the site is removed.
- Site keys are restricted to a single `http(s)://hostname`; wildcards are rejected before any permission request.
- Content scripts only accept messages whose sender is this extension's own service worker; there is no `externally_connectable` and no `web_accessible_resources`.
- The MAIN-world script only overrides page visibility getters; it holds no extension privileges and sends nothing.
- Dependabot and CodeQL (`security-extended`) run on this repository. The shipped extension has zero runtime dependencies.
