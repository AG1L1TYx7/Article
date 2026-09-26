# Sign in with Google

Optional. With `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` unset, the
buttons do not render, no Google code runs, and the site behaves exactly as
it did before — email and password only.

This page is the reasoning. The rules it describes are enforced in
`src/lib/auth/accountLinking.ts`, `src/lib/auth/config.ts` and
`src/lib/auth/oauthFlow.ts`, each of which carries the same explanation
next to the code.

---

## Setting it up

1. **Google Cloud Console** → APIs & Services → Credentials → Create
   credentials → **OAuth client ID** → Web application.
2. **Authorised redirect URIs** — the full callback path, not the origin.
   This is the single most common mistake, and it fails with
   `redirect_uri_mismatch`:

   ```
   http://localhost:3000/api/auth/callback/google
   https://your-domain.example/api/auth/callback/google
   ```

   One line per environment you sign in from. `http://localhost:3000` on
   its own is **not** enough.
3. **OAuth consent screen** — needs your privacy policy and terms URLs;
   this site serves them at `/privacy` and `/terms`. While the app is in
   *Testing*, only accounts listed as test users can sign in. Moving to
   *In production* with only the `openid email profile` scopes needs no
   security review, because none of those are restricted scopes.
4. Put the id and secret in `.env`. Never commit them; `.env*` is
   gitignored.

Scopes are `openid email profile` and nothing else. No Drive, no Gmail, no
contacts — a smaller consent screen, and less data anyone could later
accuse this site of holding.

---

## What happens when somebody presses the button

### A new person

The account is created on the way back from Google, which is a *different
request* from the one that showed the terms checkbox. A ticked box in a
form that then redirects elsewhere demonstrates nothing, and GDPR Art. 7(1)
asks the controller to be able to demonstrate consent.

So pressing "Sign up with Google" mints a signed token — policy version and
the moment agreed — in an HttpOnly cookie, and `signIn` refuses to create
an account without it. Somebody who arrives from Google with no such record
is sent back to `/register` to agree first. If the policy version changed
while they were at Google, the token is refused and they are asked again.

A handle is derived from their name (`lib/auth/handleStem.ts`) because
Google does not supply one and `User.handle` is required, unique and
public. It is derived from the *name*, never the email address: turning
`j.smith@company.com` into `@jsmith` publishes a likely work address, which
is not what pressing a button agreed to.

### Somebody this site already knows

This is the interesting case, and the one with a real attack behind it.

Auth.js offers a single switch, `allowDangerousEmailAccountLinking`, and
its name is honest. Turning it on links any Google identity to any local
account sharing an address, with no further test. That enables the
**pre-hijack attack** (Sudhodanan and Paverd, 2022):

> An attacker registers here with *your* address and a password only they
> know. They never open the verification email — they cannot, it went to
> you. The account sits dormant. Later you press "Continue with Google",
> the addresses match, and you are dropped into the attacker's account.
> You use it for months. They still have the password.

So the switch stays off and the linking is conditional. Both sides must
have proved the address:

| | Required |
| --- | --- |
| Google | `email_verified: true` in the ID token. Not universal — some Workspace identities are aliases the domain admin created. |
| This site | `emailVerifiedAt` already set, which only happens when somebody opened a link sent to that address. |

If either is missing the sign-in is **refused with an explanation**, not
linked. The person can still get in — with their password, or by verifying
the address from the email already sent them — and either route proves what
the automatic link could not.

A successful link is written to the audit log **in the same transaction**
as the link itself (a link with no record beside it is the state nobody
could later explain) and emailed to the account holder, because a silent
merge of two identities is exactly the event somebody wants to hear about
while they can still object.

### Somebody whose account has two-factor authentication

Google saying who you are is not the second factor, and for admins the
second factor is mandatory (`src/proxy.ts`). If "Sign in with Google" had
skipped it, it would have been a way around it.

