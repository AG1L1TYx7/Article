import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { approveComment, hideComment, deleteComment, suspendCommenter } from "./actions";

export default async function CommentModerationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [pending, reported] = await Promise.all([
    db.comment.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true, email: true } }, article: { select: { title: true, slug: true } } },
      take: 100,
    }),
    db.report.findMany({
      where: { status: "OPEN", commentId: { not: null } },
      orderBy: { createdAt: "asc" },
      include: {
        comment: {
          include: { author: { select: { id: true, name: true } }, article: { select: { title: true, slug: true } } },
        },
        reporter: { select: { name: true } },
      },
      take: 100,
    }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Comment moderation</h1>
      <p className="mt-2 text-sm text-neutral-600">
        New accounts and anything the spam heuristics flag land here before they appear publicly.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Awaiting review ({pending.length})</h2>
      {pending.length === 0 && <p className="mt-2 text-sm text-neutral-500">Nothing waiting.</p>}
      <ul className="mt-3 flex flex-col gap-4">
        {pending.map((c) => (
          <li key={c.id} className="rounded-md border border-neutral-200 p-4">
            <p className="text-sm">
              <strong>{c.author.name}</strong>{" "}
              <span className="text-neutral-500">on</span>{" "}
              <Link href={`/article/${c.article.slug}`} className="underline">{c.article.title}</Link>
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">{c.body}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <form action={async () => { "use server"; await approveComment(c.id); }}>
                <button className="text-emerald-700 underline">Approve</button>
              </form>
              <form action={async () => { "use server"; await hideComment(c.id); }}>
                <button className="text-amber-700 underline">Hide</button>
              </form>
              <form action={async () => { "use server"; await deleteComment(c.id); }}>
                <button className="text-red-700 underline">Delete</button>
              </form>
              <form action={async () => { "use server"; await suspendCommenter(c.author.id); }}>
                <button className="text-red-700 underline">Suspend author</button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-lg font-semibold">Reported by readers ({reported.length})</h2>
      {reported.length === 0 && <p className="mt-2 text-sm text-neutral-500">No open reports.</p>}
      <ul className="mt-3 flex flex-col gap-4">
        {reported.map((r) => (
          <li key={r.id} className="rounded-md border border-red-200 bg-red-50 p-4">
            <p className="text-sm">
              Reported as <strong>{r.reason}</strong> by {r.reporter.name}
            </p>
            {r.comment && (
              <>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">{r.comment.body}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <form action={async () => { "use server"; await hideComment(r.comment!.id); }}>
                    <button className="text-amber-700 underline">Hide</button>
                  </form>
                  <form action={async () => { "use server"; await deleteComment(r.comment!.id); }}>
                    <button className="text-red-700 underline">Delete</button>
                  </form>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
