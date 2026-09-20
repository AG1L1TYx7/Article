import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { ArticleCard } from "@/components/articles/ArticleCard";

const getCategory = cache(async (slug: string) =>
  db.category.findUnique({
    where: { slug },
    select: { id: true, name: true, description: true },
  })
);

export async function generateMetadata(props: PageProps<"/category/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const category = await getCategory(slug);
  if (!category) return {};
  return {
    title: category.name,
    description: category.description ?? `Latest ${category.name} coverage.`,
  };
}

export default async function CategoryPage(props: PageProps<"/category/[slug]">) {
  const { slug } = await props.params;
  const category = await getCategory(slug);
  if (!category) notFound();

  const articles = await db.article.findMany({
    where: { categoryId: category.id, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: 50,
    select: {
      id: true,
      slug: true,
      title: true,
      dek: true,
      isBreaking: true,
      publishedAt: true,
      author: { select: { name: true, handle: true } },
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">{category.name}</h1>
      {category.description && <p className="mt-1 text-neutral-600">{category.description}</p>}

      <ul className="mt-8 flex flex-col gap-8">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
        {articles.length === 0 && (
          <li className="text-neutral-600">Nothing published in this section yet.</li>
        )}
      </ul>
    </main>
  );
}
