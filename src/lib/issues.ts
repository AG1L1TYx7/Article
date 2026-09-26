import { db } from "@/lib/db";
import { issueSlug, newReference } from "@/lib/issueRef";
import {
  PUBLIC_STATUSES,
  canTransition,
  canView,
  publicReporter,
  type IssueStatus,
} from "@/lib/issueVisibility";

export { issueSlug, newReference };

/**
 * Reading and writing reported issues.
 *
 * The database half of lib/issueVisibility.ts, which holds the rules. This
 * module's job is to make sure every query goes through them — the rules
 * are worth nothing if one page can write its own `where` clause and
 * forget the status filter.
 *
 * So there is exactly one public-facing selector here, `PUBLIC_SELECT`,
 * and exactly one function that turns a row into something renderable,
 * `toPublicIssue`. Neither accepts a viewer who might be staff: staff
 * reads go through the queue functions, which are permission-gated at the
 * call site. Keeping the two apart means a public page cannot accidentally
 * be handed a staff projection.
 */

/**
 * Everything a public page may read.
 *
 * `reporter` is selected because `publicReporter()` needs it to decide
 * whether to name anybody — it is read here and dropped there, never
 * handed onward. Nothing in this selector is a field the platform would
 * not print.
 */
const PUBLIC_SELECT = {
  id: true,
  reference: true,
  slug: true,
  title: true,
  body: true,
  status: true,
  anonymous: true,
  reporterId: true,
  ward: true,
  publishedAt: true,
  resolvedAt: true,
  resolutionNote: true,
  createdAt: true,
  reporter: { select: { id: true, name: true, handle: true, avatarUrl: true } },
  category: { select: { slug: true, name: true } },
  province: { select: { id: true, name: true, nameNe: true } },
  district: { select: { id: true, name: true, nameNe: true } },
  municipality: { select: { id: true, name: true, nameNe: true } },
  media: {
    orderBy: { sort: "asc" },
    select: { media: { select: { url: true, width: true, height: true, altText: true } } },
  },
} as const;

type IssueRowWithRelations = Awaited<
  ReturnType<typeof db.issue.findFirstOrThrow<{ select: typeof PUBLIC_SELECT }>>
>;

/**
 * A row, reduced to what may be shown.
 *
 * The reporter is replaced by the marker `publicReporter()` returns, so
 * the identifying fields do not survive this function even in memory on
 * the way to a template.
 */
export function toPublicIssue(row: IssueRowWithRelations) {
  // Every field named, rather than spread-and-drop.
  //
  // A spread that removes two keys keeps whatever else the selector
  // gathers, so adding a column to PUBLIC_SELECT later would publish it
  // without anybody deciding to. Naming them means a new field is invisible
  // here until somebody writes it down, which is the right default for the
  // one function that decides what leaves the server.
  return {
    id: row.id,
    reference: row.reference,
    slug: row.slug,
    title: row.title,
    body: row.body,
    status: row.status,
    anonymous: row.anonymous,
    ward: row.ward,
    publishedAt: row.publishedAt,
    resolvedAt: row.resolvedAt,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt,
    category: row.category,
    province: row.province,
    district: row.district,
    municipality: row.municipality,
    reportedBy: publicReporter(row),
    media: row.media.map((m) => m.media),
  };
}

export type PublicIssue = ReturnType<typeof toPublicIssue>;

/**
 * Published reports, newest first, optionally narrowed to a place.
 *
 * The status filter is not a parameter. A caller that could pass one could
 * pass the wrong one, and the wrong one here publishes an accusation
 * nobody has checked.
 */
