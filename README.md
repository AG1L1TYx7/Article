# The Dispatch — news & article platform

A publishing platform for a news site: staff write and publish articles with
photo and video, readers register, comment, react, save, follow and share.

Built with Next.js 16 (App Router), MySQL via Prisma 7, and Auth.js.
The full architecture and security plan this implements is in [`docs/`](docs/).

---

## Getting started

**You need:** Node 20+, MySQL 8 or MariaDB 10.4+ running locally, and npm.

The database needs `innodb_ft_min_token_size=2`, or searching for "AI", "EU"
or "US" silently matches nothing. See [docs/database.md](docs/database.md).

```bash
npm install
cp .env.example .env          # then edit DATABASE_URL and AUTH_SECRET
npx prisma migrate dev        # create the schema
npm run seed                  # starter categories
npm run bootstrap:staff -- --email you@example.com --role ADMIN
npm run dev                   # http://localhost:3000
```

Two of those steps are easy to skip and then wonder why things look broken:

- **`npm run seed`** creates the starter categories. Without it the category
  dropdown in the article editor is empty and the site header has no sections.
- **`npm run bootstrap:staff`** is the only way to create the first staff
  account. Registration always creates a `READER`, by design — there is no
  "first user becomes admin" path, because that is a privilege-escalation
  race on any publicly reachable install. It prints a generated password once
  if you don't pass one.

Set `NEXTAUTH_URL` to the real public origin before deploying: it is also what
the sitemap, the RSS feed and every share card use to build absolute URLs.
(`SITE_URL` overrides it if the two ever need to differ.)

`AUTH_SECRET` can be generated with `openssl rand -base64 32`. It also keys
the encryption of stored MFA secrets, so changing it invalidates every
enrolled authenticator.

### Admins must enrol MFA

The first time an admin signs in they are redirected to `/dashboard/mfa` and
cannot reach anything else in the dashboard until they scan the QR code with
an authenticator app. This is enforced in `src/proxy.ts`, not just in the UI.
MFA is optional for moderators.

---

## Environment variables

Everything in `.env.example` beyond `DATABASE_URL` and `AUTH_SECRET` has a
working local fallback, so the app runs — and the whole test suite passes —
before you have signed up for a single third-party service:

| Missing | What happens instead |
| --- | --- |
| `RESEND_API_KEY` | Emails are written to `.email-dev-outbox.log` (gitignored) |
| `S3_*` | Uploads are stored in `./.local-uploads` |
| `UPSTASH_REDIS_REST_*` | Rate limiting uses an in-process counter |
| `TURNSTILE_*` | The registration CAPTCHA is skipped |
| `CLAMAV_HOST` | Uploads are not malware-scanned, so **video uploads are refused** (images are unaffected) |
| `FFMPEG_PATH` | Video is stored as uploaded rather than re-encoded to H.264/AAC |

**Before deploying**, the Upstash one matters most: the in-process rate
limiter gives each server process its own counters, so on more than one
instance the effective limit is multiplied by the instance count. See the
comment at the top of `src/lib/rateLimit.ts`.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test:unit` | Vitest unit tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run seed` | Starter categories (idempotent) |
| `npm run seed:demo` | Fourteen realistic stories with covers, for judging the front page on an empty site (`-- --remove` takes them away) |
| `npm run bootstrap:staff` | Create or promote a staff account |
| `npm run cleanup:test-data` | Remove e2e leftovers (dry run unless `-- --confirm`) |
| `npm run audit` | Dependency audit, failing on anything unreviewed |
| `npm run build:cpanel` | Assemble an upload-ready bundle for cPanel Node.js hosting |

### Testing

Unit tests cover the pure logic — sanitization, spam heuristics, validation,
search text extraction, comment policy. End-to-end tests drive a real browser
against a **production build**, not `next dev`.

