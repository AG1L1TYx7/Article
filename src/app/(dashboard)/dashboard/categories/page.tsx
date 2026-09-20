import type { Metadata } from "next";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createCategory, deleteCategory } from "./actions";
import { PageBody, PageHeader } from "../../PageHeader";
import { TrashIcon } from "@/components/icons";
import { plural } from "@/lib/format";

export const metadata: Metadata = { title: "Categories", robots: { index: false, follow: false } };

export default async function CategoriesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { articles: true } } },
  });

  return (
    <main id="main-content">
      <PageHeader
        kicker="Site"
        title="Categories"
        description="Sections appear in the masthead as soon as they have a published article."
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="card divide-y divide-line">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-ink-3">
                    /category/{c.slug} · {plural(c._count.articles, "article")}
                    {c.description ? ` · ${c.description}` : ""}
                  </p>
                </div>
                <form action={async () => { "use server"; await deleteCategory(c.id); }}>
                  <button className="btn btn-ghost btn-sm gap-1 text-danger" title="Delete category">
                    <TrashIcon size={14} /> Delete
                  </button>
                </form>
              </div>
            ))}
            {categories.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-ink-3">No categories yet.</p>
            )}
          </div>

          <form
            action={async (formData) => {
              "use server";
              await createCategory(formData);
            }}
            className="card flex flex-col gap-3 p-4 lg:self-start"
          >
            <h2 className="font-medium">Add category</h2>
            <div className="field">
              <label htmlFor="category-name" className="label">
                Name
              </label>
              <input id="category-name" name="name" placeholder="Business" required className="input" />
            </div>
            <div className="field">
              <label htmlFor="category-slug" className="label">
                Slug
              </label>
              <input
                id="category-slug"
                name="slug"
                placeholder="business"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                className="input font-mono text-xs"
              />
              <p className="hint">Lowercase letters, numbers and hyphens.</p>
            </div>
            <div className="field">
              <label htmlFor="category-description" className="label">
                Description <span className="font-normal text-ink-3">(optional)</span>
              </label>
              <input
                id="category-description"
                name="description"
                placeholder="Markets, companies and the economy"
                className="input"
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Add
            </button>
          </form>
        </div>
      </PageBody>
    </main>
  );
}
