# Going live: the checklist

Everything the code can check, it checks: in production the server
refuses to start until the blockers below are fixed
(`src/instrumentation.ts`), and `npm run check:production` runs the same
report against your `.env` before you deploy. What the code cannot check
— that a backup actually restored, that a person reviewed the security —
is listed here so it is not forgotten.

Run this on the machine you deploy from, with the production `.env`:

```bash
npm run check:production          # blockers fail; warnings are printed
npm run check:production -- --strict   # warnings fail too
```

## Blockers — the server will not start with any of these

| Check | Why it is a blocker |
| --- | --- |
| `DATABASE_URL` set | Nothing works without it |
| `AUTH_SECRET` at least 32 characters, not a placeholder | Signs sessions and encrypts every stored MFA secret. Set once and keep it: changing it invalidates every authenticator |
| `NEXTAUTH_URL` (or `SITE_URL`) is the public `https://` address, not localhost | Sign-in links, share cards, the feed and the sitemap are built from it; session cookies are `Secure` in production and are not sent over http |
| `RESEND_API_KEY` and a real `EMAIL_FROM` | Without a provider every verification link and password reset is written to a log file. Nobody can recover an account |

For a staging server that deliberately runs on fallbacks, set
`ALLOW_PRODUCTION_FALLBACKS=1`. Never set it on the real site.

## Warnings — the site works, but should not stay like this

| Check | What happens without it |
| --- | --- |
| `S3_*` and `MEDIA_PUBLIC_BASE_URL` | Uploads live on one server's disk, outside the database backup |
| `UPSTASH_REDIS_REST_*` | Rate limits are per process: fine on one instance, wrong on two |
| `TURNSTILE_*` | Registration has no CAPTCHA |
| `CLAMAV_HOST` | No malware scan; the re-encode is still the main control ([media.md](media.md)) |
| ffmpeg found | Video and audio uploads are refused without it; `ffmpeg-static` provides it after `npm install` |
| `VAPID_*` | Readers cannot turn on push alerts |
| `TWILIO_*` | Phone verification is unavailable |
| `LEGAL_*` | The privacy policy and terms show placeholders |

## What only a person can check

Before the first public link goes out:

- [ ] **HTTPS terminates in front of the app** (nginx, Cloudflare, or the
      host) and `X-Forwarded-For` is *overwritten* with the client
      address, never appended — see [deployment.md](deployment.md) §6.
      The rate limiter and the audit log trust that header.
- [ ] **The first admin exists** and has enrolled an authenticator
      (`npm run bootstrap:staff -- --email you@… --role ADMIN`, then log
      in and scan the code). Keep the recovery codes somewhere safe.
- [ ] **A backup runs on a schedule** and **a restore has been done
      once** on a scratch database ([operations.md](operations.md)).
      Object storage is backed up separately from the database.
- [ ] **Something watches `/api/health`.** It returns 200 with
      `{"status":"ok"}` while the database answers and 503 otherwise.
      Point an uptime monitor at it.
- [ ] **Logs are kept somewhere.** The startup report and every
      `[request error]` line go to stdout; make sure the host retains them.
- [ ] **The bucket's `quarantine/` prefix is private** and has a
      lifecycle rule ([deployment.md](deployment.md) §7).
- [ ] **The load test has been run against the real server**
      (`npm run load-test`, [operations.md](operations.md)).
- [ ] **The legal pages have been read by a human** — the code fills in
      names and addresses, not the law.
- [ ] **Someone outside the project has looked at the security.** The
      code-side hardening is described in [security-testing.md](security-testing.md);
      a penetration review is a person's job.
- [ ] **Scheduled publishing** rides on ordinary traffic (a due story goes
      live on the next request after its time). If the site can be quiet
      for hours, add a cron entry that fetches the homepage every minute.

## After going live

- Watch the audit log (`/dashboard/audit-log`) for the first days: failed
  sign-ins and lockouts show abuse early.
- Run `npm run audit` on every dependency update; CI does too.
- Keep `.env` at mode 600 and out of every backup that leaves the server
  unencrypted.
