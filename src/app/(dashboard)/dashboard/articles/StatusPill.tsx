/**
 * An article's status as a coloured pill. The text is the enum value
 * itself — DRAFT, SCHEDULED, PUBLISHED, ARCHIVED — so what staff read
 * matches what the audit log and the database say.
 *
 * One colour per meaning, the same everywhere: grey for a draft, slate
 * for something scheduled, green for live, and a muted grey for archived.
 * Red is kept for things that are wrong, and an archived story is not.
 */
export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "PUBLISHED"
      ? "pill-ok"
      : status === "SCHEDULED"
        ? "pill-info"
        : status === "ARCHIVED"
          ? "pill-neutral opacity-70"
          : "pill-neutral";
  return <span className={`pill ${tone}`}>{status}</span>;
}
