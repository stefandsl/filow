"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@filow/ui";
import { notifyUser } from "@/lib/notify";
import {
  CHANGE_THRESHOLD,
  FrameBudget,
  frameDiff,
  hasPresenterCue,
  shouldCapture,
  type Engine,
  type ScreenMode,
  type ScreenSummary,
  type SessionState,
  type VisionRequest,
  type VisionResponse,
} from "@filow/core";
import { engineHeaders } from "./useSession";
import { pageOutbound } from "./usePageOutbound";
import { getScreenMode, setScreenMode as saveScreenMode } from "@/lib/prefs";
import { openDisplayStream, screenBridge, ScreenWatcher, streamLabel, type ScreenBridge, type ScreenSourceKind } from "@/lib/screen/watcher";

export type ScreenSource = { id: string; name: string; kind: ScreenSourceKind; thumbnail: string };

export type ScreenSenseStatus = "idle" | "watching" | "unsupported";

/**
 * Owns the capture loop (§6.1), the cost dial (§6.5) and the hotkey region flow.
 * Policy lives in @filow/core; this hook only moves frames and state.
 */
export function useScreenSense(engine: Engine, state: SessionState, log: (line: string) => void) {
  const [mode, setMode] = useState<ScreenMode>("balanced");
  const t = useT();
  const [status, setStatus] = useState<ScreenSenseStatus>("idle");
  const [label, setLabel] = useState<string>("");
  const [sources, setSources] = useState<ScreenSource[] | null>(null); // non-null = chooser open
  const [enabled, setEnabled] = useState(true);
  const [desktop, setDesktop] = useState(false);
  const watcher = useRef<ScreenWatcher | null>(null);
  const bridge = useRef<ScreenBridge | null>(null);
  const budget = useRef(new FrameBudget(20));
  const lastThumb = useRef<Uint8ClampedArray | null>(null);
  const lastSentAt = useRef<number | null>(null);
  const cueCursor = useRef(0);
  const inFlight = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const stopWatching = useCallback(() => {
    const wasWatching = watcher.current !== null;
    watcher.current?.stop();
    watcher.current = null;
    lastThumb.current = null;
    void bridge.current?.select(null);
    setStatus((s) => (s === "unsupported" ? s : "idle"));
    setLabel("");
    if (wasWatching) notifyUser(t("screen.notifyOff"), t("screen.notifyOffBody"));
  }, [t]);

  const stopWatchingRef = useRef(stopWatching);
  stopWatchingRef.current = stopWatching;

  useEffect(() => {
    setMode(getScreenMode());
    bridge.current = screenBridge();
    setDesktop(Boolean(bridge.current));
    if (bridge.current) {
      void bridge.current.getSettings().then((s) => setEnabled(s.enabled));
      return bridge.current.onSettings((s) => {
        setEnabled(s.enabled);
        if (!s.enabled) stopWatchingRef.current();
      });
    }
    if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getDisplayMedia && !bridge.current) setStatus("unsupported");
  }, []);

  const changeMode = (m: ScreenMode) => {
    setMode(m);
    saveScreenMode(m);
  };

  /** One frame → /api/vision → engine. The image is not kept after the call. */
  const send = useCallback(
    async (image: string, source: VisionRequest["source"], why: string): Promise<boolean> => {
      if (inFlight.current) return false;
      const now = Date.now();
      if (!budget.current.take(now)) {
        if (!stateRef.current.screen) engine.feedScreen({ at: now, source, shows: "", pointsToMake: [], facts: [], unavailable: "capped" }, 0);
        log("Screen Sense: frame cap reached for this minute");
        return false;
      }
      inFlight.current = true;
      // The picture goes to the cloud vision model: named first, asked once, shown while it is sent.
      const out = pageOutbound();
      const recipient = (await out.recipients())?.screen;
      const decision = recipient ? await out.allow("screen", recipient) : "dismissed";
      if (!recipient || decision !== "granted") {
        inFlight.current = false;
        stopWatchingRef.current();
        log(recipient ? `Screen Sense: kept on this PC (${decision}), nothing sent` : "Screen Sense: cannot tell who would read the screen, nothing sent");
        return false;
      }
      lastSentAt.current = now;
      engine.setAnalysing(true);
      const s = stateRef.current;
      const section = s.script.sections[s.sectionIdx];
      const body: VisionRequest = {
        image,
        source,
        context: section && s.script.source !== "screen" ? { sectionTitle: section.title, points: section.bullets.map((b) => b.text) } : undefined,
      };
      try {
        const seen = await out.sending("screen", recipient, async (consent) => {
          const res = await fetch("/api/vision", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders(), ...consent }, body: JSON.stringify(body) });
          if (!res.ok) {
            const { error } = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(error ?? `vision failed (${res.status})`);
          }
          return (await res.json()) as VisionResponse;
        });
        engine.feedScreen(seen.summary, seen.cost);
        log(`Screen Sense (${why}): ${seen.summary.unavailable ?? seen.summary.shows.slice(0, 80)} · ${seen.latencyMs} ms`);
        return true;
      } catch (err) {
        // Keep the last good summary; forget the thumbnail so the loop retries this frame next tick.
        if (!stateRef.current.screen) {
          const summary: ScreenSummary = { at: now, source, shows: "", pointsToMake: [], facts: [], unavailable: "could-not-read" };
          engine.feedScreen(summary, 0);
        }
        lastThumb.current = null;
        log(`Screen Sense error: ${(err as Error).message}`);
        return false;
      } finally {
        engine.setAnalysing(false);
        inFlight.current = false;
      }
    },
    [engine, log],
  );

  /** Start watching a stream the browser (or the desktop chooser) handed us. */
  const watchStream = useCallback(
    async (stream: MediaStream, kindHint?: ScreenSourceKind, nameHint?: string) => {
      stopWatching();
      const meta = streamLabel(stream);
      const kind = kindHint ?? meta.kind;
      const name = nameHint ?? meta.label;
      const w = new ScreenWatcher(stream, kind, name, () => {
        log("Screen Sense: sharing ended");
        stopWatching();
      });
      await w.start();
      watcher.current = w;
      setStatus("watching");
      setLabel(name);
      cueCursor.current = engine.transcript.length;
      log(`Screen Sense: watching ${name}`);
      notifyUser(t("screen.notifyOn", { label: name }), t("screen.notifyOnBody"));
      // lastThumb is null, so the loop's next tick sends the first frame.
    },
    [engine, log, stopWatching, t],
  );

  /** Web: browser chooser. Desktop: our own chooser (sources state), then getDisplayMedia resolves to it. */
  const watchScreen = useCallback(async () => {
    try {
      if (bridge.current) {
        const list = await bridge.current.sources();
        setSources(list);
        return;
      }
      const stream = await openDisplayStream();
      await watchStream(stream);
    } catch (err) {
      log(`Screen Sense: ${(err as Error).message}`);
    }
  }, [log, watchStream]);

  const chooseSource = useCallback(
    async (src: ScreenSource | null) => {
      setSources(null);
      if (!src || !bridge.current) return;
      try {
        await bridge.current.select(src.id);
        const stream = await openDisplayStream();
        await watchStream(stream, src.kind, src.name);
      } catch (err) {
        log(`Screen Sense: ${(err as Error).message}`);
      }
    },
    [log, watchStream],
  );

  /** Hotkey / "Look now" without a stream on desktop: drag a region and send it. */
  const captureRegion = useCallback(async () => {
    if (!bridge.current) return;
    try {
      const picked = await bridge.current.pickRegion();
      if (picked) await send(picked.image, "region", `region ${picked.width}×${picked.height}`);
    } catch (err) {
      log(`Screen Sense: ${(err as Error).message}`);
    }
  }, [log, send]);

  const lookNow = useCallback(() => {
    const w = watcher.current;
    if (w) {
      const img = w.grab();
      const thumb = w.sample();
      if (img) void send(img, w.kind, "look now").then((sent) => sent && (lastThumb.current = thumb));
      return;
    }
    if (bridge.current) void captureRegion();
    else log("Screen Sense: pick a screen to watch first");
  }, [captureRegion, log, send]);

  // Look now from any view (mirror, PowerPoint pane) and the desktop hotkey.
  useEffect(() => engine.onLookNow(lookNow), [engine, lookNow]);
  useEffect(() => bridge.current?.onHotkey(() => void captureRegion()), [captureRegion]);

  // The 1 fps loop: dedup, cues, cost dial, cap.
  useEffect(() => {
    const t = setInterval(() => {
      const w = watcher.current;
      if (!w || !w.ready || inFlight.current) return;
      const thumb = w.sample();
      if (!thumb) return;
      const changed = lastThumb.current === null || frameDiff(lastThumb.current, thumb) >= CHANGE_THRESHOLD;
      const transcript = engine.transcript;
      const cue = engine.getState().engine.recording && hasPresenterCue(transcript, cueCursor.current);
      if (cue) cueCursor.current = transcript.length;
      if (!shouldCapture({ mode: modeRef.current, changed, cue, forced: false, now: Date.now(), lastSentAt: lastSentAt.current })) return;
      const img = w.grab();
      if (!img) return;
      const why = lastThumb.current === null ? "first frame" : changed ? "slide changed" : "presenter cue";
      lastThumb.current = thumb;
      void send(img, w.kind, why).then((sent) => {
        if (!sent) lastThumb.current = null;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [engine, send]);

  useEffect(() => () => watcher.current?.stop(), []);

  return {
    mode,
    setMode: changeMode,
    status,
    label,
    enabled,
    desktop,
    sources,
    watchScreen,
    chooseSource,
    stopWatching,
    lookNow,
    captureRegion,
    forget: () => engine.dispatch({ type: "forgetScreen" }),
  };
}
