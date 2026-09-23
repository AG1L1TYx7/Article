import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { FollowAuthorButton } from "./FollowAuthorButton";
import { initials } from "@/lib/format";
import { getI18n } from "@/i18n/server";

// cache() so generateMetadata and the page share one query — see the note
// on the article page.
const getAuthor = cache(async (handle: string) =>
  db.user.findFirst({
    // Suspended and banned accounts have no public page. Readers don't
    // either: this is an author page, and a reader has nothing to show.
    where: { handle, status: "ACTIVE", role: { in: ["MODERATOR", "ADMIN"] } },
    select: { id: true, name: true, handle: true, createdAt: true },
  })
);

export async function generateMetadata(props: PageProps<"/author/[handle]">): Promise<Metadata> {
  const { handle } = await props.params;
  const author = await getAuthor(handle);
  if (!author) return {};
  const description = `Articles written by ${author.name}.`;
  return {
    title: `${author.name} — articles`,
    description,
    alternates: { canonical: `/author/${handle}` },
    openGraph: {
      title: author.name,
      description,
      url: `/author/${handle}`,
      type: "profile",
    },
  };
}

export default async function AuthorPage(props: PageProps<"/author/[handle]">) {
  const { handle } = await props.params;
  const author = await getAuthor(handle);
  if (!author) notFound();

  const { t, n } = await getI18n();
  const session = await auth();
  const viewerId = session?.user?.id;

  const [articles, followerCount, following] = await Promise.all([
    db.article.findMany({
      // Anonymous stories stay off the byline page; listing them here
      // would name the author.
      where: { authorId: author.id, status: "PUBLISHED", anonymous: false },
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
    }),
    db.follow.count({ where: { authorId: author.id } }),
    viewerId
      ? db.follow.findFirst({ where: { followerId: viewerId, authorId: author.id }, select: { id: true } })
      : null,
  ]);

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center gap-6 border-b border-line pb-8">
        <span className="avatar h-20 w-20 text-2xl">{initials(author.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="kicker">{t("common.author")}</p>
          <h1 className="headline mt-1 text-4xl">{author.name}</h1>
          <p className="mt-2 text-sm text-ink-3">
            {n(articles.length, "common.articles")} · {n(followerCount, "common.followers")} · @{author.handle}
          </p>
        </div>
        {/* Following yourself is meaningless, so the control isn't offered. */}
        {viewerId !== author.id && (
          <FollowAuthorButton
            authorId={author.id}
            authorName={author.name}
            signedIn={!!viewerId}
            following={!!following}
          />
        )}
      </header>

      {articles.length === 0 && <p className="mt-8 text-ink-2">{t("author.noArticles")}</p>}

      {articles.length > 0 && (
        <ul className="mt-2 grid gap-x-12 md:grid-cols-2 [&>li]:border-b [&>li]:border-line [&>li]:py-6">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} variant="row" hideCategory={false} />
          ))}
        </ul>
      )}
    </main>
  );
}
