import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { sessionHas } from "@/lib/auth/rbac";
import { ReportForm } from "./ReportForm";

export const metadata: Metadata = {
  title: "Report an issue",
  robots: { index: false, follow: false },
};

/**
 * The form a member fills in to raise something.
 *
 * Signed in and email-verified, because the report has to be answerable:
 * a verifier who cannot ask a follow-up question usually cannot verify,
 * and the outcome has to reach somebody. Both are checked again in the
 * server action — this is the courtesy that explains why, rather than the
 * control.
 */
export default async function NewIssuePage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/issues/new");

  if (!sessionHas(session, "issue.submit")) redirect("/issues");

  const [districts, categories, me] = await Promise.all([
    db.district.findMany({
      orderBy: [{ province: { number: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, nameNe: true, province: { select: { name: true } } },
    }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { districtId: true, emailVerifiedAt: true },
    }),
  ]);

  return (
    <main id="main-content" className="mx-auto max-w-2xl px-4 pt-10 pb-16 sm:px-6">
      <p className="kicker">Raise an issue</p>
      <h1 className="headline mt-2 text-4xl">Report something</h1>
      <p className="mt-3 text-ink-2">
        Anyone can report something happening where they live. Nothing is published until
        somebody has checked it — and once it is, people in that district are told.
      </p>

      {!me?.emailVerifiedAt && (
        <p className="alert alert-warn mt-6" role="status">
          Verify your email address first. We need a way to come back to you with questions, and
          to tell you what happened to your report.
        </p>
      )}

      <ReportForm
        districts={districts}
        categories={categories}
        defaultDistrictId={me?.districtId ?? ""}
        canSubmit={!!me?.emailVerifiedAt}
      />
    </main>
  );
}
