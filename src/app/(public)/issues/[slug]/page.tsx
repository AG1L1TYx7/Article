import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Image from "next/image";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth/config";
import { getIssueForViewer } from "@/lib/issues";
import { isPublicStatus, type IssueStatus } from "@/lib/issueVisibility";
import { getI18n } from "@/i18n/server";

/**
 * One reported issue.
 *
 * Reached by anybody for a published report, and by its reporter or a
 * verifier before that. `getIssueForViewer` returns null for both "does
 * not exist" and "you may not see it", and this page turns both into the
 * same 404 — so it cannot be used to discover that a report about somebody
 * is sitting unpublished in the queue.
 */
export async function generateMetadata(props: PageProps<"/issues/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const session = await auth();
  const issue = await getIssueForViewer(slug, sessionViewer(session));
  if (!issue) return { title: "Report not found" };

  // Unpublished reports are never indexed or described: the description
  // would put an unverified accusation into a search result.
  const isPublic = isPublicStatus(issue.status as IssueStatus);
  return {
    title: issue.title,
    description: isPublic ? issue.body.slice(0, 160) : undefined,
    robots: isPublic ? undefined : { index: false, follow: false },
  };
}

/**
 * The viewer, in the shape lib/issueVisibility.ts expects.
 *
 * Typed against Session rather than `ReturnType<typeof auth>`: `auth` is
 * overloaded — it is also the proxy wrapper — so inferring from it picks
 * up the middleware signature instead of the session one.
 */
function sessionViewer(session: Session | null) {
  return session?.user?.id
    ? { id: session.user.id, permissions: session.user.permissions ?? [] }
    : null;
}

export default async function IssuePage(props: PageProps<"/issues/[slug]">) {
  const { slug } = await props.params;
  const session = await auth();
  const { formatDate } = await getI18n();

  const issue = await getIssueForViewer(slug, sessionViewer(session));
  if (!issue) notFound();

  const status = issue.status as IssueStatus;
  const isPublic = isPublicStatus(status);

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6">
      {/* Shown to the reporter and to verifiers, who are the only people
          who can be here before it is published. Saying so plainly stops
          somebody assuming a draft report is already public. */}
      {!isPublic && (
        <p className="alert alert-warn mb-6" role="status">
          This report is not public. Only you and the people who check reports can see it.
          Status: {status.toLowerCase().replace("_", " ")}.
        </p>
      )}

      <p className="kicker">
        <Link href={`/issues?district=${issue.district.id}`} className="hover:text-link">
          {issue.district.name} · {issue.district.nameNe}
        </Link>
        {issue.ward ? ` · Ward ${issue.ward}` : ""}
      </p>

      <h1 className="headline mt-2 text-4xl">{issue.title}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-2">
        {issue.reportedBy.kind === "anonymous" ? (
          <span>Reported anonymously</span>
        ) : (
          <span>
            Reported by{" "}
            <Link href={`/author/${issue.reportedBy.handle}`} className="text-link">
              {issue.reportedBy.name}
            </Link>
          </span>
        )}
        {issue.publishedAt && <span>· {formatDate(issue.publishedAt)}</span>}
        {issue.category && <span>· {issue.category.name}</span>}
      </div>

      <p className="mt-2 text-xs text-ink-3">
        Reference <code className="font-mono">{issue.reference}</code> — quote this when raising
        it with an office.
      </p>

      <div className="prose mt-8 max-w-none whitespace-pre-wrap">{issue.body}</div>

      {issue.media.length > 0 && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {issue.media.map((m) => (
            <Image
              key={m.url}
              src={m.url}
              alt={m.altText ?? ""}
              width={m.width ?? 800}
              height={m.height ?? 600}
              className="rounded-md border border-rule"
            />
          ))}
        </div>
      )}

      {issue.status === "RESOLVED" && issue.resolutionNote && (
        <section className="mt-8 rounded-md border border-rule bg-surface-2 p-5">
          <h2 className="text-sm font-medium">What changed</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{issue.resolutionNote}</p>
          {issue.resolvedAt && (
            <p className="mt-2 text-xs text-ink-3">Marked resolved {formatDate(issue.resolvedAt)}</p>
          )}
        </section>
      )}

      <p className="mt-10 text-sm">
        <Link href="/issues" className="text-link">
          ← All reported issues
        </Link>
      </p>
    </main>
  );
}
