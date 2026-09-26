import { db } from "@/lib/db";
import { pushToUser } from "@/lib/push";
import { issueInDistrictPayload, yourIssueUpdatedPayload } from "@/lib/pushPayload";

/**
 * Telling people that something was reported where they live.
 *
 * The part of the platform that makes a report useful rather than merely
 * filed: somebody in Rautahat should learn that a verified report concerns
 * Rautahat without having to go looking for it.
 *
 * Three rules shape everything here.
 *
 * **Only published reports.** This is called from the publish transition
 * and re-checks the status itself rather than trusting the caller — a
 * notification is the one action that cannot be taken back, and an alert
 * about an unverified accusation would reach phones before anybody could
 * undo it.
 *
 * **The reporter is never named.** Not in the in-app row, not in the push
 * payload, whether or not the report is anonymous. A push notification is
 * the least controllable surface this platform has: it lands on a lock
 * screen that anybody standing nearby can read. In a district where the
 * subject of a report and its author live on the same street, a byline on
 * a lock screen is a safety failure, so this layer simply never has one to
 * leak.
 *
 * **Nobody is told twice.** The unique index on
 * (userId, type, issueId) makes a second attempt a no-op rather than a
 * duplicate — a report can be published, corrected and resolved, and each
 * of those paths tries to tell the district.
 */

/**
 * How many people one report may alert in a single pass.
 *
 * Kathmandu district alone could be tens of thousands of members. A cap
 * keeps one publish from becoming a long-running write that blocks the
 * request that triggered it; the rest is a job for a queue, which this
 * platform does not have yet and should not pretend to.
 */
const DISTRICT_FANOUT_LIMIT = 2000;

export interface AlertResult {
  notified: number;
  /** True when the district has more members than one pass may alert. */
  truncated: boolean;
}

/**
 * Alerts members whose home district matches a newly published report.
 *
 * The reporter is excluded: they know. Suspended and erased accounts are
 * excluded because they are not members any more.
 */
export async function alertDistrictOfIssue(issueId: string): Promise<AlertResult> {
  const issue = await db.issue.findUnique({
    where: { id: issueId },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      reporterId: true,
      districtId: true,
      district: { select: { name: true } },
    },
  });

  // Re-checked here, not trusted from the caller. See the note above.
  if (!issue || issue.status !== "PUBLISHED") return { notified: 0, truncated: false };

  const residents = await db.user.findMany({
    where: {
      districtId: issue.districtId,
      status: "ACTIVE",
      anonymisedAt: null,
      id: { not: issue.reporterId },
    },
    select: { id: true },
    take: DISTRICT_FANOUT_LIMIT + 1,
  });

  const truncated = residents.length > DISTRICT_FANOUT_LIMIT;
  const recipients = truncated ? residents.slice(0, DISTRICT_FANOUT_LIMIT) : residents;
  if (!recipients.length) return { notified: 0, truncated };

  // createMany with skipDuplicates leans on the unique index rather than
  // reading first and writing second, which would race two publishes.
  const created = await db.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.id,
      type: "ISSUE_IN_YOUR_DISTRICT" as const,
      issueId: issue.id,
    })),
    skipDuplicates: true,
  });

  // Push is best effort and deliberately after the durable rows: the
  // in-app notification is the record, and a push that fails must not
  // cost somebody the alert entirely.
  const payload = issueInDistrictPayload({
    slug: issue.slug,
    title: issue.title,
    districtName: issue.district.name,
  });
  await Promise.allSettled(recipients.map((r) => pushToUser(r.id, payload)));

  return { notified: created.count, truncated };
}

/**
 * Tells a reporter what happened to their own report.
 *
 * Sent for every outcome, including rejection. Somebody who took the risk
 * of reporting something is owed an answer either way, and silence after a
 * rejection is how a platform teaches people not to bother.
 */
export async function alertReporterOfChange(issueId: string): Promise<void> {
  const issue = await db.issue.findUnique({
    where: { id: issueId },
    select: { id: true, slug: true, title: true, status: true, reporterId: true },
  });
  if (!issue) return;

  await db.notification
    .create({
      data: {
        userId: issue.reporterId,
        type: "YOUR_ISSUE_UPDATED",
        issueId: issue.id,
      },
    })
    .catch(() => {
      // The unique index fired: they have been told about this report
      // before. Their own report changing twice is worth one row.
    });

  await pushToUser(
    issue.reporterId,
    yourIssueUpdatedPayload({ slug: issue.slug, title: issue.title, status: issue.status })
  ).catch(() => {});
}
