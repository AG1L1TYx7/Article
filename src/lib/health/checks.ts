import type * as NodeFs from "node:fs";
import { promises as dnsPromises, Resolver } from "node:dns";
import { join } from "node:path";
import * as tls from "node:tls";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/siteUrl";
import { assessReadiness } from "@/lib/productionReadiness";
import { isTranscodingConfigured } from "@/lib/transcode";
import {
  type AuditReport,
  type Finding,
  type Status,
  formatBytes,
  gradeAdminMfa,
  gradeAudit,
  gradeCertificate,
  gradeDisk,
  gradeHeaders,
  gradeLatency,
  gradeMigrations,
  gradeNameservers,
  gradeSignIns,
  worst,
} from "./grade";

/**
 * Takes the measurements for the admin System health page. The judging is
 * in ./grade.ts; this file only measures.
 *
 * Every check runs at once, each with its own time limit, and a check that
 * throws becomes a warning on its own row rather than a broken page.
 *
 * Next's file tracer cannot tell which file a runtime path like
 * join(process.cwd(), name) refers to, and responds by copying the entire
 * project into the build (see lib/restartOnDeploy.ts). The paths joined
 * with a variable carry turbopackIgnore, the opt-out the build suggests:
 * getBuiltinModule alone (which settled it for restartOnDeploy, whose path
 * is fixed) did not stop the warning for these.
 */
const fs = process.getBuiltinModule("node:fs") as typeof NodeFs;

export type Group = "Application" | "Database" | "Configuration" | "Security" | "Storage";

export interface Check extends Finding {
  id: string;
  group: Group;
  title: string;
}

export interface HealthReport {
  checkedAt: string;
  overall: Status;
  checks: Check[];
}

const TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS, what = "check"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000} seconds`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function run(id: string, group: Group, title: string, measure: () => Promise<Finding> | Finding): Promise<Check> {
  try {
    const finding = await withTimeout(Promise.resolve().then(measure), TIMEOUT_MS, title);
    return { id, group, title, ...finding };
  } catch (e) {
    return { id, group, title, status: "warn", summary: "This check could not run.", details: [e instanceof Error ? e.message : String(e)] };
  }
}

function readText(name: string): string | null {
  try {
    // turbopackIgnore: a runtime file (BUILD_INFO, AUDIT.json), not a build input.
    return fs.readFileSync(join(/*turbopackIgnore: true*/ process.cwd(), name), "utf8");
  } catch {
    return null;
  }
}

// --- Application --------------------------------------------------------

function application(): Finding {
  const uptime = process.uptime();
  const days = Math.floor(uptime / 86_400);
  const hours = Math.floor((uptime % 86_400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const mem = process.memoryUsage();
  return {
    status: "ok",
    summary: `Running for ${days ? `${days}d ` : ""}${hours}h ${minutes}m.`,
    details: [`Node.js ${process.version}`, `Memory in use: ${formatBytes(mem.rss)} (heap ${formatBytes(mem.heapUsed)})`, `Environment: ${process.env.NODE_ENV ?? "unset"}`],
  };
}

function build(): Finding {
  const info = readText("BUILD_INFO");
  if (!info) {
    return { status: "info", summary: "This build has no record of its commit.", details: ["Builds deployed by GitHub record one. A local or hand-uploaded build does not."] };
  }
  const commit = /commit=([0-9a-f]+)/.exec(info)?.[1];
  const built = /built=(\S+)/.exec(info)?.[1];
  return {
    status: "ok",
    summary: commit ? `Deployed commit ${commit.slice(0, 7)}.` : "Deployed build recorded.",
    details: [...(built ? [`Built ${built.replace("T", " ").replace("Z", " UTC")}`] : []), ...(commit ? [`https://github.com/AG1L1TYx7/Article/commit/${commit}`] : [])],
  };
}

// --- Database -----------------------------------------------------------

async function databaseLatency(): Promise<Finding> {
  const started = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    return gradeLatency(null);
  }
  const finding = gradeLatency(performance.now() - started);
  const version = await db.$queryRaw<{ v: string }[]>`SELECT VERSION() AS v`.catch(() => []);
  return { ...finding, details: version[0] ? [`Server: ${version[0].v}`] : undefined };
}

