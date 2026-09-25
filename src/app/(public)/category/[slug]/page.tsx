import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { FollowCategoryButton } from "./FollowCategoryButton";
import { IssueCard } from "@/app/(public)/issues/IssueCard";
import { listPublishedIssues } from "@/lib/issues";
import { getI18n } from "@/i18n/server";

const getCategory = cache(async (slug: string) =>
  db.category.findUnique({
    where: { slug },
    select: { id: true, name: true, description: true },
  })
);

export async function generateMetadata(props: PageProps<"/category/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const category = await getCategory(slug);
  if (!category) return {};
  const description = category.description ?? `Latest ${category.name} coverage.`;
  return {
    title: category.name,
    description,
    alternates: { canonical: `/category/${slug}` },
    openGraph: { title: category.name, description, url: `/category/${slug}`, type: "website" },
  };
}

export default async function CategoryPage(props: PageProps<"/category/[slug]">) {
  const { slug } = await props.params;
  const category = await getCategory(slug);
  if (!category) notFound();

  const { t, n, formatDate } = await getI18n();
  const session = await auth();
  const viewerId = session?.user?.id;

  const [articles, issues, followerCount, following] = await Promise.all([
    db.article.findMany({
      where: { categoryId: category.id, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 50,
      select: {
        id: true,
        slug: true,
        title: true,
        dek: true,
        isBreaking: true,
        publishedAt: true,
        locale: true,
        author: { select: { name: true, handle: true } },
        coverImage: { select: { url: true, altText: true } },
      },
    }),
    // A section is a place on this platform, not a shelf of articles.
    // "Youth against corruption" means the reporting staff published *and*
    // what people in the districts reported and had verified — showing one
    // without the other would make half the work invisible.
    listPublishedIssues({ categorySlug: slug, take: 10 }),
    db.follow.count({ where: { categoryId: category.id } }),
    viewerId
      ? db.follow.findFirst({ where: { followerId: viewerId, categoryId: category.id }, select: { id: true } })
      : null,
  ]);

  const [lead, ...rest] = articles;

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div className="min-w-0">
          <p className="kicker">{t("common.section")}</p>
          <h1 className="headline mt-2 text-4xl sm:text-5xl">{category.name}</h1>
          {category.description && <p className="mt-3 max-w-2xl text-ink-2">{category.description}</p>}
          <p className="mt-3 text-xs text-ink-3">
            {n(articles.length, "common.articles")} · {n(followerCount, "common.followers")}
          </p>
        </div>
        <FollowCategoryButton
          categoryId={category.id}
          categoryName={category.name}
          signedIn={!!viewerId}
          following={!!following}
        />
      </header>

      {!lead && issues.length === 0 && (
        <p className="mt-8 text-ink-2">{t("category.nothingYet")}</p>
      )}

      {lead && (
        <ul className="mt-8">
          <ArticleCard article={lead} variant="lead" />
        </ul>
      )}

      {rest.length > 0 && (
        <ul className="mt-10 grid gap-x-12 border-t border-line md:grid-cols-2 [&>li]:border-b [&>li]:border-line [&>li]:py-6">
          {rest.map((article) => (
            <ArticleCard key={article.id} article={article} variant="row" />
          ))}
        </ul>
      )}

      {issues.length > 0 && (
        <section className="mt-12 border-t border-line pt-8" aria-labelledby="section-issues">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="section-issues" className="section-title">
              {t("category.reportedHere")}
            </h2>
            <Link href={`/issues`} className="text-sm text-link">
              {t("category.allReports")}
            </Link>
          </div>
          <p className="mt-1 text-sm text-ink-2">{t("category.reportedHereBlurb")}</p>
          <div className="mt-5 grid gap-4">
            {issues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} formatDate={formatDate} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
