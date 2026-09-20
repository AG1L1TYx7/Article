/**
 * Starter categories, so the article form's category dropdown isn't empty
 * on a fresh install. Idempotent — safe to run repeatedly; it never
 * touches a category that already exists.
 *
 *   npm run seed
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const CATEGORIES = [
  { slug: "world", name: "World", description: "International news and reporting" },
  { slug: "politics", name: "Politics", description: "Government, policy and elections" },
  { slug: "business", name: "Business", description: "Markets, companies and the economy" },
  { slug: "technology", name: "Technology", description: "Tech industry and science" },
  { slug: "culture", name: "Culture", description: "Arts, media and society" },
  { slug: "sport", name: "Sport", description: "Results, analysis and features" },
];

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  for (const category of CATEGORIES) {
    await db.category.upsert({
      where: { slug: category.slug },
      create: category,
      update: {}, // leave any edits the newsroom has made alone
    });
  }

  const total = await db.category.count();
  console.log(`Seeded ${CATEGORIES.length} categories (${total} now in the database).`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
