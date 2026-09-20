import { db } from "@/lib/db";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { withDatabaseFallback } from "@/lib/buildSafe";

export default async function Home() {
  // This page is prerendered at build time, so it must survive being
  // built before any database exists. See lib/buildSafe.ts — publishing
  // an article revalidates this path, so the real list appears as soon as
  // there is one.
  const articles = await withDatabaseFallback(
    () =>
      db.article.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 20,
        // Explicit select, not include: the default pulls every scalar
        // column, which on this table means bodyHtml and bodyJson —
        // roughly 19KB and 21KB of article text each, fetched and
        // decompressed for 20 articles just to render titles and deks.
        select: {
          id: true,
          slug: true,
          title: true,
          dek: true,
          isBreaking: true,
          publishedAt: true,
          author: { select: { name: true, handle: true } },
          category: { select: { name: true, slug: true } },
        },
      }),
    [],
    "homepage article list"
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Latest</h1>

      <ul className="mt-8 flex flex-col gap-8">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
        {articles.length === 0 && <li className="text-neutral-500">No articles published yet.</li>}
      </ul>
    </main>
  );
}
