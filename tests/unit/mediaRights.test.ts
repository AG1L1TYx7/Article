import { describe, expect, test } from "vitest";
import {
  LICENSES,
  MEDIA_LICENSES,
  allowsDownload,
  creditLine,
  extractMediaUrls,
  formatDuration,
  isRightsComplete,
  isoDuration,
  rightsProblem,
} from "@/lib/mediaRights";

const base = {
  license: null,
  credit: null,
  sourceName: null,
  sourceUrl: null,
  rightsNote: null,
  rightsConfirmedAt: null,
};

describe("rightsProblem", () => {
  test("a licence is the first thing needed", () => {
    expect(rightsProblem(base)).toBe("Choose a licence.");
  });

  test("our own work needs only the confirmation", () => {
    expect(rightsProblem({ ...base, license: "OWN_WORK" })).toMatch(/Confirm/);
    expect(isRightsComplete({ ...base, license: "OWN_WORK", rightsConfirmedAt: new Date() })).toBe(true);
  });

  test("attribution licences need a creator or a source", () => {
    expect(rightsProblem({ ...base, license: "CC_BY", rightsConfirmedAt: new Date() })).toBe("Name the creator or the source.");
    expect(isRightsComplete({ ...base, license: "CC_BY", sourceName: "Reuters", rightsConfirmedAt: new Date() })).toBe(true);
    expect(isRightsComplete({ ...base, license: "CC_BY", credit: "Maya Okafor", rightsConfirmedAt: new Date() })).toBe(true);
  });

  test("permission and public domain need the basis written down", () => {
    expect(rightsProblem({ ...base, license: "PERMISSION", credit: "J. Doe", rightsConfirmedAt: new Date() })).toBe("Say who gave permission, and when.");
    expect(rightsProblem({ ...base, license: "PUBLIC_DOMAIN", rightsConfirmedAt: new Date() })).toBe("Say why it is in the public domain.");
    expect(rightsProblem({ ...base, license: "OTHER", credit: "Stock Co", rightsConfirmedAt: new Date() })).toBe("Describe the licence.");
    expect(isRightsComplete({ ...base, license: "PERMISSION", credit: "J. Doe", rightsNote: "Email of 3 May", rightsConfirmedAt: new Date() })).toBe(true);
  });

  test("whitespace does not count as a name", () => {
    expect(rightsProblem({ ...base, license: "CC_BY", credit: "   ", rightsConfirmedAt: new Date() })).toBe("Name the creator or the source.");
  });

  test("every licence has a label, and every attribution one links to its deed", () => {
    for (const code of MEDIA_LICENSES) {
      expect(LICENSES[code].label.length).toBeGreaterThan(0);
      if (code.startsWith("CC")) expect(LICENSES[code].url).toMatch(/^https:\/\/creativecommons\.org\//);
    }
  });
});

describe("allowsDownload", () => {
  test("only open licences let readers keep a copy", () => {
    expect(allowsDownload("CC_BY")).toBe(true);
    expect(allowsDownload("CC0")).toBe(true);
    expect(allowsDownload("PUBLIC_DOMAIN")).toBe(true);
    expect(allowsDownload("OWN_WORK")).toBe(false);
    expect(allowsDownload("PERMISSION")).toBe(false);
    expect(allowsDownload("OTHER")).toBe(false);
    expect(allowsDownload(null)).toBe(false);
  });
});

describe("creditLine", () => {
  test("creator, source and licence, in that order", () => {
    expect(creditLine("IMAGE", { credit: "Maya Okafor", sourceName: "Reuters", license: "CC_BY" })).toBe("Photo: Maya Okafor / Reuters · CC BY 4.0");
  });

  test("our own work shows the creator without a licence label", () => {
    expect(creditLine("VIDEO", { credit: "Daniel Reyes", sourceName: null, license: "OWN_WORK" })).toBe("Video: Daniel Reyes");
  });

  test("a licence alone still makes a line; nothing at all makes none", () => {
    expect(creditLine("AUDIO", { credit: null, sourceName: null, license: "CC0" })).toBe("Audio · CC0 1.0");
    expect(creditLine("AUDIO", { credit: null, sourceName: null, license: null })).toBeNull();
    expect(creditLine("AUDIO", { credit: null, sourceName: null, license: "OWN_WORK" })).toBeNull();
  });
});

describe("extractMediaUrls", () => {
  test("finds images, video, audio and sources, once each, without variant parameters", () => {
    const html = `
      <p>Intro</p>
      <figure data-media-id="a"><img src="/media/one.webp?w=800" alt=""></figure>
      <figure data-media-id="b"><video src="/media/two.mp4" controls></video></figure>
      <figure data-media-id="c"><audio src="/media/three.mp3" controls></audio></figure>
      <video controls><source src="/media/four.mp4" type="video/mp4"></video>
      <img src="/media/one.webp">
      <a href="/media/not-a-src.webp">link</a>`;
    expect(extractMediaUrls(html)).toEqual(["/media/one.webp", "/media/two.mp4", "/media/three.mp3", "/media/four.mp4"]);
  });

  test("decodes an escaped ampersand in a URL", () => {
    expect(extractMediaUrls('<img src="https://cdn.example/x.webp?a=1&amp;b=2">')).toEqual(["https://cdn.example/x.webp"]);
  });

  test("an empty body has no media", () => {
    expect(extractMediaUrls("<p>Just words.</p>")).toEqual([]);
  });
});

describe("durations", () => {
  test("formats for people and for schema.org", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(isoDuration(0)).toBe("PT0S");
    expect(isoDuration(65)).toBe("PT1M5S");
    expect(isoDuration(3600)).toBe("PT1H");
    expect(isoDuration(3725)).toBe("PT1H2M5S");
  });
});
