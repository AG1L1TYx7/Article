"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { submitIssueAction } from "../actions";

interface Evidence {
  id: string;
  url: string;
  width?: number;
  height?: number;
}

interface DistrictOption {
  id: string;
  name: string;
  nameNe: string;
  province: { name: string };
}

/**
 * The report form.
 *
 * The anonymity choice is given its own block with the consequences spelled
 * out, rather than a checkbox in a row of checkboxes. On a platform whose
 * sectors include corruption, this is the most consequential thing on the
 * page and the person ticking it may be deciding whether their neighbours
 * can work out who filed it.
 */
export function ReportForm({
  districts,
  categories,
  defaultDistrictId,
  canSubmit,
}: {
  districts: DistrictOption[];
  categories: { id: string; name: string }[];
  defaultDistrictId: string;
  canSubmit: boolean;
}) {
  const [anonymous, setAnonymous] = useState(false);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; slug: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await submitIssueAction({
        title: String(form.get("title") ?? ""),
        body: String(form.get("body") ?? ""),
        districtId: String(form.get("districtId") ?? ""),
        ward: String(form.get("ward") ?? ""),
        categoryId: String(form.get("categoryId") ?? ""),
        anonymous,
        mediaIds: evidence.map((e) => e.id),
      });
      if (!result.ok) {
        setError(result.error ?? "Could not submit that.");
        return;
      }
      setDone({ reference: result.reference!, slug: result.slug! });
    });
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setError(null);
    setUploading(true);

    // One at a time rather than in parallel: these are phone photos on a
    // connection that may be poor, and eight simultaneous uploads is how
    // all eight fail together.
    for (const file of files.slice(0, 8 - evidence.length)) {
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/issues/evidence", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "That photo could not be uploaded.");
          break;
        }
        setEvidence((prev) => [...prev, data as Evidence]);
      } catch {
        setError("That photo could not be uploaded. Check your connection.");
        break;
      }
    }

    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  if (done) {
    return (
      <div className="card mt-8 p-6">
        <h2 className="text-lg font-medium">Report received</h2>
        <p className="mt-2 text-sm text-ink-2">
          Somebody will check it before anything is published. You will be told either way —
          including if it cannot be verified, and why.
        </p>
        <p className="mt-4 text-sm">
          Your reference is{" "}
          <code className="font-mono text-base font-medium">{done.reference}</code>
        </p>
        <p className="mt-1 text-xs text-ink-3">
          Write it down. It is how you refer to this report, here or at an office.
        </p>
        <p className="mt-5">
          <Link href={`/issues/${done.slug}`} className="btn btn-secondary btn-sm">
            Follow your report
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
      <label className="field">
        <span className="label">What happened</span>
        <input
          name="title"
          required
          minLength={10}
          maxLength={180}
          placeholder="Ward office asking for money for a free service"
          className="input"
        />
        <span className="mt-1 text-xs text-ink-3">
          One line. Say what happened, not how it made you feel — it has to be checkable.
        </span>
      </label>

      <label className="field">
        <span className="label">Tell us more</span>
        <textarea
          name="body"
          required
          minLength={60}
          maxLength={20000}
          rows={10}
          placeholder="When did it happen, where exactly, who was involved, and what was said or done. Anything that can be checked — dates, amounts, names of offices — makes it far more likely this can be verified and published."
          className="input"
        />
        <span className="mt-1 text-xs text-ink-3">
          Details that can be checked are what lets this be published. A report nobody can
          verify cannot go out, however true it is.
        </span>
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="field">
          <span className="label">District</span>
          <select name="districtId" required defaultValue={defaultDistrictId} className="input">
            <option value="">Choose a district…</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.nameNe} ({d.province.name})
              </option>
            ))}
          </select>
          <span className="mt-1 text-xs text-ink-3">
            This decides who is told about it once it is published.
          </span>
        </label>

        <label className="field">
          <span className="label">Ward number (if you know it)</span>
          <input name="ward" type="number" min={1} max={40} className="input" />
        </label>
      </div>

      <label className="field">
        <span className="label">Which area of work (optional)</span>
        <select name="categoryId" defaultValue="" className="input">
          <option value="">Not sure</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span className="label">Photographs (optional)</span>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          disabled={uploading || evidence.length >= 8}
          onChange={onPickFiles}
          className="input"
        />
        <span className="mt-1 text-xs text-ink-3">
          Up to eight photos, 10MB each. Location data is stripped from every photo before it is
          stored — a picture usually records where it was taken, and that would say more about
          you than your name would.
        </span>

        {evidence.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {evidence.map((e) => (
              <div key={e.id} className="relative">
                <Image
                  src={e.url}
                  alt=""
                  width={e.width ?? 200}
                  height={e.height ?? 150}
                  className="h-24 w-full rounded-md border border-rule object-cover"
                />
                <button
                  type="button"
                  onClick={() => setEvidence((prev) => prev.filter((x) => x.id !== e.id))}
                  className="absolute right-1 top-1 rounded bg-ink/70 px-1.5 text-xs text-white"
                  aria-label="Remove this photo"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {uploading && <p className="mt-2 text-xs text-ink-2">Uploading…</p>}
      </div>

      {/* The safety decision, given its own weight on the page. */}
      <fieldset className="rounded-md border border-rule p-4">
        <legend className="label px-1">Your name</legend>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span>
            <span className="font-medium">Publish this without my name</span>
            <span className="mt-1 block text-xs text-ink-2">
              Your name will not appear anywhere public, now or later. The people who check
              reports will still see it — they may need to ask you something, and a report
              nobody can follow up on usually cannot be verified.
            </span>
          </span>
        </label>
        {!anonymous && (
          <p className="mt-3 text-xs text-ink-3">
            Your name and handle will appear on the published report. That carries more weight
            with an office — but consider whether it is safe where you live.
          </p>
        )}
      </fieldset>

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !canSubmit}
        className="btn btn-primary w-full py-2.5"
      >
        {pending ? "Sending…" : "Submit report"}
      </button>
    </form>
  );
}
