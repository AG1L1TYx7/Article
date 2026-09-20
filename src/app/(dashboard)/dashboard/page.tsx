import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { EmailVerifyBanner } from "./EmailVerifyBanner";
import { PageBody, PageHeader } from "../PageHeader";
import { ArrowRightIcon, PlusIcon, ShieldIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";
import { StatusPill } from "./articles/StatusPill";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="card card-hover flex flex-col px-5 py-4">
      <span className="text-3xl font-semibold tracking-tight tabular-nums">{value.toLocaleString("en-GB")}</span>
      <span className="mt-1 text-sm text-ink-2">{label}</span>
    </Link>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  const mine = { authorId: session.user.id };

  const [user, published, drafts, pendingComments, openReports, recent] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, emailVerifiedAt: true },
    }),
    db.article.count({ where: { ...(isAdmin ? {} : mine), status: "PUBLISHED" } }),
    db.article.count({ where: { ...(isAdmin ? {} : mine), status: "DRAFT" } }),
    db.comment.count({ where: { status: "PENDING" } }),
    db.report.count({ where: { status: "OPEN" } }),
    db.article.findMany({
      where: isAdmin ? {} : mine,
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, title: true, status: true, updatedAt: true, author: { select: { name: true } } },
    }),
  ]);

  const firstName = session.user.name?.split(" ")[0] ?? "there";
  const hour = new Date().getUTCHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <main id="main-content">
      <PageHeader
        kicker="Overview"
        title={`${greeting}, ${firstName}.`}
        description={
          <>
            Signed in as <strong className="text-ink">{session.user.email}</strong> ·{" "}
            <span className="pill pill-neutral align-middle">{session.user.role}</span>
          </>
        }
        actions={
          <Link href="/dashboard/articles/new" className="btn btn-primary gap-1.5">
            <PlusIcon size={16} /> New article
          </Link>
        }
      />

      <PageBody>
        {user && !user.emailVerifiedAt && <EmailVerifyBanner email={user.email} />}

        {session.user.role === "ADMIN" && !session.user.mfaEnabled && (
          <div className="alert alert-warn mb-6 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <ShieldIcon size={16} /> Admin accounts must enable two-factor authentication.
            </span>
            <Link href="/dashboard/mfa" className="btn btn-sm btn-primary">
              Set it up
            </Link>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={isAdmin ? "Published articles" : "Your published articles"} value={published} href="/dashboard/articles" />
          <Stat label={isAdmin ? "Drafts" : "Your drafts"} value={drafts} href="/dashboard/articles" />
          <Stat label="Comments awaiting review" value={pendingComments} href="/dashboard/comments" />
          <Stat label="Open reports" value={openReports} href="/dashboard/comments" />
        </div>

        <section className="mt-10" aria-labelledby="recent-heading">
          <div className="flex items-center justify-between">
            <h2 id="recent-heading" className="section-title flex-1">
              Recently edited
            </h2>
            <Link href="/dashboard/articles" className="btn btn-ghost btn-sm ml-4 gap-1">
              All articles <ArrowRightIcon size={14} />
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="card mt-4 px-6 py-10 text-center">
              <p className="font-medium">No articles yet</p>
              <p className="mt-1 text-sm text-ink-2">Your first draft is one click away.</p>
              <Link href="/dashboard/articles/new" className="btn btn-primary mt-5 gap-1.5">
                <PlusIcon size={16} /> Write an article
              </Link>
            </div>
          ) : (
            <ul className="card mt-4 divide-y divide-line">
              {recent.map((article) => (
                <li key={article.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/articles/${article.id}`} className="font-medium hover:underline">
                      {article.title}
                    </Link>
                    <p className="text-xs text-ink-3">
                      {isAdmin && <>{article.author.name} · </>}
                      updated {formatDate(article.updatedAt)}
                    </p>
                  </div>
                  <StatusPill status={article.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageBody>
    </main>
  );
}
