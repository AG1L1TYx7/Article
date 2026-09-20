import { db } from "@/lib/db";
import type { Dimension, ViewContext } from "@/lib/analyticsClassify";

export { classifyReferrer, countryFrom, deviceFrom } from "@/lib/analyticsClassify";
export type { Dimension, ViewContext } from "@/lib/analyticsClassify";

/**
 * First-party, privacy-preserving analytics capture.
 *
 * Everything recorded here is a count in a bucket — article × day ×
 * (country | referrer class | device class) — or a sum of reading time.
 * No row carries an identifier, an IP address, a user id or a cookie, so
 * the tables are not personal data and the privacy policy can say so.
 * That is also why there is no third-party analytics script: the same
 * questions ("where are readers, how long do they stay, how did they get
 * here") are answered without handing readers to anyone.
 *
 * The classifiers that produce the buckets live in analyticsClassify.ts,
 * which has no database import so they can be unit-tested.
 */

/** Bumps the three dimension buckets for one view. Bots are counted under device only. */
export async function recordViewDimensions(articleId: string, ctx: ViewContext): Promise<void> {
  const rows: [Dimension, string][] = [["device", ctx.device]];
  if (ctx.device !== "bot") {
    rows.push(["country", ctx.country], ["referrer", ctx.referrer]);
  }
  for (const [dimension, value] of rows) {
    await db.$executeRaw`INSERT INTO \`ViewDimensionDaily\` (\`articleId\`, \`day\`, \`dimension\`, \`value\`, \`views\`)
      VALUES (${articleId}, UTC_DATE(), ${dimension}, ${value}, 1)
      ON DUPLICATE KEY UPDATE \`views\` = \`views\` + 1`;
  }
}

export interface ReadSample {
  /** Seconds the tab was visible with the article on screen. */
  activeSeconds: number;
  /** Furthest point scrolled, 0–100. */
  scrollDepth: number;
}

/** Folds one reader's session into the day's aggregate for the article. */
export async function recordRead(articleId: string, sample: ReadSample): Promise<void> {
  const seconds = Math.max(0, Math.min(3600, Math.round(sample.activeSeconds)));
  const scroll = Math.max(0, Math.min(100, Math.round(sample.scrollDepth)));
  const completed = scroll >= 90 ? 1 : 0;
  await db.$executeRaw`INSERT INTO \`ArticleReadDaily\` (\`articleId\`, \`day\`, \`reads\`, \`activeSeconds\`, \`completions\`, \`scrollSum\`)
    VALUES (${articleId}, UTC_DATE(), 1, ${seconds}, ${completed}, ${scroll})
    ON DUPLICATE KEY UPDATE \`reads\` = \`reads\` + 1, \`activeSeconds\` = \`activeSeconds\` + ${seconds},
      \`completions\` = \`completions\` + ${completed}, \`scrollSum\` = \`scrollSum\` + ${scroll}`;
}
