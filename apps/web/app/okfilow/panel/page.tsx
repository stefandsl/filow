"use client";
// OK Filow panel: settings + the "brain" (hold-to-talk -> speech-to-text on this PC ->
// screenshots -> /api/buddy/ask streamed -> voice + pointing). Lives in a hidden desktop window.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@filow/ui";
import { getSelectedMic } from "@filow/stt";
import { joinTranscript, okFilowBridge, type OkFilowBridge, type OkFilowCapture, type OkFilowCard, type OkFilowJob, type OkFilowMode, type OkFilowStatus } from "@/lib/buddy/bridge";
import { drawingSvg, type BuddyModel } from "@/lib/buddy/visuals";
import { speechDeadline } from "@/lib/buddy/speech";
import { markToDisplay, parseBuddyAnswer, pointToDisplay, type BuddyTurn } from "@/lib/buddy/prompt";
import { OKF_TEXT, type OkfKey } from "@/lib/buddy/text";
import { burnStrokes, createVad, describeMarked } from "@/lib/buddy/listen";
import "../okfilow.css";

const HISTORY_KEY = "okfilow.history.v1";
const COLORS = ["#ffb600", "#3380ff", "#ff4d6d", "#2ecc71", "#b06cff", "#ffffff"];
type Purpose = "talk" | "dictate" | "handsfree";

function loadHistory(): BuddyTurn[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => x && (x.role === "user" || x.role === "assistant") && typeof x.text === "string").slice(-12) : [];
  } catch { return []; }
}
function saveHistory(h: BuddyTurn[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-12))); } catch { /* storage off: memory only */ }
}

const HOTKEY_LABEL: Record<string, string> = { "ctrl+alt": "Ctrl + Alt", "ctrl+shift": "Ctrl + Shift", "alt+shift": "Alt + Shift", "ctrl+meta": "Ctrl + Win" };