That last point is deliberate and worth keeping. `next dev` compiles routes on
demand, so under parallel load the first request to a route can take seconds.
That produced failures which looked like application bugs — a like that
"didn't persist", a registration that "didn't redirect" — but were really the
dev server still compiling. The same suite failed 3 times in 24 runs against
`next dev` and passed 24/24 against a production build, in a third of the time.
It also surfaced two bugs that only exist in production builds.

The e2e suite clears its own leftovers before each run (`globalSetup`), because
these tests register real accounts and publish real articles. Cleanup is scoped
to `@example.com`, a domain RFC 2606 reserves for testing, so it can never
match a real account.

The suite talks to the database directly for a few things the application
deliberately offers no UI for — promoting an account to staff, backdating a row
— through `tests/e2e/support/db.ts`. Connection details come from the usual
`MYSQL_*` environment variables, and the `mysql` client is found on PATH or at
a standard install location, so you don't need the same setup as whoever wrote
the test.

Everything runs on push and on pull requests via GitHub Actions
(`.github/workflows/ci.yml`): typecheck, lint and unit tests in one job, the
end-to-end suite against a real MySQL service container in another.

---

## How it fits together

```
src/
  app/                    Routes (App Router)
    (auth)/               Register, login, verify, reset
    (dashboard)/          Staff: articles, categories, comment queue, analytics,
                          people, audit log, MFA
    api/                  Route handlers (uploads, auth, unread count)
    article/ author/ category/ search/ saved/ notifications/
  components/             UI, grouped by feature
  lib/                    Everything that isn't a route or a component
    auth/                 Session config, RBAC, MFA, password, lockout
    validation/           Zod schemas — one per feature
  proxy.ts                Route protection and security headers
prisma/                   Schema, migrations, seed
tests/                    unit/ and e2e/
docs/                     Architecture and security plan, search, link previews,
                          deployment, security testing
```

A few conventions that aren't obvious from the tree:

- **`src/proxy.ts` is the middleware.** Next.js 16 renamed `middleware.ts` to
  `proxy.ts`, and it runs on the **Node.js** runtime, not Edge. Setting a
  `runtime` option in that file throws.
- **One auth config, used everywhere**, including the proxy. An earlier
  Edge/Node split let a revoked session survive at the proxy layer.
- **Every export from a `"use server"` file must be an `async function`.**
  `export const approve = (id) => ...` type-checks and lints cleanly and then
  fails the build. Only `npm run build` catches it.
- **Prisma stores `DateTime` as `timestamp without time zone` holding UTC.**
  Any raw SQL comparing it to `now()` or to a bound `Date` must say
  `AT TIME ZONE 'UTC'` on both sides, or every row shifts by the database
  session's offset. See [`docs/search.md`](docs/search.md).

---

## Security model

The short version of what's implemented and why.

**Accounts.** Argon2id password hashing. After five failed logins the account
locks, with the lock doubling on each further attempt from two minutes up to a
day — per account, so rotating accounts does not dodge it, and per IP at the
rate-limit layer, so rotating targets does not either.

TOTP MFA, mandatory for admins, with secrets encrypted at rest (AES-256-GCM). Sessions are JWTs, but every request re-reads the user's role,
status and `sessionVersion` from the database — so banning an account, or
"log out everywhere", takes effect on the very next request rather than
whenever the token happens to expire.

**Authorization** is checked on the server for every mutation, in the server
action or route handler itself. `src/proxy.ts` gates routes as well, but it is
a second line, not the only one. Moderators can edit and publish their own
articles; admins can act on anyone's.

**Browser-side.** A nonce-based Content-Security-Policy on every response,
with `strict-dynamic` rather than a list of allowed hosts, plus
`object-src none`, `base-uri none`, `frame-ancestors none` and
`form-action self`. It is the backstop for an XSS the sanitizer misses: a
script that slips through still cannot run.

This is why every page renders per request (`export const dynamic` in the
root layout). Next.js injects the nonce while rendering, so a statically
generated page has scripts with no nonce — and under `strict-dynamic` a
browser then blocks every one of them. Measured: the homepage and auth
pages produced 12-13 blocked scripts each and never hydrated.

