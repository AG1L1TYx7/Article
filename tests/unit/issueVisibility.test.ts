import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canSeeReporter,
  canTransition,
  canView,
  canViewUnpublished,
  isPublicStatus,
  publicReporter,
  type IssueRow,
  type IssueStatus,
} from "@/lib/issueVisibility";

/**
 * The rules that protect people who report things.
 *
 * These are not ordinary unit tests. On a platform whose sectors include
 * corruption, a failure here does not produce a wrong page — it tells the
 * subject of a report who filed it. So the cases are written as the
 * questions somebody would ask in an inquiry: could a stranger see this,
 * could the accused, could it leak before anybody checked it was true.
 */

const ALL_STATUSES: IssueStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "VERIFIED",
  "PUBLISHED",
  "REJECTED",
  "RESOLVED",
];

const reporter = { id: "u_reporter", name: "Sita Rai", handle: "sita", avatarUrl: null };

function issue(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    status: "PUBLISHED",
    anonymous: false,
    reporterId: reporter.id,
    reporter,
    ...overrides,
  };
}

const stranger = { id: "u_stranger", permissions: ["comment.create"] };
const verifier = { id: "u_verifier", permissions: ["issue.verify", "dashboard.access"] };
const theReporter = { id: reporter.id, permissions: ["comment.create"] };
const anonymous = null;

describe("nothing unpublished is public", () => {
  it("only published and resolved reports are public statuses", () => {
    expect(ALL_STATUSES.filter(isPublicStatus)).toEqual(["PUBLISHED", "RESOLVED"]);
  });

  it("a signed-out visitor sees nothing that has not been published", () => {
    for (const status of ALL_STATUSES) {
      const visible = canView(issue({ status }), anonymous);
      expect(visible, status).toBe(isPublicStatus(status));
    }
  });

  it("another member cannot read a report that is still being checked", () => {
    // An unverified report is an unchecked accusation about a named person.
    for (const status of ["SUBMITTED", "UNDER_REVIEW", "VERIFIED", "REJECTED"] as IssueStatus[]) {
      expect(canView(issue({ status }), stranger), status).toBe(false);
    }
  });

  it("the reporter can follow their own report at every stage", () => {
    for (const status of ALL_STATUSES) {
      expect(canView(issue({ status }), theReporter), status).toBe(true);
    }
  });

  it("a verifier can see the queue", () => {
    for (const status of ALL_STATUSES) {
      expect(canView(issue({ status }), verifier), status).toBe(true);
    }
  });

  it("canViewUnpublished never lets a stranger in, whatever they hold", () => {
    const wellEquipped = { id: "u_other", permissions: ["article.publish", "user.manage", "role.manage"] };
    // Managing people is not the same as verifying reports, and holding
    // every other permission must not imply this one.
    expect(canViewUnpublished(issue({ status: "SUBMITTED" }), wellEquipped)).toBe(false);
  });
});

describe("an anonymous report never carries its reporter outward", () => {
  it("gives no identifying field at all, only the marker", () => {
    const result = publicReporter(issue({ anonymous: true }));
    expect(result).toEqual({ kind: "anonymous" });
    // Asserted as a whole object on purpose: a spread that accidentally
    // carried `name` or `handle` through would still satisfy a check for
    // `kind`, and would be exactly the leak this exists to prevent.
    expect(JSON.stringify(result)).not.toContain("Sita");
    expect(JSON.stringify(result)).not.toContain("sita");
    expect(JSON.stringify(result)).not.toContain("u_reporter");
  });

  it("stays anonymous at every status, including after it is resolved", () => {
    for (const status of ALL_STATUSES) {
      expect(publicReporter(issue({ status, anonymous: true })).kind, status).toBe("anonymous");
    }
  });

  it("treats a missing reporter as anonymous rather than throwing", () => {
    // A row read without the relation must fail closed, not blank.
    expect(publicReporter(issue({ reporter: null })).kind).toBe("anonymous");
    expect(publicReporter(issue({ reporter: undefined })).kind).toBe("anonymous");
  });

  it("names the reporter when they did not ask for anonymity", () => {
    expect(publicReporter(issue())).toEqual({
      kind: "named",
      id: reporter.id,
      name: "Sita Rai",
      handle: "sita",
      avatarUrl: null,
    });
  });
});

describe("who may be told who reported it", () => {
  it("not a stranger, and not the public", () => {
    const anon = issue({ anonymous: true });
    expect(canSeeReporter(anon, anonymous)).toBe(false);
    expect(canSeeReporter(anon, stranger)).toBe(false);
  });

  it("the reporter themselves, and a verifier who must ask questions", () => {
    const anon = issue({ anonymous: true });
    expect(canSeeReporter(anon, theReporter)).toBe(true);
    expect(canSeeReporter(anon, verifier)).toBe(true);
  });

  it("does not become public merely because the report was published", () => {
    // The tempting mistake: "it is public now, so the byline can be too."
    expect(canSeeReporter(issue({ anonymous: true, status: "PUBLISHED" }), stranger)).toBe(false);
    expect(canSeeReporter(issue({ anonymous: true, status: "RESOLVED" }), anonymous)).toBe(false);
  });
});

describe("the lifecycle", () => {
  it("cannot jump from submitted straight to published", () => {
    // Publishing without verification is the whole failure mode.
    expect(canTransition("SUBMITTED", "PUBLISHED")).toBe(false);
    expect(canTransition("UNDER_REVIEW", "PUBLISHED")).toBe(false);
    expect(canTransition("VERIFIED", "PUBLISHED")).toBe(true);
  });

  it("cannot quietly republish something that was rejected", () => {
    expect(canTransition("REJECTED", "PUBLISHED")).toBe(false);
    // It has to go back through review, where somebody signs their name to it.
    expect(canTransition("REJECTED", "UNDER_REVIEW")).toBe(true);
  });

  it("cannot pull a published report back into the dark", () => {
    // People have already read it. Resolve or correct it; do not hide it.
    for (const to of ["SUBMITTED", "UNDER_REVIEW", "VERIFIED", "REJECTED"] as IssueStatus[]) {
      expect(canTransition("PUBLISHED", to), to).toBe(false);
    }
    expect(canTransition("PUBLISHED", "RESOLVED")).toBe(true);
  });

  it("treats resolved as the end of the road", () => {
    expect(allowedTransitions("RESOLVED")).toEqual([]);
  });

  it("never allows a status to transition to itself", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });

  it("every status it can reach is one it knows about", () => {
    for (const from of ALL_STATUSES) {
      for (const to of allowedTransitions(from)) {
        expect(ALL_STATUSES, `${from} -> ${to}`).toContain(to);
      }
    }
  });
});