So the Google leg deliberately ends **without a session**. It redirects to
`/login/mfa` carrying a signed token that names the account and nothing
else — useless without a current six-digit code. The `mfa-continue`
provider re-checks every condition at the moment it would issue the session
(still active, `sessionVersion` unmoved, MFA still on) and only then mints
one. A device already remembered for two-factor skips the step, exactly as
it does on the password path.

The token lives five minutes. It cannot leak to a third party: the site
sends `Referrer-Policy: strict-origin-when-cross-origin`, so any
cross-origin request from that page carries the origin alone, never the
path or its query.

---

## Connecting and disconnecting later

The account page has a **Connected accounts** section.

**Connect** is a different act from signing in, and is told apart from one
by its own signed cookie. Signing in matches on the email address;
connecting does not, because somebody may well want to attach a Google
account whose address is not the one they registered with — and they are
already signed in, so there is nothing left to prove about who they are. A
Google identity already connected to a *different* account is refused.

**Disconnect** is refused when it would leave no way back in. Somebody who
signed up with Google has no password, so removing the only sign-in method
would lock them out of an account they can still see. They are told to set
a password first.

Disconnecting here does **not** revoke this site's access at Google. That
is the person's to do, at their own Google account page, and saying so is
more honest than implying otherwise.

---

## The profile picture

Copied here once, at sign-in, and served from this origin afterwards.

Storing Google's URL and rendering it would be two lines. It would also
mean that every time anybody loads a page showing that avatar — a comment
thread, an author page — their browser requests it from Google, carrying
their IP address and the page they are on. That is a transfer of the
*reader's* data to a third party, about readers who never signed in and
never agreed to anything. It would need disclosing in the privacy policy,
defending under Art. 6, and a wider `img-src` in the CSP.

Instead `lib/auth/avatar.ts` fetches it once — pinned to Google's own
hosts, with a timeout, a size cap and redirects refused — and puts it
through the same pipeline as any upload: sharp re-encodes to WebP, which
strips the EXIF the original may carry. Only for an account that has no
picture yet, so a second sign-in never overwrites one somebody chose here.
Failure is silent: an avatar is decoration, and nothing about a sign-in
should depend on it.

---

## What this adds to the privacy record

- `docs/compliance.md` gains an Art. 30 inventory row for the `Account`
  table, and the consent section explains the token above.
- `/privacy` lists Google automatically, through `activeProcessors()` in
  `lib/legal.ts` — it appears only when the feature is configured.
- The data export (`/account/data`) includes which providers are connected
  and since when. Deliberately **not** the OAuth tokens beside them: an
  access or id token is a live credential for someone else's system, and
  handing one to whoever downloads that file would be creating a risk, not
  serving a right. Same reasoning as the password hash and the MFA secret.
- Deleting an account already removed its `Account` rows
  (`lib/accountDeletion.ts`); that needed no change.

No script from Google runs on any page. The button mark is inline SVG. The
only contact with Google happens when somebody presses the button.

---

## Testing

Unit tests cover the parts that can be tested without a browser or a
Google account, which is where the security properties live:

- `tests/unit/handleStem.test.ts` — the public handle derived from a name:
  accents folded rather than dropped, scripts with no ASCII form falling
  back, length capped, and never a character a handle may not contain.
- `tests/unit/oauthFlow.test.ts` — the signed tokens: tampering refused,
  a different secret refused, expiry enforced at five minutes and thirty,
  and the three token types not interchangeable with each other.

The account-linking decision is deliberately a pure function of what the
database holds (`decideLinking`), so it can be exercised directly against a
test database without standing up an OAuth flow.

There is no end-to-end test that signs in through Google, because that
would mean automating a real Google account and its consent screen — a
brittle test that fails for reasons having nothing to do with this code.
What the e2e suite does guarantee is that the password path, mandatory
admin MFA and the trusted-device flow all still behave as before.
