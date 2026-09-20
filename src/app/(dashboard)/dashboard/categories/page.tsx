import type { Metadata } from "next";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageBody, PageHeader } from "../../PageHeader";
import { CategoryRow } from "./CategoryRow";
import { CategoryForm } from "./CategoryForm";

export const metadata: Metadata = { title: "Categories", robots: { index: false, follow: false } };

export default async function CategoriesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { articles: true } } },
  });

  return (
    <main id="main-content">
      <PageHeader
        kicker="Site"
        title="Categories"
        description="Sections appear in the masthead as soon as they have a published article. A section with articles in it can be renamed but not deleted."
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="card divide-y divide-line">
            {categories.map((c) => (
              <CategoryRow
                key={c.id}
                category={{
                  id: c.id,
                  slug: c.slug,
                  name: c.name,
                  description: c.description,
                  articles: c._count.articles,
                }}
              />
            ))}
            {categories.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-ink-3">No categories yet.</p>
            )}
          </div>

          <CategoryForm />
        </div>
      </PageBody>
    </main>
  );
}
