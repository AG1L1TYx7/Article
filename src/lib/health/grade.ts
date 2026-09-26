/**
 * The judgements behind the admin System health page: given a measurement,
 * is it fine, worth a look, or a problem?
 *
 * Pure, with no I/O, so every threshold is unit-tested and the page and
 * its tests cannot drift apart. The measuring lives in lib/health/checks.ts.
 */

export type Status = "ok" | "warn" | "fail" | "info";

export interface Finding {
  status: Status;
  /** One line, in the words an administrator would use. */
  summary: string;
  /** Supporting facts shown under the summary. */
  details?: string[];
}

const STATUS_RANK: Record<Status, number> = { ok: 0, info: 0, warn: 1, fail: 2 };

/** The worst status in a list; "info" never raises the alarm. */
export function worst(statuses: Status[]): Status {
  let result: Status = "ok";
  for (const s of statuses) if (STATUS_RANK[s] > STATUS_RANK[result]) result = s;
  return result;
}

// --- Database -----------------------------------------------------------

/** Round-trip time of `SELECT 1`. The database is on another host here, so a few ms is normal. */
export function gradeLatency(ms: number | null): Finding {
  if (ms === null) return { status: "fail", summary: "The database is not answering." };
  const rounded = Math.round(ms);
  if (ms > 500) return { status: "fail", summary: `The database took ${rounded} ms to answer a trivial query.` };
  if (ms > 100) return { status: "warn", summary: `The database is slow: ${rounded} ms for a trivial query.` };
  return { status: "ok", summary: `The database answers in ${rounded} ms.` };
}

export interface MigrationState {
  applied: string[];
  /** Started but never finished: MySQL cannot roll back, so the schema is between versions. */
  failed: string[];
  /** Migration folders shipped with this build. Null when they could not be read. */
  shipped: string[] | null;
}

export function gradeMigrations(m: MigrationState): Finding {
  if (m.failed.length) {
    return {
      status: "fail",
      summary: `A database migration failed part-way: ${m.failed.join(", ")}.`,
      details: ["The schema is between two versions. It needs fixing by hand before the next deploy."],
    };
  }
  if (m.shipped === null) {
    return { status: "info", summary: `${m.applied.length} migrations applied.`, details: ["The migration files shipped with this build could not be read, so pending ones cannot be counted."] };
  }
  const applied = new Set(m.applied);
  const pending = m.shipped.filter((name) => !applied.has(name));
  if (pending.length) {
    return {
      status: "fail",
      summary: `${pending.length} migration${pending.length === 1 ? " has" : "s have"} not been applied.`,
      details: pending.map((p) => `Pending: ${p}`),
    };
  }
  return { status: "ok", summary: `All ${m.applied.length} migrations are applied.` };
}

// --- TLS certificate ----------------------------------------------------

export interface CertificateFacts {
  /** Whether Node's default trust store accepted the chain. */
  trusted: boolean;
  /** The reason it was not, as Node reports it. */
  trustError?: string | null;
  /** Whether the certificate names the host that was asked for. */
  coversHost: boolean;
  validTo: Date;
  issuer: string;
  /** The address the connection actually reached. */
  address?: string | null;
}

export function gradeCertificate(c: CertificateFacts, now: Date): Finding {
  const daysLeft = Math.floor((c.validTo.getTime() - now.getTime()) / 86_400_000);
  const details = [
    `Issued by ${c.issuer}`,
    `Expires ${c.validTo.toISOString().slice(0, 10)} (${daysLeft} day${Math.abs(daysLeft) === 1 ? "" : "s"})`,
    ...(c.address ? [`Served from ${c.address}`] : []),
  ];
  if (!c.trusted) {
    return {
      status: "fail",
      summary: "Browsers will refuse this certificate.",
      details: [c.trustError ? `Reason: ${c.trustError}` : "It is not signed by a trusted authority.", ...details],
    };
  }
  if (!c.coversHost) return { status: "fail", summary: "The certificate is for a different name than the site.", details };
  if (daysLeft < 0) return { status: "fail", summary: "The certificate has expired.", details };
  if (daysLeft < 7) return { status: "fail", summary: `The certificate expires in ${daysLeft} days.`, details };
  if (daysLeft < 21) {
    return {
      status: "warn",
      summary: `The certificate expires in ${daysLeft} days.`,
      details: [...details, "Let's Encrypt renews at 30 days left, so automatic renewal may be failing."],
    };
  }
  return { status: "ok", summary: `The certificate is valid for another ${daysLeft} days.`, details };
}

