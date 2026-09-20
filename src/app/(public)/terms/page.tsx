import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL, LEGAL_COMPLETE } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The agreement between you and this site when you read it or create an account.",
  alternates: { canonical: "/terms" },
};

function Missing({ what }: { what: string }) {
  return (
    <mark className="rounded bg-warn-soft px-1 font-mono text-[0.9em] text-warn" title={`Set ${what} in .env`}>
      [{what} not set]
    </mark>
  );
}

export default function TermsPage() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6">
      <p className="kicker">Legal</p>
      <h1 className="headline mt-2 text-4xl">Terms of use</h1>
      <p className="mt-3 text-sm text-ink-3">Version {LEGAL.policyVersion}</p>

      {!LEGAL_COMPLETE && (
        <p className="alert alert-warn mt-6">
          <strong>For the site owner:</strong> the highlighted fields come from <code className="font-mono text-xs">.env</code>{" "}
          (<code className="font-mono text-xs">LEGAL_ENTITY</code>, <code className="font-mono text-xs">LEGAL_ADDRESS</code>,{" "}
          <code className="font-mono text-xs">LEGAL_CONTACT_EMAIL</code>, <code className="font-mono text-xs">LEGAL_JURISDICTION</code>).
          Have a lawyer in your jurisdiction review this text before relying on it.
        </p>
      )}

      <div className="prose mt-8 max-w-none">
        <h2>Who we are</h2>
        <p>
          {LEGAL.siteName} is published by <strong>{LEGAL.entity ?? <Missing what="LEGAL_ENTITY" />}</strong>,{" "}
          {LEGAL.address ?? <Missing what="LEGAL_ADDRESS" />} (&ldquo;we&rdquo;). By reading the site you agree to
          these terms; by creating an account you agree to them and to the{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>

        <h2>Your account</h2>
        <ul>
          <li>You must be 16 or older to create an account.</li>
          <li>Keep your password to yourself. You are responsible for what happens under your account; tell us at once if you think someone else has used it.</li>
          <li>One account per person, under a name you are entitled to use. Staff accounts are issued by us and may be withdrawn.</li>
          <li>You can delete your account at any time from your account page.</li>
        </ul>

        <h2>Comments and what you post</h2>
        <p>
          You own what you write. By posting it here you give us a non-exclusive, royalty-free, worldwide licence to
          display it on the site alongside the article it responds to, for as long as it is posted. You can edit a
          comment for a short period after posting and delete it at any time.
        </p>
        <p>Do not post anything that:</p>
        <ul>
          <li>is unlawful, defamatory, threatening, harassing, or incites hatred or violence;</li>
          <li>infringes someone else&apos;s copyright, trademark or privacy;</li>
          <li>contains personal data about another person that they have not made public;</li>
          <li>is spam, advertising, or links to malware.</li>
        </ul>
        <p>
          Comments from new accounts are reviewed before they appear. We may hide or remove any comment, and suspend
          any account, that in our judgement breaks these rules, without notice. Readers can report comments; we
          look at every report.
        </p>

        <h2>Our content</h2>
        <p>
          Articles, images and everything else we publish are protected by copyright and belong to us or our
          licensors. You may read, share links to, and quote short extracts of our articles with attribution. You
          may not republish, scrape, or systematically copy our content without written permission.
        </p>

        <h2>Accuracy and liability</h2>
        <p>
          We try to get things right and correct errors promptly; corrections are noted on the article. Nothing on
          the site is professional advice. To the fullest extent the law allows, we exclude liability for loss
          arising from your use of the site or reliance on its content. Nothing in these terms limits liability
          that cannot be limited by law.
        </p>

        <h2>Availability</h2>
        <p>
          We may change, suspend or withdraw any part of the site at any time. We do not promise the site will be
          available without interruption.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          If we change these terms materially we will tell registered users by email or a notice on the site before
          the change applies. Continuing to use the site after that is acceptance of the new terms.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the law of {LEGAL.jurisdiction ?? <Missing what="LEGAL_JURISDICTION" />}, and its
          courts have jurisdiction, without prejudice to any mandatory consumer protection you have where you live.
        </p>

        <h2>Contact</h2>
        <p>
          {LEGAL.contactEmail ? <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> : <Missing what="LEGAL_CONTACT_EMAIL" />}
        </p>
      </div>
    </main>
  );
}
