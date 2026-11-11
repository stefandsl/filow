// A lesson saved as a video, made inside the app: the board as it is drawn on screen, frame by
// frame onto a canvas, recorded by the browser's own MediaRecorder as WebM. No ffmpeg, nothing
// leaves this PC. The sentence of each step is written under the board as a caption.
//
// What plays where, honestly:
// - the picture is the live board, so the video takes as long to make as the lesson takes to play,
//   and the window has to stay in front (a hidden window stops drawing);
// - the narration is in the video only with the natural voice of this PC, whose sound the app
//   plays itself and can also hand to the recorder. The system voice is spoken by Windows and
//   cannot be recorded by a page: the video is then silent, with the captions.
import type { ChunkPlayer } from "@/lib/buddy/voice";

export const VIDEO = { fps: 12, width: 1280, height: 720, captionH: 96 };

/** The first WebM flavour this browser can record, or null when it can record none. */
export function videoMime(isSupported: (mime: string) => boolean, sound: boolean): string | null {
  const kinds = sound ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"] : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return kinds.find((k) => isSupported(k)) ?? null;
}

/** A caption broken into at most `max` lines of at most `width` units (a wide character counts double); the last line ends with an ellipsis when the text is longer. */
export function captionLines(text: string, width: number, max = 2): string[] {
  const wide = (ch: string) => ((ch.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1);
  const size = (s: string) => Array.from(s).reduce((n, ch) => n + wide(ch), 0);
  const words = text.trim().split(/\s+/).flatMap((w) => (size(w) > width ? Array.from(w) : [w]));
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const joined = !line ? word : size(word) === 2 && Array.from(word).length === 1 ? line + word : `${line} ${word}`;
    if (size(joined) <= width) line = joined;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/[\s.,;:]+$/, "")}…`;
  return kept;
}

/** Where the board and the caption go on the frame: the board as large as fits above the caption, centred. */
export function frameLayout(boardW: number, boardH: number, v: { width: number; height: number; captionH: number } = VIDEO) {
  const room = v.height - v.captionH;
  const scale = Math.min(v.width / boardW, room / boardH);
  const w = Math.round(boardW * scale);
  const h = Math.round(boardH * scale);
  return { board: { x: Math.round((v.width - w) / 2), y: Math.round((room - h) / 2), w, h }, caption: { x: 0, y: room, w: v.width, h: v.captionH } };
}

/**
 * The board as it looks at this instant, as a picture: a copy of the live SVG in which every
 * stroke, label and block carries the state its animation has reached (how much of the stroke is
 * drawn, how much of the text is written), since a copy does not take the page's style sheets along.
 */
export async function boardFrame(svg: SVGSVGElement, css: string): Promise<HTMLImageElement> {
  const box = svg.viewBox.baseVal;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("width", String(box.width));
  copy.setAttribute("height", String(box.height));
  const live = svg.querySelectorAll<SVGElement>(".wb-stroke, .wb-fade, text");
  const still = copy.querySelectorAll<SVGElement>(".wb-stroke, .wb-fade, text");
  live.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const to = still[i];
    if (!to) return;
    if (el.classList.contains("wb-stroke")) {
      to.style.strokeDasharray = cs.strokeDasharray;
      to.style.strokeDashoffset = cs.strokeDashoffset;
    }
    to.style.opacity = cs.opacity;
    // text still being written is cut where the pen is; text written to its end is whole (a copy measures its letters anew)
    const right = /inset\(\s*\S+\s+(-?[\d.]+)/.exec(cs.clipPath ?? "");
    if (right && Number(right[1]) > 0) to.style.clipPath = cs.clipPath;
  });
  copy.removeAttribute("class");
  if (css) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = css;
    copy.insertBefore(style, copy.firstChild);
  }
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("the board could not be drawn as a picture"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  });
  return img;
}

export type RecorderDeps = {
  /** The live board, or null while there is none. */
  board(): SVGSVGElement | null;
  /** The sentence being said now. */
  caption(): string;
  colours(): { page: string; ink: string };
  /** The style rules the copy of the board needs (the formulas' fonts): fetched once. */
  css(): Promise<string>;
  /** Record sound too (the natural voice is in use). */
  sound: boolean;
};

/** Records the lesson as it plays. `player()` is the voice's output while recording: heard as usual and also written into the video. */
export function createRecorder(deps: RecorderDeps) {
  const mime = typeof MediaRecorder === "undefined" ? null : videoMime((m) => MediaRecorder.isTypeSupported(m), deps.sound);
  if (!mime) return null;
  const canvas = document.createElement("canvas");
  canvas.width = VIDEO.width;
  canvas.height = VIDEO.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const stream = canvas.captureStream(VIDEO.fps);
  const audio = deps.sound ? new AudioContext() : null;
  const tap = audio?.createMediaStreamDestination() ?? null;
  if (tap) for (const track of tap.stream.getAudioTracks()) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const pieces: Blob[] = [];
  recorder.ondataavailable = (ev) => { if (ev.data.size) pieces.push(ev.data); };
  let css = "";
  let busy = false;
  let frames = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const paint = async () => {
    const svg = deps.board();
    if (busy || !svg) return;
    busy = true;
    try {
      const img = await boardFrame(svg, css);
      const { page, ink } = deps.colours();
      const at = frameLayout(svg.viewBox.baseVal.width, svg.viewBox.baseVal.height);
      ctx.fillStyle = page;
      ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
      ctx.drawImage(img, at.board.x, at.board.y, at.board.w, at.board.h);
      ctx.fillStyle = ink;
      ctx.font = '600 26px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = captionLines(deps.caption(), 84);
      lines.forEach((line, k) => ctx.fillText(line, VIDEO.width / 2, at.caption.y + at.caption.h / 2 + (k - (lines.length - 1) / 2) * 34));
      frames++;
    } catch { /* one frame lost: the next one is drawn */ } finally {
      busy = false;
    }
  };
  return {
    mime,
    sound: Boolean(tap),
    frames: () => frames,
    async start() {
      css = await deps.css().catch(() => "");
      await paint();
      recorder.start(500);
      timer = setInterval(() => void paint(), Math.round(1000 / VIDEO.fps));
    },
    /** Ends the recording and gives the file. */
    stop(): Promise<Blob> {
      clearInterval(timer);
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          void audio?.close().catch(() => {});
          resolve(new Blob(pieces, { type: mime.split(";")[0] }));
        };
        if (recorder.state === "inactive") recorder.onstop?.(new Event("stop"));
        else recorder.stop();
      });
    },
    /** The voice's output while recording (same behaviour as the app's own player, plus the tap into the video). */
    player(): ChunkPlayer | null {
      if (!audio || !tap) return null;
      if (audio.state === "suspended") void audio.resume().catch(() => {});
      const gain = audio.createGain();
      gain.connect(audio.destination);
      gain.connect(tap);
      const sources: AudioBufferSourceNode[] = [];
      let next = 0;
      let first = -1;
      let end = 0;
      let stoppedAt = -1;
      return {
        add(samples, sampleRate, pauseMs) {
          if (stoppedAt >= 0 || !samples.length) return;
          const buffer = audio.createBuffer(1, samples.length, sampleRate);
          buffer.getChannelData(0).set(samples);
          const source = audio.createBufferSource();
          source.buffer = buffer;
          source.connect(gain);
          const at = Math.max(audio.currentTime + 0.03, next);
          source.start(at);
          sources.push(source);
          if (first < 0) first = at;
          end = at + buffer.duration;
          next = end + Math.max(0, pauseMs) / 1000;
        },
        remaining: () => (stoppedAt >= 0 ? 0 : Math.max(0, end - audio.currentTime)),
        played: () => (first < 0 ? 0 : Math.max(0, Math.min(stoppedAt >= 0 ? stoppedAt : audio.currentTime, end) - first)),
        stop() {
          if (stoppedAt >= 0) return;
          stoppedAt = audio.currentTime;
          for (const s of sources) { try { s.stop(stoppedAt + 0.01); } catch { /* already ended */ } }
          setTimeout(() => gain.disconnect(), 100);
        },
        state: () => audio.state,
      };
    },
  };
}
export type LessonRecorder = NonNullable<ReturnType<typeof createRecorder>>;
