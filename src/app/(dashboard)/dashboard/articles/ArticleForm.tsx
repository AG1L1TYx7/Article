"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArticleEditor } from "@/components/editor/ArticleEditor";
import { slugify } from "@/lib/slugify";
import type { ArticleInput } from "@/lib/validation/article";
import type { ArticleActionResult } from "./actions";

interface CategoryOption {
  id: string;
  name: string;
}

interface ArticleFormProps {
  categories: CategoryOption[];
  initial?: {
    title: string;
    dek: string;
    slug: string;
    excerpt: string;
    categoryId: string;
    tagSlugs: string;
    isBreaking: boolean;
    bodyJson: object;
    bodyHtml: string;
  };
  action: (input: ArticleInput) => Promise<ArticleActionResult>;
}

export function ArticleForm({ categories, initial, action }: ArticleFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [dek, setDek] = useState(initial?.dek ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug);
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [tagSlugs, setTagSlugs] = useState(initial?.tagSlugs ?? "");
  const [isBreaking, setIsBreaking] = useState(initial?.isBreaking ?? false);
  // Seeded from the stored article, not left empty: combined with the
  // editor's onCreate emit, this makes it impossible to save a blank body
  // over an existing article just because the author never clicked into
  // the editor.
  const [body, setBody] = useState<{ json: object; html: string }>({
    json: initial?.bodyJson ?? {},
    html: initial?.bodyHtml ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const result = await action({
      title,
      dek: dek || undefined,
      slug: slug || slugify(title),
      bodyJson: body.json,
      bodyHtml: body.html,
      excerpt: excerpt || undefined,
      categoryId: categoryId || undefined,
      tagSlugs: tagSlugs
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      isBreaking,
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.push("/dashboard/articles");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Title</span>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          required
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Slug</span>
        <input
          value={slug}
          onChange={(e) => {
            setSlug(slugify(e.target.value));
            setSlugTouched(true);
          }}
          required
          className="rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Dek (subtitle)</span>
        <input
          value={dek}
          onChange={(e) => setDek(e.target.value)}
          maxLength={300}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Body</span>
        <ArticleEditor
          initialContent={initial?.bodyJson}
          onChange={(json, html) => setBody({ json, html })}
        />
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Excerpt</span>
        <textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          maxLength={500}
          rows={3}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Category</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          >
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Tags (comma-separated)</span>
          <input
            value={tagSlugs}
            onChange={(e) => setTagSlugs(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isBreaking} onChange={(e) => setIsBreaking(e.target.checked)} />
        <span className="font-medium text-neutral-700">Mark as breaking news</span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save draft"}
      </button>
    </form>
  );
}
