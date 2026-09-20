
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { publishArticle, unpublishArticle, archiveArticle } from "./actions";

export default async function ArticlesListPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  // Publishing requires a confirmed email address (see publishArticle in
  // ./actions.ts). Surface that here instead of letting the button look
  // live and then quietly do nothing.
  const canPublish = session.user.emailConfirmed;
  const articles = await db.article.findMany({
    where: isAdmin ? {} : { authorId: session.user.id },
    orderBy: { updatedAt: "desc" },
    // Card fields only — see the note on the homepage query.
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      author: { select: { name: true } },
    },
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Articles</h1>
        <Link
          href="/dashboard/articles/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          New article
        </Link>
      </div>

      {!canPublish && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Verify your email address to publish. You can still write and edit drafts.
        </p>
      )}

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-neutral-500">
            <th className="py-2 font-medium">Title</th>
            {isAdmin && <th className="py-2 font-medium">Author</th>}
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">Updated</th>
            <th className="py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {articles.map((article) => (
            <tr key={article.id} className="border-b border-neutral-100">
              <td className="py-2">
                <Link href={`/dashboard/articles/${article.id}`} className="underline">
                  {article.title}
                </Link>
              </td>
              {isAdmin && <td className="py-2 text-neutral-600">{article.author.name}</td>}
              <td className="py-2">
                <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-xs">{article.status}</span>
              </td>
              <td className="py-2 text-neutral-500">{article.updatedAt.toLocaleDateString()}</td>
              <td className="py-2">
                <div className="flex gap-2">
                  {article.status !== "PUBLISHED" ? (
                    <form action={async () => { "use server"; await publishArticle(article.id); }}>
                      <button
                        disabled={!canPublish}
                        title={canPublish ? undefined : "Verify your email address to publish"}
                        className="text-emerald-700 underline disabled:cursor-not-allowed disabled:text-neutral-400 disabled:no-underline"
                      >
                        Publish
                      </button>
                    </form>
                  ) : (
                    <form action={async () => { "use server"; await unpublishArticle(article.id); }}>
                      <button className="text-amber-700 underline">Unpublish</button>
                    </form>
                  )}
                  {article.status !== "ARCHIVED" && (
                    <form action={async () => { "use server"; await archiveArticle(article.id); }}>
                      <button className="text-red-700 underline">Archive</button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {articles.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 5 : 4} className="py-8 text-center text-neutral-500">
                No articles yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
