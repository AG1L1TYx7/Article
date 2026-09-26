import { describe, expect, test } from "vitest";
import {
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
} from "@/lib/health/grade";

const NOW = new Date("2026-09-26T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("worst", () => {
  test("the most serious status wins, and info never raises the alarm", () => {
    expect(worst(["ok", "info", "warn"])).toBe("warn");
    expect(worst(["ok", "fail", "warn"])).toBe("fail");
    expect(worst(["info", "info"])).toBe("ok");
    expect(worst([])).toBe("ok");
  });
});

describe("gradeLatency", () => {
  test("thresholds", () => {
    expect(gradeLatency(null).status).toBe("fail");
    expect(gradeLatency(12).status).toBe("ok");
    expect(gradeLatency(250).status).toBe("warn");
    expect(gradeLatency(900).status).toBe("fail");
  });
});

describe("gradeMigrations", () => {
  test("a half-applied migration is a failure, whatever else is true", () => {
    const f = gradeMigrations({ applied: ["a"], failed: ["b"], shipped: ["a", "b"] });
    expect(f.status).toBe("fail");
    expect(f.summary).toContain("b");
  });
  test("shipped but not applied is named", () => {
    const f = gradeMigrations({ applied: ["a"], failed: [], shipped: ["a", "c"] });
    expect(f.status).toBe("fail");
    expect(f.details).toEqual(["Pending: c"]);
  });
  test("all applied", () => {
    expect(gradeMigrations({ applied: ["a", "b"], failed: [], shipped: ["a", "b"] }).status).toBe("ok");
  });
  test("unreadable migration files are information, not an alarm", () => {
    expect(gradeMigrations({ applied: ["a"], failed: [], shipped: null }).status).toBe("info");
  });
});

describe("gradeCertificate", () => {
  const good = { trusted: true, coversHost: true, validTo: days(80), issuer: "Let's Encrypt, YR2" };
  test("a trusted certificate with time left is fine", () => {
    expect(gradeCertificate(good, NOW).status).toBe("ok");
  });
  test("renewal is overdue under 21 days, urgent under 7", () => {
    expect(gradeCertificate({ ...good, validTo: days(15) }, NOW).status).toBe("warn");
    expect(gradeCertificate({ ...good, validTo: days(3) }, NOW).status).toBe("fail");
    expect(gradeCertificate({ ...good, validTo: days(-1) }, NOW).summary).toMatch(/expired/);
  });
  test("an untrusted certificate fails however long it lasts", () => {
    // The self-signed placeholder this site was served with, valid until 4096.
    const f = gradeCertificate({ ...good, trusted: false, trustError: "DEPTH_ZERO_SELF_SIGNED_CERT", validTo: new Date("4096-01-01") }, NOW);
    expect(f.status).toBe("fail");
    expect(f.details!.join(" ")).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
  });
  test("a certificate for another name fails", () => {
    expect(gradeCertificate({ ...good, coversHost: false }, NOW).status).toBe("fail");
  });
});

describe("gradeNameservers", () => {
  test("agreement is fine", () => {
    const f = gradeNameservers({ "ns1.x": ["198.38.90.26"], "ns2.x": ["198.38.90.26"] });
    expect(f.status).toBe("ok");
  });
  test("disagreement is the failure this site actually had", () => {
    const f = gradeNameservers({ "ns1.x": ["198.38.90.25"], "ns2.x": ["198.38.90.26"], "ns3.x": ["198.38.90.25"], "ns4.x": ["198.38.90.25"] });
    expect(f.status).toBe("fail");
    expect(f.summary).toMatch(/disagree/);
  });
  test("agreement on the wrong server fails when the expected address is known", () => {
    const f = gradeNameservers({ "ns1.x": ["198.38.90.25"], "ns2.x": ["198.38.90.25"] }, "198.38.90.26");
    expect(f.status).toBe("fail");
  });
  test("a silent nameserver is a warning; all silent is a failure", () => {
    expect(gradeNameservers({ "ns1.x": ["1.2.3.4"], "ns2.x": null }).status).toBe("warn");
    expect(gradeNameservers({ "ns1.x": null, "ns2.x": null }).status).toBe("fail");
  });
  test("the order of addresses in an answer does not matter", () => {
    expect(gradeNameservers({ a: ["1.1.1.1", "2.2.2.2"], b: ["2.2.2.2", "1.1.1.1"] }).status).toBe("ok");
  });
});

