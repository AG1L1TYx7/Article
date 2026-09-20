/**
 * An article's status as a coloured pill. The text is the enum value
 * itself — DRAFT, PUBLISHED, ARCHIVED — so what staff read matches what
 * the audit log and the database say.
 */
export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "PUBLISHED" ? "pill-ok" : status === "ARCHIVED" ? "pill-danger" : "pill-neutral";
  return <span className={`pill ${tone}`}>{status}</span>;
}
