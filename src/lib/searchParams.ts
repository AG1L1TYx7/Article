/**
 * Shared parsing for the /search query string.
 *
 * Search is a plain GET form, so every filter arrives as untrusted text in
 * the URL. Parsing lives here so the page, the form and the pagination
 * links all agree on what a parameter means.
 */
export const DATE_RANGES = [
  { value: "", label: "Any time" },
  { value: "24h", label: "Past 24 hours" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "year", label: "Past year" },
] as const;

export type DateRange = (typeof DATE_RANGES)[number]["value"];

const RANGE_MS: Record<Exclude<DateRange, "">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

export function isDateRange(value: string): value is DateRange {
  return DATE_RANGES.some((r) => r.value === value);
}

export function rangeToSince(range: DateRange, now = new Date()): Date | undefined {
  if (!range) return undefined;
  return new Date(now.getTime() - RANGE_MS[range]);
}

/** Collapses `string | string[] | undefined` from searchParams to one string. */
export function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export interface SearchQuery {
  q: string;
  category: string;
  author: string;
  range: DateRange;
  page: number;
}

export function parseSearchParams(params: Record<string, string | string[] | undefined>): SearchQuery {
  const rawRange = one(params.range);
  const page = Number.parseInt(one(params.page), 10);
  return {
    q: one(params.q),
    // Slugs and handles are only ever compared against the database, so an
    // unknown value simply matches nothing.
    category: one(params.category).slice(0, 160),
    author: one(params.author).slice(0, 60),
    range: isDateRange(rawRange) ? rawRange : "",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 500) : 1,
  };
}

/** Builds a /search URL, dropping empty filters so links stay readable. */
export function searchHref(query: Partial<SearchQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.author) params.set("author", query.author);
  if (query.range) params.set("range", query.range);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}
