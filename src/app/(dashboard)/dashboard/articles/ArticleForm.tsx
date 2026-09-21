"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArticleEditor } from "@/components/editor/ArticleEditor";
import { slugify } from "@/lib/slugify";
import { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES, isLocale, type Locale } from "@/i18n/config";
import { uploadFile } from "@/lib/uploadClient";
import { readingTime } from "@/lib/format";
import type { ArticleInput } from "@/lib/validation/article";
import {
  archiveArticle,
  createArticle,
  publishArticle,
  unpublishArticle,
  updateArticle,
  type ArticleActionResult,
} from "./actions";
import { StatusPill } from "./StatusPill";
import { ClockIcon, ExternalIcon, ImageIcon, XIcon } from "@/components/icons";

interface CategoryOption {
  id: string;
  name: string;
}

interface CoverImage {
  id: string;
  url: string;
  altText?: string | null;
}

export interface ArticleFormInitial {
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
  seoTitle?: string;
  seoDescription?: string;
  scheduledFor?: string | null; // ISO
  locale?: string;
  translationOfSlug?: string;
}

interface ArticleFormProps {
  categories: CategoryOption[];
  /** Present when editing; absent on the new-article page. */
  articleId?: string;
  status?: string;
  initial?: ArticleFormInitial;
  /** Whether this person may publish (a confirmed email address). */
  canPublish: boolean;
}

// Long enough that a pause in typing, not every keystroke, triggers a
// save; short enough that closing the tab loses at most a sentence.
const AUTOSAVE_DELAY_MS = 2500;

