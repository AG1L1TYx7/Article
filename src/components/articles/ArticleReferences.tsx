"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addArticleReference, removeArticleReference } from "@/app/(dashboard)/dashboard/articles/actions";
import { XIcon } from "@/components/icons";

export interface ArticleReferenceRow {
  id: string;
  position: number;
  title: string;
  author: string | null;
  publication: string | null;
  url: string | null;
  publishedOn: string | null;
  note: string | null;
}

/**
 * The sources a story cites, on the article editor.
 *
 * Numbered in the order they were added; the number is what a citation
 * in the text points at ("Cite" in the editor toolbar inserts [n]).
 * Like related links, references belong to a saved article, so this
 * only appears once the draft exists.
 */
export function ArticleReferences({ articleId, references }: { articleId: string; references: ArticleReferenceRow[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publication, setPublication] = useState("");
  const [url, setUrl] = useState("");
  const [publishedOn, setPublishedOn] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await addArticleReference({
      articleId,
      title: title.trim(),
      author: author.trim() || undefined,
      publication: publication.trim() || undefined,
      url: url.trim() || undefined,
      publishedOn: publishedOn.trim() || undefined,
      note: note.trim() || undefined,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't add that reference.");
      return;
    }
    setTitle("");
    setAuthor("");
    setPublication("");
    setUrl("");
    setPublishedOn("");
    setNote("");
    router.refresh();
  }

  return (
    <section className="mt-10 border-t border-line pt-8" aria-labelledby="references-heading" data-article-references>
      <h2 id="references-heading" className="headline text-2xl">
        References
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        The sources this story relies on: reports, documents, interviews, other coverage. Listed under the story in
        this order. Use <strong>Cite</strong> in the editor toolbar to put a numbered marker in the text.
      </p>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {references.length === 0 && (
            <p className="card px-4 py-6 text-center text-sm text-ink-3">No references yet.</p>
          )}
          {references.length > 0 && (
            <ol className="flex flex-col gap-2">
              {references.map((ref) => (
                <li key={ref.id} className="card flex items-start gap-3 px-4 py-3">
                  <span className="figure w-6 shrink-0 text-sm text-ink-3 tabular-nums">{ref.position}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{ref.title}</p>
                    <p className="mt-0.5 text-xs text-ink-2">
                      {[ref.author, ref.publication, ref.publishedOn].filter(Boolean).join(" · ")}
                    </p>
                    {ref.url && <p className="mt-0.5 truncate text-xs text-ink-3">{ref.url}</p>}
                    {ref.note && <p className="mt-1 text-xs text-ink-3">{ref.note}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={async () => {
                      setPending(true);
                      await removeArticleReference(ref.id);
                      setPending(false);
                      router.refresh();
                    }}
                    className="btn btn-ghost btn-sm shrink-0 gap-1"
                  >
                    <XIcon size={14} /> Remove
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <form onSubmit={onSubmit} className="card flex flex-col gap-3 p-4 lg:self-start">
          <div className="field">
            <label htmlFor="ref-title" className="label">
              Add a reference
            </label>
            <input id="ref-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title of the report, document or article" maxLength={300} required className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label htmlFor="ref-author" className="label">
                Author
              </label>
              <input id="ref-author" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} className="input" placeholder="Person or body" />
            </div>
            <div className="field">
              <label htmlFor="ref-publication" className="label">
                Publication
              </label>
              <input id="ref-publication" value={publication} onChange={(e) => setPublication(e.target.value)} maxLength={200} className="input" placeholder="Journal, paper, office" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ref-url" className="label">
              Link <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <input id="ref-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" maxLength={2000} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label htmlFor="ref-date" className="label">
                Date
              </label>
              <input id="ref-date" value={publishedOn} onChange={(e) => setPublishedOn(e.target.value)} maxLength={40} className="input" placeholder="e.g. 12 May 2026" />
            </div>
            <div className="field">
              <label htmlFor="ref-note" className="label">
                Note
              </label>
              <input id="ref-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="input" placeholder="Page, section, accessed on" />
            </div>
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending || title.trim().length === 0} className="btn btn-primary">
            {pending ? "Adding…" : "Add reference"}
          </button>
        </form>
      </div>
    </section>
  );
}
