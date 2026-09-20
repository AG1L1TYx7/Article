import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { ArticleCard } from "@/components/articles/ArticleCard";

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
        },
      },
    },
  });

  // An article that's been unpublished since it was saved shouldn't show
  // up as a dead link — the bookmark row stays, so it reappears if the
  // article is published again.
  const readable = bookmarks.filter((b) => b.article.status === "PUBLISHED");

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Saved articles</h1>

      {readable.length === 0 && (
        <p className="mt-6 text-neutral-600">
          Nothing saved yet — use <strong>Save</strong> on any article to keep it here.
        </p>
      )}

      <ul className="mt-8 flex flex-col gap-8">
        {readable.map(({ article }) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </ul>
    </main>
  );
}
