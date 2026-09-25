/**
 * Creates the fixed rows the e2e suite expects to already exist.
 *
 * Right now that is one thing: somewhere to park the approved comments
 * that make a test account "trusted" (see TRUSTED_AFTER_APPROVED_COMMENTS
 * in src/lib/spam.ts). Those warm-ups must not land on the article a test
 * is looking at, or they show up in its comment list and break assertions
 * about which controls are on the page.
 *
 * The ballast article is a DRAFT on purpose: drafts are never rendered to
 * readers, so comments parked on it cannot appear anywhere a test looks,
 * no matter which article that test publishes.
 *
 * Run by Playwright's globalSetup, after cleanup-test-data has emptied the
 * previous run's leftovers. Owned by an @example.com account so the next
 * run's cleanup removes it again.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

export const FIXTURE_EMAIL = "e2e-fixture@example.com";
export const BALLAST_ARTICLE_ID = "e2e-trust-ballast";

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaMariaDb(process.env.DATABASE_URL!),
  });

  // The reader role, so the fixture account looks like any other
  // registration. Without a role it would hold no permissions at all,
  // which is a state the application never produces and which would make
  // this account behave unlike the ones the tests create.
  const readerRole = await db.userRole.findUnique({
    where: { key: "reader" },
    select: { id: true },
  });

  const user = await db.user.upsert({
    where: { email: FIXTURE_EMAIL },
    update: { roleId: readerRole?.id ?? undefined },
    create: {
      email: FIXTURE_EMAIL,
      name: "E2E Fixture",
      handle: "e2efixture",
      emailVerifiedAt: new Date(),
      roleId: readerRole?.id ?? undefined,
    },
  });

  await db.article.upsert({
    where: { id: BALLAST_ARTICLE_ID },
    update: {},
    create: {
      id: BALLAST_ARTICLE_ID,
      slug: BALLAST_ARTICLE_ID,
      title: "E2E trust ballast (never published)",
      bodyJson: {},
      bodyHtml: "",
      status: "DRAFT",
      authorId: user.id,
    },
  });

  console.log(`E2E fixtures ready (ballast article ${BALLAST_ARTICLE_ID}).`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
