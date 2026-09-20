"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addArticleLink, removeArticleLink } from "@/app/(dashboard)/dashboard/articles/actions";
import { XIcon } from "@/components/icons";

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
    <section className="mt-10 border-t border-line pt-8" aria-labelledby="related-links-heading">
      <h2 id="related-links-heading" className="headline text-2xl">
        Related links
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        The headline and summary are read from the linked page when you add it.
      </p>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {links.length === 0 && (
            <p className="card px-4 py-6 text-center text-sm text-ink-3">No links attached yet.</p>
          )}
          {links.length > 0 && (
            <ul className="flex flex-col gap-2">
              {links.map((link) => (
                <li key={link.id} className="card flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    {/* Everything below came from a remote page. Rendered as
                        text — never as HTML. */}
                    <p className="truncate text-sm font-medium text-ink">
                      {link.label || link.title || link.url}
                    </p>
                    {link.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-ink-2">{link.description}</p>
                    )}
                    <p className="mt-1 truncate text-xs text-ink-3">
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
                    className="btn btn-ghost btn-sm shrink-0 gap-1"
                  >
                    <XIcon size={14} /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={onSubmit} className="card flex flex-col gap-3 p-4 lg:self-start">
          <div className="field">
            <label htmlFor="link-url" className="label">
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
              className="input"
            />
          </div>
          <div className="field">
            <label htmlFor="link-label" className="label">
              Label <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <input
              id="link-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Shown instead of the page's own headline"
              maxLength={200}
              className="input"
            />
          </div>

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="alert alert-warn" role="status">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || url.trim().length === 0}
            className="btn btn-primary"
          >
            {pending ? "Fetching…" : "Add link"}
          </button>
        </form>
      </div>
    </section>
  );
}
