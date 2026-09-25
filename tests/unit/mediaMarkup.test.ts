import { describe, expect, test } from "vitest";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { buildRssFeed } from "@/lib/feed";
import { durationFromFfmpegLog, ffmpegAudioArgs, ffmpegArgs } from "@/lib/transcode";

describe("sanitizer and media figures", () => {
  const figure =
    '<figure data-media-id="cm123" data-kind="audio" class="media-figure"><audio src="/media/a.mp3" controls preload="metadata"></audio><figcaption>Interview — Audio: P. Natarajan · CC BY 4.0</figcaption></figure>';

  test("keeps an audio figure, its data attributes and its caption", () => {
    const out = sanitizeArticleHtml(figure);
    expect(out).toContain('data-media-id="cm123"');
    expect(out).toContain('data-kind="audio"');
    expect(out).toContain("<audio");
    expect(out).toContain('preload="metadata"');
    expect(out).toContain("<figcaption>Interview — Audio: P. Natarajan · CC BY 4.0</figcaption>");
  });

  test("keeps a video with playsinline and a poster, and a nested source", () => {
    const out = sanitizeArticleHtml(
      '<figure data-media-id="v1" data-kind="video"><video controls playsinline preload="metadata" poster="/media/p.webp"><source src="/media/v.mp4" type="video/mp4"></video></figure>'
    );
    expect(out).toContain("playsinline");
    expect(out).toContain('poster="/media/p.webp"');
    expect(out).toContain('<source src="/media/v.mp4" type="video/mp4">');
  });

  test("a story must never start making noise on its own", () => {
    const out = sanitizeArticleHtml('<audio src="/media/a.mp3" autoplay loop controls onplay="alert(1)"></audio>');
    expect(out).not.toContain("autoplay");
    expect(out).not.toContain("loop");
    expect(out).not.toContain("onplay");
    expect(out).toContain("controls");
  });

  test("a media element cannot point outside http(s) or the site", () => {
    const out = sanitizeArticleHtml('<audio src="javascript:alert(1)" controls></audio>');
    expect(out).not.toContain("javascript:");
  });
});

describe("audio transcoding arguments", () => {
  test("audio is MP3 with metadata and cover art dropped", () => {
    const args = ffmpegAudioArgs("in.wav", "out.mp3");
    expect(args.slice(0, 2)).toEqual(["-nostdin", "-y"]);
    expect(args).toContain("-vn");
    expect(args[args.indexOf("-c:a") + 1]).toBe("libmp3lame");
    expect(args[args.indexOf("-map_metadata") + 1]).toBe("-1");
    expect(args[args.length - 1]).toBe("out.mp3");
  });

  test("video arguments are unchanged by the audio path", () => {
    const args = ffmpegArgs("in.mov", "out.mp4");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args).toContain("+faststart");
  });

  test("the duration comes from the last progress line ffmpeg printed", () => {
    const log =
      "size=     256kB time=00:00:10.50 bitrate= 199.8kbits/s speed=  50x\r" +
      "size=     512kB time=00:00:21.02 bitrate= 199.8kbits/s speed=  50x\r" +
      "size=     780kB time=00:01:05.23 bitrate= 199.8kbits/s speed=  50x\nvideo:0kB audio:780kB";
    expect(durationFromFfmpegLog(log)).toBe(65);
    expect(durationFromFfmpegLog("nothing useful")).toBeNull();
    expect(durationFromFfmpegLog("time=01:02:03.00")).toBe(3723);
  });
});

describe("RSS enclosures", () => {
  const item = {
    slug: "the-interview",
    title: "The interview",
    summary: "Forty minutes with the council leader.",
    publishedAt: new Date("2026-09-20T06:00:00Z"),
    authorName: "Priya Natarajan",
    categoryName: "Politics",
  };

  test("a story with audio carries it as an enclosure", () => {
    const xml = buildRssFeed([{ ...item, enclosure: { url: "https://dispatch.example/media/x.mp3", length: 4_120_000, type: "audio/mpeg" } }]);
    expect(xml).toContain('<enclosure url="https://dispatch.example/media/x.mp3" length="4120000" type="audio/mpeg" />');
  });

  test("a story without audio has no enclosure element at all", () => {
    const xml = buildRssFeed([{ ...item, enclosure: null }, item]);
    expect(xml).not.toContain("<enclosure");
  });

  test("an enclosure URL is escaped like everything else", () => {
    const xml = buildRssFeed([{ ...item, enclosure: { url: "https://cdn.example/a.mp3?x=1&y=2", length: 1, type: "audio/mpeg" } }]);
    expect(xml).toContain('url="https://cdn.example/a.mp3?x=1&amp;y=2"');
  });
});
