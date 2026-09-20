import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ArticleForm } from "../ArticleForm";
import { createArticle } from "../actions";

export default async function NewArticlePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const categories = await db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">New article</h1>
      <ArticleForm categories={categories} action={createArticle} />
    </main>
  );
}