async function migrations(): Promise<Finding> {
  const rows = await db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
    SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  // The deploy bundle ships them as migrations/; a development checkout has
  // them in prisma/migrations-mysql/.
  let shipped: string[] | null = null;
  for (const dir of ["migrations", join("prisma", "migrations-mysql")]) {
    try {
      shipped = fs
        .readdirSync(join(/*turbopackIgnore: true*/ process.cwd(), dir), { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{14}_/.test(e.name))
        .map((e) => e.name);
      break;
    } catch {
      /* try the next place */
    }
  }
  return gradeMigrations({ applied, failed, shipped });
}

async function searchSetting(): Promise<Finding> {
  const rows = await db.$queryRaw<{ Value: string }[]>`SHOW VARIABLES LIKE 'innodb_ft_min_token_size'`;
  const size = Number(rows[0]?.Value ?? NaN);
  if (!Number.isFinite(size)) return { status: "info", summary: "The full-text search setting could not be read." };
  if (size > 2) {
    return {
      status: "warn",
      summary: `Search ignores words shorter than ${size} letters.`,
      details: ["Two-letter words such as AI, EU, US and UN can't be searched.", "Only the hosting provider can lower innodb_ft_min_token_size to 2."],
    };
  }
  return { status: "ok", summary: `Search indexes words of ${size} letters and up.` };
}

// --- Configuration --------------------------------------------------------

function configuration(): Check[] {
  const r = assessReadiness(process.env, { ffmpegAvailable: isTranscodingConfigured() });
  const checks: Check[] = [
    ...r.blockers.map<Check>((b) => ({ id: `config-${b.area}`, group: "Configuration", title: b.area, status: "fail", summary: b.problem, details: [b.fix] })),
    ...r.warnings.map<Check>((w) => ({ id: `config-${w.area}`, group: "Configuration", title: w.area, status: "warn", summary: w.problem, details: [w.fix] })),
  ];
  if (r.ok.length) {
    checks.push({ id: "config-ok", group: "Configuration", title: "Configured", status: "ok", summary: `${r.ok.length} items set up correctly.`, details: r.ok });
  }
  return checks;
}

// --- Security -------------------------------------------------------------

async function headers(): Promise<Finding> {
  // A real page, fetched from this same process: what a visitor receives,
  // minus whatever the web server in front adds.
  const port = process.env.PORT || "3000";
  const res = await fetch(`http://127.0.0.1:${port}/login`, { redirect: "manual", cache: "no-store" });
  const names = ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "x-powered-by"];
  const found = Object.fromEntries(names.map((n) => [n, res.headers.get(n)]));
  return gradeHeaders(found, process.env.NODE_ENV === "production");
}

function publicHost(): string | null {
  try {
    const host = siteUrl().hostname;
    return host === "localhost" || host === "127.0.0.1" ? null : host;
  } catch {
    return null;
  }
}

function certificate(host: string): Promise<Finding> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      const coversHost = tls.checkServerIdentity(host, cert) === undefined;
      const issuer = [cert.issuer?.O, cert.issuer?.CN].filter(Boolean).join(", ") || "unknown";
      const finding = gradeCertificate(
        {
          trusted: socket.authorized,
          trustError: socket.authorizationError ? String(socket.authorizationError) : null,
          coversHost,
          validTo: new Date(cert.valid_to),
          issuer,
          address: socket.remoteAddress ?? null,
        },
        new Date()
      );
      socket.end();
      resolve(finding);
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`No TLS answer from ${host}:443`));
    });
    socket.on("error", reject);
  });
}

/**
 * A resolver that answers. The system's own is tried first; some refuse
 * NS queries outright (seen on a Windows machine: ECONNREFUSED), so
 * public resolvers are the fallback. They only find where the domain's
 * own nameservers are. The answers that matter come from those.
 */
async function lookup<T>(query: (r: InstanceType<typeof dnsPromises.Resolver>) => Promise<T>): Promise<T> {
  try {
    return await query(new dnsPromises.Resolver({ timeout: 3000, tries: 1 }));
  } catch {
    const fallback = new dnsPromises.Resolver({ timeout: 3000, tries: 1 });
    fallback.setServers(["1.1.1.1", "8.8.8.8"]);
    return query(fallback);
  }
}

