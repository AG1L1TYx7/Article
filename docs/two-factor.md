# Two-factor authentication

Two methods, deliberately unequal, and the site is explicit about which is
which.

| | Authenticator app (TOTP) | Emailed code |
| --- | --- | --- |
| What it is | Six digits from an app on a phone | Six digits sent to the address on the account |
| Administrators | **Required** | Refused |
| Moderators | Either, their choice | Either, their choice |
| Members | Either, their choice | Either, their choice |
| Default | Off | Off |

Nobody is forced into either except administrators. A member signs in with
a password until they choose otherwise, from the account page.

---

## Why an administrator may not use the emailed code

Whoever holds the mailbox holds the factor. For a member that is a real
improvement on a password alone and asks nothing they do not already have.
For an account that can publish on behalf of the platform, change what
everybody else may do, or read the audit log, it is not a good enough
answer — the second factor would rest on the same channel that resets the
first one.

Enforced in two places, because either alone is a gap:

- `src/proxy.ts` will not let an administrator into `/dashboard` unless
  their second factor is an app (`mfaUsesApp` on the session, refreshed
  from the database on every request);
- `account/emailOtpActions.ts` refuses to switch an administrator onto the
  emailed method in the first place.

An account promoted to administrator while using the emailed code is sent
to `/dashboard/mfa` to enrol an app, and can reach nothing else until it
does.

---

## The emailed code

Six digits is a million possibilities, which is only safe with all of
these together. Remove any one and it is brute-forceable:

- **Ten-minute life.**
- **Five guesses, then the code is destroyed** — not merely rejected.
  Leaving it alive would let somebody keep guessing for the rest of its
  ten minutes.
- **One live code per account.** Asking for another replaces the last one,
  so requesting more does not widen the target.
- **Sixty-second resend cooldown**, so the sign-in form cannot be used to
  flood somebody's inbox.

Stored as an **HMAC keyed by `AUTH_SECRET`**, never a plain hash: a
SHA-256 of a six-digit code is reversible by anybody holding the database
and a second of CPU time, because there are only a million preimages to
try. The key is what makes the stored value useless on its own.

**A code is only ever sent after the first factor has passed** — after the
password is verified in `checkMfaRequired()`, or after Google has
identified the person in the `signIn` callback. That ordering is what
stops the sign-in form being a way to post mail to any address on demand,
and it is tested (`tests/e2e/email-otp.spec.ts`).

The email carries no link and nothing to click. A sign-in code that
arrives with a button trains people to click buttons in emails claiming to
be about their account, which is the whole mechanism of the phishing this
factor is meant to resist.

---

## Remembering a device

Works for both methods. The signed cookie is bound to the account id, the
account's `sessionVersion`, and — for an app — a fingerprint of the
enrolled secret, so re-enrolling after a lost phone revokes every
remembered device at once.

An emailed code has no secret to fingerprint, so revocation there rests
entirely on `sessionVersion`. That is why `enableEmailOtp` and
`disableEmailOtp` both increment it, and why they must keep doing so.

---

## The operational dependency

**Email delivery becomes a sign-in dependency for anybody who turns this
on.** With `RESEND_API_KEY` unset, mail is written to
`.email-dev-outbox.log` rather than sent — fine for development, and fine
in CI, but on a live site it means somebody who enabled the emailed code
cannot get in.

Before anybody relies on it in production:

- set `RESEND_API_KEY` and verify the sending domain (SPF/DKIM), or codes
  land in spam and this becomes a support queue;
- keep the resend button in mind — it is the escape hatch for a delayed
  message, and it is rate limited, not disabled.

The authenticator app has no such dependency, which is one more reason it
is the method required of administrators.

---

## Testing

`tests/e2e/email-otp.spec.ts` proves the three things that matter:

1. a correct password alone does not get in once the method is on, and the
   code that does get in arrives by email;
2. no code is emailed to somebody who got the password wrong;
3. an administrator on the emailed method is sent to enrol an app and
   cannot reach the dashboard.

The rules around the code itself — single use, the five-guess cap, expiry,
the cooldown — are enforced in `lib/auth/emailOtp.ts` and were verified
directly against the database during development. They have no browser
surface to drive, so they are not in the e2e suite; a future unit test
would need a test database rather than the pure-function setup the current
`tests/unit` uses.
