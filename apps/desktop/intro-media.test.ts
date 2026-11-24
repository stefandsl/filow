import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LANGS } from "@filow/core";
import * as introCaptions from "./intro-captions";

const desktopDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

/**
 * Walk ISO-BMFF (MP4) boxes and collect track handler types ("vide", "soun", ...)
 * from moov -> trak -> mdia -> hdlr. Pure Node, no external ffprobe binary required.
 */
function mp4HandlerTypes(buf: Buffer): string[] {
  const handlers: string[] = [];
  const containers = new Set(["moov", "trak", "mdia"]);

  function walk(start: number, end: number) {
    let offset = start;
    while (offset + 8 <= end) {
      let size = buf.readUInt32BE(offset);
      const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > end) break;
        size = Number(buf.readBigUInt64BE(offset + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerSize || offset + size > end) break;
      const boxEnd = offset + size;
      if (type === "hdlr" && offset + headerSize + 12 <= boxEnd) {
        handlers.push(buf.subarray(offset + headerSize + 8, offset + headerSize + 12).toString("ascii"));
      } else if (containers.has(type)) {
        walk(offset + headerSize, boxEnd);
      }
      offset = boxEnd;
    }
  }

  walk(0, buf.length);
  return handlers;
}

function videoFileForLang(lang: string): string {
  const selectMedia = (introCaptions as { selectIntroMedia?: (l: string) => { src: string; poster: string } }).selectIntroMedia;
  if (selectMedia) {
    return path.join(desktopDir, selectMedia(lang).src);
  }
  const html = readFileSync(path.join(desktopDir, "welcome.html"), "utf8");
  const src = html.match(/<video[^>]*id="intro-video"[^>]*\bsrc="([^"]+)"/)?.[1]
    ?? html.match(/<video[^>]*id="intro-video"[\s\S]*?<source[^>]*\bsrc="([^"]+)"/)?.[1]
    ?? "media/intro.mp4";
  return path.join(desktopDir, src);
}

describe("onboarding intro video audio, localized assets, and caption placement", () => {
  it.each([...LANGS])("ships a video with both video and audio streams for %s", (lang) => {
    const videoPath = videoFileForLang(lang);
    expect(existsSync(videoPath), `${lang}: missing ${videoPath}`).toBe(true);
    const tracks = mp4HandlerTypes(readFileSync(videoPath));
    expect(tracks, `${lang}: ${path.basename(videoPath)} must have a video stream`).toContain("vide");
    expect(tracks, `${lang}: ${path.basename(videoPath)} must have an audio stream`).toContain("soun");
  });

  it("selects localized video and poster per UI language with English fallback", () => {
    const selectMedia = (introCaptions as { selectIntroMedia?: (l: string) => { lang: string; src: string; poster: string } }).selectIntroMedia;
    expect(typeof selectMedia).toBe("function");
    for (const lang of LANGS) {
      const media = selectMedia!(lang);
      expect(media.lang).toBe(lang);
      expect(media.src).toBe(`media/intro.${lang}.mp4`);
      expect(media.poster).toBe(`media/intro-poster.${lang}.png`);
      expect(existsSync(path.join(desktopDir, media.src)), `missing ${media.src}`).toBe(true);
      expect(existsSync(path.join(desktopDir, media.poster)), `missing ${media.poster}`).toBe(true);
    }
    expect(selectMedia!("unknown")).toEqual({
      lang: "en",
      src: "media/intro.en.mp4",
      poster: "media/intro-poster.en.png",
    });
  });

  it("renders live captions below the video picture so they do not cover demo content", () => {
    const html = readFileSync(path.join(desktopDir, "welcome.html"), "utf8");
    const css = readFileSync(path.join(desktopDir, "welcome.css"), "utf8");
    expect(html).toContain('id="intro-live-caption"');
    expect(css).toMatch(/\.intro-video:not\(:fullscreen\)::cue/);
  });
});
