import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import {
  currentMembership,
  getSupportSettings,
  listActiveTiers,
  publicSupporters,
} from "@/lib/contributions";
import { isPayable } from "@/lib/supportSettings";
import { formatAmount } from "@/lib/money";
import { getI18n } from "@/i18n/server";
import { SupportForm } from "./SupportForm";

export const metadata: Metadata = {
  title: "Support this work",
  description: "Become a member or make a one-off contribution.",
};

/**
 * Where somebody gives.
 *
 * Returns a 404 when contributions are switched off or the bank details
 * are incomplete, rather than rendering a page that asks for money and
 * cannot say where to send it. A half-configured donation page is how
 * somebody transfers to nowhere.
 */
export default async function SupportPage() {
  const settings = await getSupportSettings();
  if (!isPayable(settings)) notFound();

  const session = await auth();
  const { formatDate } = await getI18n();

  const [tiers, supporters, membership] = await Promise.all([
    listActiveTiers(),
    settings.showSupporters ? publicSupporters(60) : Promise.resolve([]),
    session?.user?.id ? currentMembership(session.user.id) : Promise.resolve(null),
  ]);

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6">
      <p className="kicker">Support this work</p>
      <h1 className="headline mt-2 text-4xl">
        {settings.organisationName || "Back the people doing this"}
      </h1>
      <p className="mt-3 text-ink-2">
        This platform is run by people who care about the country, not by advertisers. Membership
        and one-off contributions are what pay for it.
      </p>

      {membership && (
        <p className="alert alert-ok mt-6" role="status">
          You are a member{membership.tier ? ` (${membership.tier.name})` : ""} until{" "}
          {formatDate(membership.periodEnd!)}. Thank you.
        </p>
      )}

      {/* What membership does and does not buy, said before anybody pays.
          Nothing on this platform is behind a payment, and somebody giving
          money is entitled to know that is deliberate rather than
          unfinished. */}
      <div className="card mt-8 p-5">
        <h2 className="text-sm font-medium">What membership gets you</h2>
        <p className="mt-2 text-sm text-ink-2">
          Recognition, and the knowledge that this keeps running. It buys no extra access —
          everything on this site is open to everybody, including the people least able to pay,
          who are often the ones with most to report. That is the point, and it is not going to
          change.
        </p>
      </div>

      <SupportForm
        tiers={tiers.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          amount: formatAmount(t.amountPaisa, t.currency as "NPR" | "USD"),
          intervalMonths: t.intervalMonths,
        }))}
        settings={{
          bankName: settings.bankName,
          accountName: settings.accountName,
          accountNumber: settings.accountNumber,
          branch: settings.branch,
          walletName: settings.walletName,
          walletId: settings.walletId,
          instructions: settings.instructions,
        }}
        signedInName={session?.user?.name ?? ""}
        signedInEmail={session?.user?.email ?? ""}
      />

      {settings.showSupporters && supporters.length > 0 && (
        <section className="mt-12 border-t border-line pt-8" aria-labelledby="supporters">
          <h2 id="supporters" className="section-title">
            People who support this
          </h2>
          {/* Names only, never amounts. A public ranking of who gave how
              much says more about people's means than they agreed to. */}
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink-2">
            {supporters.map((s) => (
              <li key={s.id}>{s.donorName}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
