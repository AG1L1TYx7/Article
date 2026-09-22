import type { Metadata } from "next";
import { LegalLanguageNotice } from "@/components/LegalLanguageNotice";
import Link from "next/link";
import { activeProcessors, LEGAL, LEGAL_COMPLETE, RETENTION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What personal data this site collects, why, for how long, and your rights over it.",
  alternates: { canonical: "/privacy" },
};

function Missing({ what }: { what: string }) {
  return (
    <mark className="rounded bg-warn-soft px-1 font-mono text-[0.9em] text-warn" title={`Set ${what} in .env`}>
      [{what} not set]
    </mark>
  );
}

/**
 * Written to be true of THIS codebase — every sentence about what is
 * collected, kept and shared is derived from what the code actually does
 * (see docs/compliance.md for the mapping). The parts only the publisher
 * can supply — who they are, where, how to reach them — come from the
 * environment and are marked in yellow until they are.
 */
export default function PrivacyPage() {
  const processors = activeProcessors();

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6">
      <p className="kicker">Legal</p>
      <h1 className="headline mt-2 text-4xl">Privacy policy</h1>
      <p className="mt-3 text-sm text-ink-3">Version {LEGAL.policyVersion}</p>
      <LegalLanguageNotice />

      {!LEGAL_COMPLETE && (
        <p className="alert alert-warn mt-6">
          <strong>For the site owner:</strong> the highlighted fields below come from{" "}
          <code className="font-mono text-xs">LEGAL_ENTITY</code>, <code className="font-mono text-xs">LEGAL_ADDRESS</code>,{" "}
          <code className="font-mono text-xs">LEGAL_CONTACT_EMAIL</code> and{" "}
          <code className="font-mono text-xs">LEGAL_JURISDICTION</code> in <code className="font-mono text-xs">.env</code>.
          This policy is not complete until they are set.
        </p>
      )}

      <div className="prose mt-8 max-w-none">
        <h2>Who is responsible</h2>
        <p>
          {LEGAL.siteName} is published by <strong>{LEGAL.entity ?? <Missing what="LEGAL_ENTITY" />}</strong>,{" "}
          {LEGAL.address ?? <Missing what="LEGAL_ADDRESS" />}. We are the &ldquo;controller&rdquo; of the personal data
          described here. For anything about your data, write to{" "}
          {LEGAL.contactEmail ? <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> : <Missing what="LEGAL_CONTACT_EMAIL" />}
          {LEGAL.dpoEmail && (
            <>
              {" "}
              or our Data Protection Officer at <a href={`mailto:${LEGAL.dpoEmail}`}>{LEGAL.dpoEmail}</a>
            </>
          )}
          .
        </p>

        <h2>What we collect, and why</h2>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>When</th>
              <th>Why</th>
              <th>Legal basis</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Name, handle, email address, password (stored only as a one-way hash)</td>
              <td>You register</td>
              <td>To run your account, show your name on comments, and reach you about your account</td>
              <td>Performance of a contract (the terms of use)</td>
            </tr>
            <tr>
              <td>Whether and when your email was verified; when you accepted the terms</td>
              <td>You register or verify</td>
              <td>To know the address is yours; to record your consent</td>
              <td>Legal obligation (Art. 7 GDPR); legitimate interest</td>
            </tr>
            <tr>
              <td>Comments, likes, saved articles, writers and sections you follow</td>
              <td>You use those features</td>
              <td>To provide them — they are the feature</td>
              <td>Performance of a contract</td>
            </tr>
            <tr>
              <td>
                A push subscription: the address your browser&apos;s push service issued for this device, and
                two encryption keys. Linked to your account only if you were signed in when you turned alerts on.
              </td>
              <td>You turn on &ldquo;breaking news alerts&rdquo;</td>
              <td>To deliver those alerts</td>
              <td>Consent — withdrawn by turning them off, which deletes the record</td>
            </tr>
            <tr>
              <td>Sign-in events: time, IP address, success or failure, and account changes (a security audit log)</td>
              <td>You sign in, or a staff member changes something</td>
              <td>Detecting break-in attempts and account abuse; investigating incidents</td>
              <td>Legitimate interest in the security of the service</td>
            </tr>
            <tr>
              <td>Two-factor authentication secret (encrypted) and recovery codes (stored only as keyed hashes)</td>
              <td>You enable two-factor authentication</td>
              <td>To verify your codes, and to let you back in if you lose your authenticator</td>
              <td>Consent; security</td>
            </tr>
            <tr>
              <td>IP address, briefly</td>
              <td>Every request</td>
              <td>Rate limiting, so one person cannot flood the site or guess passwords</td>
              <td>Legitimate interest in the security of the service</td>
            </tr>
            <tr>
              <td>
                Article readership statistics: a view count per article per day, split by country (a two-letter
                code your network provider or our CDN reports — the IP address itself is never stored), by how you
                arrived (search, social, direct, or the referring site&apos;s domain — never the page), and by device
                class (phone, tablet, desktop); and how long the article was on screen and how far it was scrolled
              </td>
              <td>You read an article</td>
              <td>Editorial analytics — which stories are read, where, and whether people finish them</td>
              <td>Not personal data: every figure is a total for the article and day, with no identifier, cookie or IP attached</td>
            </tr>
          </tbody>
        </table>
        <p>
          We do not collect anything else. There is no advertising, no tracking pixel, no analytics service, and
          no profiling. We never sell personal data and never have.
        </p>

        <h2>Cookies</h2>
        <p>
          This site sets only cookies that are strictly necessary to make it work, which is why there is no cookie
          banner: they need no consent under the ePrivacy rules, and there is nothing to opt out of.
        </p>
        <table>
          <thead>
            <tr>
              <th>Cookie</th>
              <th>Purpose</th>
              <th>Lasts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>authjs.session-token</code>
              </td>
              <td>Keeps you signed in</td>
              <td>Session, up to 30 days</td>
            </tr>
            <tr>
              <td>
                <code>authjs.csrf-token</code>, <code>authjs.callback-url</code>
              </td>
              <td>Protects sign-in forms from forgery</td>
              <td>Session</td>
            </tr>
            <tr>
              <td>
                <code>locale</code>
              </td>
              <td>Only if you choose a language from the switcher: remembers it. Holds a two-letter code and nothing else.</td>
              <td>1 year</td>
            </tr>
            <tr>
              <td>
                <code>mfa_trust</code>
              </td>
              <td>Only if you tick &ldquo;don&apos;t ask for a code on this device&rdquo;: remembers that this browser passed
                two-factor authentication</td>
              <td>30 days</td>
            </tr>
          </tbody>
        </table>
        <p>Your browser&apos;s own storage may remember a tab or a filter you chose; that never leaves your device.</p>

        <h2>Who else sees it</h2>
        {processors.length > 0 ? (
          <>
            <p>These services process data on our behalf, under contracts that bind them to this policy:</p>
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>What for</th>
                  <th>What they receive</th>
                  <th>Where</th>
                </tr>
              </thead>
              <tbody>
                {processors.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.purpose}</td>
                    <td>{p.data}</td>
                    <td>{p.region}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p>No third-party service currently processes personal data for this site.</p>
        )}
        <p>
          Beyond those: nobody, unless the law requires it (a court order, for instance), in which case we will tell
          you unless we are legally forbidden to.
        </p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Your account and content: until you delete your account (see below).</li>
          <li>Security audit log: {RETENTION.auditLogDays} days, then deleted automatically.</li>
          <li>Notifications: {RETENTION.notificationDays} days.</li>
          <li>
            Push alert subscriptions: until you turn alerts off or delete your account; a device the push
            service keeps rejecting is dropped after {RETENTION.pushFailedDays} days.
          </li>
          <li>Last sign-in IP address: cleared after {RETENTION.lastLoginIpDays} days without a sign-in.</li>
          <li>Rate-limit counters: minutes.</li>
          <li>Email verification and password-reset links: one hour, single use.</li>
        </ul>

        <h2>Your rights</h2>
        <p>
          Wherever you are, you can do all of the following yourself from{" "}
          <Link href="/account">your account page</Link>, without asking us:
        </p>
        <ul>
          <li>
            <strong>See and take your data</strong> (access and portability): download everything we hold about you
            as a JSON file.
          </li>
          <li>
            <strong>Correct it</strong> (rectification): change your name; change your password.
          </li>
          <li>
            <strong>Delete it</strong> (erasure, &ldquo;right to be forgotten&rdquo;): delete your account. Your name,
            email, password and settings are erased immediately. Your comments are removed from the site; where a
            reply from someone else hangs off one, an anonymous placeholder keeps their reply readable. The security
            audit log keeps its entries for the retention period above, without your name or email.
          </li>
        </ul>
        <p>
          You also have the right to object to processing based on our legitimate interests, to restrict it, and to
          withdraw consent where consent is the basis (for example by turning off two-factor authentication). To
          exercise any of these, or if something on the account page does not work for you, email{" "}
          {LEGAL.contactEmail ? <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> : <Missing what="LEGAL_CONTACT_EMAIL" />}
          . We answer within one month.
        </p>
        <p>
          If you are in the EU or UK and believe we have handled your data unlawfully, you can complain to your
          national data protection authority.
        </p>

        <h2 id="california">California residents — your privacy choices</h2>
        <p>
          Under the CCPA/CPRA you have the right to know what we collect (the table above), to delete it (your
          account page), to correct it, and to opt out of the sale or sharing of your personal information.{" "}
          <strong>We do not sell or share personal information</strong>, as those terms are defined in the CCPA, and
          we do not use it for cross-context behavioural advertising, so there is nothing to opt out of. We honour
          Global Privacy Control signals as a matter of course. We will never treat you differently for exercising
          these rights.
        </p>

        <h2>Children</h2>
        <p>
          The site is not directed at children. Registration requires you to confirm you are 16 or older. If you
          believe a child has created an account, tell us and we will delete it.
        </p>

        <h2>Security</h2>
        <p>
          Passwords are hashed with Argon2id; two-factor secrets are encrypted at rest; every page is served over
          HTTPS with a strict content security policy; staff accounts with full access must use two-factor
          authentication. If a breach ever affects your data, we will tell you and the relevant authority within 72
          hours of learning of it.
        </p>

        <h2>Changes</h2>
        <p>
          When this policy changes materially, the version at the top changes and registered users are told by
          email or a notice on the site before the change takes effect.
        </p>
      </div>
    </main>
  );
}
