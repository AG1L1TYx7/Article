import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { TagIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";

const getTag = cache(async (slug: string) =>
  db.tag.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } })
);

export async function generateMetadata(props: PageProps<"/tag/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const tag = await getTag(slug);
  if (!tag) return {};
  const description = `Every article tagged ${tag.name}.`;
  return {
    title: `${tag.name} — tag`,
    description,
    alternates: { canonical: `/tag/${slug}` },
    openGraph: { title: tag.name, description, url: `/tag/${slug}`, type: "website" },
  };
}

/**
 * Tags used to be entered in the editor and shown nowhere; every one is
 * now a page, so a reader who finishes a story on the housing plan can
 * follow "housing" rather than searching for it.
 */
export default async function TagPage(props: PageProps<"/tag/[slug]">) {
  const { slug } = await props.params;
  const tag = await getTag(slug);
  if (!tag) notFound();

  const { t, n } = await getI18n();

  const articles = await db.article.findMany({
    where: { status: "PUBLISHED", tags: { some: { tagId: tag.id } } },
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
      anonymous: true,
      author: { select: { name: true, handle: true } },
      category: { select: { name: true, slug: true } },
      coverImage: { select: { url: true, altText: true } },
    },
  });

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6">
      <header className="border-b border-line pb-6">
        <p className="kicker flex items-center gap-1.5">
          <TagIcon size={12} /> {t("common.tag")}
        </p>
        <h1 className="headline mt-2 text-4xl sm:text-5xl">{tag.name}</h1>
        <p className="mt-3 text-xs text-ink-3">{n(articles.length, "common.articles")}</p>
      </header>

      {articles.length === 0 && <p className="mt-8 text-ink-2">{t("tag.nothingYet")}</p>}

      {articles.length > 0 && (
        <ul className="mt-2 grid gap-x-12 md:grid-cols-2 [&>li]:border-b [&>li]:border-line [&>li]:py-6">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} variant="row" />
          ))}
        </ul>
      )}
    </main>
  );
}
