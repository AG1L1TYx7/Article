import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { FollowAuthorButton } from "./FollowAuthorButton";

// cache() so generateMetadata and the page share one query — see the note
// on the article page.
const getAuthor = cache(async (handle: string) =>
  db.user.findFirst({
    // Suspended and banned accounts have no public page. Readers don't
    // either: this is an author page, and a reader has nothing to show.
    where: { handle, status: "ACTIVE", role: { in: ["MODERATOR", "ADMIN"] } },
    select: { id: true, name: true, handle: true },
  })
);

export async function generateMetadata(props: PageProps<"/author/[handle]">): Promise<Metadata> {
  const { handle } = await props.params;
  const author = await getAuthor(handle);
  if (!author) return {};
  return {
    title: `${author.name} — articles`,
    description: `Articles written by ${author.name}.`,
  };
}

export default async function AuthorPage(props: PageProps<"/author/[handle]">) {
  const { handle } = await props.params;
  const author = await getAuthor(handle);
  if (!author) notFound();

  const session = await auth();
  const viewerId = session?.user?.id;

  const [articles, followerCount, following] = await Promise.all([
    db.article.findMany({
      where: { authorId: author.id, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 50,
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
    db.follow.count({ where: { authorId: author.id } }),
    viewerId
      ? db.follow.findFirst({ where: { followerId: viewerId, authorId: author.id }, select: { id: true } })
      : null,
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">{author.name}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {articles.length} {articles.length === 1 ? "article" : "articles"} · {followerCount}{" "}
        {followerCount === 1 ? "follower" : "followers"}
      </p>

      {/* Following yourself is meaningless, so the control isn't offered. */}
      {viewerId !== author.id && (
        <div className="mt-4">
          <FollowAuthorButton
            authorId={author.id}
            authorName={author.name}
            signedIn={!!viewerId}
            following={!!following}
          />
        </div>
      )}

      <ul className="mt-8 flex flex-col gap-8">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
        {articles.length === 0 && (
          <li className="text-neutral-600">No published articles yet.</li>
        )}
      </ul>
    </main>
  );
}
