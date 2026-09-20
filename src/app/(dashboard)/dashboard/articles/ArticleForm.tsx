"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArticleEditor } from "@/components/editor/ArticleEditor";
import { slugify } from "@/lib/slugify";
import { uploadFile } from "@/lib/uploadClient";
import type { ArticleInput } from "@/lib/validation/article";
import type { ArticleActionResult } from "./actions";
import { ImageIcon, XIcon } from "@/components/icons";

interface CategoryOption {
  id: string;
  name: string;
}

interface CoverImage {
  id: string;
  url: string;
  altText?: string | null;
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
    coverImage?: CoverImage | null;
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
  const [cover, setCover] = useState<CoverImage | null>(initial?.coverImage ?? null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
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
      coverImageId: cover?.id,
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.push("/dashboard/articles");
    router.refresh();
  }

  async function pickCover(file: File) {
    setCoverError(null);
    setCoverUploading(true);
    try {
      // Same pipeline as images in the body: type-checked, re-encoded,
      // scanned. See lib/uploadClient.ts.
      const result = await uploadFile(file);
      if (!result.ok) {
        setCoverError(result.error);
        return;
      }
      setCover({ id: result.media.id, url: result.media.url });
    } finally {
      setCoverUploading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* The story */}
      <div className="flex flex-col gap-6">
        <div className="field">
          <label htmlFor="article-title" className="label">
            Title
          </label>
          <input
            id="article-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
            maxLength={200}
            placeholder="A headline that says what happened"
            className="input py-3 font-serif text-2xl leading-tight"
          />
        </div>

        <div className="field">
          <label htmlFor="article-dek" className="label">
            Dek (subtitle)
          </label>
          <input
            id="article-dek"
            value={dek}
            onChange={(e) => setDek(e.target.value)}
            maxLength={300}
            placeholder="One sentence that makes the headline worth clicking"
            className="input font-serif text-lg"
          />
        </div>

        <div className="field">
          <span className="label">Body</span>
          <ArticleEditor
            initialContent={initial?.bodyJson}
            onChange={(json, html) => setBody({ json, html })}
          />
        </div>

        <div className="field">
          <label htmlFor="article-excerpt" className="label">
            Excerpt
          </label>
          <textarea
            id="article-excerpt"
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Used in search results and share cards. Falls back to the dek."
            className="input resize-y"
          />
          <p className="hint">{500 - excerpt.length} characters left</p>
        </div>
      </div>

      {/* Settings rail */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <div className="card flex flex-col gap-3 p-4">
          <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5">
            {pending ? "Saving…" : "Save draft"}
          </button>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={isBreaking}
              onChange={(e) => setIsBreaking(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              <span className="font-medium">Mark as breaking news</span>
              <span className="mt-0.5 block text-xs text-ink-3">
                Leads the front page for a day and notifies readers who follow the author.
              </span>
            </span>
          </label>
        </div>

        <div className="card p-4">
          <span className="label">Cover image</span>
          <p className="hint mt-0.5">Shown at the top of the article and on the front page.</p>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pickCover(file);
              e.target.value = "";
            }}
          />
          {cover ? (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- just uploaded through this site's own pipeline */}
              <img src={cover.url} alt="" className="aspect-[16/9] w-full rounded-md bg-surface-2 object-cover" />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={coverUploading}
                  className="btn btn-secondary btn-sm flex-1"
                >
                  {coverUploading ? "Uploading…" : "Replace"}
                </button>
                <button
                  type="button"
                  onClick={() => setCover(null)}
                  disabled={coverUploading}
                  className="btn btn-ghost btn-sm gap-1"
                >
                  <XIcon size={14} /> Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={coverUploading}
              className="mt-3 flex aspect-[16/9] w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink disabled:opacity-60"
            >
              <ImageIcon size={22} />
              {coverUploading ? "Uploading…" : "Add a cover image"}
            </button>
          )}
          {coverError && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {coverError}
            </p>
          )}
        </div>

        <div className="card flex flex-col gap-4 p-4">
          <div className="field">
            <label htmlFor="article-category" className="label">
              Category
            </label>
            <select
              id="article-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="input"
            >
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="article-tags" className="label">
              Tags (comma-separated)
            </label>
            <input
              id="article-tags"
              value={tagSlugs}
              onChange={(e) => setTagSlugs(e.target.value)}
              placeholder="budget, council, housing"
              className="input"
            />
          </div>

          <div className="field">
            <label htmlFor="article-slug" className="label">
              Slug
            </label>
            <input
              id="article-slug"
              value={slug}
              onChange={(e) => {
                setSlug(slugify(e.target.value));
                setSlugTouched(true);
              }}
              required
              className="input font-mono text-xs"
            />
            <p className="hint break-all">/article/{slug || "…"}</p>
          </div>
        </div>
      </aside>
    </form>
  );
}