/** ISO -> the value a datetime-local input wants (local time, no zone). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function wordCount(html: string): number {
  return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

export function ArticleForm({ categories, articleId: initialId, status: initialStatus, initial, canPublish }: ArticleFormProps) {
  const router = useRouter();

  const [articleId, setArticleId] = useState<string | undefined>(initialId);
  const [status, setStatus] = useState(initialStatus ?? "DRAFT");

  const [title, setTitle] = useState(initial?.title ?? "");
  const [dek, setDek] = useState(initial?.dek ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug);
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [tagSlugs, setTagSlugs] = useState(initial?.tagSlugs ?? "");
  const [isBreaking, setIsBreaking] = useState(initial?.isBreaking ?? false);
  const [cover, setCover] = useState<CoverImage | null>(initial?.coverImage ?? null);
  const [coverAlt, setCoverAlt] = useState(initial?.coverImage?.altText ?? "");
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? "");
  const [locale, setLocale] = useState<Locale>(isLocale(initial?.locale) ? initial.locale : DEFAULT_LOCALE);
  const [translationOfSlug, setTranslationOfSlug] = useState(initial?.translationOfSlug ?? "");
  const [scheduledFor, setScheduledFor] = useState(toLocalInput(initial?.scheduledFor));
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
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  // One save at a time. An autosave that is still in flight when the
  // author clicks Save is awaited rather than raced.
  const inFlight = useRef<Promise<ArticleActionResult> | null>(null);
  const editorCreated = useRef(false);

  function buildInput(): ArticleInput {
    return {
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
      coverAltText: cover ? coverAlt : undefined,
      seoTitle: seoTitle || undefined,
      seoDescription: seoDescription || undefined,
      locale,
      translationOfSlug: translationOfSlug.trim() || undefined,
      scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
    };
  }

  /**
   * Saves the current state, creating the article on the first save and
   * updating it thereafter. After the first save the address bar is
   * moved to the edit page without a navigation, so a refresh lands on
   * the same article rather than an empty form.
   */
  const persist = useCallback(
    async (input: ArticleInput): Promise<ArticleActionResult> => {
      if (inFlight.current) await inFlight.current.catch(() => {});
      const run = (async () => {
        setSaveState("saving");
        const result = articleId ? await updateArticle(articleId, input) : await createArticle(input);
        if (result.ok) {
          if (!articleId && result.id) {
            setArticleId(result.id);
            window.history.replaceState(null, "", `/dashboard/articles/${result.id}`);
          }
          if (result.slug) setSlug(result.slug);
          if (input.scheduledFor && (status === "DRAFT" || status === "SCHEDULED")) setStatus("SCHEDULED");
          if (!input.scheduledFor && status === "SCHEDULED") setStatus("DRAFT");
          setDirty(false);
          setSavedAt(new Date());
          setSaveState("saved");
        } else {
          setSaveState("failed");
        }
        return result;
      })();
      inFlight.current = run;
      try {
        return await run;
      } finally {
        inFlight.current = null;
      }
    },
    [articleId, status]
  );

  // Autosave: a pause after any change, once there is a title to save
  // under. Errors are shown in the status line, never as a modal — the
  // author is mid-sentence.
  useEffect(() => {
    if (!dirty || !title.trim() || pending || actionPending) return;
    const timer = setTimeout(() => {
      void persist(buildInput()).then((result) => {
        if (!result.ok) setError(result.error ?? "Autosave failed.");
      });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // buildInput reads every field; the effect re-arms on any of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, title, dek, slug, excerpt, categoryId, tagSlugs, isBreaking, cover, coverAlt, seoTitle, seoDescription, locale, translationOfSlug, scheduledFor, body, pending, actionPending, persist]);

  // Leaving with unsaved changes asks first. Browsers show their own
  // wording; the string here just has to be non-empty.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = () => setDirty(true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await persist(buildInput());
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.push("/dashboard/articles");
    router.refresh();
  }

  /** Save first, then run a status action, so nothing typed is lost. */
  async function runAction(name: string, action: (id: string) => Promise<ArticleActionResult>, next?: string) {
    setError(null);
    setActionPending(name);
    try {
      const saved = dirty || !articleId ? await persist(buildInput()) : { ok: true, id: articleId };
      if (!saved.ok) {
        setError(saved.error ?? "Couldn't save before that.");
        return;
      }
      const id = articleId ?? saved.id!;
      const result = await action(id);
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      if (next) setStatus(next);
      router.refresh();
    } finally {
      setActionPending(null);
    }
  }

  async function openPreview() {
    if (dirty || !articleId) {
      const saved = await persist(buildInput());
      if (!saved.ok) {
        setError(saved.error ?? "Couldn't save before previewing.");
        return;
      }
    }
    const id = articleId ?? new URL(window.location.href).pathname.split("/").pop();
    window.open(`/dashboard/articles/${id}/preview`, "_blank", "noopener");
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
      touch();
    } finally {
      setCoverUploading(false);
    }
  }

  const words = wordCount(body.html);
  const minutes = readingTime(body.html);
  const isLive = status === "PUBLISHED";
  const saveLabel = isLive ? "Save changes" : "Save draft";
  const savedTime = savedAt ? savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <form onSubmit={onSubmit} className="grid gap-8 pb-16 lg:grid-cols-[minmax(0,1fr)_320px] lg:pb-0">
      {/* On a phone the settings rail is a long scroll away, so the save
          button and its status ride along the bottom of the screen. Hidden
          on large screens, where the rail is always in view. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface/95 px-4 py-2 backdrop-blur lg:hidden">
        <span className="min-w-0 flex-1 truncate text-xs text-ink-3">
          {saveState === "saving" ? "Saving…" : dirty ? "Unsaved changes" : savedTime ? `Saved ${savedTime}` : "All changes saved"}
        </span>
        <button type="submit" disabled={pending || !!actionPending} className="btn btn-primary btn-sm">
          {pending ? "Saving…" : saveLabel}
        </button>
      </div>
      {/* The story */}
      <div className="flex flex-col gap-6">
        <div className="field">
          <label htmlFor="article-title" className="label">
            Title
          </label>
          <textarea
            id="article-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value.replace(/\n/g, " "));
              if (!slugTouched) setSlug(slugify(e.target.value));
              touch();
            }}
            required
            maxLength={200}
            rows={2}
            placeholder="A headline that says what happened"
            // field-sizing: content grows the box with the headline where
            // supported; elsewhere it stays two lines and scrolls.
            className="input resize-none py-3 font-serif text-2xl leading-tight [field-sizing:content] sm:text-3xl"
          />
        </div>

        <div className="field">
          <label htmlFor="article-dek" className="label">
            Dek (subtitle)
          </label>
          <input
            id="article-dek"
            value={dek}
            onChange={(e) => {
              setDek(e.target.value);
              touch();
            }}
            maxLength={300}
            placeholder="One sentence that makes the headline worth clicking"
            className="input font-serif text-lg"
          />
        </div>

        <div className="field">
          <div className="flex items-baseline justify-between">
            <span className="label">Body</span>
            <span className="hint tabular-nums">
              {words.toLocaleString("en-GB")} words · {minutes} min read
            </span>
          </div>
          <ArticleEditor
            initialContent={initial?.bodyJson}
            onChange={(json, html) => {
              setBody({ json, html });
              // The editor emits once on creation; that is not an edit.
              if (editorCreated.current) touch();
              editorCreated.current = true;
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="article-excerpt" className="label">
            Excerpt
          </label>
          <textarea
            id="article-excerpt"
            value={excerpt}
            onChange={(e) => {
              setExcerpt(e.target.value);
              touch();
            }}
            maxLength={500}
            rows={3}
            placeholder="Used in search results and share cards. Falls back to the dek."
            className="input resize-y"
          />
          <p className="hint">{500 - excerpt.length} characters left</p>
        </div>

        <details className="card group p-4 open:pb-5">
          <summary className="cursor-pointer text-sm font-medium">
            Search & sharing
            <span className="ml-2 font-normal text-ink-3">optional — title and description as they appear in Google</span>
          </summary>
          <div className="mt-4 grid gap-4">
            <div className="field">
              <label htmlFor="article-seo-title" className="label">
                Search title
              </label>
              <input
                id="article-seo-title"
                value={seoTitle}
                onChange={(e) => {
                  setSeoTitle(e.target.value);
                  touch();
                }}
                maxLength={70}
                placeholder={title || "Defaults to the headline"}
                className="input"
              />
              <p className={`hint ${seoTitle.length > 60 ? "text-warn" : ""}`}>
                {seoTitle.length}/70 · Google shows about 60
              </p>
            </div>
            <div className="field">
              <label htmlFor="article-seo-description" className="label">
                Search description
              </label>
              <textarea
                id="article-seo-description"
                value={seoDescription}
                onChange={(e) => {
                  setSeoDescription(e.target.value);
                  touch();
                }}
                maxLength={170}
                rows={2}
                placeholder={excerpt || dek || "Defaults to the excerpt, then the dek"}
                className="input resize-y"
              />
              <p className={`hint ${seoDescription.length > 160 ? "text-warn" : ""}`}>
                {seoDescription.length}/170 · Google shows about 160
              </p>
            </div>
          </div>
        </details>
      </div>

      {/* Settings rail */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <StatusPill status={status} />
            <span className="text-xs text-ink-3" role="status" aria-live="polite">
              {saveState === "saving"
                ? "Saving…"
                : saveState === "failed"
                  ? "Not saved"
                  : dirty
                    ? "Unsaved changes"
                    : savedTime
                      ? `Saved ${savedTime}`
                      : articleId
                        ? "All changes saved"
                        : "Autosaves as you type"}
            </span>
          </div>

          <button type="submit" disabled={pending || !!actionPending} className="btn btn-primary w-full py-2.5">
            {pending ? "Saving…" : saveLabel}
          </button>

          <div className="grid grid-cols-2 gap-2">
            {isLive ? (
              <button
                type="button"
                disabled={!!actionPending}
                onClick={() => {
                  if (window.confirm("Take this article off the site? It returns to being a draft.")) {
                    void runAction("unpublish", unpublishArticle, "DRAFT");
                  }
                }}
                className="btn btn-secondary btn-sm"
              >
                {actionPending === "unpublish" ? "Working…" : "Unpublish"}
              </button>
            ) : (
              <button
                type="button"
                disabled={!!actionPending || !canPublish}
                title={canPublish ? undefined : "Verify your email address to publish"}
                onClick={() => void runAction("publish", publishArticle, "PUBLISHED")}
                className="btn btn-secondary btn-sm text-ok disabled:text-ink-3"
              >
                {actionPending === "publish" ? "Publishing…" : status === "SCHEDULED" ? "Publish now" : "Publish"}
              </button>
            )}
            <button type="button" onClick={() => void openPreview()} disabled={!!actionPending} className="btn btn-secondary btn-sm gap-1">
              <ExternalIcon size={13} /> Preview
            </button>
          </div>

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <label className="flex items-start gap-2.5 border-t border-line pt-3 text-sm">
            <input
              type="checkbox"
              checked={isBreaking}
              onChange={(e) => {
                setIsBreaking(e.target.checked);
                touch();
              }}
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

        {!isLive && status !== "ARCHIVED" && (
          <div className="card p-4">
            <label htmlFor="article-schedule" className="label flex items-center gap-1.5">
              <ClockIcon size={14} /> Publish automatically at
            </label>
            <input
              id="article-schedule"
              type="datetime-local"
              value={scheduledFor}
              min={toLocalInput(new Date().toISOString())}
              onChange={(e) => {
                setScheduledFor(e.target.value);
                touch();
              }}
              disabled={!canPublish}
              className="input mt-2"
            />
            <p className="hint mt-1">
              {scheduledFor
                ? "Saving schedules it. Clear the time to cancel."
                : canPublish
                  ? "Leave empty to publish by hand."
                  : "Verify your email address to schedule."}
            </p>
          </div>
        )}

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
                  onClick={() => {
                    setCover(null);
                    touch();
                  }}
                  disabled={coverUploading}
                  className="btn btn-ghost btn-sm gap-1"
                >
                  <XIcon size={14} /> Remove
                </button>
              </div>
              <div className="field mt-3">
                <label htmlFor="article-cover-alt" className="label">
                  Caption / alt text
                </label>
                <input
                  id="article-cover-alt"
                  value={coverAlt}
                  onChange={(e) => {
                    setCoverAlt(e.target.value);
                    touch();
                  }}
                  maxLength={200}
                  placeholder="What the picture shows"
                  className="input"
                />
                <p className="hint">Read aloud to readers who cannot see it, and shown under the image.</p>
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
              onChange={(e) => {
                setCategoryId(e.target.value);
                touch();
              }}
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
            <label htmlFor="article-locale" className="label">
              Language
            </label>
            <select
              id="article-locale"
              value={locale}
              onChange={(e) => {
                if (isLocale(e.target.value)) setLocale(e.target.value);
                touch();
              }}
              className="input"
            >
              {LOCALES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
            <p className="hint">The language the story is written in. Readers see it marked when it differs from their own.</p>
          </div>

          <div className="field">
            <label htmlFor="article-translation-of" className="label">
              Translation of <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <input
              id="article-translation-of"
              value={translationOfSlug}
              onChange={(e) => {
                setTranslationOfSlug(e.target.value.trim().toLowerCase());
                touch();
              }}
              placeholder="slug of the original, e.g. budget-vote-2026"
              className="input"
            />
            <p className="hint">Links this story to the same story in another language: each page offers the other, and search engines treat them as one.</p>
          </div>

          <div className="field">
            <label htmlFor="article-tags" className="label">
              Tags (comma-separated)
            </label>
            <input
              id="article-tags"
              value={tagSlugs}
              onChange={(e) => {
                setTagSlugs(e.target.value);
                touch();
              }}
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
                touch();
              }}
              required
              className="input font-mono text-xs"
            />
            <p className="hint break-all">/article/{slug || "…"}</p>
          </div>
        </div>

        {articleId && status !== "ARCHIVED" && (
          <button
            type="button"
            disabled={!!actionPending}
            onClick={() => {
              if (window.confirm("Archive this article? It leaves the site; the list keeps it for the record.")) {
                void runAction("archive", archiveArticle, "ARCHIVED");
              }
            }}
            className="btn btn-ghost btn-sm self-start text-danger"
          >
            {actionPending === "archive" ? "Archiving…" : "Archive article"}
          </button>
        )}
      </aside>
    </form>
  );
}
