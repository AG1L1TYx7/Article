# Privacy compliance (GDPR, UK GDPR, CCPA/CPRA)

What this application does to meet data-protection law, what the code
guarantees, and — stated plainly — what only the publisher can do.
Written so it can double as the record of processing activities that
GDPR Art. 30 asks a controller to keep.

## Before going live: the owner's checklist

Everything below the line is built. These four things are not, because
they are facts about you, not about the software:

1. **Set the legal identity** in `.env`: `LEGAL_ENTITY`, `LEGAL_ADDRESS`,
   `LEGAL_CONTACT_EMAIL`, `LEGAL_JURISDICTION` (and `LEGAL_DPO_EMAIL` if
   you have appointed one). `/privacy` and `/terms` print these and show
   a yellow warning until they are set.
2. **Have a lawyer in your jurisdiction read `/privacy` and `/terms`.**
   They are accurate to the code, but a template is not legal advice.
3. **Sign data-processing agreements** with any processor you enable:
   Resend (email), your S3-compatible storage, Upstash (rate limiting),
   Cloudflare (Turnstile). Each publishes a standard DPA; you accept it in
   their dashboard. The privacy policy lists whichever are configured,
   automatically.
4. **Decide who handles requests** sent to `LEGAL_CONTACT_EMAIL` and make
   sure they are answered within a month (GDPR) / 45 days (CCPA). Most
   requests need no handling — the account page does them — but the
   address must be read.

If you are in the EU/UK and processing at scale, also consider whether a
DPO or an EU representative is required; that depends on your size and
activity, not on this software.

---

## Data inventory (Art. 30 record)

