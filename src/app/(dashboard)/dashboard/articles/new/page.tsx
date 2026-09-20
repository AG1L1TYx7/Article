import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ArticleForm } from "../ArticleForm";
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
        description="Autosaves as you type. Publish from the panel on the right, or set a time and it publishes itself."
        actions={
          <Link href="/dashboard/articles" className="btn btn-ghost">
            Back to list
          </Link>
        }
      />
      <PageBody>
        <ArticleForm categories={categories} canPublish={session.user.emailConfirmed} />
      </PageBody>
    </main>
  );
}