async function nameservers(host: string): Promise<Finding> {
  // The registrable domain holds the NS records; for a www. host, step up.
  const zone = host.startsWith("www.") ? host.slice(4) : host;
  const servers = await lookup((r) => r.resolveNs(zone));
  const answers: Record<string, string[] | null> = {};
  await Promise.all(
    servers.sort().map(async (ns) => {
      try {
        const [nsIp] = await lookup((r) => r.resolve4(ns));
        const resolver = new Resolver({ timeout: 3000, tries: 1 });
        resolver.setServers([nsIp!]);
        answers[ns] = await new Promise<string[]>((res, rej) => resolver.resolve4(host, (err, ips) => (err ? rej(err) : res(ips))));
      } catch {
        answers[ns] = null;
      }
    })
  );
  return gradeNameservers(answers, process.env.PUBLIC_SERVER_IP ?? null);
}

function vulnerabilities(): Finding {
  const raw = readText("AUDIT.json");
  let report: AuditReport | null = null;
  if (raw) {
    try {
      report = JSON.parse(raw) as AuditReport;
    } catch {
      report = null;
    }
  }
  return gradeAudit(report, new Date());
}

async function adminMfa(): Promise<Finding> {
  const admins = await db.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE", anonymisedAt: null },
    select: { handle: true, mfaEnabled: true },
  });
  return gradeAdminMfa(admins.filter((a) => !a.mfaEnabled).map((a) => a.handle), admins.length);
}

async function signIns(): Promise<Finding> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await db.auditLog.groupBy({
    by: ["action"],
    where: {
      createdAt: { gte: since },
      action: { in: ["auth.login.failed", "auth.login.locked", "auth.login.blocked", "auth.login.mfa_failed", "auth.mfa.recovery_used"] },
    },
    _count: { _all: true },
  });
  const n = (action: string) => rows.find((r) => r.action === action)?._count._all ?? 0;
  return gradeSignIns({
    failed: n("auth.login.failed"),
    locked: n("auth.login.locked"),
    blocked: n("auth.login.blocked"),
    mfaFailed: n("auth.login.mfa_failed"),
    recoveryUsed: n("auth.mfa.recovery_used"),
  });
}

// --- Storage ------------------------------------------------------------

function disk(): Finding {
  const s = fs.statfsSync(process.cwd());
  return gradeDisk(Number(s.bavail) * Number(s.bsize), Number(s.blocks) * Number(s.bsize));
}

function uploads(): Finding {
  const root = join(process.cwd(), ".local-uploads");
  if (!fs.existsSync(root)) return { status: "info", summary: "No uploads stored on this server yet." };
  // Capped, so a huge folder cannot make the page hang.
  const LIMIT = 50_000;
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length && files < LIMIT) {
    const dir = stack.pop()!;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        files++;
        bytes += fs.statSync(p).size;
      }
    }
  }
  return {
    status: "info",
    summary: `${files >= LIMIT ? `Over ${LIMIT.toLocaleString("en")}` : files.toLocaleString("en")} uploaded files, ${formatBytes(bytes)}.`,
    details: ["Stored on this server's disk. They are not in the database backup, so back this folder up separately."],
  };
}

// --- All of it ----------------------------------------------------------

export async function runHealthChecks(): Promise<HealthReport> {
  const host = publicHost();
  const skipped = (id: string, group: Group, title: string): Check => ({
    id,
    group,
    title,
    status: "info",
    summary: "Skipped: the site's public address is not set, so there is no domain to check.",
  });

  const checks = await Promise.all([
    run("app", "Application", "Server", application),
    run("build", "Application", "Deployed version", build),
    run("db", "Database", "Connection", databaseLatency),
    run("migrations", "Database", "Migrations", migrations),
    run("search", "Database", "Search setting", searchSetting),
    run("headers", "Security", "Security headers", headers),
    host ? run("tls", "Security", "TLS certificate", () => certificate(host)) : skipped("tls", "Security", "TLS certificate"),
    host ? run("dns", "Security", "DNS", () => nameservers(host)) : skipped("dns", "Security", "DNS"),
    run("audit", "Security", "Known vulnerabilities", vulnerabilities),
    run("mfa", "Security", "Admin two-factor", adminMfa),
    run("signins", "Security", "Sign-in activity", signIns),
    run("disk", "Storage", "Disk space", disk),
    run("uploads", "Storage", "Uploads", uploads),
  ]);
  checks.push(...configuration());

  return { checkedAt: new Date().toISOString(), overall: worst(checks.map((c) => c.status)), checks };
}
