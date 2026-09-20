/**
 * Creates or promotes a staff account, so there's a way into the newsroom
 * dashboard on a fresh install. Registration through the site always
 * creates a READER by design — this is the deliberate out-of-band path an
 * operator uses to appoint the first Admin, rather than exposing a
 * "make me an admin" button on the public site.
 *
 *   npm run bootstrap:staff -- --email you@example.com --role ADMIN
 *
 * Password: passed with --password, or read from STAFF_PASSWORD, or
 * generated and printed once. It is never written to a file or logged
 * anywhere other than stdout.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const role = (arg("role") ?? "ADMIN").toUpperCase();
  const name = arg("name") ?? "Newsroom Staff";

  if (!email || !email.includes("@")) {
    throw new Error("Pass a real address: --email you@example.com");
  }
  if (role !== "ADMIN" && role !== "MODERATOR") {
    throw new Error("--role must be ADMIN or MODERATOR");
  }

  const password = arg("password") ?? process.env.STAFF_PASSWORD ?? randomBytes(12).toString("base64url");
  const generated = !arg("password") && !process.env.STAFF_PASSWORD;
  if (password.length < 12) throw new Error("Password must be at least 12 characters");

  const db = new PrismaClient({
    adapter: new PrismaMariaDb(process.env.DATABASE_URL!),
  });

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const handleBase = email.split("@")[0]!.replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "staff";

  const existing = await db.user.findUnique({ where: { email } });

  const user = existing
    ? await db.user.update({
        where: { email },
        // An existing account keeps its password — this path is "promote
        // the account I already registered", not "reset my credentials".
        data: { role, emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), status: "ACTIVE" },
      })
    : await db.user.create({
        data: {
          email,
          name,
          handle: (await db.user.findUnique({ where: { handle: handleBase } }))
            ? `${handleBase}-${randomBytes(2).toString("hex")}`
            : handleBase,
          passwordHash,
          role,
          // Verified on the spot: this account is being vouched for by
          // whoever has server access, and publishing requires a
          // confirmed address (see requireVerifiedEmail in lib/auth/rbac.ts).
          emailVerifiedAt: new Date(),
          // The password came from this script, not from them: the site
          // asks for a new one at first sign-in (see proxy.ts).
          mustChangePassword: true,
        },
      });

  console.log(`\n${existing ? "Promoted" : "Created"} ${user.email}`);
  console.log(`  role:  ${user.role}`);
  console.log(`  email: verified`);
  if (!existing && generated) {
    console.log(`\n  password: ${password}`);
    console.log("  ^ shown once. Change it after your first login.");
  } else if (existing) {
    console.log("  password: unchanged (existing account)");
  }
  if (user.role === "ADMIN") {
    console.log("\nAdmins must set up two-factor auth before using the dashboard.");
    console.log("Log in and you'll be sent straight to /dashboard/mfa to scan a QR code.");
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