export default function OkFilowPanel() {
  const lang = useLang();
  const t = useCallback((k: OkfKey) => (OKF_TEXT[lang === "it" ? "it" : "en"][k] ?? OKF_TEXT.en[k]), [lang]);
  const [bridge, setBridge] = useState<OkFilowBridge | null>(null);
  const [status, setStatus] = useState<OkFilowStatus | null>(null);
  const [mode, setModeState] = useState<OkFilowMode>("idle");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [sttReady, setSttReady] = useState<boolean | null>(null);

  const history = useRef<BuddyTurn[]>([]);
  const purpose = useRef<Purpose>("talk");
  const handsFree = useRef(false);
  const [handsFreeOn, setHandsFreeOn] = useState(false);
  const vad = useRef<ReturnType<typeof createVad> | null>(null);
  // Start/stop can cross: a release while the mic is still opening is remembered and applied after.
  const starting = useRef(false);
  const pendingStop = useRef<boolean | null>(null);
  const session = useRef(0);
  const typeBox = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [jobs, setJobs] = useState<OkFilowJob[]>([]);
  const committed = useRef<string[]>([]);
  const partial = useRef("");
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode } | null>(null);
  const run = useRef(0);
  const asking = useRef<AbortController | null>(null);
  /** The last answer's visuals in global DIP, for "Replay last answer". */
  const lastShown = useRef<{ points: Parameters<OkFilowBridge["point"]>[0]; marks: Parameters<OkFilowBridge["draw"]>[0]; model: BuddyModel | null; cards: OkFilowCard[] } | null>(null);
  const token = useRef<string | null>(null);
  const statusRef = useRef<OkFilowStatus | null>(null);
  statusRef.current = status;

  useEffect(() => {
    const b = okFilowBridge();
    setBridge(b);
    if (!b) return;
    void b.status().then(setStatus);
    history.current = loadHistory();
    void b.agents.list().then(setJobs).catch(() => {});
    // Load the local model now, so the first question does not wait for it (local only, no content sent).
    void b.status().then(async (s) => {
      if (s.enabled && (s.provider === "local" || s.offline)) {
        await fetch("/api/buddy/warm", { method: "POST", headers: await engineHeadersRef.current() }).catch(() => {});
      }
    });
    void b.stt.status().then((s) => setSttReady(s.ready)).catch(() => setSttReady(false));
    const offs = [b.onConfig(setStatus), b.onMode((m) => setModeState(m.mode))];
    return () => offs.forEach((o) => o());
  }, []);

  const setMode = useCallback((m: OkFilowMode, extra?: Record<string, unknown>) => {
    setModeState(m);
    void okFilowBridge()?.setMode(m, extra);
  }, []);

  const stopAudio = useCallback(() => {
    const a = audio.current;
    audio.current = null;
    if (!a) return;
    a.node.disconnect();
    a.stream.getTracks().forEach((tr) => tr.stop());
    void a.ctx.close();
    okFilowBridge()?.level(0);
  }, []);

  const fail = useCallback((raw: string) => {
    // Electron wraps errors thrown in the main process: "Error invoking remote method 'x': Error: msg".
    const message = raw.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "");
    setError(message);
    okFilowBridge()?.text(message);
    setMode("error", { error: message });
    // A failure never leaves the mic open.
    if (audio.current) {
      stopAudio();
      void okFilowBridge()?.stt.stop().catch(() => {});
    }
  }, [setMode, stopAudio]);

  const engineHeadersRef = useRef<() => Promise<Record<string, string>>>(async () => ({}));
  const engineHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const b = okFilowBridge();
    if (!b?.accessPassword) return {};
    if (!token.current) {
      const res = await fetch(`${b.sessionUrl}/api/session`, { method: "POST", headers: { "X-Access-Password": b.accessPassword } });
      if (res.ok) token.current = ((await res.json()) as { engineToken?: string }).engineToken ?? null;
    }
    return token.current ? { Authorization: `Bearer ${token.current}` } : {};
  }, []);
  engineHeadersRef.current = engineHeaders;

  const speak = useCallback(async (text: string, id: number) => {
    const voice = statusRef.current?.voice ?? "system";
    if (!text || voice === "off") return;
    if (voice === "cloud" && !statusRef.current?.offline) {
      const res = await fetch("/api/buddy/tts", { method: "POST", headers: { "Content-Type": "application/json", ...(await engineHeaders()) }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `voice ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const el = new Audio(url);
      await new Promise<void>((resolve) => {
        let check: ReturnType<typeof setInterval> | undefined;
        const done = () => { clearInterval(check); clearTimeout(stuck); resolve(); };
        // The end event can go missing (device change, Bluetooth sleep): never stay on "speaking".
        const stuck = setTimeout(() => { el.pause(); done(); }, speechDeadline(text, statusRef.current?.speed));
        el.onended = el.onerror = done;
        el.playbackRate = statusRef.current?.speed ?? 1;
        void el.play().catch(done);
        check = setInterval(() => { if (run.current !== id) { el.pause(); done(); } }, 100);
      });
      URL.revokeObjectURL(url);
      return;
    }
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const want = lang === "it" ? "it" : "en";
    const voices = synth.getVoices();
    u.voice = voices.find((v) => v.lang.toLowerCase().startsWith(want) && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith(want)) ?? null;
    u.lang = want === "it" ? "it-IT" : "en-US";
    u.rate = 1.05 * (statusRef.current?.speed ?? 1);
    await new Promise<void>((resolve) => {
      const done = () => { clearInterval(check); clearTimeout(stuck); resolve(); };
      const stuck = setTimeout(() => { synth.cancel(); done(); }, speechDeadline(text, statusRef.current?.speed));
      u.onend = u.onerror = done;
      synth.speak(u);
      const check = setInterval(() => { if (run.current !== id) { synth.cancel(); done(); } else if (!synth.speaking && !synth.pending) done(); }, 150);
    });
  }, [engineHeaders, lang]);

  // Hands-free: after each answer the mic opens again until it is switched off.
  const listenAgain = useRef<() => void>(() => {});

  /** Second, narrow request: just the point for what the answer described. Null when there is none. */
  const groundAnswer = useCallback(async (question: string, answer: string, images: string[], shot: OkFilowCapture, signal: AbortSignal) => {
    const res = await fetch("/api/buddy/ask", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...(await engineHeaders()) },
      body: JSON.stringify({
        question: `${question}\nYou answered: "${answer.slice(0, 300)}". Reply with only the tag [POINT:x,y:label:screenN] for that thing, on the 0-1000 grid, and nothing else. If it is not visible, reply NONE.`,
        images,
        screens: shot.screens,
        history: [],
        language: "auto",
        provider: statusRef.current?.provider ?? "local",
      }),
    });
    if (!res.ok) return null;
    const p = parseBuddyAnswer(await res.text(), shot.screens, shot.screens.find((x) => x.cursor)?.index ?? 1).points[0];
    const d = p && shot.displays.find((x) => x.index === p.screen);
    return p && d ? { ...pointToDisplay(p, d.bounds), label: p.label } : null;
  }, [engineHeaders]);

  const ask = useCallback(async (question: string, opts: { typed?: boolean } = {}) => {
    const b = okFilowBridge();
    if (!b) return;
    // "agent, ..." goes to a background job instead of the screen helper.
    try {
      const job = await b.agents.start(question, history.current.at(-1)?.text ?? "");
      if (job) {
        const said = t("agentStarted").replace("{title}", job.title);
        setHeard(question);
        setAnswer(said);
        b.text(said);
        setMode("speaking");
        const id = ++run.current;
        if (!opts.typed || statusRef.current?.typedVoice) await speak(said, id);
        if (run.current === id) setMode("idle");
        if (handsFree.current) listenAgain.current();
        return;
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    const id = ++run.current;
    asking.current?.abort();
    const abort = new AbortController();
    asking.current = abort;
    setHeard(question);
    setAnswer("");
    setError("");
    setMode("thinking");
    b.text("");
    b.clearVisuals();
    try {
      const shot = await b.capture();
      // What the user circled goes in two ways: burnt into the screenshot, and as grid boxes in words.
      const marked = shot.marked ?? [];
      const images = marked.length
        ? await Promise.all(shot.images.map((img, i) => burnStrokes(img, marked.filter((m) => m.screen === i + 1), statusRef.current?.color ?? "#ffb600")))
        : shot.images;
      const markedNote = [describeMarked(marked), shot.selected ? `(Text I have selected: "${shot.selected}")` : ""].filter(Boolean).join("\n");
      const res = await fetch("/api/buddy/ask", {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json", ...(await engineHeaders()) },
        body: JSON.stringify({ question: markedNote ? question + "\n" + markedNote : question, images, screens: shot.screens, history: history.current, language: "auto", provider: statusRef.current?.provider ?? "local" }),
      });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        if (run.current !== id) return;
        const shown = parseBuddyAnswer(raw.split("\n[ERROR]")[0], shot.screens).text;
        setAnswer(shown);
        b.text(shown);
      }
      const [body, err] = raw.split("\n[ERROR] ");
      if (err) throw new Error(err.trim());
      const { text, points, marks, cards, model, drawing } = parseBuddyAnswer(body, shot.screens, shot.screens.find((s) => s.cursor)?.index ?? 1);
      // Answer log (dev builds, or the folder the user picked): exactly what the model produced and saw.
      void b.answerLog({ question, raw: body, visuals: { text, points, marks, cards, model, drawing }, images, svg: drawing ? drawingSvg(drawing) : undefined }).catch(() => "");
      if (!text && !points.length) throw new Error(t("emptyAnswer"));
      setAnswer(text);
      b.text(text);
      history.current = [...history.current, { role: "user" as const, text: question }, { role: "assistant" as const, text: body.trim() }].slice(-12);
      saveHistory(history.current);
      const mapped = points.flatMap((p) => {
        const d = shot.displays.find((x) => x.index === p.screen);
        return d ? [{ ...pointToDisplay(p, d.bounds), label: p.label }] : [];
      });
      if (mapped.length) b.point(mapped);
      const drawn = marks.flatMap((m) => {
        const d = shot.displays.find((x) => x.index === m.screen);
        return d ? [markToDisplay(m, d.bounds)] : [];
      });
      if (drawn.length) b.draw(drawn);
      if (model) b.showModel(model);
      lastShown.current = { points: mapped, marks: drawn, model, cards: [] };
      if (drawing) {
        // The 2D drawing is shown as a card near the cursor; its image is our own SVG from validated shapes.
        const s = shot.screens.find((x) => x.cursor)?.index ?? 1;
        cards.unshift({ x: 500, y: 250, title: drawing.title, text: "", photo: "", svg: drawingSvg(drawing), screen: s });
      }
      if (cards.length) {
        // Photos are fetched while the answer is spoken; a card without one still shows its text.
        void Promise.all(cards.map(async (c) => {
          const d = shot.displays.find((x) => x.index === c.screen);
          if (!d) return null;
          const at = pointToDisplay({ x: c.x, y: c.y, label: "", screen: c.screen }, d.bounds);
          let photo = c.svg ? `data:image/svg+xml;base64,${btoa(c.svg)}` : "";
          if (c.photo && !statusRef.current?.offline) {
            const r = await fetch(`/api/buddy/photo?q=${encodeURIComponent(c.photo)}`, { headers: await engineHeaders() }).catch(() => null);
            photo = (r && r.ok ? ((await r.json()) as { dataUrl?: string | null }).dataUrl : null) ?? "";
          }
          return { ...at, title: c.title, text: c.text, photo };
        })).then((list) => {
          if (run.current !== id) return;
          const shown = list.filter((x): x is NonNullable<typeof x> => Boolean(x));
          if (lastShown.current) lastShown.current.cards = shown;
          b.cards(shown);
        });
      }
      // HeyClicky always shows you where. Small local models sometimes answer in words only: then ask
      // once more, narrowly, for the point, while the answer is already being spoken.
      const grounding = !mapped.length && !drawn.length && !cards.length && !model && text
        ? groundAnswer(question, text, images, shot, abort.signal).then((p) => { if (p && run.current === id) b.point([p]); }).catch(() => {})
        : Promise.resolve();
      setMode("speaking");
      if (!opts.typed || statusRef.current?.typedVoice) await speak(text, id);
      await grounding;
      if (run.current === id) setMode("idle");
      if (run.current === id && handsFree.current) listenAgain.current();
    } catch (e) {
      if (abort.signal.aborted || run.current !== id) return;
      fail(e instanceof Error ? e.message : String(e));
      if (handsFree.current) setTimeout(() => handsFree.current && listenAgain.current(), 1500);
    }
  }, [engineHeaders, fail, groundAnswer, setMode, speak, t]);

  const startListening = useCallback(async (why: Purpose = "talk") => {
    const b = okFilowBridge();
    if (!b) return;
    if (audio.current || starting.current) return;
    starting.current = true;
    pendingStop.current = null;
    session.current++;
    purpose.current = why;
    committed.current = [];
    partial.current = "";
    setNote("");
    vad.current = why === "handsfree" ? createVad() : null;
    if (why !== "dictate") {
      // A new question interrupts the old answer; dictation leaves the conversation alone.
      run.current++;
      asking.current?.abort();
      window.speechSynthesis?.cancel();
      setHeard("");
      setAnswer("");
      setError("");
      b.text("");
      b.point([]);
    }
    setMode("listening", { purpose: why });
    if (why === "dictate") b.text(t("dictating"));
    try {
      // Like HeyClicky: never guess the language from the UI, let the recognizer detect what is spoken.
      await b.stt.start("auto");
      const mic = getSelectedMic();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (ev) => {
        const samples = new Float32Array(ev.inputBuffer.getChannelData(0));
        b.stt.feed(samples);
        let peak = 0;
        for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
        const level = Math.min(1, peak * 2.5);
        b.level(level);
        if (vad.current?.push(level, performance.now())) { vad.current = null; void stopRef.current(true); }
      };
      src.connect(node);
      node.connect(ctx.destination);
      audio.current = { ctx, stream, node };
      starting.current = false;
      if (pendingStop.current !== null) {
        const send = pendingStop.current;
        pendingStop.current = null;
        void stopRef.current(send);
      }
    } catch (e) {
      starting.current = false;
      pendingStop.current = null;
      stopAudio();
      void b.stt.stop().catch(() => {});
      fail(e instanceof Error ? e.message : String(e));
    }
  }, [fail, setMode, stopAudio, t]);

  const stopListening = useCallback(async (send: boolean) => {
    const b = okFilowBridge();
    if (!b) return;
    if (starting.current) { pendingStop.current = send; return; }
    if (!audio.current) return;
    const why = purpose.current;
    const sid = session.current;
    stopAudio();
    try { await b.stt.stop(); } catch { /* the error already reached onResult */ }
    // The recognizer's last words can land up to about a second after the keys go up: wait for them.
    for (let waited = 0; waited < 1500; waited += 50) {
      await new Promise((r) => setTimeout(r, 50));
      if (waited >= 150 && joinTranscript(committed.current, partial.current)) break;
    }
    // A new recording started meanwhile (a press during hands-free): leave its state alone.
    if (session.current !== sid) return;
    const question = joinTranscript(committed.current, partial.current);
    if (!send) { b.text(""); return setMode("idle"); }
    if (why === "dictate") {
      b.text("");
      if (!question) return setMode("idle");
      const ok = await b.typeText(question).catch(() => false);
      setNote(ok ? t("dictated") : t("dictateFailed"));
      if (!ok) setTyped(question);
      return setMode("idle");
    }
    if (!question) {
      if (why === "handsfree" && handsFree.current) { setMode("idle"); return listenAgain.current(); }
      b.text(t("notHeard"));
      return setMode("error", { error: t("notHeard") });
    }
    void ask(question);
  }, [ask, setMode, stopAudio, t]);
  const stopRef = useRef(stopListening);
  stopRef.current = stopListening;
  listenAgain.current = () => { if (handsFree.current) void startListening("handsfree"); };

  const setHandsFree = useCallback((on: boolean) => {
    handsFree.current = on;
    setHandsFreeOn(on);
    if (on) void startListening("handsfree");
    else if (purpose.current === "handsfree") void stopListening(false);
  }, [startListening, stopListening]);

  useEffect(() => {
    const b = bridge;
    if (!b) return;
    const offs = [
      b.stt.onResult((r) => {
        if (r.error) return fail(r.error);
        if (r.committed) { committed.current.push(r.committed); partial.current = ""; }
        else partial.current = r.partial;
        const live = joinTranscript(committed.current, partial.current);
        setHeard(live);
        b.text(live);
      }),
      b.onPress((p) => {
        if (handsFree.current) { handsFree.current = false; setHandsFreeOn(false); b.handsFreeOff(); void stopListening(false); }
        void startListening(p?.purpose === "dictate" ? "dictate" : "talk");
      }),
      b.onRelease(() => void stopListening(true)),
      b.onCancel(() => void stopListening(false)),
      b.onHandsFree((on) => setHandsFree(Boolean(on))),
      b.onQuickAsk(() => setTimeout(() => typeBox.current?.focus(), 30)),
      // A part clicked in the 3D model window: ask about it, like a spoken question.
      b.onAskText((text) => { if (typeof text === "string" && text.trim()) void ask(text.trim()); }),
      b.agents.onChange(setJobs),
      b.onWelcome((tray) => {
        const key = HOTKEY_LABEL[statusRef.current?.hotkey ?? "ctrl+alt"] ?? "Ctrl + Alt";
        const line = t("welcome").replace("{key}", key);
        void b.configure({ onboarded: true }).then(setStatus);
        if (tray) b.draw([{ kind: "circle", x: tray.x, y: tray.y, r: 26, label: "OK Filow", screen: 1 }]);
        b.text(line);
        setMode("speaking");
        const id = ++run.current;
        void speak(line, id).finally(() => { if (run.current === id) setMode("idle"); });
      }),
      b.agents.onDone((job) => {
        const line = (job.status === "done" ? t("agentDone") : t("agentFailed")).replace("{title}", job.title).replace("{summary}", job.summary);
        b.text(line);
        // Announce only when nothing else is being said or heard.
        if (!audio.current && statusRef.current?.voice !== "off") void speak(line, run.current);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [ask, bridge, fail, setHandsFree, setMode, speak, startListening, stopListening, t]);

  if (!bridge) return <main className="okf-panel"><p>{t("desktopOnly")}</p></main>;
  const c = status;
  const configure = async (patch: Partial<OkFilowStatus>) => setStatus(await bridge.configure(patch));
  /** Redraws the last answer's visuals (they may have been cleared with Escape). */
  const replay = () => {
    const last = lastShown.current;
    if (!last) return;
    bridge.clearVisuals();
    if (last.points.length) bridge.point(last.points);
    if (last.marks.length) bridge.draw(last.marks);
    if (last.cards.length) bridge.cards(last.cards);
    if (last.model) bridge.showModel(last.model);
  };
  const hotkey = HOTKEY_LABEL[c?.hotkey ?? "ctrl+alt"] ?? c?.hotkey;

  return (
    <main className="okf-panel">
      <header className="okf-head">
        <span className={`okf-dot okf-dot--${mode}`} aria-hidden />
        <h1>OK Filow</h1>
        <button className="okf-x" aria-label={t("close")} title={t("close")} onClick={() => bridge.hidePanel()}>×</button>
      </header>

      <p className="okf-status" role="status">{t(`mode_${mode}` as OkfKey)}</p>
      <p className="okf-hint">
        {c?.hook === "toggle" ? t("hintToggle") : t("hintHold").replace("{key}", hotkey ?? "")}
      </p>
      {c?.hook !== "toggle" && <p className="okf-hint">{t("hintMore")}</p>}
      {handsFreeOn && (
        <p className="okf-handsfree" role="status">
          {t("handsFreeOn")}
          <button type="button" onClick={() => { bridge.handsFreeOff(); setHandsFree(false); }}>{t("handsFreeStop")}</button>
        </p>
      )}
      {note && <p className="okf-note" role="status">{note}</p>}

      {(heard || answer || error) && (
        <section className="okf-convo">
          {heard && <p className="okf-q">{heard}</p>}
          {answer && <p className="okf-a">{answer}</p>}
          {error && <p className="okf-err">{error}</p>}
        </section>
      )}

      {sttReady === false && <p className="okf-warn">{t("noStt")} <a href="/settings/local" target="_blank" rel="noreferrer">{t("openSettings")}</a></p>}

      <form className="okf-type" onSubmit={(e) => { e.preventDefault(); const q = typed.trim(); if (q) { setTyped(""); bridge.hidePanel(); void ask(q, { typed: true }); } }}>
        <input ref={typeBox} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("typePlaceholder")} aria-label={t("typePlaceholder")} />
        <button type="submit" disabled={!typed.trim()}>{t("ask")}</button>
      </form>

      <section className="okf-jobs" aria-label={t("agentsTitle")}>
        <h2>{t("agentsTitle")}</h2>
        {jobs.length === 0 && <p className="okf-hint">{t("agentsHint")}</p>}
        {jobs.slice(0, 6).map((j) => (
          <article key={j.id} className={"okf-job okf-job--" + j.status}>
            <header>
              <strong>{j.title}</strong>
              <span className="okf-chip">{t(j.status === "running" ? "agentRunning" : j.status === "done" ? "agentDoneLabel" : j.status === "failed" ? "agentFailedLabel" : "agentStoppedLabel")}</span>
            </header>
            {j.summary && <p>{j.summary}</p>}
            <div className="okf-job-actions">
              {j.artifacts[0] && <button type="button" onClick={() => void bridge.agents.open(j.artifacts[0])}>{t("agentOpen")}</button>}
              <button type="button" onClick={() => void bridge.agents.open(j.dir)}>{t("agentFolder")}</button>
              {j.status === "running"
                ? <button type="button" onClick={() => void bridge.agents.stop(j.id).then(setJobs)}>{t("agentStop")}</button>
                : <button type="button" onClick={() => void bridge.agents.remove(j.id).then(setJobs)}>{t("agentRemove")}</button>}
            </div>
          </article>
        ))}
      </section>

      {c && (
        <section className="okf-settings">
          <label className="okf-row">
            <span>{t("enabled")}</span>
            <input type="checkbox" checked={c.enabled} onChange={(e) => void configure({ enabled: e.target.checked })} />
          </label>
          <label className="okf-row">
            <span>{t("showAlways")}</span>
            <input type="checkbox" checked={c.showAlways} onChange={(e) => void configure({ showAlways: e.target.checked })} />
          </label>
          <label className="okf-row">
            <span>{t("hotkey")}</span>
            <select value={c.hotkey} onChange={(e) => void configure({ hotkey: e.target.value })} disabled={c.hook === "toggle"}>
              {c.hotkeys.map((h) => <option key={h} value={h}>{HOTKEY_LABEL[h] ?? h}</option>)}
            </select>
          </label>
          <label className="okf-row">
            <span>{t("brain")}</span>
            <select value={c.offline ? "local" : c.provider} onChange={(e) => void configure({ provider: e.target.value as "local" | "cloud" })} disabled={c.offline}>
              <option value="local">{t("brainLocal")}</option>
              <option value="cloud">{t("brainCloud")}</option>
            </select>
          </label>
          <label className="okf-row">
            <span>{t("voice")}</span>
            <select value={c.offline && c.voice === "cloud" ? "system" : c.voice} onChange={(e) => void configure({ voice: e.target.value as "system" | "cloud" | "off" })}>
              <option value="system">{t("voiceSystem")}</option>
              {!c.offline && <option value="cloud">{t("voiceCloud")}</option>}
              <option value="off">{t("voiceOff")}</option>
            </select>
          </label>
          <label className="okf-row">
            <span>{t("speed")}</span>
            <select value={String(c.speed)} onChange={(e) => void configure({ speed: Number(e.target.value) })}>
              {[0.75, 0.9, 1, 1.15, 1.3, 1.5].map((v) => <option key={v} value={v}>{v}x</option>)}
            </select>
          </label>
          <label className="okf-row">
            <span>{t("typedVoice")}</span>
            <input type="checkbox" checked={c.typedVoice} onChange={(e) => void configure({ typedVoice: e.target.checked })} />
          </label>
          <label className="okf-row">
            <span>{t("dictation")}</span>
            <input type="checkbox" checked={c.dictation} disabled={c.hotkey === c.dictateChord} onChange={(e) => void configure({ dictation: e.target.checked })} />
          </label>
          <div className="okf-row">
            <span>{t("color")}</span>
            <span className="okf-swatches" role="radiogroup" aria-label={t("color")}>
              {COLORS.map((col) => (
                <button key={col} type="button" role="radio" aria-checked={c.color === col} aria-label={col} title={col}
                  className={"okf-swatch" + (c.color === col ? " okf-swatch--on" : "")} style={{ background: col }}
                  onClick={() => void configure({ color: col })} />
              ))}
            </span>
          </div>
          <label className="okf-row">
            <span>{t("agentCli")}</span>
            <select value={c.agentCli ?? "auto"} onChange={(e) => void configure({ agentCli: e.target.value })}>
              <option value="auto">{t("agentCliAuto")}</option>
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </label>
          <label className="okf-row">
            <span>{t("allowScreenshots")}</span>
            <input type="checkbox" checked={c.allowScreenshots === true} onChange={(e) => void configure({ allowScreenshots: e.target.checked })} />
          </label>
          <label className="okf-row">
            <span>{t("answerLog")}</span>
            <input type="checkbox" checked={c.answerLog === true} onChange={(e) => void configure({ answerLog: e.target.checked })} />
          </label>
          {c.answerLog && <div className="okf-row">
            <button type="button" className="okf-link" onClick={() => void okFilowBridge()?.deleteAnswers().then((n) => setNote(t("answersDeleted").replace("{n}", String(n))))}>{t("deleteAnswers")}</button>
          </div>}
          <div className="okf-row">
            <span>{t("answerDir")}</span>
            <button type="button" className="okf-link" title={c.answerDir || ""} onClick={() => void okFilowBridge()?.pickAnswerDir().then(setStatus).catch((e) => fail(String(e?.message ?? e)))}>
              {c.answerDir ? c.answerDir.split(/[\\/]/).pop() : t("answerDirPick")}
            </button>
          </div>
          <div className="okf-row">
            <button type="button" className="okf-link" onClick={() => okFilowBridge()?.clearVisuals()}>{t("clearVisuals")}</button>
            <button type="button" className="okf-link" disabled={!lastShown.current} onClick={replay}>{t("replay")}</button>
            <button type="button" className="okf-link" onClick={() => void okFilowBridge()?.openAnswers().then((ok) => { if (!ok) setNote(t("answerDirNone")); })}>{t("openAnswers")}</button>
          </div>
          <button type="button" className="okf-link" onClick={() => { history.current = []; saveHistory([]); setNote(t("historyCleared")); }}>{t("clearHistory")}</button>
          {c.provider === "cloud" && !c.offline && <p className="okf-note">{t("cloudNote")}</p>}
          {c.offline && <p className="okf-note">{t("offlineNote")}</p>}
        </section>
      )}
    </main>
  );
}