// --- DNS ----------------------------------------------------------------

/**
 * What each of the domain's own nameservers says the site's address is.
 * Disagreement is the failure this site actually had: the hosting panel
 * showed one address while some nameservers kept publishing another, so
 * some visitors reached the site and others reached a different server.
 */
export function gradeNameservers(answers: Record<string, string[] | null>, expected?: string | null): Finding {
  const entries = Object.entries(answers).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return { status: "warn", summary: "The domain's nameservers could not be found." };
  const details = entries.map(([ns, ips]) => `${ns}: ${ips ? ips.join(", ") || "no address" : "no answer"}`);
  const answered = entries.filter(([, ips]) => ips && ips.length) as [string, string[]][];
  if (!answered.length) return { status: "fail", summary: "None of the domain's nameservers answered.", details };
  const distinct = new Set(answered.map(([, ips]) => [...ips].sort().join(",")));
  if (distinct.size > 1) {
    return {
      status: "fail",
      summary: "The domain's nameservers disagree about the site's address.",
      details: [...details, "Visitors reach different servers depending on which nameserver they ask. The hosting provider has to fix this."],
    };
  }
  const ips = answered[0]![1];
  if (expected && !ips.includes(expected)) {
    return {
      status: "fail",
      summary: `The domain points at ${ips.join(", ")}, not this server (${expected}).`,
      details,
    };
  }
  if (answered.length < entries.length) {
    return { status: "warn", summary: "Some of the domain's nameservers did not answer.", details };
  }
  return { status: "ok", summary: `All ${entries.length} nameservers agree: ${ips.join(", ")}.`, details };
}

// --- Security headers ---------------------------------------------------

/**
 * The response headers of a real page, checked for what this site sets on
 * purpose (src/proxy.ts). A missing header here means a change removed it.
 */
/**
 * `expectHsts` is separate from `production` because the proxy leaves
 * Strict-Transport-Security off when the site is configured for
 * localhost, as it is in the test suite; see headers() in
 * lib/health/checks.ts.
 */