**Untrusted input.** Article HTML is sanitized on save *and* again on render
(`src/lib/sanitize.ts`) — there is exactly one `dangerouslySetInnerHTML` in
the codebase and it is fed by that sanitizer. Comments are plain text,
rendered as text, so React escapes them; no sanitizer is involved and none is
needed. Everything is validated with Zod before it reaches the database.

**Uploads.** File type comes from magic bytes, not the extension or the
`Content-Type` header. Images are re-encoded with `sharp`, which strips EXIF
and any embedded payload, and are only marked servable once that succeeds.

**Abuse.** Per-endpoint rate limits. New accounts' comments are held for
moderation until they have three approved; spam heuristics hold anything
link-stuffed or shouty regardless of who wrote it, and editing a comment
re-runs those checks so an edit can't be used to slip past approval.
Registration can require a CAPTCHA.

**Outbound fetches.** Link previews make the server request a URL an author
typed — the classic SSRF setup. Every address a hostname resolves to must be
public, the connection is made to the address that was checked rather than
resolving the name a second time, every redirect hop is re-checked, and
failures are reported coarsely so this cannot be used to map the internal
network. [`docs/link-previews.md`](docs/link-previews.md) walks through each
attack and what stops it.

**Newsroom tooling.** `/dashboard/audit-log` reads the audit trail with filters
for the security-relevant actions; `/dashboard/users` manages roles and
suspensions, and refuses the two changes that cannot be undone from inside the
application — changing your own role, and removing the last active admin.
`/dashboard/analytics` shows what is being read and discussed.

**Audit.** Every privileged action writes an append-only `AuditLog` row, and
so does every authentication event — successes, failures, lockouts, and a
correct password with a failed second factor, which is the signal that a
password is already compromised. Without those, a credential-stuffing run
leaves no trace until it succeeds. The
application exposes no way to update or delete one. Comments and articles are
soft-removed via status flags, never hard-deleted, so the trail survives.

---

## Not done yet

Stated plainly so nobody assumes otherwise:

- **Google OAuth** is not scaffolded — it needs a Google Cloud OAuth client.
- **Search has no GIN index yet.** Fine into the low tens of thousands of
  articles; [`docs/search.md`](docs/search.md) has the exact migration for
  when it isn't.
- No internationalization.

## Deploying

See [docs/deployment.md](docs/deployment.md) — a step-by-step guide for a
fresh Ubuntu VPS or dedicated server, covering server hardening, Docker,
nginx, HTTPS, backups and the three services that must replace their local
fallbacks before the site really works.

This needs a server that can keep a Node process alive.

**cPanel works too**, if it offers "Setup Node.js App" with Node 20.9+ — see
[docs/cpanel.md](docs/cpanel.md) and `npm run build:cpanel`. Video uploads are
refused on that path, because malware scanning needs a ClamAV daemon shared
hosting will not give you; everything else works.

## Known local hazard

If this working copy lives in a OneDrive-synced folder, OneDrive locks files
inside `.next` mid-sync and builds fail with
`EPERM: operation not permitted, unlink`. The e2e config works around it by
wiping `.next` before building. For day-to-day work, either exclude
`.next` and `node_modules` from sync, or keep the project outside OneDrive.

## Security testing

[`docs/security-testing.md`](docs/security-testing.md) covers what is tested
automatically, the flaws that testing found (an open redirect, missing
authentication audit logging, a framework banner, a missing CSRF check), and —
importantly — what it does not cover. It is a regression net against known
classes of flaw, not a penetration test.

## Browsing the database

`npx prisma studio` opens a schema-aware browser on http://localhost:5555.
Adminer — the phpMyAdmin-style option, which unlike phpMyAdmin speaks
MySQL and MariaDB — is set up in XAMPP at http://localhost/adminer.php. See
[docs/database-gui.md](docs/database-gui.md) for connection details.
