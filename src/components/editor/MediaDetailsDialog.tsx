"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { getMediaDetails, setMediaRights, type MediaRightsResult } from "@/app/(dashboard)/dashboard/media/actions";
import { LICENSES, MEDIA_LICENSES, creditLine, type MediaLicenseCode } from "@/lib/mediaRights";

/**
 * Caption, credit, licence and rights confirmation for one file.
 *
 * Opens right after an upload, before the file goes into the story, and
 * again from the figure's "Details" button. Nothing is inserted until the
 * form is complete and the person has confirmed the newsroom may publish
 * the file under those terms — an article cannot be published with a
 * file that lacks this, so it is asked for at the moment the file is
 * chosen, when the person still remembers where it came from.
 */
export interface MediaDetailsValues {
  title: string | null;
  caption: string | null;
  altText: string | null;
  credit: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  license: MediaLicenseCode | null;
  rightsNote: string | null;
  transcript: string | null;
  rightsConfirmedAt: Date | null;
}

export interface MediaDetailsDone extends MediaDetailsValues {
  /** The line to show under the file: "Photo: Jane Doe / Reuters · CC BY 4.0". */
  creditLine: string | null;
}

export function MediaDetailsDialog({
  media,
  onDone,
  onCancel,
}: {
  media: { id: string; type: "IMAGE" | "VIDEO" | "AUDIO"; url: string };
  onDone: (values: MediaDetailsDone) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const idPrefix = useId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [altText, setAltText] = useState("");
  const [credit, setCredit] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [license, setLicense] = useState<MediaLicenseCode | "">("");
  const [rightsNote, setRightsNote] = useState("");
  const [transcript, setTranscript] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  // Prefill from the server, so re-opening Details shows what was saved
  // (the licence and note live on the Media row, not in the document).
  useEffect(() => {
    let cancelled = false;
    getMediaDetails(media.id).then((result) => {
      if (cancelled) return;
      if (result.ok && result.media) {
        const m = result.media;
        setTitle(m.title ?? "");
        setCaption(m.caption ?? "");
        setAltText(m.altText ?? "");
        setCredit(m.credit ?? "");
        setSourceName(m.sourceName ?? "");
        setSourceUrl(m.sourceUrl ?? "");
        setLicense((m.license as MediaLicenseCode | null) ?? "");
        setRightsNote(m.rightsNote ?? "");
        setTranscript(m.transcript ?? "");
        setConfirmed(!!m.rightsConfirmedAt);
      } else if (!result.ok) {
        setError(result.error ?? "Could not load this file's details.");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [media.id]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const info = license ? LICENSES[license] : null;
  const kindWord = media.type === "IMAGE" ? "image" : media.type === "VIDEO" ? "video" : "audio clip";
  const needsCredit = !!info?.requiresCredit && !credit.trim() && !sourceName.trim();
  const needsNote = !!info?.requiresNote && !rightsNote.trim();
  const needsAlt = media.type === "IMAGE" && !altText.trim();
  const incomplete = !license || needsCredit || needsNote || needsAlt || !confirmed;

  function submit() {
    if (!license) return;
    setError(null);
    startTransition(async () => {
      const result: MediaRightsResult = await setMediaRights({
        mediaId: media.id,
        title,
        caption,
        altText,
        credit,
        sourceName,
        sourceUrl,
        license,
        rightsNote,
        transcript,
        confirmed,
      });
      if (!result.ok || !result.media) {
        setError(result.error ?? "That didn't save.");
        return;
      }
      const m = result.media;
      onDone({
        title: m.title,
        caption: m.caption,
        altText: m.altText,
        credit: m.credit,
        sourceName: m.sourceName,
        sourceUrl: m.sourceUrl,
        license: m.license as MediaLicenseCode | null,
        rightsNote: m.rightsNote,
        transcript: m.transcript,
        rightsConfirmedAt: m.rightsConfirmedAt,
        creditLine: creditLine(media.type, { credit: m.credit, sourceName: m.sourceName, license: m.license as MediaLicenseCode | null }),
      });
    });
  }

  // Rendered at the end of <body>, never inside the article form: a form
  // inside a form makes the Save button submit the outer one, and the
  // dialog closes with nothing saved. The portal keeps this form its own.
  return createPortal(
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby={`${idPrefix}-title`}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-ink/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex max-h-[calc(100vh-4rem)] flex-col"
      >
        <div className="border-b border-line px-6 py-4">
          <h2 id={`${idPrefix}-title`} className="text-lg font-medium">
            About this {kindWord}
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Every file we publish carries a credit and a licence. Readers see the credit under the file and in the
            story&apos;s credits; the licence is linked to its terms.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-sm text-ink-3">Loading…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {media.type !== "AUDIO" && (
                <div className="sm:col-span-2 flex items-start gap-3">
                  {media.type === "IMAGE" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- just uploaded through this site's own pipeline
                    <img src={media.url} alt="" className="h-20 w-28 shrink-0 rounded-md bg-surface-2 object-cover" />
                  ) : (
                    <video src={media.url} preload="metadata" muted className="h-20 w-28 shrink-0 rounded-md bg-black object-cover" />
                  )}
                  {media.type === "IMAGE" && (
                    <div className="field flex-1">
                      <label htmlFor={`${idPrefix}-alt`} className="label">
                        Alt text <span className="text-danger">*</span>
                      </label>
                      <input id={`${idPrefix}-alt`} value={altText} onChange={(e) => setAltText(e.target.value)} maxLength={200} className="input" placeholder="What the picture shows, for readers who cannot see it" />
                    </div>
                  )}
                </div>
              )}

              <div className="field sm:col-span-2">
                <label htmlFor={`${idPrefix}-caption`} className="label">
                  Caption
                </label>
                <input id={`${idPrefix}-caption`} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={1000} className="input" placeholder="Shown under the file" />
              </div>

              {media.type !== "IMAGE" && (
                <div className="field sm:col-span-2">
                  <label htmlFor={`${idPrefix}-title-input`} className="label">
                    Title
                  </label>
                  <input id={`${idPrefix}-title-input`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={191} className="input" placeholder={media.type === "AUDIO" ? "e.g. Interview with the council leader" : "e.g. Drone footage of the site"} />
                </div>
              )}

              <div className="field">
                <label htmlFor={`${idPrefix}-credit`} className="label">
                  Creator {info?.requiresCredit && <span className="text-danger">*</span>}
                </label>
                <input id={`${idPrefix}-credit`} value={credit} onChange={(e) => setCredit(e.target.value)} maxLength={191} className="input" placeholder="Photographer, filmmaker, producer" />
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}-source`} className="label">
                  Source
                </label>
                <input id={`${idPrefix}-source`} value={sourceName} onChange={(e) => setSourceName(e.target.value)} maxLength={191} className="input" placeholder="Agency, archive, organisation" />
              </div>
              <div className="field sm:col-span-2">
                <label htmlFor={`${idPrefix}-source-url`} className="label">
                  Source link
                </label>
                <input id={`${idPrefix}-source-url`} type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} maxLength={2000} className="input" placeholder="https://… where the file came from" />
              </div>

              <div className="field sm:col-span-2">
                <label htmlFor={`${idPrefix}-license`} className="label">
                  Licence <span className="text-danger">*</span>
                </label>
                <select id={`${idPrefix}-license`} value={license} onChange={(e) => setLicense(e.target.value as MediaLicenseCode | "")} className="input">
                  <option value="">Choose…</option>
                  {MEDIA_LICENSES.map((code) => (
                    <option key={code} value={code}>
                      {LICENSES[code].label}
                    </option>
                  ))}
                </select>
                {info && (
                  <p className="hint">
                    {info.description}{" "}
                    {info.url && (
                      <a href={info.url} target="_blank" rel="noopener noreferrer" className="text-link">
                        Read the terms
                      </a>
                    )}
                  </p>
                )}
              </div>

              {info?.requiresNote && (
                <div className="field sm:col-span-2">
                  <label htmlFor={`${idPrefix}-note`} className="label">
                    Basis <span className="text-danger">*</span>
                  </label>
                  <textarea id={`${idPrefix}-note`} value={rightsNote} onChange={(e) => setRightsNote(e.target.value)} maxLength={2000} rows={2} className="input" placeholder={license === "PERMISSION" ? "Who gave permission, how (email, contract) and when" : license === "PUBLIC_DOMAIN" ? "Why copyright does not apply, e.g. published 1890; US federal government work" : "Name the licence or agreement"} />
                </div>
              )}

              {media.type !== "IMAGE" && (
                <div className="field sm:col-span-2">
                  <label htmlFor={`${idPrefix}-transcript`} className="label">
                    Transcript
                  </label>
                  <textarea id={`${idPrefix}-transcript`} value={transcript} onChange={(e) => setTranscript(e.target.value)} maxLength={50_000} rows={4} className="input font-mono text-xs" placeholder="What is said, for readers who cannot hear it and for search" />
                </div>
              )}

              <label className="sm:col-span-2 flex items-start gap-2 rounded-md border border-line bg-surface-2 p-3 text-sm">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                <span>
                  I confirm we have the right to publish this {kindWord} under the licence chosen, and the credit is
                  accurate. <span className="text-ink-3">Recorded in the audit log with your name.</span>
                </span>
              </label>
            </div>
          )}
          {error && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-3">
          <p className="text-xs text-ink-3">
            {incomplete && !loading
              ? needsAlt
                ? "Alt text is required."
                : !license
                  ? "Choose a licence."
                  : needsCredit
                    ? "This licence needs the creator or source named."
                    : needsNote
                      ? "Explain the basis."
                      : "Tick the confirmation to continue."
              : ""}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={loading || pending || incomplete}>
              {pending ? "Saving…" : "Save details"}
            </button>
          </div>
        </div>
      </form>
    </dialog>,
    document.body
  );
}
