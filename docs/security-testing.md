# Security testing

What is tested automatically, what was found, and what this does not
cover.

## What runs

| Suite | Where | What it does |
| --- | --- | --- |
| Attack attempts | `tests/e2e/security.spec.ts` | Tries to break in against a running production build, organised by OWASP Top 10 category |
| CSP enforcement | `tests/e2e/csp.spec.ts` | Watches the browser console for anything the policy blocked, on every page type |
| SSRF | `tests/unit/ssrf.test.ts`, `tests/unit/linkPreviewFetch.test.ts` | Address classification, and the real fetcher against real loopback and private targets |
| Sanitization | `tests/unit/sanitize.test.ts` | The allowlist that article HTML passes through |
| Redirects | `tests/unit/safeRedirect.test.ts` | Open-redirect payloads |
| Upload tokens | `tests/unit/uploadToken.test.ts` | Forgery, expiry, key-shape escape attempts |
| CSRF | `tests/unit/csrf.test.ts` | Origin/Host agreement |
| Dependencies | `npm run audit` | Fails on any advisory not reviewed and written down |

All of it runs in CI on every push and pull request.

## Findings, and what was done

These were found by writing the tests, not by reading the code.

**Open redirect in the login flow.** `?from=` was validated with
`from.startsWith("/")`. That accepts `//evil.com`, which browsers resolve
to `https://evil.com`. The attack is a victim logging in genuinely on the
real site and landing on an attacker's cloned "log in again" page — the
credentials go to the attacker, and nothing looked wrong until after they
had trusted the real domain. `/\evil.com` works the same way, because
browsers normalise the backslash.

Replaced with `lib/safeRedirect.ts`, which resolves the value the way a
browser does and checks the origin did not move, rather than
pattern-matching prefixes.

**No authentication events in the audit log.** Content and privilege
actions were audited; logins were not. A credential-stuffing run against
real accounts left no trace anywhere until one succeeded. Now records
successes, failures, lockouts, blocked accounts, and — most urgently — a
correct password with a failed second factor, which is the signal that a
password is already compromised.

**The server advertised its framework** in `X-Powered-By`, which tells an
attacker what to look up exploits for. Disabled.

**No explicit CSRF check on the media API routes.** Server Actions get
Origin/Host verification from Next.js automatically; a plain Route Handler
does not, and three of them are cookie-authenticated and state-changing.
The session cookie is `SameSite=Lax`, which independently blocks the
attack in any modern browser — but depending solely on a cookie flag
nobody has to think about is fragile. Now checked explicitly as well.

Two earlier findings are written up in full elsewhere:
[unscanned video publicly readable on S3](deployment.md) and the
[CSP that blocked every script on statically rendered pages](../README.md).

## What this does not cover

**This is automated testing, not a penetration test.** It exercises the
attacks that were thought of while building the thing — which is exactly
the set a real attacker will go beyond. It is a regression net, so a flaw
of a known shape cannot come back unnoticed. It is not a substitute for
somebody adversarial and unfamiliar spending time on it.

Specifically not covered:

- **Business logic abuse.** Whether the moderation model can be gamed,
  whether trust can be farmed, whether the rate limits are set at
  sensible numbers rather than merely present.
- **Infrastructure.** The server, TLS configuration, database hardening
  and network exposure are deployment concerns, and none of them exist
  yet to be tested.
- **The S3 path.** No credentials here, so pre-signing, direct upload and
  the fetch-back have never run against a real bucket.
- **Denial of service.** There is no load test. Rate limits are asserted
  to fire, not measured under real traffic.
- **Dependencies at runtime.** `npm audit` reads the manifest; it does not
  detect a compromised package that matches its published hash.

An external review is listed in the project plan's phase 6 and has not
happened. It is the item on that list that most needs a person.
