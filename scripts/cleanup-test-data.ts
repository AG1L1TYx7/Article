/**
 * Removes accounts left behind by e2e runs. Those tests register real
 * users, so a dev database steadily fills up with them.
 *
 *   npm run cleanup:test-data            # dry run, shows what would go
 *   npm run cleanup:test-data -- --confirm
 *
 * Scoped to @example.com addresses. That domain is reserved by RFC 2606
 * specifically for documentation and testing and can never receive real
 * mail, so no genuine account can be caught by this — which is exactly
 * why the e2e helpers generate addresses there.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const TEST_DOMAIN = "@example.com";

async function main() {
  const confirm = process.argv.includes("--confirm");
  const db = new PrismaClient({
    adapter: new PrismaMariaDb(process.env.DATABASE_URL!),
  });

  const where = { email: { endsWith: TEST_DOMAIN } };
  const users = await db.user.findMany({ where, select: { id: true, email: true } });

  if (users.length === 0) {
    console.log("No test accounts found — nothing to clean up.");
    await db.$disconnect();
    return;
  }

  const ids = users.map((u) => u.id);
  const articles = await db.article.count({ where: { authorId: { in: ids } } });

  if (!confirm) {
    console.log(`Would delete ${users.length} account(s) ending in ${TEST_DOMAIN}, plus ${articles} article(s) they authored.`);
    console.log("Sample:", users.slice(0, 3).map((u) => u.email).join(", "));
    console.log("\nRe-run with --confirm to actually delete.");
    await db.$disconnect();
    return;
  }

  // Order matters: rows pointing at a user have to go before the user.
  // Notifications reference the recipient and the actor, so both sides
  // have to go, not just the ones addressed to a test account.
  await db.notification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] },
  });
  await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await db.reaction.deleteMany({ where: { userId: { in: ids } } });
  await db.bookmark.deleteMany({ where: { userId: { in: ids } } });
  await db.follow.deleteMany({ where: { followerId: { in: ids } } });
  await db.report.deleteMany({ where: { reporterId: { in: ids } } });
  await db.comment.deleteMany({ where: { userId: { in: ids } } });
  await db.article.deleteMany({ where: { authorId: { in: ids } } });
  await db.media.deleteMany({ where: { uploadedById: { in: ids } } });
  // Push subscriptions: the accounts' own, and the anonymous ones the
  // e2e suite registers against a reserved test hostname.
  await db.pushSubscription.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { endpoint: { startsWith: "https://push.example.com/" } }] },
  });
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.account.deleteMany({ where: { userId: { in: ids } } });
  const deleted = await db.user.deleteMany({ where: { id: { in: ids } } });

  console.log(`Deleted ${deleted.count} test account(s) and their content.`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