| Data | Where | Purpose | Lawful basis | Retention |
| --- | --- | --- | --- | --- |
| Name, handle, email | `User` | Account; byline on comments | Contract | Until deletion |
| Password | `User.passwordHash` (Argon2id) | Authentication | Contract | Until deletion |
| Email verified at; terms accepted at | `User` | Proof the address is theirs; proof of consent (Art. 7) | Legal obligation / legitimate interest | Until deletion |
| Connected sign-in providers (`provider`, the account id Google issues for you, the OAuth tokens, connected-at) | `Account` | Letting you sign in with Google instead of a password | Contract | Until you disconnect it or delete the account |
| Sign-in code (HMAC of a six-digit code, expiry, guess count) | `EmailOtp` | The emailed second factor, for accounts that chose it | Consent (the switch); withdrawn by turning it off, which deletes the row | 10 minutes; expired rows swept by the retention pass |
| Reported issues (title, description, district, ward, photographs, and the reporter's account) | `Issue`, `IssueMedia` | The platform's core purpose: raising and verifying issues | Contract; published under legitimate interest (public-interest reporting) | A report that could not be verified is deleted after 90 days (`REJECTED_ISSUE_RETENTION_DAYS`); a published report is kept as a record, and everything goes when the account is deleted |
| Home district | `User.districtId` | Telling a member when a verified report concerns where they live | Consent (they choose to set it; blank by default) | Until cleared or the account is deleted |
| Contributions (amount, reference, donor name and email where given, message, bank reference) | `Contribution` | Collecting membership and donations, and accounting for them | Contract; kept under legal obligation (an organisation must account for money it receives) | Kept as a financial record. Deleting an account unlinks the row rather than removing it; an anonymous contribution stores no name at all |
| MFA secret | `User.mfaSecret` (AES-256-GCM, keyed by `AUTH_SECRET`) | Second factor | Consent | Until disabled or deletion |
| Last sign-in time and IP | `User.lastLoginAt/Ip` | "When did I last sign in, and from where" | Legitimate interest (security) | IP cleared after 90 days |
| Comments, likes, saves, follows (writers and sections), reports | own tables | The features themselves; the "Following" feed is a time-ordered list of the reader's own choices, not profiling | Contract | Until deletion |
| Security audit log (action, actor, IP, time) | `AuditLog` | Detecting and investigating abuse | Legitimate interest (security) | 365 days (`AUDIT_RETENTION_DAYS`) |
| Notifications | `Notification` | In-app alerts | Contract | 180 days |
| Push subscription (endpoint URL issued by the browser's push service, two encryption keys, optional userId) | `PushSubscription` | Breaking-news and reply alerts the reader turned on | Consent (the toggle); withdrawn by turning it off, which deletes the row | Until turned off or account deleted; rows the push service keeps rejecting purged after 30 days |
| Rate-limit counters | memory or Upstash | Abuse prevention | Legitimate interest | Minutes |
| Interface language (`locale` cookie, two letters) | browser cookie | Remembering a language chosen from the switcher; strictly necessary, so no consent banner | Legitimate interest | 1 year |
| Verification / reset tokens | `VerificationToken` | One-time links | Contract | 1 hour; rows purged daily |
| Article view counts | `Article.viewCount`, `ArticleViewDaily` | Editorial analytics | Not personal data (no identifier) | Indefinite |
| Views by country code / referrer class / device class, per article per day | `ViewDimensionDaily` | Editorial analytics (where readers are, how they arrive) | Not personal data: coarse buckets and counts; the IP and user agent are classified in memory and discarded. Country comes from a CDN/host header (`CF-IPCountry` etc.), never from a lookup we store | Indefinite |
| Reading time and scroll depth, summed per article per day | `ArticleReadDaily` | Editorial analytics (do people finish?) | Not personal data: the beacon carries the article id and two numbers, no identifier or cookie | Indefinite |
| Uploaded images/video | storage; `Media` | Publishing | Contract (staff) | Until removed by staff |

Retention is enforced by `lib/retention.ts`, which runs after public
responses at most once an hour, using the periods declared in
`lib/legal.ts` — the same constants the privacy policy prints, so the
two cannot drift apart.

## Rights, and how each is served

| Right | GDPR | CCPA | How |
| --- | --- | --- | --- |
| Information | Art. 13/14 | §1798.100 | `/privacy`, generated from the code and the environment |
| Access, portability | Art. 15, 20 | §1798.110 | Account page → **Download your data** (`/account/data`, JSON, every table with a `userId`; see `lib/personalData.ts`) |
| Rectification | Art. 16 | §1798.106 | Account page → edit name; change password; email verification |
| Erasure | Art. 17 | §1798.105 | Account page → **Delete your account**, password-confirmed (`lib/accountDeletion.ts`) |
| Restriction / objection | Art. 18, 21 | — | By email to the contact address; the site does no profiling, so there is little to object to |
| Withdraw consent | Art. 7(3) | — | Disable two-factor from the account page; delete the account |
| Opt out of sale/sharing | — | §1798.120 | Nothing is sold or shared; stated on `/privacy#california`, linked from every footer as "Your privacy choices" |
| Non-discrimination | — | §1798.125 | No feature depends on any of the above |
| Complaint | Art. 77 | — | Named in the policy |

### What deletion actually does

The `User` row is anonymised, not removed, because comments, reactions
and audit entries reference it. Every personal field is blanked (name,
email, handle, password, MFA secret, IPs, timestamps of consent and
verification), the status is set so it can never sign in, and the
session version is bumped so any open session dies. Bookmarks, follows,
likes, reports and notifications are deleted. Comments are deleted,
except that a comment with someone else's reply beneath it becomes an
anonymous tombstone so the reply stays readable — the same rule the
reader's own "delete comment" uses. Audit rows keep their foreign key
but no longer join to a name; they expire with the retention purge.

Accounts that have written articles cannot self-delete: the articles are
the publisher's, kept under legitimate interest, and need a byline. An
admin reassigns them, then the account can go.

## Consent

- Registration requires ticking "I am 16 or older and I agree to the
  terms and privacy policy". The server refuses the account without it
  and stores `termsAcceptedAt`. The age of 16 is the GDPR default (Art. 8)
  and above COPPA's 13.
- **Signing up with Google requires the same tick, before leaving this
  site.** The account is created on the way back from Google, in a
  different request from the one that showed the checkbox, so the box
  alone would demonstrate nothing. Pressing "Sign up with Google" mints a
  signed token recording the policy version and the moment agreed, and
  `signIn` refuses to create an account without it — somebody arriving
  from Google with no such record is sent to the registration page to
  agree first. If the policy version changed while they were at Google,
  the token is refused and they are asked again. See
  `lib/auth/oauthFlow.ts`.
- Connecting or disconnecting Google on an existing account is an
  explicit action on the account page, is written to the audit log, and —
  when a connection is made by matching a verified address rather than by
  pressing that button — is emailed to the account holder.
- Two-factor authentication and "remember this device" are opt-in.
- Marketing consent does not exist because there is no marketing.

## Cookies and tracking

Only strictly necessary cookies (session, CSRF, optional MFA trust, and —
only while a Google sign-in is actually in progress — the short-lived
consent and connect-intent cookies described in `lib/auth/oauthFlow.ts`),
so no consent banner is required under the ePrivacy Directive/PECR. No
analytics service, no advertising, no third-party scripts except
Cloudflare Turnstile when enabled (which the policy discloses). Google
sign-in adds no script and no request to Google from any page: the button
is inline SVG, the profile picture is copied here once and served from
this origin, and the only contact with Google happens when somebody
presses the button themselves. Global Privacy Control needs no handling
because nothing is sold or shared.

## Security measures (Art. 32)

Argon2id password hashing; breached-password check via k-anonymity
(HIBP); TOTP two-factor, mandatory for admins; encryption at rest of MFA
secrets; login lockout and per-IP rate limiting; strict CSP with
per-request nonces, HSTS, frame denial; RBAC checked in the proxy, the
page and the server action; append-only audit log; uploads re-encoded
and (where ClamAV is present) scanned. `docs/security-testing.md` has
the tests.

## Breach procedure

1. Contain: rotate `AUTH_SECRET` if credentials or MFA secrets may be
   exposed (this signs everyone out and invalidates trusted devices);
   suspend affected accounts from People.
2. Assess: the audit log gives who, when and from where.
3. Notify: the supervisory authority within 72 hours where the breach is
   likely to risk people's rights (Art. 33); the people themselves
   without undue delay where the risk is high (Art. 34). The policy
   promises this.
4. Record: what happened, effects, remedy — kept even if no notification
   was required.

## What is deliberately not done

- No cookie banner: nothing to consent to.
- No "download all users" for admins: an admin can see people on the
  People page, which is enough to answer a request, and a bulk export is
  a breach waiting to happen.
- No IP logging beyond security events and the last sign-in.
- No deletion of audit rows on account deletion: the log is the record
  that protects everyone else; it is pseudonymised and time-limited
  instead.