describe("gradeHeaders", () => {
  const strict = {
    "content-security-policy": "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; frame-ancestors 'none'",
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=()",
    "x-powered-by": null,
  };
  test("what the site sends today passes", () => {
    expect(gradeHeaders(strict, true).status).toBe("ok");
  });
  test("each missing protection is reported by name", () => {
    const f = gradeHeaders({ ...strict, "content-security-policy": null, "x-powered-by": "Next.js" }, true);
    expect(f.status).toBe("fail");
    expect(f.details!.join(" ")).toMatch(/Content-Security-Policy/);
    expect(f.details!.join(" ")).toMatch(/X-Powered-By/);
  });
  test("a short or missing HSTS matters in production only", () => {
    expect(gradeHeaders({ ...strict, "strict-transport-security": "max-age=3600" }, true).status).toBe("fail");
    expect(gradeHeaders({ ...strict, "strict-transport-security": null }, false).status).toBe("ok");
  });
  test("HSTS is only expected when the page was requested under a public host", () => {
    // The proxy never sends it to localhost, so a production build asked
    // for 127.0.0.1 legitimately has none; that must not read as a problem.
    const noHsts = { ...strict, "strict-transport-security": null };
    expect(gradeHeaders(noHsts, true, false).status).toBe("ok");
    expect(gradeHeaders(noHsts, true, true).status).toBe("fail");
    // ...while the other production-only checks still apply.
    const evalPolicy = { ...noHsts, "content-security-policy": "script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval'; frame-ancestors 'none'" };
    expect(gradeHeaders(evalPolicy, true, false).details!.join(" ")).toMatch(/eval/);
  });
  test("a policy that allows inline scripts without strict-dynamic fails", () => {
    const loose = { ...strict, "content-security-policy": "script-src 'self' 'nonce-abc' 'unsafe-inline'" };
    expect(gradeHeaders(loose, true).details!.join(" ")).toMatch(/inline scripts/);
  });
});

describe("gradeAudit", () => {
  const clean = { generatedAt: NOW.toISOString(), counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, packages: [] };
  test("no report is information, not a failure", () => {
    expect(gradeAudit(null, NOW).status).toBe("info");
  });
  test("clean and recent is fine", () => {
    expect(gradeAudit(clean, NOW).status).toBe("ok");
  });
  test("critical or high fails, moderate warns", () => {
    expect(gradeAudit({ ...clean, counts: { ...clean.counts, high: 1 } }, NOW).status).toBe("fail");
    expect(gradeAudit({ ...clean, counts: { ...clean.counts, moderate: 2 } }, NOW).status).toBe("warn");
  });
  test("a clean report over a month old warns, because new advisories appear weekly", () => {
    expect(gradeAudit({ ...clean, generatedAt: days(-40).toISOString() }, NOW).status).toBe("warn");
  });
});

describe("gradeAdminMfa", () => {
  test("any admin without two-factor fails, and is named", () => {
    const f = gradeAdminMfa(["priya"], 3);
    expect(f.status).toBe("fail");
    expect(f.details).toEqual(["@priya"]);
    expect(gradeAdminMfa([], 3).status).toBe("ok");
  });
});

describe("gradeSignIns", () => {
  const quiet = { failed: 3, locked: 0, blocked: 0, mfaFailed: 0, recoveryUsed: 0 };
  test("a handful of typos is normal", () => {
    expect(gradeSignIns(quiet).status).toBe("ok");
  });
  test("a single right-password-wrong-code is worth a look", () => {
    expect(gradeSignIns({ ...quiet, mfaFailed: 1 }).status).toBe("warn");
  });
  test("guessing volumes warn", () => {
    expect(gradeSignIns({ ...quiet, failed: 80 }).status).toBe("warn");
    expect(gradeSignIns({ ...quiet, locked: 5 }).status).toBe("warn");
  });
});

describe("gradeDisk and formatBytes", () => {
  test("thresholds", () => {
    expect(gradeDisk(50, 100).status).toBe("ok");
    expect(gradeDisk(10, 100).status).toBe("warn");
    expect(gradeDisk(3, 100).status).toBe("fail");
  });
  test("readable sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});
