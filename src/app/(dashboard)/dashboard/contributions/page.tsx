import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { sessionHas } from "@/lib/auth/rbac";
import { confirmedTotals, listContributions } from "@/lib/contributions";
import { formatAmount } from "@/lib/money";
import { PageBody, PageHeader } from "../../PageHeader";
import { ContributionRow } from "./ContributionRow";

export const metadata: Metadata = { title: "Contributions", robots: { index: false, follow: false } };

/**
 * The treasurer's page.
 *
 * Gated on `contribution.view`; the buttons that move money additionally
 * need `contribution.confirm`, so a bookkeeper can be given sight of the
 * ledger without the ability to change it.
 *
 * Shows names, amounts and email addresses — a donor list is a list of who
 * funds this work, which in some districts is a sensitive thing to be on.
 * The page says so, for the same reason the issue queue does.
 */
export default async function ContributionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/dashboard/contributions");
  if (!sessionHas(session, "contribution.view")) redirect("/dashboard");

  const canConfirm = sessionHas(session, "contribution.confirm");
  const [rows, totals] = await Promise.all([listContributions(), confirmedTotals()]);

  const pending = rows.filter((r) => r.status === "PENDING");
  const settled = rows.filter((r) => r.status !== "PENDING");

  return (
    <main id="main-content">
      <PageHeader
        kicker="Support"
        title="Contributions"
        description="Pledges people have made, and what has actually arrived. Nothing counts as received until somebody here confirms it against the bank."
      />
      <PageBody>
        <div className="card mb-6 p-5">
          <p className="text-xs uppercase tracking-wide text-ink-3">Received and confirmed</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {formatAmount(totals.totalPaisa)}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            across {totals.count} {totals.count === 1 ? "contribution" : "contributions"}. Pledges
            that have not arrived are not counted.
          </p>
        </div>

        <p className="mb-6 rounded-md border border-rule bg-surface-2 p-4 text-sm text-ink-2">
          This page lists who has given and how much. That is a list of the people who fund this
          work — treat it the way you would treat the reporters&rsquo; names in the issue queue.
        </p>

        <section className="mb-8">
          <h2 className="section-title">
            Waiting for the money <span className="text-ink-3">({pending.length})</span>
          </h2>
          {pending.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">Nothing outstanding.</p>
          ) : (
            <div className="mt-3 grid gap-3">
              {pending.map((c) => (
                <ContributionRow key={c.id} contribution={serialise(c)} canConfirm={canConfirm} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="section-title">
            Settled <span className="text-ink-3">({settled.length})</span>
          </h2>
          {settled.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">Nothing yet.</p>
          ) : (
            <div className="mt-3 grid gap-3">
              {settled.map((c) => (
                <ContributionRow key={c.id} contribution={serialise(c)} canConfirm={canConfirm} />
              ))}
            </div>
          )}
        </section>
      </PageBody>
    </main>
  );
}

/** Amounts formatted on the server, so the client never divides money. */
function serialise(c: Awaited<ReturnType<typeof listContributions>>[number]) {
  return {
    id: c.id,
    reference: c.reference,
    kind: c.kind,
    status: c.status,
    amount: formatAmount(c.amountPaisa, c.currency as "NPR" | "USD"),
    donorName: c.anonymous ? null : (c.donorName ?? c.user?.name ?? null),
    donorEmail: c.anonymous ? null : (c.donorEmail ?? c.user?.email ?? null),
    anonymous: c.anonymous,
    message: c.message,
    staffNote: c.staffNote,
    providerRef: c.providerRef,
    tierName: c.tier?.name ?? null,
    confirmedByName: c.confirmedBy?.name ?? null,
    createdAt: c.createdAt.toISOString(),
    confirmedAt: c.confirmedAt?.toISOString() ?? null,
    periodEnd: c.periodEnd?.toISOString() ?? null,
  };
}
