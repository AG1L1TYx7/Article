/**
 * Date and text formatting shared by the public site and the newsroom.
 *
 * Fixed locale and time zone on purpose. `toLocaleDateString()` with no
 * arguments picks whatever the machine it runs on is set to, so the
 * server renders "9/20/2026" and a reader in London hydrates "20/09/2026",
 * which React reports as a hydration mismatch. One formatter, one answer.
 */

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const longDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  return dateFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  return dateTimeFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function formatLongDate(value: Date | string): string {
  return longDateFormatter.format(typeof value === "string" ? new Date(value) : value);
}

/**
 * "3 minutes ago" style, used where the exact time matters less than
 * how recent something is. Falls back to the date once it is old enough
 * that "412 hours ago" would be silly.
 */
export function formatRelative(value: Date | string, now: Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(date);
}

/** Estimated reading time from HTML, at an ordinary reading pace. */
export function readingTime(html: string): number {
  const words = html
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** Up to two initials for an avatar disc. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return (parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "");
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? singular : pluralForm}`;
}
