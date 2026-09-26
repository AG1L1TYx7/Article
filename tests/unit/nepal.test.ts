import { describe, expect, it } from "vitest";
import { DISTRICTS, PROVINCES } from "@/lib/nepal";

/**
 * The reference data itself.
 *
 * Worth asserting rather than trusting, because it is the one thing here
 * that cannot be derived from anything else and that nothing else will
 * catch when it is wrong. A district quietly missing from the list is a
 * district whose reports cannot be filed and whose residents are never
 * alerted — and nothing would fail, it would simply not be there.
 */
describe("Nepal's administrative divisions", () => {
  it("has the seven provinces the constitution names", () => {
    expect(PROVINCES).toHaveLength(7);
    expect(PROVINCES.map((p) => p.name)).toEqual([
      "Koshi",
      "Madhesh",
      "Bagmati",
      "Gandaki",
      "Lumbini",
      "Karnali",
      "Sudurpashchim",
    ]);
  });

  it("numbers them 1 to 7, as they were known before they were named", () => {
    expect(PROVINCES.map((p) => p.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("has all seventy-seven districts", () => {
    expect(DISTRICTS).toHaveLength(77);
  });

  it("distributes them the way the constitution does", () => {
    // Koshi 14, Madhesh 8, Bagmati 13, Gandaki 11, Lumbini 12, Karnali 10,
    // Sudurpashchim 9 — which is where the 77 comes from.
    expect(PROVINCES.map((p) => p.districts.length)).toEqual([14, 8, 13, 11, 12, 10, 9]);
  });

  it("gives every district and province a unique id", () => {
    const districtIds = DISTRICTS.map((d) => d.id);
    expect(new Set(districtIds).size).toBe(districtIds.length);

    const provinceIds = PROVINCES.map((p) => p.id);
    expect(new Set(provinceIds).size).toBe(provinceIds.length);
  });

  it("uses ids that are safe in a URL", () => {
    // They appear in paths like /issues/district/eastern-rukum.
    for (const d of DISTRICTS) expect(d.id, d.name).toMatch(/^[a-z][a-z-]*[a-z]$/);
    for (const p of PROVINCES) expect(p.id, p.name).toMatch(/^[a-z][a-z-]*[a-z]$/);
  });

  it("names every district in Nepali as well as English", () => {
    // The interface is bilingual, and somebody reporting from Rautahat
    // should not have to find their own district in an English list.
    for (const d of DISTRICTS) {
      expect(d.nameNe, d.name).not.toBe("");
      expect(d.nameNe, `${d.name} should be in Devanagari`).toMatch(/[ऀ-ॿ]/);
    }
    for (const p of PROVINCES) {
      expect(p.nameNe, p.name).toMatch(/[ऀ-ॿ]/);
    }
  });

  it("keeps the two districts that were split apart distinct", () => {
    // Rukum and Nawalparasi were each divided between two provinces when
    // the federal structure came in, and collapsing either pair would put
    // reports in the wrong province.
    const ids = DISTRICTS.map((d) => d.id);
    expect(ids).toContain("eastern-rukum");
    expect(ids).toContain("western-rukum");
    expect(ids).toContain("nawalpur");
    expect(ids).toContain("parasi");

    const byId = new Map(DISTRICTS.map((d) => [d.id, d.provinceId]));
    expect(byId.get("eastern-rukum")).toBe("lumbini");
    expect(byId.get("western-rukum")).toBe("karnali");
    expect(byId.get("nawalpur")).toBe("gandaki");
    expect(byId.get("parasi")).toBe("lumbini");
  });

  it("gives every province its seat of government", () => {
    for (const p of PROVINCES) expect(p.capital, p.name).not.toBe("");
  });
});
