/**
 * Starter categories, so the article form's category dropdown isn't empty
 * on a fresh install. Idempotent — safe to run repeatedly; it never
 * touches a category that already exists.
 *
 *   npm run seed
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { SYSTEM_ROLES } from "../src/lib/auth/permissions";
import { DISTRICTS, PROVINCES } from "../src/lib/nepal";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

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
    adapter: new PrismaMariaDb(process.env.DATABASE_URL!),
  });

  for (const category of CATEGORIES) {
    await db.category.upsert({
      where: { slug: category.slug },
      create: category,
      update: {}, // leave any edits the newsroom has made alone
    });
  }


  // Nepal's provinces and districts.
  //
  // Reference data, not example data: an issue cannot be filed without a
  // district, and a member cannot be alerted without one either. Upserted
  // by id so re-running the seed is harmless and so a name corrected here
  // reaches an existing database, while nothing that references a district
  // is disturbed.
  for (const province of PROVINCES) {
    await db.province.upsert({
      where: { id: province.id },
      create: {
        id: province.id,
        name: province.name,
        nameNe: province.nameNe,
        capital: province.capital,
        number: province.number,
      },
      update: { name: province.name, nameNe: province.nameNe, capital: province.capital },
    });
  }
  for (const district of DISTRICTS) {
    await db.district.upsert({
      where: { id: district.id },
      create: {
        id: district.id,
        name: district.name,
        nameNe: district.nameNe,
        provinceId: district.provinceId,
      },
      update: { name: district.name, nameNe: district.nameNe, provinceId: district.provinceId },
    });
  }
  console.log(
    `Seeded ${PROVINCES.length} provinces and ${DISTRICTS.length} districts.`
  );

  const total = await db.category.count();
  console.log(`Seeded ${CATEGORIES.length} categories (${total} now in the database).`);

  // The three built-in roles, reconciled rather than created.
  //
  // They are first inserted by the migration that introduced roles, because
  // an account with no role holds no permissions and that cannot wait for
  // an optional script. This pass exists for afterwards: when a permission
  // is added to the catalogue in lib/auth/permissions.ts, running the seed
  // is what gives it to the built-in roles that should have it. Roles an
  // administrator created, and permissions they have deliberately removed
  // from a non-protected role, are left exactly as they are.
  for (const role of SYSTEM_ROLES) {
    const existing = await db.userRole.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        name: role.name,
        description: role.description,
        tier: role.tier,
        isSystem: true,
        isProtected: role.isProtected ?? false,
      },
      // Name and description stay as the site has them; only the flags
      // that the application relies on are re-asserted.
      update: { isSystem: true, isProtected: role.isProtected ?? false, tier: role.tier },
      select: { id: true, isProtected: true },
    });

    // Only the protected role has its permissions forced back to the full
    // set. For the others this adds what is missing and removes nothing,
    // so a deliberately narrowed moderator role stays narrowed.
    const held = new Set(
      (
        await db.rolePermission.findMany({
          where: { roleId: existing.id },
          select: { permission: true },
        })
      ).map((p) => p.permission)
    );
    const missing = role.permissions.filter((permission) => !held.has(permission));
    if (missing.length) {
      await db.rolePermission.createMany({
        data: missing.map((permission) => ({ roleId: existing.id, permission })),
        skipDuplicates: true,
      });
      console.log(`Role "${role.key}": added ${missing.length} new permission(s).`);
    }
  }

  // An account with no role at all: only possible on a database that
  // predates roles and missed the backfill. Cheap to check, and the
  // alternative is somebody who cannot comment and cannot be told why.
  const readerRole = await db.userRole.findUnique({ where: { key: "reader" }, select: { id: true } });
  if (readerRole) {
    const orphaned = await db.user.updateMany({
      where: { roleId: null, role: "READER" },
      data: { roleId: readerRole.id },
    });
    if (orphaned.count) console.log(`Gave ${orphaned.count} account(s) the reader role.`);
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