export async function listPublishedIssues(filter: {
  districtId?: string;
  provinceId?: string;
  categorySlug?: string;
  take?: number;
  skip?: number;
} = {}): Promise<PublicIssue[]> {
  const rows = await db.issue.findMany({
    where: {
      status: { in: PUBLIC_STATUSES },
      ...(filter.districtId ? { districtId: filter.districtId } : {}),
      ...(filter.provinceId ? { provinceId: filter.provinceId } : {}),
      ...(filter.categorySlug ? { category: { slug: filter.categorySlug } } : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: Math.min(filter.take ?? 20, 50),
    skip: filter.skip ?? 0,
    select: PUBLIC_SELECT,
  });
  return rows.map(toPublicIssue);
}

export async function countPublishedIssues(filter: { districtId?: string; provinceId?: string } = {}) {
  return db.issue.count({
    where: {
      status: { in: PUBLIC_STATUSES },
      ...(filter.districtId ? { districtId: filter.districtId } : {}),
      ...(filter.provinceId ? { provinceId: filter.provinceId } : {}),
    },
  });
}

/**
 * One report, by slug, for whoever is asking.
 *
 * Returns null rather than throwing for something the viewer may not see,
 * and returns the same null for something that does not exist — so the
 * page cannot be used to discover that a report about somebody is sitting
 * unpublished in the queue.
 */
export async function getIssueForViewer(
  slug: string,
  viewer: { id: string; permissions: string[] } | null
): Promise<PublicIssue | null> {
  const row = await db.issue.findUnique({ where: { slug }, select: PUBLIC_SELECT });
  if (!row) return null;
  if (!canView({ ...row, status: row.status as IssueStatus }, viewer)) return null;
  return toPublicIssue(row);
}

export interface SubmitIssueInput {
  title: string;
  body: string;
  categoryId?: string | null;
  districtId: string;
  municipalityId?: string | null;
  ward?: number | null;
  anonymous: boolean;
  mediaIds?: string[];
}

/**
 * Files a report.
 *
 * The province is derived from the district rather than accepted from the
 * form: they must agree, and the only way to be sure of that is to look it
 * up. A form that posts both can post a mismatched pair, and the report
 * then appears under a province its district is not in.
 */
export async function submitIssue(reporterId: string, input: SubmitIssueInput) {
  const district = await db.district.findUnique({
    where: { id: input.districtId },
    select: { id: true, provinceId: true },
  });
  if (!district) throw new Error("Unknown district");

  // Only media this person uploaded may be attached.
  //
  // The ids come from the browser, so without this check a report could
  // carry somebody else's photograph — a picture from an unrelated
  // article, or worse, evidence from another reporter's unpublished
  // report, which would attach their material to a public accusation.
  const ownMedia = input.mediaIds?.length
    ? await db.media.findMany({
        where: { id: { in: input.mediaIds }, uploadedById: reporterId },
        select: { id: true },
      })
    : [];

  const reference = newReference();
  const slug = issueSlug(input.title, reference);

  return db.issue.create({
    data: {
      reference,
      slug,
      title: input.title.trim(),
      body: input.body.trim(),
      reporterId,
      anonymous: input.anonymous,
      categoryId: input.categoryId || null,
      provinceId: district.provinceId,
      districtId: district.id,
      municipalityId: input.municipalityId || null,
      ward: input.ward ?? null,
      status: "SUBMITTED",
      ...(ownMedia.length
        ? { media: { create: ownMedia.map((m, sort) => ({ mediaId: m.id, sort })) } }
        : {}),
    },
    select: { id: true, reference: true, slug: true },
  });
}

/**
 * The verifier's queue.
 *
 * Gated by `issue.verify` at every call site — this function does not
 * check, because it has no session; it is the reason the permission
 * exists. It returns the reporter, which is the point: a verifier has to
 * be able to go back and ask.
 */
export async function listQueue(status?: IssueStatus) {
  return db.issue.findMany({
    where: status ? { status } : { status: { in: ["SUBMITTED", "UNDER_REVIEW", "VERIFIED"] } },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      reference: true,
      slug: true,
      title: true,
      status: true,
      anonymous: true,
      createdAt: true,
      ward: true,
      reporter: { select: { id: true, name: true, handle: true, email: true } },
      district: { select: { id: true, name: true, nameNe: true } },
      province: { select: { id: true, name: true } },
      category: { select: { name: true } },
      verifiedBy: { select: { name: true } },
      _count: { select: { media: true } },
    },
  });
}

export class IssueTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueTransitionError";
  }
}

/**
 * Moves a report along, refusing anything the lifecycle forbids.
 *
 * The forbidden ones are the point: a rejected report must not quietly
 * become published, and a published one must not slide back out of sight.
 * See the transition table in lib/issueVisibility.ts.
 */
export async function transitionIssue(params: {
  issueId: string;
  to: IssueStatus;
  actorId: string;
  note?: string | null;
}) {
  const issue = await db.issue.findUnique({
    where: { id: params.issueId },
    select: { id: true, status: true, reporterId: true, districtId: true },
  });
  if (!issue) throw new IssueTransitionError("That report no longer exists.");

  const from = issue.status as IssueStatus;
  if (!canTransition(from, params.to)) {
    throw new IssueTransitionError(
      `A report that is ${from.toLowerCase().replace("_", " ")} cannot become ${params.to
        .toLowerCase()
        .replace("_", " ")}.`
    );
  }

  const now = new Date();
  await db.issue.update({
    where: { id: issue.id },
    data: {
      status: params.to,
      ...(params.to === "UNDER_REVIEW" ? { verifiedById: params.actorId } : {}),
      ...(params.to === "VERIFIED" ? { verifiedById: params.actorId, verifiedAt: now } : {}),
      ...(params.to === "PUBLISHED" ? { publishedAt: now } : {}),
      ...(params.to === "RESOLVED" ? { resolvedAt: now, resolutionNote: params.note ?? null } : {}),
      ...(params.to === "REJECTED" ? { reviewNote: params.note ?? null, verifiedById: params.actorId } : {}),
    },
  });

  return { from, to: params.to, issue };
}