export function gradeHeaders(headers: Record<string, string | null>, production: boolean, expectHsts = production): Finding {
  const h = (name: string) => headers[name.toLowerCase()] ?? null;
  const problems: string[] = [];
  const notes: string[] = [];

  const csp = h("content-security-policy");
  if (!csp) problems.push("No Content-Security-Policy.");
  else {
    const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? "";
    if (!scriptSrc.includes("'nonce-")) problems.push("The Content-Security-Policy has no script nonce.");
    if (scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'strict-dynamic'")) problems.push("The Content-Security-Policy allows inline scripts.");
    if (scriptSrc.includes("'unsafe-eval'") && production) problems.push("The Content-Security-Policy allows eval().");
    if (!/frame-ancestors\s+'none'/.test(csp) && h("x-frame-options")?.toUpperCase() !== "DENY") problems.push("Pages can be framed by other sites.");
    notes.push("Content-Security-Policy: nonce-based, strict-dynamic");
  }
  if (h("x-content-type-options")?.toLowerCase() !== "nosniff") problems.push("X-Content-Type-Options is not nosniff.");
  if (!h("referrer-policy")) problems.push("No Referrer-Policy.");
  if (!h("permissions-policy")) problems.push("No Permissions-Policy.");
  if (h("x-powered-by")) problems.push(`X-Powered-By reveals the framework (${h("x-powered-by")}).`);

  const hsts = h("strict-transport-security");
  if (expectHsts) {
    const maxAge = Number(/max-age=(\d+)/.exec(hsts ?? "")?.[1] ?? 0);
    if (!hsts) problems.push("No Strict-Transport-Security, so browsers may use plain HTTP.");
    else if (maxAge < 31_536_000) problems.push(`Strict-Transport-Security lasts only ${Math.round(maxAge / 86_400)} days; a year or more is expected.`);
    else notes.push(`Strict-Transport-Security: ${Math.round(maxAge / 86_400)} days`);
  }

  if (problems.length) return { status: "fail", summary: `${problems.length} security header problem${problems.length === 1 ? "" : "s"}.`, details: problems };
  return { status: "ok", summary: "Every expected security header is present and strict.", details: notes };
}

// --- Dependency vulnerabilities ------------------------------------------

export interface AuditReport {
  generatedAt: string;
  commit?: string;
  counts: { critical: number; high: number; moderate: number; low: number; info: number };
  /** Vulnerable packages, most severe first. */
  packages: { name: string; severity: string; title?: string }[];
}

/**
 * Known vulnerabilities in the packages this build runs with, from
 * `npm audit` at build time (scripts/write-audit-report.mjs). The server
 * cannot run the audit itself: it has no dev tooling and no reason to
 * reach the npm registry. So the report is only as fresh as the last
 * deploy, and it says so.
 */
export function gradeAudit(report: AuditReport | null, now: Date): Finding {
  if (!report) {
    return { status: "info", summary: "No vulnerability report shipped with this build.", details: ["Builds made by the GitHub deploy include one. A build uploaded by hand does not."] };
  }
  const ageDays = Math.floor((now.getTime() - new Date(report.generatedAt).getTime()) / 86_400_000);
  const { critical, high, moderate, low } = report.counts;
  const details = [
    `Checked ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}${report.commit ? `, at commit ${report.commit.slice(0, 7)}` : ""}.`,
    ...report.packages.slice(0, 12).map((p) => `${p.severity}: ${p.name}${p.title ? `: ${p.title}` : ""}`),
  ];
  if (critical || high) {
    return { status: "fail", summary: `${critical} critical and ${high} high-severity vulnerabilities in the packages the site runs on.`, details };
  }
  if (moderate) return { status: "warn", summary: `${moderate} moderate vulnerabilit${moderate === 1 ? "y" : "ies"} in the packages the site runs on.`, details };
  if (ageDays > 30) {
    return { status: "warn", summary: `No known vulnerabilities as of ${ageDays} days ago.`, details: [...details, "New vulnerabilities are published every week. Deploy again to re-check."] };
  }
  return { status: "ok", summary: low ? `No serious vulnerabilities (${low} low).` : "No known vulnerabilities in the packages the site runs on.", details };
}

// --- Accounts and sign-ins -------------------------------------------------

export function gradeAdminMfa(adminsWithoutMfa: string[], totalAdmins: number): Finding {
  if (adminsWithoutMfa.length) {
    return {
      status: "fail",
      summary: `${adminsWithoutMfa.length} of ${totalAdmins} admin account${totalAdmins === 1 ? "" : "s"} ha${adminsWithoutMfa.length === 1 ? "s" : "ve"} no two-factor authentication.`,
      details: adminsWithoutMfa.map((h) => `@${h}`),
    };
  }
  return { status: "ok", summary: `All ${totalAdmins} admin account${totalAdmins === 1 ? " has" : "s have"} two-factor authentication.` };
}

export interface SignInCounts {
  failed: number;
  locked: number;
  blocked: number;
  mfaFailed: number;
  recoveryUsed: number;
}

/** Sign-in trouble in the last 24 hours, from the audit log. */
export function gradeSignIns(c: SignInCounts): Finding {
  const details = [
    `${c.failed} failed password${c.failed === 1 ? "" : "s"}`,
    `${c.locked} account lockout${c.locked === 1 ? "" : "s"}`,
    `${c.blocked} blocked by rate limit`,
    `${c.mfaFailed} wrong two-factor code${c.mfaFailed === 1 ? "" : "s"} after a correct password`,
    `${c.recoveryUsed} recovery code${c.recoveryUsed === 1 ? "" : "s"} used`,
  ];
  // A right password followed by a wrong second factor means someone has
  // the password. One is worth a look whatever the other numbers are.
  if (c.mfaFailed > 0) {
    return { status: "warn", summary: "Someone entered a correct password but the wrong two-factor code.", details: [...details, "That password is known to someone. Check the audit log for which account."] };
  }
  if (c.failed >= 50 || c.locked >= 5 || c.blocked >= 20) {
    return { status: "warn", summary: "Unusually many failed sign-ins in the last 24 hours.", details: [...details, "This is what password guessing looks like. The rate limits and lockouts are doing their job."] };
  }
  return { status: "ok", summary: "Nothing unusual in sign-ins over the last 24 hours.", details };
}

// --- Storage -------------------------------------------------------------

export function gradeDisk(freeBytes: number, totalBytes: number): Finding {
  const pct = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0;
  const summary = `${formatBytes(freeBytes)} free of ${formatBytes(totalBytes)} (${pct.toFixed(0)}%).`;
  if (pct < 5) return { status: "fail", summary: `Disk nearly full: ${summary}`, details: ["Uploads and the database will start failing."] };
  if (pct < 15) return { status: "warn", summary: `Disk getting full: ${summary}` };
  return { status: "ok", summary };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}
