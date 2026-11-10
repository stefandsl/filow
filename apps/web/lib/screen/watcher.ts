// Browser side of Screen Sense (ARCHITECTURE.md §6.1): samples a display stream at
// 1 fps into a 16×16 thumbnail for change detection and grabs a full frame on demand.
// Frames never leave this module except through `grab()`, which the caller sends once.
import { THUMB_SIZE } from "@filow/core";

export type ScreenSourceKind = "screen" | "window";

/** What the desktop preload exposes as window.filow.screen. */
export type ScreenBridge = {
  sources: () => Promise<Array<{ id: string; name: string; kind: ScreenSourceKind; thumbnail: string }>>;
  select: (id: string | null) => Promise<void>;
  pickRegion: () => Promise<{ image: string; width: number; height: number } | null>;
  onHotkey: (fn: () => void) => () => void;
  onSettings: (fn: (s: { hotkey: string; enabled: boolean }) => void) => () => void;
  getSettings: () => Promise<{ hotkey: string; enabled: boolean }>;
  setSettings: (next: { hotkey?: string; enabled?: boolean }) => Promise<{ ok: boolean; error?: string; hotkey: string; enabled: boolean }>;
};

export function screenBridge(): ScreenBridge | null {
  return (globalThis as { filow?: { screen?: ScreenBridge } }).filow?.screen ?? null;
}

/** Ask the browser (or, on desktop, the app's own chooser result) for a screen/window stream. */
export async function openDisplayStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 2, max: 5 } }, audio: false });
}

export class ScreenWatcher {
  private video: HTMLVideoElement;
  private thumb: HTMLCanvasElement;
  private full: HTMLCanvasElement;
  private ended = false;

  constructor(
    public readonly stream: MediaStream,
    public readonly kind: ScreenSourceKind,
    public readonly label: string,
    onEnded: () => void,
  ) {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    this.thumb = document.createElement("canvas");
    this.thumb.width = this.thumb.height = THUMB_SIZE;
    this.full = document.createElement("canvas");
    for (const t of stream.getVideoTracks()) {
      t.addEventListener("ended", () => {
        if (this.ended) return;
        this.ended = true;
        onEnded();
      });
    }
  }

  async start(): Promise<void> {
    await this.video.play();
  }

  get ready(): boolean {
    return !this.ended && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  /** 16×16 RGBA sample of the current frame, for frameDiff. */
  sample(): Uint8ClampedArray | null {
    if (!this.ready) return null;
    const ctx = this.thumb.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(this.video, 0, 0, THUMB_SIZE, THUMB_SIZE);
    return ctx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE).data;
  }

  /** Full frame as a JPEG data URL, downscaled to `maxWidth`. */
  grab(maxWidth = 1280, quality = 0.8): string | null {
    if (!this.ready) return null;
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    const k = Math.min(1, maxWidth / w);
    this.full.width = Math.round(w * k);
    this.full.height = Math.round(h * k);
    const ctx = this.full.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(this.video, 0, 0, this.full.width, this.full.height);
    return this.full.toDataURL("image/jpeg", quality);
  }

  stop(): void {
    this.ended = true;
    for (const t of this.stream.getTracks()) t.stop();
    this.video.srcObject = null;
  }
}

/** The label the browser gives a display surface, if any. */
export function streamLabel(stream: MediaStream): { kind: ScreenSourceKind; label: string } {
  const track = stream.getVideoTracks()[0];
  const settings = (track?.getSettings?.() ?? {}) as { displaySurface?: string };
  const kind: ScreenSourceKind = settings.displaySurface === "window" ? "window" : "screen";
  return { kind, label: track?.label || (kind === "window" ? "a window" : "a screen") };
}
