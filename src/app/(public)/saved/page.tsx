import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { BookmarkIcon } from "@/components/icons";
import { plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Saved articles",
  robots: { index: false, follow: false },
};

export default async function SavedPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/saved");

  const bookmarks = await db.bookmark.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      article: {
        // Card fields only — see the note on the homepage query.
        select: {
          id: true,
          slug: true,
          title: true,
          dek: true,
          status: true,
          publishedAt: true,
          author: { select: { name: true, handle: true } },
          category: { select: { name: true, slug: true } },
          coverImage: { select: { url: true, altText: true } },
        },
      },
    },
  });

  // An article that's been unpublished since it was saved shouldn't show
  // up as a dead link — the bookmark row stays, so it reappears if the
  // article is published again.
  const readable = bookmarks.filter((b) => b.article.status === "PUBLISHED");

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6">
      <p className="kicker">Your reading list</p>
      <h1 className="headline mt-2 text-4xl">Saved articles</h1>
      {readable.length > 0 && (
        <p className="mt-2 text-sm text-ink-3">{plural(readable.length, "article")}</p>
      )}

      {readable.length === 0 && (
        <div className="card mt-8 flex flex-col items-center px-6 py-12 text-center">
          <span className="avatar h-12 w-12">
            <BookmarkIcon size={20} />
          </span>
          <p className="mt-4 font-medium">Nothing saved yet</p>
          <p className="mt-1 max-w-sm text-sm text-ink-2">
            Use <strong>Save</strong> on any article to keep it here for later.
          </p>
          <Link href="/" className="btn btn-secondary mt-6">
            Browse the front page
          </Link>
        </div>
      )}

      <ul className="mt-2 [&>li]:border-b [&>li]:border-line [&>li]:py-6">
        {readable.map(({ article }) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </ul>
    </main>
  );
}
