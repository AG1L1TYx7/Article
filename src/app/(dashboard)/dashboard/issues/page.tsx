import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { sessionHas } from "@/lib/auth/rbac";
import { listQueue } from "@/lib/issues";
import { PageBody, PageHeader } from "../../PageHeader";
import { QueueRow } from "./QueueRow";

export const metadata: Metadata = { title: "Reported issues", robots: { index: false, follow: false } };

/**
 * The verifier's queue.
 *
 * Gated on `issue.verify`, not on a role or a tier — the whole point of
 * editable roles is that a newsroom can create "issue verifier" without
 * handing somebody the rest of the dashboard.
 *
 * This page shows the reporter's name and email, including for reports
 * filed anonymously. That is the permission's real meaning and it is
 * stated on the page, so nobody discovers it by accident: whoever holds
 * `issue.verify` can see who filed every report.
 */
export default async function IssueQueuePage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/dashboard/issues");
  if (!sessionHas(session, "issue.verify")) redirect("/dashboard");

  const queue = await listQueue();
  const canPublish = sessionHas(session, "issue.publish");
  const canResolve = sessionHas(session, "issue.resolve");

  const waiting = queue.filter((i) => i.status === "SUBMITTED");
  const mine = queue.filter((i) => i.status === "UNDER_REVIEW");
  const ready = queue.filter((i) => i.status === "VERIFIED");

  return (
    <main id="main-content">
      <PageHeader
        kicker="Community"
        title="Reported issues"
        description="Reports raised by members, waiting to be checked. Nothing here is public. Publishing one alerts everybody in that district, so it cannot be undone — check it first."
      />
      <PageBody>
        <p className="mb-6 rounded-md border border-rule bg-surface-2 p-4 text-sm text-ink-2">
          You can see who filed every report on this page, including the ones marked anonymous.
          That is what this permission means. Their name must not leave this page.
        </p>

        <Section title="Waiting to be checked" count={waiting.length} empty="Nothing waiting.">
          {waiting.map((issue) => (
            <QueueRow key={issue.id} issue={issue} canPublish={canPublish} canResolve={canResolve} />
          ))}
        </Section>

        <Section title="Being checked" count={mine.length} empty="Nothing in progress.">
          {mine.map((issue) => (
            <QueueRow key={issue.id} issue={issue} canPublish={canPublish} canResolve={canResolve} />
          ))}
        </Section>

        <Section
          title="Checked, ready to publish"
          count={ready.length}
          empty="Nothing ready."
        >
          {ready.map((issue) => (
            <QueueRow key={issue.id} issue={issue} canPublish={canPublish} canResolve={canResolve} />
          ))}
        </Section>
      </PageBody>
    </main>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="section-title">
        {title} <span className="text-ink-3">({count})</span>
      </h2>
      {count === 0 ? (
        <p className="mt-3 text-sm text-ink-3">{empty}</p>
      ) : (
        <div className="mt-3 grid gap-3">{children}</div>
      )}
    </section>
  );
}
