import { describe, expect, test } from "vitest";
import { displayName, PROFILE_LIMITS, profileSchema, suggestNameParts } from "@/lib/profile";

const parse = (input: Record<string, unknown>) => profileSchema.safeParse(input);

describe("profileSchema", () => {
  test("trims, collapses spaces, and turns blanks into null", () => {
    const r = parse({ firstName: "  Ada  ", lastName: "  King   Lovelace ", preferredName: "   ", bio: "" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ firstName: "Ada", lastName: "King Lovelace", preferredName: null, bio: null });
  });

  test("needs a first name or a preferred name, because something has to go on a byline", () => {
    const none = parse({ firstName: "", lastName: "Lovelace", preferredName: "", bio: "" });
    expect(none.success).toBe(false);
    expect(none.error!.issues[0]!.message).toMatch(/first name or a preferred name/);
    expect(parse({ firstName: "", lastName: "", preferredName: "Ada", bio: "" }).success).toBe(true);
    expect(parse({ firstName: "Ada", lastName: "", preferredName: "", bio: "" }).success).toBe(true);
  });

  test("strips control and direction-override characters from names", () => {
    // U+202E would make "Ada" + "txt.exe" render backwards as a different name.
    const r = parse({ firstName: "Ada\u202etxt.exe\u0007", lastName: "", preferredName: "", bio: "" });
    expect(r.data!.firstName).toBe("Adatxt.exe");
  });

  test("keeps paragraphs in the bio but not runs of blank lines or control characters", () => {
    const r = parse({ firstName: "Ada", lastName: "", preferredName: "", bio: "One.\r\n\r\n\r\n\r\nTwo.\u0000\nThree." });
    expect(r.data!.bio).toBe("One.\n\nTwo.\nThree.");
  });

  test("enforces the length limits", () => {
    const long = "x".repeat(PROFILE_LIMITS.name + 1);
    expect(parse({ firstName: long, lastName: "", preferredName: "", bio: "" }).success).toBe(false);
    expect(parse({ firstName: "Ada", lastName: "", preferredName: "", bio: "b".repeat(PROFILE_LIMITS.bio + 1) }).success).toBe(false);
    expect(parse({ firstName: "Ada", lastName: "", preferredName: "", bio: "b".repeat(PROFILE_LIMITS.bio) }).success).toBe(true);
  });

  test("treats missing or non-string fields as empty rather than crashing", () => {
    const r = parse({ firstName: "Ada", lastName: 42, bio: null });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ firstName: "Ada", lastName: null, preferredName: null, bio: null });
  });
});

describe("displayName", () => {
  test("a preferred name wins over the full name", () => {
    expect(displayName({ firstName: "Augusta", lastName: "King", preferredName: "Ada" })).toBe("Ada");
  });
  test("otherwise first and last together", () => {
    expect(displayName({ firstName: "Ada", lastName: "Lovelace", preferredName: null })).toBe("Ada Lovelace");
  });
  test("a first name alone is fine", () => {
    expect(displayName({ firstName: "Cher", lastName: null, preferredName: null })).toBe("Cher");
  });
});

describe("suggestNameParts", () => {
  test("splits at the first space", () => {
    expect(suggestNameParts("Ada King Lovelace")).toEqual({ firstName: "Ada", lastName: "King Lovelace" });
  });
  test("a single name is a first name", () => {
    expect(suggestNameParts("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });
  test("tolerates stray whitespace", () => {
    expect(suggestNameParts("  Ada   Lovelace ")).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });
});
