import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LANGS } from "@filow/core";
import * as introCaptions from "./intro-captions";

const desktopDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

type Mp4TrackInfo = {
  handler: string;
  durationSec: number;
  sampleCount: number;
  avgSampleBytes: number;
};

/**
 * Walk ISO-BMFF (MP4) boxes and collect track handler types ("vide", "soun", ...),
 * mdhd durations in seconds, and stsz sample byte statistics. Pure Node, no external binary required.
 */
function inspectMp4Tracks(buf: Buffer): Mp4TrackInfo[] {
  const tracks: Mp4TrackInfo[] = [];

  function walkBoxes(start: number, end: number, onBox: (type: string, bodyStart: number, boxEnd: number) => void) {
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
      onBox(type, offset + headerSize, boxEnd);
      offset = boxEnd;
    }
  }

  function parseTrack(start: number, end: number) {
    const info: Mp4TrackInfo = { handler: "", durationSec: 0, sampleCount: 0, avgSampleBytes: 0 };
    const containers = new Set(["mdia", "minf", "stbl"]);
    function walk(s: number, e: number) {
      walkBoxes(s, e, (type, body, boxEnd) => {
        if (type === "hdlr" && body + 12 <= boxEnd) {
          info.handler = buf.subarray(body + 8, body + 12).toString("ascii");
        } else if (type === "mdhd" && body + 4 <= boxEnd) {
          const version = buf.readUInt8(body);
          if (version === 1 && body + 32 <= boxEnd) {
            const timescale = buf.readUInt32BE(body + 20);
            const duration = Number(buf.readBigUInt64BE(body + 24));
            if (timescale > 0) info.durationSec = duration / timescale;
          } else if (version === 0 && body + 20 <= boxEnd) {
            const timescale = buf.readUInt32BE(body + 12);
            const duration = buf.readUInt32BE(body + 16);
            if (timescale > 0) info.durationSec = duration / timescale;
          }
        } else if (type === "stsz" && body + 12 <= boxEnd) {
          const sampleSize = buf.readUInt32BE(body + 4);
          const count = buf.readUInt32BE(body + 8);
          info.sampleCount = count;
          if (sampleSize > 0) {
            info.avgSampleBytes = sampleSize;
          } else if (count > 0) {
            let total = 0;
            const limit = Math.min(count, Math.floor((boxEnd - (body + 12)) / 4));
            for (let i = 0; i < limit; i++) total += buf.readUInt32BE(body + 12 + i * 4);
            info.avgSampleBytes = limit > 0 ? total / limit : 0;
          }
        } else if (containers.has(type)) {
          walk(body, boxEnd);
        }
      });
    }
    walk(start, end);
    if (info.handler) tracks.push(info);
  }

  walkBoxes(0, buf.length, (type, body, boxEnd) => {
    if (type === "moov") {
      walkBoxes(body, boxEnd, (childType, childBody, childEnd) => {
        if (childType === "trak") parseTrack(childBody, childEnd);
      });
    }
  });
  return tracks;
}

function measureAudioDbWithFfmpeg(videoPath: string): { meanDb: number; maxDb: number } | null {
  const res = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", videoPath, "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (res.error || res.status !== 0) return null;
  const stderr = res.stderr || "";
  const meanMatch = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  const maxMatch = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  if (!meanMatch || !maxMatch) return null;
  return { meanDb: Number(meanMatch[1]), maxDb: Number(maxMatch[1]) };
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
  it.each([...LANGS])("ships a video with full-length, non-silent narrated audio for %s", (lang) => {
    const videoPath = videoFileForLang(lang);
    expect(existsSync(videoPath), `${lang}: missing ${videoPath}`).toBe(true);
    const tracks = inspectMp4Tracks(readFileSync(videoPath));
    const videoTrack = tracks.find(t => t.handler === "vide");
    const audioTrack = tracks.find(t => t.handler === "soun");
    expect(videoTrack, `${lang}: ${path.basename(videoPath)} must have a video stream`).toBeDefined();
    expect(audioTrack, `${lang}: ${path.basename(videoPath)} must have an audio stream`).toBeDefined();
    expect(videoTrack!.durationSec, `${lang}: video duration must be > 10s`).toBeGreaterThan(10);
    expect(
      audioTrack!.durationSec,
      `${lang}: audio duration (${audioTrack!.durationSec.toFixed(2)}s) must be >= 90% of video (${videoTrack!.durationSec.toFixed(2)}s)`,
    ).toBeGreaterThanOrEqual(videoTrack!.durationSec * 0.9);
    // Compressed AAC speech averages well above silent-frame overhead (> 30 bytes/frame).
    expect(audioTrack!.sampleCount, `${lang}: audio must have encoded frames`).toBeGreaterThan(200);
    expect(audioTrack!.avgSampleBytes, `${lang}: audio frames look silent`).toBeGreaterThan(30);
    // When ffmpeg is installed, also verify actual decoded loudness is non-silent.
    const db = measureAudioDbWithFfmpeg(videoPath);
    if (db) {
      expect(db.meanDb, `${lang}: audio mean volume ${db.meanDb} dB is too quiet`).toBeGreaterThan(-45);
      expect(db.maxDb, `${lang}: audio max volume ${db.maxDb} dB is too quiet`).toBeGreaterThan(-20);
    }
  });

  it("selects distinct localized videos and posters per UI language with English fallback", () => {
    const selectMedia = (introCaptions as { selectIntroMedia?: (l: string) => { lang: string; src: string; poster: string } }).selectIntroMedia;
    expect(typeof selectMedia).toBe("function");
    const posterHashes = new Set<string>();
    for (const lang of LANGS) {
      const media = selectMedia!(lang);
      expect(media.lang).toBe(lang);
      expect(media.src).toBe(`media/intro.${lang}.mp4`);
      expect(media.poster).toBe(`media/intro-poster.${lang}.png`);
      expect(existsSync(path.join(desktopDir, media.src)), `missing ${media.src}`).toBe(true);
      const posterPath = path.join(desktopDir, media.poster);
      expect(existsSync(posterPath), `missing ${media.poster}`).toBe(true);
      posterHashes.add(createHash("sha256").update(readFileSync(posterPath)).digest("hex"));
    }
    expect(posterHashes.size, "each language must ship a distinct localized poster frame").toBe(LANGS.length);
    expect(selectMedia!("unknown")).toEqual({
      lang: "en",
      src: "media/intro.en.mp4",
      poster: "media/intro-poster.en.png",
    });
  });

  it("reserves live caption space below the video so captions never cover the demo or jump the layout", () => {
    const html = readFileSync(path.join(desktopDir, "welcome.html"), "utf8");
    const css = readFileSync(path.join(desktopDir, "welcome.css"), "utf8");
    const liveCapTag = html.match(/<[^>]*id="intro-live-caption"[^>]*>/)?.[0] ?? "";
    expect(liveCapTag).toBeTruthy();
    expect(liveCapTag, "caption element must reserve space instead of using hidden").not.toMatch(/\bhidden\b/);
    expect(css).toMatch(/\.intro-video:not\(:fullscreen\)::cue/);
  });
});
