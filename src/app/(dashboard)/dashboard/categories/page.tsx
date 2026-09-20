import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createCategory, deleteCategory } from "./actions";

export default async function CategoriesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { articles: true } } },
  });

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-semibold">Categories</h1>

      <ul className="mt-6 flex flex-col gap-2">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm">
            <span>
              {c.name} <span className="font-mono text-xs text-neutral-500">({c._count.articles})</span>
            </span>
            <form action={async () => { "use server"; await deleteCategory(c.id); }}>
              <button className="text-red-700 underline">Delete</button>
            </form>
          </li>
        ))}
        {categories.length === 0 && <li className="text-sm text-neutral-500">No categories yet.</li>}
      </ul>

      <form
        action={async (formData) => {
          "use server";
          await createCategory(formData);
        }}
        className="mt-8 flex flex-col gap-3 border-t border-neutral-200 pt-6"
      >
        <h2 className="text-sm font-medium text-neutral-700">Add category</h2>
        <input
          name="name"
          placeholder="Name"
          required
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <input
          name="slug"
          placeholder="slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          className="rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-500"
        />
        <input
          name="description"
          placeholder="Description (optional)"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button type="submit" className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
          Add
        </button>
      </form>
    </main>
  );
}
