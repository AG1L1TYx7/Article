"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addArticleLink, removeArticleLink } from "@/app/(dashboard)/dashboard/articles/actions";

export interface ArticleLinkRow {
  id: string;
  url: string;
  label: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
  fetchedAt: string | null;
}

/**
 * Related links on the article editor.
 *
 * Separate from the main article form because a link belongs to a saved
 * article: there is no article id to attach one to until the draft
 * exists, so this only appears when editing.
 */
export function ArticleLinks({
  articleId,
  links,
}: {
  articleId: string;
  links: ArticleLinkRow[];
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const result = await addArticleLink({
      articleId,
      url: url.trim(),
      label: label.trim() || undefined,
    });
    setPending(false);

    if (!result.ok) {
      setError(result.error ?? "Couldn't add that link.");
      return;
    }

    setUrl("");
    setLabel("");
    if (result.previewUnavailable) {
      // Said plainly: the link is saved, it just has no extra detail.
      setNotice("Link added. Nothing could be read from that page, so it will show as a plain link.");
    }
    router.refresh();
  }

  return (
    <section className="mt-10 border-t border-neutral-200 pt-8">
      <h2 className="text-lg font-semibold">Related links</h2>
      <p className="mt-1 text-sm text-neutral-600">
        The headline and summary are read from the linked page when you add it.
      </p>

      {links.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-start justify-between gap-4 rounded-md border border-neutral-200 px-4 py-3"
            >
              <div className="min-w-0">
                {/* Everything below came from a remote page. Rendered as
                    text — never as HTML. */}
                <p className="truncate text-sm font-medium text-neutral-800">
                  {link.label || link.title || link.url}
                </p>
                {link.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-600">{link.description}</p>
                )}
                <p className="mt-1 truncate text-xs text-neutral-500">
                  {link.siteName ? `${link.siteName} · ` : ""}
                  {link.url}
                  {!link.fetchedAt && " · no preview available"}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  await removeArticleLink(link.id);
                  setPending(false);
                  router.refresh();
                }}
                className="shrink-0 text-sm text-neutral-600 underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-2">
        <label htmlFor="link-url" className="text-sm font-medium">
          Add a link
        </label>
        <input
          id="link-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          maxLength={2000}
          required
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <label htmlFor="link-label" className="text-sm font-medium">
          Label <span className="font-normal text-neutral-500">(optional)</span>
        </label>
        <input
          id="link-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Shown instead of the page's own headline"
          maxLength={200}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-amber-700">{notice}</p>}

        <button
          type="submit"
          disabled={pending || url.trim().length === 0}
          className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Fetching…" : "Add link"}
        </button>
      </form>
    </section>
  );
}
