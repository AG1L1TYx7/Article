import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { listPublishedIssues } from "@/lib/issues";
import { one } from "@/lib/searchParams";
import { getI18n } from "@/i18n/server";
import { IssueCard } from "./IssueCard";

export const metadata: Metadata = {
  title: "Reported issues",
  description: "Verified reports raised by people across Nepal.",
};

/**
 * Every verified report, newest first, filterable by place.
 *
 * Only published and resolved reports reach here — the list function does
 * not take a status, so this page cannot ask for anything else. See
 * lib/issues.ts.
 *
 * The district filter defaults to the reader's own when they have set one.
 * The whole point of the platform is that somebody in Rautahat hears about
 * Rautahat, so the first thing they see should be their own district
 * rather than a national feed they have to narrow by hand.
 */
export default async function IssuesPage(props: PageProps<"/issues">) {
  const params = await props.searchParams;
  const session = await auth();
  const { t, formatDate } = await getI18n();

  const home = session?.user?.id
    ? await db.user.findUnique({
        where: { id: session.user.id },
        select: { districtId: true },
      })
    : null;

  // "all" is an explicit choice to see the whole country; absent means
  // "wherever I live, if I have said".
  const requested = one(params.district);
  const districtId = requested === "all" ? undefined : (requested ?? home?.districtId ?? undefined);

  const [issues, districts, selected] = await Promise.all([
    listPublishedIssues({ districtId, take: 30 }),
    db.district.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, nameNe: true, province: { select: { name: true } } },
    }),
    districtId
      ? db.district.findUnique({ where: { id: districtId }, select: { name: true, nameNe: true } })
      : null,
  ]);

  return (
    <main id="main-content" className="mx-auto max-w-4xl px-4 pt-10 pb-16 sm:px-6">
      <p className="kicker">{t("issues.kicker")}</p>
      <h1 className="headline mt-2 text-4xl">
        {selected ? t("issues.inDistrict", { district: selected.name }) : t("issues.title")}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-2">{t("issues.intro")}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href="/issues/new" className="btn btn-primary">
          {t("issues.report")}
        </Link>

        {/* A plain form, so choosing a district works without scripting. */}
        <form method="get" className="flex items-center gap-2">
          <label htmlFor="district" className="text-sm text-ink-2">
            {t("issues.filterByDistrict")}
          </label>
          <select
            id="district"
            name="district"
            defaultValue={districtId ?? "all"}
            className="input w-auto py-1.5 text-sm"
          >
            <option value="all">{t("issues.allOfNepal")}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.nameNe} ({d.province.name})
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-secondary btn-sm">
            {t("common.apply")}
          </button>
        </form>
      </div>

      {issues.length === 0 ? (
        <p className="mt-10 rounded-md border border-rule p-6 text-center text-ink-2">
          {selected ? t("issues.noneHere", { district: selected.name }) : t("issues.noneYet")}
        </p>
      ) : (
        <div className="mt-8 grid gap-4">
          {issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} formatDate={formatDate} />
          ))}
        </div>
      )}
    </main>
  );
}
