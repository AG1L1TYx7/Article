import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ArticleForm } from "../ArticleForm";
import { createArticle } from "../actions";
import { PageBody, PageHeader } from "../../../PageHeader";

export const metadata: Metadata = { title: "New article", robots: { index: false, follow: false } };

export default async function NewArticlePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const categories = await db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <main id="main-content">
      <PageHeader
        kicker="Articles"
        title="New article"
        description="Saved as a draft. Publish it from the articles list when it's ready."
        actions={
          <Link href="/dashboard/articles" className="btn btn-ghost">
            Cancel
          </Link>
        }
      />
      <PageBody>
        <ArticleForm categories={categories} action={createArticle} />
      </PageBody>
    </main>
  );
}
