"use client";
// OK Filow panel: settings + the "brain" (hold-to-talk -> speech-to-text on this PC ->
// screenshots -> /api/buddy/ask streamed -> voice + pointing). Lives in a hidden desktop window.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@filow/ui";
import { getSelectedMic } from "@filow/stt";
import { joinTranscript, okFilowBridge, type OkFilowBridge, type OkFilowCapture, type OkFilowCard, type OkFilowJob, type OkFilowMode, type OkFilowStatus } from "@/lib/buddy/bridge";
import { drawingSvg, type BuddyModel } from "@/lib/buddy/visuals";
import { createSpeaker } from "@/lib/buddy/voice";
import { markToDisplay, parseBuddyAnswer, pointToDisplay, type BuddyTurn } from "@/lib/buddy/prompt";
import { okfText, OLLAMA_STOPPED_ANSWER, type OkfKey } from "@/lib/buddy/text";
import { dictationText, pasteKeys, type DictationKey } from "@/lib/dictation/text";
import { playCue } from "@/lib/dictation/cue";
import { createPhraseFlow, type PhraseFlow } from "@/lib/dictation/handsfree";
import { burnStrokes, createVad, describeMarked } from "@/lib/buddy/listen";
import { askRoute, askRouteRecipient, changesStored, consentKey, FREELLM_ID, joinNames, localAnswersLabel, localNames, localServer, voiceRoute, whoPhrase, type BuddyRecipients, type NoticeRequest, type OutboundSnapshot, type Recipient } from "@/lib/buddy/outbound";
import { FREELLM_DOWNLOAD_URL, freellmCodeOf, localizeFreeLlmError } from "@/lib/freellm";
import { FreeLlmPanelNotes } from "./freellm-notes";
import { createOutboundController, type OutboundController } from "@/lib/buddy/outboundClient";
import { ConsentList, OutboundNotice, OutboundPill } from "../outbound-ui";
import { VoiceSettings } from "./voice-settings";
import { getSetupPreference, getSpeechLang } from "@/lib/prefs";
import { createAnswerTurn, joinContinuation, resumePlan, sentenceParts, splitSentences } from "@/lib/buddy/turn";
import { createProgressiveSpeech, moreFollows, type ProgressiveSpeech } from "@/lib/buddy/progressive";
import { reopenAfterSpeech } from "@/lib/buddy/reopen";
import { askSees, eyeToggle, screenLeaves, screenYesMissing, seesScreen, slowToSee, stillSees, wordsOnlyAfterYes, type LocalScreenMode } from "@/lib/buddy/sees";
import { keyLabel, type PillAction } from "@/lib/buddy/pill";
import { createPausableClock, marksStarted, STROKE_GAP_MS } from "@/lib/buddy/motion";
import { wantsDrawing } from "@/lib/buddy/visuals";
import { photoOnly } from "@/lib/buddy/photo";
import { AnswerControls, KeyChoice, SeeScreenSwitch } from "@/components/okfilow/controls";
import { whiteboardTopic } from "@/lib/whiteboard/client";
import "../okfilow.css";

const HISTORY_KEY = "okfilow.history.v1";
const COLORS = ["#ffb600", "#3380ff", "#ff4d6d", "#2ecc71", "#b06cff", "#ffffff"];
type Purpose = "talk" | "dictate" | "handsfree";
/** Why the words were only copied, in plain words (an administrator window, no text box, keys refused). */
const copiedKey = (reason: string): DictationKey => (reason === "elevated" ? "copiedElevated" : reason === "nofocus" ? "copiedNoFocus" : reason === "blocked" ? "copiedBlocked" : "copied");

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
  const t = useCallback((k: OkfKey) => okfText(lang)(k), [lang]);
  const dictT = useCallback((k: DictationKey, vars?: Record<string, string>) => dictationText(lang, k, vars), [lang]);
  /** The language the recognizer listened in for this dictation (for the filler words). */
  const spoken = useRef("");
  const [bridge, setBridge] = useState<OkFilowBridge | null>(null);
  const [status, setStatus] = useState<OkFilowStatus | null>(null);
  const [mode, setModeState] = useState<OkFilowMode>("idle");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  /** The last error was "FreeLLMAPI is not running": its download link shows under it. */
  const [freeDown, setFreeDown] = useState(false);
  const [typed, setTyped] = useState("");
  const [sttReady, setSttReady] = useState<boolean | null>(null);

  const history = useRef<BuddyTurn[]>([]);
  const purpose = useRef<Purpose>("talk");
  const handsFree = useRef(false);
  const [handsFreeOn, setHandsFreeOn] = useState(false);
  const vad = useRef<ReturnType<typeof createVad> | null>(null);
  // Hands-free dictation (issue #2): the next dictation types phrase by phrase (set by the press), the
  // flow that decides when, and the phrases being typed, one after the other.
  const dictHandsFree = useRef(false);
  const flow = useRef<PhraseFlow | null>(null);
  const typing = useRef<Promise<unknown>>(Promise.resolve());
  /** Goes up when a dictation is cancelled or fails: phrases still queued from before are not typed. */
  const typingRun = useRef(0);
  const micTick = useRef<(level: number, now: number) => void>(() => {});
  // Start/stop can cross: a release while the mic is still opening is remembered and applied after.
  const starting = useRef(false);
  const pendingStop = useRef<boolean | null>(null);
  /** A stop is finishing (decoding, typing); a press meanwhile waits in queuedStart. */
  const stopping = useRef(false);
  const queuedStart = useRef<Purpose | null>(null);
  const session = useRef(0);
  const typeBox = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [jobs, setJobs] = useState<OkFilowJob[]>([]);
  const committed = useRef<string[]>([]);
  const partial = useRef("");
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode } | null>(null);
  const run = useRef(0);
  const asking = useRef<AbortController | null>(null);
  // The answer in progress, so it can be stopped (lib/buddy/turn.ts), and whether the one on screen was.
  const turn = useRef(createAnswerTurn());
  const [stopped, setStopped] = useState(false);
  const modeRef = useRef<OkFilowMode>("idle");
  modeRef.current = mode;
  // Pause and Resume (docs/okfilow/PILL.md): the answer in progress is paused; a stopped one can be carried on.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [resumable, setResumable] = useState(false);
  /** The clock the answer's marks are drawn on: it stands still during a pause, like the overlay's. */
  const drawClock = useRef(createPausableClock());
  /** The answer in progress: whether it is read aloud, its language, and its marks (for a Resume after Stop). */
  // `voice`: the answer's speech queue (lib/buddy/progressive.ts), which knows how far the user heard it.
  const answerCtx = useRef<{ id: number; typed: boolean; lang?: string; speaking: boolean; marks: Parameters<OkFilowBridge["draw"]>[0]; marksAt: number; marksBase: number; voice?: ProgressiveSpeech } | null>(null);
  /** What a Resume of the stopped answer needs beyond the offer itself (lib/buddy/turn.ts); `heard`: sentences heard whole. */
  const resumeInfo = useRef<{ typed: boolean; lang?: string; left: string; heard: number; marks: Parameters<OkFilowBridge["draw"]>[0]; from: number } | null>(null);
  // "Look at my screen": what the setup for this computer picked (until the user chooses), and whether the question being answered took the screen.
  const [localScreen, setLocalScreen] = useState<LocalScreenMode>(null);
  const localScreenRef = useRef<LocalScreenMode>(null);
  localScreenRef.current = localScreen;
  const [asksSee, setAsksSee] = useState(true);
  /** The last answer's visuals in global DIP, for "Replay last answer". */
  const lastShown = useRef<{ points: Parameters<OkFilowBridge["point"]>[0]; marks: Parameters<OkFilowBridge["draw"]>[0]; model: BuddyModel | null; cards: OkFilowCard[] } | null>(null);
  const token = useRef<string | null>(null);
  const statusRef = useRef<OkFilowStatus | null>(null);
  statusRef.current = status;
  // Going outside: the first-send notice on screen, what is in flight right now, who would receive what.
  const [notice, setNotice] = useState<NoticeRequest | null>(null);
  const [outSnap, setOutSnap] = useState<OutboundSnapshot>({ active: false, kinds: [], names: [] });
  const [recipients, setRecipients] = useState<BuddyRecipients | null>(null);
  const outRef = useRef<OutboundController | null>(null);

  useEffect(() => {
    const b = okFilowBridge();
    setBridge(b);
    if (!b) return;
    void b.status().then(setStatus);
    void outRef.current?.recipients();
    history.current = loadHistory();
    void b.agents.list().then(setJobs).catch(() => {});
    // Load the local model now, so the first question does not wait for it (local only, no content sent).
    void b.status().then(async (s) => {
      if (s.enabled && (s.provider === "local" || s.offline)) {
        await fetch("/api/buddy/warm", { method: "POST", headers: { "Content-Type": "application/json", ...(await engineHeadersRef.current()) }, body: JSON.stringify({ setup: getSetupPreference() }) }).catch(() => {});
      }
    });
    void b.stt.status().then((s) => setSttReady(s.ready)).catch(() => setSttReady(false));
    // What the setup for this computer picked for looking at the screen (the switch shows it until the user chooses).
    void (async () => {
      const res = await fetch(`/api/buddy/screen?setup=${encodeURIComponent(getSetupPreference())}`, { headers: await engineHeadersRef.current() });
      if (res.ok) setLocalScreen(((await res.json()) as { local?: LocalScreenMode }).local ?? null);
    })().catch(() => {});
    const offs = [b.onConfig(setStatus), b.onMode((m) => setModeState(m.mode)), b.outbound?.onChange(setOutSnap)];
    b.outbound?.ready();
    return () => {
      offs.forEach((o) => o?.());
      // A panel that goes away can no longer be answered: nothing that was waiting may be sent.
      outRef.current?.dismissAll();
    };
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
    // A stopped Ollama: said in the user's language, and the desktop shell starts it in the background.
    const stopped = OLLAMA_STOPPED_ANSWER.test(raw);
    const plain = raw.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "");
    // FreeLLMAPI's failures come tagged from the server: shown in the panel's language, with its download link when it is not running
    const message = stopped ? t("ollamaStopped") : localizeFreeLlmError(plain, lang);
    setFreeDown(freellmCodeOf(plain) === "not_running");
    setError(message);
    okFilowBridge()?.text(message);
    setMode("error", stopped ? { error: message, code: "ollama_stopped" } : { error: message });
    // Hands-free dictation: nothing more is typed after an error; words still waiting for a pause are kept in the box below.
    const f = flow.current;
    flow.current = null;
    typingRun.current++;
    const rest = f ? joinTranscript(f.pending(), partial.current) : "";
    if (rest) setTyped((was) => joinTranscript([was, rest], ""));
    // A failure never leaves the mic open.
    if (audio.current) {
      stopAudio();
      void okFilowBridge()?.stt.stop().catch(() => {});
    }
  }, [lang, setMode, stopAudio, t]);

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

  // Nothing carrying the user's content leaves this window except through this controller: it asks
  // before the first send to each recipient, adds the header the server checks, and drives the signal.
  if (!outRef.current) {
    outRef.current = createOutboundController({
      consent: () => statusRef.current?.consent,
      save: async (_next, also, changes) => {
        const b = okFilowBridge();
        if (!b) return false;
        // Only this window's changes: main merges them into what is stored now.
        const s = await b.configure({ consentChanges: changes, ...also });
        statusRef.current = s;
        setStatus(s);
        // A yes that main did not store is not a yes.
        return changesStored(s.consent ?? {}, changes);
      },
      fetchRecipients: async () => {
        const res = await fetch("/api/buddy/recipients", { headers: await engineHeadersRef.current() });
        const got = res.ok ? ((await res.json()) as BuddyRecipients) : null;
        if (got) setRecipients(got);
        return got;
      },
      signal: {
        begin: (id, kind, names) => okFilowBridge()?.outbound?.begin(id, kind, names),
        end: (id, o) => okFilowBridge()?.outbound?.end(id, o),
      },
      onNotice: (head) => {
        setNotice(head);
        if (head) okFilowBridge()?.notice?.open();
        else okFilowBridge()?.notice?.close();
      },
    });
  }
  const out = outRef.current;

  /**
   * The cloud voice, behind the notice and the signal. A Blob: play it. "system": the user kept the
   * voice on this PC. null: the notice was closed without a choice, say nothing.
   */
  const cloudVoice = useCallback(async (text: string): Promise<Blob | "system" | null> => {
    const rec = await out.recipients();
    if (!rec) throw new Error(t("noticeUnknown"));
    const decision = await out.allow("voice", rec.voice);
    if (decision === "declined") { setNote(t("kept_voice")); return "system"; }
    if (decision !== "granted") return null;
    return out.sending("voice", rec.voice, async (consent) => {
      const res = await fetch("/api/buddy/tts", { method: "POST", headers: { "Content-Type": "application/json", ...(await engineHeaders()), ...consent }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `voice ${res.status}`);
      return res.blob();
    });
  }, [engineHeaders, out, t]);
  const cloudVoiceRef = useRef(cloudVoice);
  cloudVoiceRef.current = cloudVoice;

  // The three voices (natural on this PC, this PC's own, cloud) live in lib/buddy/voice.ts; the cloud
  // one gets its audio only through cloudVoice above, so the notice and the signal always come first.
  const langRef = useRef(lang);
  langRef.current = lang;
  const tRef = useRef(t);
  tRef.current = t;
  /** How many sentences of the text in the bubble come before the ones the voice is saying (0, or more after a Resume). */
  const spokenBase = useRef(0);
  const speaker = useMemo(() => createSpeaker({
    bridge: okFilowBridge,
    status: () => statusRef.current,
    isCurrent: (id) => run.current === id,
    uiLang: () => langRef.current,
    cloudAudio: (text) => cloudVoiceRef.current(text),
    onFallback: (reason) => setNote(tRef.current(`voiceWhy_${reason}`)),
    onNoVoice: () => setNote(tRef.current("voiceNoSystem")),
    // The bubble next to the pointer keeps the sentence being spoken in view.
    onSentence: (index) => okFilowBridge()?.spoken?.(spokenBase.current + index),
  }), []);
  // lang: the answer's language from the server (X-Buddy-Lang); without it the voice detects it from the text.
  // base: how many sentences of the text in the bubble come before what is spoken now (a Resume says only the rest).
  const speak = useCallback((text: string, id: number, lang?: string, base = 0) => {
    spokenBase.current = base;
    return speaker.speak(text, id, { lang });
  }, [speaker]);
  useEffect(() => speaker.attach(), [speaker]);

  // Hands-free: after each answer the mic opens again until it is switched off.
  const listenAgain = useRef<() => void>(() => {});

  /**
   * Second, narrow request: just the point for what the answer described. Null when there is none.
   * `to` is who the question itself went to (null: it stayed on this PC, and so does this one).
   */
  const groundAnswer = useCallback(async (question: string, answer: string, images: string[], shot: OkFilowCapture, signal: AbortSignal, to: Recipient | null) => {
    const send = async (consent: Record<string, string>) => {
      const res = await fetch("/api/buddy/ask", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", ...(await engineHeaders()), ...consent },
        body: JSON.stringify({
          question: `${question}\nYou answered: "${answer.slice(0, 300)}". Reply with only the tag [POINT:x,y:label:screenN] for that thing, on the 0-1000 grid, and nothing else. If it is not visible, reply NONE.`,
          images,
          screens: shot.screens,
          elements: shot.elements,
          history: [],
          language: getSpeechLang(),
          // the same door as the answer: never another cloud than the one the user said yes to
          provider: to ? (to.id === FREELLM_ID ? "freellm" : "cloud") : "local",
          setup: getSetupPreference(),
        }),
      });
      return res.ok ? res.text() : null;
    };
    const raw = to ? await out.sending("ask", to, send) : await send({});
    if (raw === null) return null;
    const p = parseBuddyAnswer(raw, shot.screens, shot.screens.find((x) => x.cursor)?.index ?? 1).points[0];
    const d = p && shot.displays.find((x) => x.index === p.screen);
    return p && d ? { ...pointToDisplay(p, d.bounds), label: p.label } : null;
  }, [engineHeaders, out]);

  /**
   * Ends the answer in progress for good: the request to the model (the server stops the model when
   * the request goes), the voice, the notice still waiting. What was already said goes into the
   * conversation. Returns what was on screen, or null when no answer was being fetched.
   */
  const endAnswer = useCallback(() => {
    run.current++;
    const was = turn.current.stop(history.current);
    asking.current?.abort();
    // A paused answer that ends is no longer paused.
    pausedRef.current = false;
    setPaused(false);
    drawClock.current.resume(performance.now());
    speaker.stop();
    window.speechSynthesis?.cancel();
    if (was && was.history !== history.current) {
      history.current = was.history;
      saveHistory(history.current);
    }
    return was;
  }, [speaker]);

  /**
   * Stop (the button, Escape): the answer ends at once and what was already said stays, marked as
   * stopped. Not an error. Hands-free goes back to listening, as after any answer.
   */
  const stopAnswer = useCallback(() => {
    const b = okFilowBridge();
    if (!b || (modeRef.current !== "thinking" && modeRef.current !== "speaking")) return false;
    const ctx = answerCtx.current;
    // How many marks had begun to draw (the rest wait for a Resume), on the clock that stood still during a pause.
    const begun = ctx ? Math.min(ctx.marks.length, ctx.marksBase + marksStarted(ctx.marks.length - ctx.marksBase, drawClock.current.at(performance.now()) - ctx.marksAt, STROKE_GAP_MS)) : 0;
    const was = endAnswer();
    // Nothing of the stopped answer may still go out, and the pointer stops flying to places.
    outRef.current?.dismissAll();
    b.point([]);
    setStopped(true);
    if (was) { setAnswer(was.shown); b.text(was.shown); }
    // What Resume would do (lib/buddy/turn.ts): the model carries on, the question is asked again,
    // or (the whole answer was there) the voice says the sentences it has not said and the pen draws the marks not begun.
    const offer = turn.current.offer();
    // The speech queue knows the chunks not started yet; the voice knows how far into its chunk it got.
    const where = ctx?.speaking && ctx.voice ? ctx.voice.where(speaker.left()) : { heard: 0, left: ctx?.speaking ? speaker.left() : "" };
    const left = offer?.kind === "speak" ? where.left : "";
    resumeInfo.current = offer && ctx ? { typed: ctx.typed, lang: ctx.lang, left, heard: where.heard, marks: ctx.marks, from: begun } : null;
    // Nothing left to say or draw, or an answer that was not a question to the model: no Resume.
    if (!resumeInfo.current || (offer?.kind === "speak" && !left && begun >= (ctx?.marks.length ?? 0))) turn.current.discard();
    setResumable(turn.current.offer() !== null);
    // The pill is told before the mode, so the stopped pill comes up with its Resume.
    b.pill?.({ sees: seesScreen(statusRef.current?.seeScreen, askRoute(statusRef.current), localScreenRef.current), paused: false, resumable: turn.current.offer() !== null });
    setMode("idle", { stopped: true, holdMs: 4000 });
    // Hands-free listens again, after a moment: listening clears the bubble, and what was stopped should be seen first.
    if (handsFree.current) setTimeout(() => { if (handsFree.current && modeRef.current === "idle") listenAgain.current(); }, 2500);
    return true;
  }, [endAnswer, setMode, speaker]);

  /** Pause (the button, the key): the text, the voice, the pointer and the pen hold still. False when no answer is in progress. */
  const pauseAnswer = useCallback(() => {
    if ((modeRef.current !== "thinking" && modeRef.current !== "speaking") || pausedRef.current) return false;
    pausedRef.current = true;
    setPaused(true);
    // The request goes on being read into a buffer (nothing upstream times out); it is shown on Resume.
    turn.current.pause();
    speaker.pause();
    drawClock.current.pause(performance.now());
    return true;
  }, [speaker]);

  /**
   * `resume`: this question carries on a stopped answer whose first part (`shown`) is on screen and
   * is the conversation's last answer (Resume after Stop, lib/buddy/turn.ts resumePlan); `said`: the
   * start of it the user already heard, which the voice does not say again.
   */
  const ask = useCallback(async (question: string, opts: { typed?: boolean; resume?: { shown: string; said?: string } } = {}) => {
    const b = okFilowBridge();
    if (!b) return;
    const resume = opts.resume;
    // A new question cuts the answer being spoken at once, before anything below is awaited
    // (the agent check alone took about half a second in the packaged app).
    endAnswer();
    // A new question: the stopped answer can no longer be carried on.
    turn.current.discard();
    setResumable(false);
    resumeInfo.current = null;
    answerCtx.current = null;
    setStopped(false);
    // "agent, ..." goes to a background job instead of the screen helper.
    // A new question drops any notice still waiting for the previous one: nothing of it may go out.
    out.dismissAll();
    // "whiteboard: ..." opens the whiteboard tutor with that topic (docs/whiteboard/SPEC.md).
    const boardTopic = resume ? "" : whiteboardTopic(question);
    if (boardTopic && b.showWhiteboard) {
      setHeard(question);
      b.showWhiteboard(boardTopic);
      return setMode("idle");
    }
    try {
      const lastAnswer = history.current.at(-1)?.text ?? "";
      // (a continuation is never an agent request: the answer it carries on came from the model)
      let job = resume ? null : await b.agents.start(question, lastAnswer);
      if (job && "needsConsent" in job) {
        // The task and the last answer would go to the maker of the coding agent: ask first.
        const { recipient, cli } = job.needsConsent;
        setHeard(question);
        b.text(t("noticeWaiting"));
        const decision = await out.allow("agent", recipient, cli);
        b.text("");
        if (decision === "dismissed") return setMode("idle");
        if (decision === "declined") {
          setAnswer(t("kept_agent"));
          b.text(t("kept_agent"));
          return setMode("idle");
        }
        job = await b.agents.start(question, lastAnswer);
        if (job && "needsConsent" in job) return fail(t("noticeUnknown"));
      }
      if (job) {
        const said = t("agentStarted").replace("{title}", job.title);
        setHeard(question);
        setAnswer(said);
        b.text(said);
        setMode("speaking");
        const id = ++run.current;
        const spoke = !opts.typed || statusRef.current?.typedVoice;
        if (spoke) await speak(said, id);
        if (run.current === id) setMode("idle");
        if (handsFree.current) { if (spoke) reopenAfterSpeech(() => listenAgain.current(), () => handsFree.current && modeRef.current === "idle" && run.current === id); else listenAgain.current(); }
        return;
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    const id = ++run.current;
    asking.current?.abort();
    const abort = new AbortController();
    asking.current = abort;
    // A drawing request is answered in one piece: a stop of it offers no Resume.
    turn.current.begin(id, question, abort, { resumable: wantsDrawing(question) === null, continues: resume?.shown });
    let answerLang: string | undefined;
    // The one speech queue of this answer: sentence by sentence while the text arrives, each chunk at its
    // place among the bubble's sentences (the pill keeps that one in view), none started during a pause.
    const voiced = !opts.typed || statusRef.current?.typedVoice === true;
    const voice = createProgressiveSpeech({
      isCurrent: () => run.current === id && !abort.signal.aborted,
      unpaused: () => turn.current.unpaused(id),
      said: resume?.said,
      speak: async (sentence, base) => {
        if (!voiced) return;
        setMode("speaking");
        await speak(sentence, id, answerLang, base);
      },
    });
    answerCtx.current = { id, typed: opts.typed === true, speaking: voiced, marks: [], marksAt: 0, marksBase: 0, voice };
    // "Look at my screen" (lib/buddy/sees.ts): off, the question goes with the user's words only.
    // A continuation follows the eye as it is now, not as it was when the question was first asked.
    const seeing = seesScreen(statusRef.current?.seeScreen, askRoute(statusRef.current), localScreenRef.current);
    setAsksSee(seeing);
    setHeard(question);
    setAnswer(resume?.shown ?? "");
    setError("");
    setMode("thinking", { sees: seeing });
    b.text(resume?.shown ?? "");
    b.clearVisuals();
    try {
      // With "Look at my screen" off no picture of the screen is even taken.
      const shot = await b.capture({ images: seeing });
      if (run.current !== id) return;
      // What the user circled goes in two ways: burnt into the screenshot, and as grid boxes in words.
      const marked = shot.marked ?? [];
      const images = !seeing ? [] : marked.length
        ? await Promise.all(shot.images.map((img, i) => burnStrokes(img, marked.filter((m) => m.screen === i + 1), statusRef.current?.color ?? "#ffb600")))
        : shot.images;
      const markedNote = [describeMarked(marked), shot.selected ? `(Text I have selected: "${shot.selected}")` : ""].filter(Boolean).join("\n");
      // Local or cloud is decided in one place (askRoute). The screenshot above was taken before the
      // notice so it shows the screen as it was when the user asked; nothing is sent until they say yes.
      // A plain photo request is answered by the card alone, on this PC, whatever "Answers from" says:
      // no notice for the cloud opens, because nothing of the question goes there.
      const photo = photoOnly(question, { drawing: wantsDrawing(question) !== null, resume: !!resume });
      let route = photo ? "local" : askRoute(statusRef.current);
      let to: Recipient | null = null;
      // "Local" can mean the user's own server (Settings > Advanced, model per task): that leaves this
      // PC too, so it gets the same notice and signal, naming "your server <name>".
      const viaServer = !photo && route === "local" ? (await out.recipients())?.server ?? null : null;
      if (run.current !== id) return;
      if (route !== "local" || viaServer) {
        const rec = await out.recipients();
        // Stopped while this was looked up: no notice opens for an answer nobody waits for.
        if (run.current !== id) return;
        const named = rec && askRouteRecipient(route, rec);
        const recipient = named && localServer(named, t("outServer"));
        if (!recipient) throw new Error(t("noticeUnknown"));
        // A yes given while the notice said "no picture of your screen is sent" does not cover the
        // screen: with the switch on it is withdrawn, so the full notice comes before any screenshot goes.
        if (screenYesMissing(seeing, out.standing("ask", recipient) === "granted", statusRef.current?.askWordsOnly, recipient.id)) await out.forget(consentKey("ask", recipient));
        const asked = out.standing("ask", recipient) === "ask";
        if (asked) b.text(t("noticeWaiting"));
        const decision = await out.allow("ask", recipient, undefined, !seeing);
        if (run.current !== id) return;
        // Which notice the yes was given to is kept, so it is never stretched to cover more later.
        if (asked && decision === "granted") {
          const s = await b.configure({ askWordsOnly: wordsOnlyAfterYes(statusRef.current?.askWordsOnly, recipient.id, seeing) });
          statusRef.current = s;
          setStatus(s);
        }
        b.text("");
        if (decision === "dismissed") return setMode("idle");
        if (decision === "declined") {
          route = "local";
          setNote(t("kept_ask"));
        } else to = recipient;
      }
      // What the server says about the answer: whether the model saw a picture (X-Buddy-Sees) and the
      // language it answered in (X-Buddy-Lang), which the voice uses to pick a matching voice.
      let seesText = false;
      let lastPoints = "", lastMarks = "";
      /** The pointer and the pen follow the text as it arrives (never during a pause: the caller holds them). */
      const showVisuals = (parsed: ReturnType<typeof parseBuddyAnswer>) => {
        const points = JSON.stringify(parsed.points), marks = JSON.stringify(parsed.marks);
        if (parsed.points.length && points !== lastPoints) {
          b.point(parsed.points.flatMap(p => {
            const d = shot.displays.find(x => x.index === p.screen);
            return d ? [{ ...pointToDisplay(p, d.bounds), label: p.label }] : [];
          }));
          lastPoints = points;
        }
        if (parsed.marks.length && marks !== lastMarks) {
          const list = parsed.marks.flatMap(m => {
            const d = shot.displays.find(x => x.index === m.screen);
            return d ? [markToDisplay(m, d.bounds)] : [];
          });
          b.draw(list);
          if (answerCtx.current?.id === id) Object.assign(answerCtx.current, { marks: list, marksAt: drawClock.current.at(performance.now()), marksBase: 0 });
          lastMarks = marks;
        }
      };
      const send = async (consent: Record<string, string>, quiet?: () => void) => {
        const headers = { "Content-Type": "application/json", ...(await engineHeaders()), ...consent };
        // The eye was closed after the screenshot was taken (while the notice was open, say): the
        // picture is dropped here, at the last moment before anything is sent, and the question goes
        // with the words only. Nothing of the screen leaves.
        const withScreen = stillSees(seeing, statusRef.current?.seeScreen);
        if (seeing && !withScreen) setAsksSee(false);
        const res = await fetch("/api/buddy/ask", {
          method: "POST",
          signal: abort.signal,
          headers,
          // sees: false when this question goes without the screen; else the user's own choice, or nothing so the setup decides
          // resume: the conversation ends with the part of the answer already shown, and the model carries on from it
          body: JSON.stringify({ question: markedNote ? question + "\n" + markedNote : question, images: withScreen ? images : [], screens: shot.screens, elements: withScreen ? shot.elements : undefined, history: history.current, language: getSpeechLang(), provider: route, setup: getSetupPreference(), sees: withScreen ? askSees(statusRef.current?.seeScreen) : false, ...(resume ? { resume: true } : {}) }),
        });
        if (!res.ok || !res.body) {
          // Refused before anything was forwarded (no yes on record, Offline mode, FreeLLMAPI without a key): nothing went outside.
          if (res.status === 403 || res.status === 409) quiet?.();
          throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${res.status}`);
        }
        seesText = res.headers.get("X-Buddy-Sees") === "text";
        answerLang = res.headers.get("X-Buddy-Lang") ?? undefined;
        // The server answered from this PC after all (offline switch): nothing went outside.
        if (res.headers.get("X-Buddy-Provider") === "local") quiet?.();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let got = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return got + decoder.decode();
          got += decoder.decode(value, { stream: true });
          if (run.current !== id) return null;
          const partial = got.split("\n[ERROR]")[0];
          const parsedNow = parseBuddyAnswer(partial, shot.screens, shot.screens.find((s) => s.cursor)?.index ?? 1);
          const arrived = parsedNow.text;
          // A continuation is shown after the part already there, without the sentences the model says again.
          const shown = resume ? joinContinuation(resume.shown, arrived, { partial: true }) : arrived;
          // Paused: the text is kept, not shown (Resume shows it).
          if (!turn.current.progress(id, shown)) continue;
          setAnswer(shown);
          b.text(shown);
          showVisuals(parsedNow);
          voice.update(shown, false, moreFollows(partial, arrived));
        }
      };
      const raw = to ? await out.sending("ask", to, send) : await send({});
      if (raw === null) return;
      // Paused: what follows the text (the marks, the pointer, the voice, an error) waits for Resume.
      if (!(await turn.current.unpaused(id))) return;
      const [answered, err] = raw.split("\n[ERROR] ");
      if (err) throw new Error(err.trim());
      const body = resume ? joinContinuation(resume.shown, answered.trim()) : answered;
      const parsed = parseBuddyAnswer(answered, shot.screens, shot.screens.find((s) => s.cursor)?.index ?? 1);
      const { points, marks, cards, model, drawing } = parsed;
      const text = resume ? joinContinuation(resume.shown, parsed.text) : parsed.text;
      // Answer log (dev builds, or the folder the user picked): exactly what the model produced and saw.
      void b.answerLog({ question, raw: body, visuals: { text, points, marks, cards, model, drawing }, images, svg: drawing ? drawingSvg(drawing) : undefined }).catch(() => "");
      // A drawing or a model with no sentence is an answer too (it used to be thrown away as "empty").
      if (!text && !points.length && !marks.length && !cards.length && !model && !drawing) throw new Error(t("emptyAnswer"));
      setAnswer(text);
      b.text(text);
      // A continuation: the conversation's last answer becomes the first part and what followed, with no second question.
      history.current = resume && history.current.at(-1)?.role === "assistant"
        ? [...history.current.slice(0, -1), { role: "assistant" as const, text: body.trim() }]
        : [...history.current, { role: "user" as const, text: question }, { role: "assistant" as const, text: body.trim() }].slice(-12);
      saveHistory(history.current);
      if (answerCtx.current?.id === id) answerCtx.current.lang = answerLang;
      // From here a Stop keeps the conversation as it is: the whole answer is in it.
      turn.current.progress(id, text);
      turn.current.kept(id);
      const mapped = points.flatMap((p) => {
        const d = shot.displays.find((x) => x.index === p.screen);
        return d ? [{ ...pointToDisplay(p, d.bounds), label: p.label }] : [];
      });
      if (mapped.length && JSON.stringify(points) !== lastPoints) b.point(mapped);
      const drawn = marks.flatMap((m) => {
        const d = shot.displays.find((x) => x.index === m.screen);
        return d ? [markToDisplay(m, d.bounds)] : [];
      });
      // Drawn already while the text arrived: the pen is not started again.
      if (drawn.length && JSON.stringify(marks) !== lastMarks) {
        b.draw(drawn);
        if (answerCtx.current?.id === id) Object.assign(answerCtx.current, { marks: drawn, marksAt: drawClock.current.at(performance.now()), marksBase: 0 });
      }
      if (model) b.showModel(model);
      lastShown.current = { points: mapped, marks: drawn, model, cards: [] };
      if (drawing) {
        // The 2D drawing is shown as a card near the cursor; its image is our own SVG from validated shapes.
        const s = shot.screens.find((x) => x.cursor)?.index ?? 1;
        cards.unshift({ x: 500, y: 250, title: drawing.title, text: "", photo: "", svg: drawingSvg(drawing), screen: s });
      }
      if (cards.length) {
        // The cards show at once with their text. A picture means sending the card's subject to
        // Wikipedia, so it is looked up only after a yes, while the answer is spoken.
        const placed = cards.flatMap((c) => {
          const d = shot.displays.find((x) => x.index === c.screen);
          if (!d) return [];
          const at = pointToDisplay({ x: c.x, y: c.y, label: "", screen: c.screen }, d.bounds);
          return [{ lookup: c.photo, card: { ...at, title: c.title, text: c.text, photo: c.svg ? `data:image/svg+xml;base64,${btoa(c.svg)}` : "" } }];
        });
        const showCards = (list: Array<(typeof placed)[number]["card"]>) => {
          if (run.current !== id) return;
          if (lastShown.current) lastShown.current.cards = list;
          b.cards(list);
        };
        showCards(placed.map((p) => p.card));
        if (placed.some((p) => p.lookup) && !statusRef.current?.offline) {
          void (async () => {
            const rec = await out.recipients();
            if (!rec) return;
            const decision = await out.allow("photo", rec.photo);
            // Said every time, not only at the first no: a card without its picture needs its reason.
            if (decision === "declined" && run.current === id) setNote(t("kept_photo"));
            if (decision !== "granted" || run.current !== id) return;
            const withPhotos = await out.sending("photo", rec.photo, async (consent) => {
              const headers = { ...(await engineHeaders()), ...consent };
              return Promise.all(placed.map(async (p) => {
                if (!p.lookup) return p.card;
                const r = await fetch(`/api/buddy/photo?q=${encodeURIComponent(p.lookup)}`, { headers }).catch(() => null);
                return { ...p.card, photo: (r && r.ok ? ((await r.json()) as { dataUrl?: string | null }).dataUrl : null) ?? p.card.photo };
              }));
            });
            showCards(withPhotos);
          })().catch(() => {});
        }
      }
      // HeyClicky always shows you where. Small local models sometimes answer in words only: then ask
      // once more, narrowly, for the point, while the answer is already being spoken.
      // (not when the setup answered from text: the model saw no picture to point at)
      // (and not once the eye is closed: the grounding pass would send the screenshot again)
      const grounding = !mapped.length && !drawn.length && !cards.length && !model && text && !seesText && stillSees(seeing, statusRef.current?.seeScreen)
        ? groundAnswer(question, text, images, shot, abort.signal, to).then((p) => { if (p && run.current === id) b.point([p]); }).catch(() => {})
        : Promise.resolve();
      setMode("speaking");
      // The sentences not said while the text arrived (the queue says each one once).
      await voice.finish(text);
      await grounding;
      turn.current.end(id);
      if (run.current === id) setMode("idle");
      if (run.current === id && handsFree.current) { if (voiced) reopenAfterSpeech(() => listenAgain.current(), () => handsFree.current && modeRef.current === "idle" && run.current === id); else listenAgain.current(); }
    } catch (e) {
      voice.cancel();
      // A stop or a newer question: not an error, nothing is shown or logged as one.
      if (abort.signal.aborted || run.current !== id) return;
      // A request that failed during a pause: the error is held and shown on Resume, never as a bubble during the pause.
      if (!(await turn.current.unpaused(id))) return;
      turn.current.end(id);
      fail(e instanceof Error ? e.message : String(e));
      // Nothing of a failed answer goes on: a sentence being said is cut, the request is closed.
      speaker.stop();
      abort.abort();
      if (handsFree.current) setTimeout(() => handsFree.current && listenAgain.current(), 1500);
    }
  }, [endAnswer, engineHeaders, fail, groundAnswer, out, setMode, speak, speaker, t]);

  /**
   * Resume (the button, the key). A paused answer carries on exactly where it paused: the text that
   * arrived meanwhile appears, the voice says its next sentence, the pen and the pointer move again.
   * A stopped answer is carried on (lib/buddy/turn.ts): the model continues from the last whole
   * sentence shown, or the same question is asked again when nothing was shown, or (the whole answer
   * was there) the voice says the sentences it has not said and the marks not begun are drawn, with
   * no request to the model. False when there is nothing to resume.
   */
  const resumeAnswer = useCallback(() => {
    const b = okFilowBridge();
    if (!b) return false;
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      drawClock.current.resume(performance.now());
      const text = turn.current.resume();
      if (text) { setAnswer(text); b.text(text); }
      speaker.resume();
      return true;
    }
    const offer = turn.current.offer();
    const info = resumeInfo.current;
    if (!offer || !info || modeRef.current === "thinking" || modeRef.current === "speaking" || modeRef.current === "listening") return false;
    const plan = resumePlan(offer, history.current);
    if (plan.kind === "speak") {
      // The whole answer is there: say the rest, draw the rest. Stop and Pause work on it as on any answer.
      turn.current.discard();
      setResumable(false);
      setStopped(false);
      const id = ++run.current;
      turn.current.begin(id, plan.question);
      turn.current.progress(id, plan.shown);
      turn.current.kept(id);
      answerCtx.current = { id, typed: info.typed, lang: info.lang, speaking: Boolean(info.left), marks: info.marks, marksAt: drawClock.current.at(performance.now()), marksBase: info.from };
      setAnswer(plan.shown);
      b.text(plan.shown);
      // All of them, not only the ones still to draw: the marks went with the stopped answer's bubble,
      // so the ones drawn before the stop are shown again as they were (`from`), the rest are drawn now.
      if (info.marks.length) b.draw(info.marks, info.from);
      setMode("speaking");
      void (async () => {
        if (info.left) await speak(info.left, id, info.lang, Math.max(0, splitSentences(plan.shown).length - splitSentences(info.left).length));
        turn.current.end(id);
        if (run.current === id) setMode("idle");
        if (run.current === id && handsFree.current) { if (info.left) reopenAfterSpeech(() => listenAgain.current(), () => handsFree.current && modeRef.current === "idle" && run.current === id); else listenAgain.current(); }
      })();
      return true;
    }
    if (plan.history !== history.current) {
      history.current = plan.history;
      saveHistory(history.current);
    }
    // A continuation's voice starts at the first sentence the user did not hear whole, not at the top.
    const said = sentenceParts(plan.shown).slice(0, info.heard).join("");
    void ask(plan.question, plan.kind === "continue" ? { typed: info.typed, resume: { shown: plan.shown, said } } : { typed: info.typed });
    return true;
  }, [ask, setMode, speak, speaker]);

  /** The eye (its button on the pill, its shortcut): open or closed for the next question, stored as the user's own choice. */
  const toggleEye = useCallback(async () => {
    const b = okFilowBridge();
    const s = statusRef.current;
    if (!b || !s) return;
    const got = await b.configure({ seeScreen: eyeToggle(s.seeScreen, askRoute(s), localScreenRef.current) });
    statusRef.current = got;
    setStatus(got);
  }, []);

  /** A control of the pill, a shortcut, or the same button on this panel. */
  const control = useCallback((action: PillAction) => {
    if (action === "eye") void toggleEye();
    else if (action === "pause") pauseAnswer();
    else if (action === "resume") resumeAnswer();
    else stopAnswer();
  }, [pauseAnswer, resumeAnswer, stopAnswer, toggleEye]);

  const startListening = useCallback(async (why: Purpose = "talk") => {
    const b = okFilowBridge();
    if (!b) return;
    if (audio.current || starting.current || stopping.current) {
      // The last recording is still finishing (its words not typed yet): start right after it, so two
      // dictations close together neither merge nor lose words.
      if (stopping.current || pendingStop.current !== null) queuedStart.current = why;
      return;
    }
    starting.current = true;
    pendingStop.current = null;
    session.current++;
    purpose.current = why;
    committed.current = [];
    partial.current = "";
    setNote("");
    flow.current = why === "dictate" && dictHandsFree.current ? createPhraseFlow() : null;
    vad.current = why === "handsfree" || flow.current ? createVad() : null;
    if (why !== "dictate") {
      // A new question interrupts the old answer (what it had said so far stays in the conversation);
      // dictation leaves the conversation alone.
      endAnswer();
      // A new question is being asked: the stopped answer can no longer be carried on.
      turn.current.discard();
      setResumable(false);
      setStopped(false);
      setHeard("");
      setAnswer("");
      setError("");
      b.text("");
      b.point([]);
    }
    setMode("listening", { purpose: why });
    const dict = why === "dictate" ? statusRef.current?.dictationStatus : undefined;
    if (why === "dictate") {
      const keys = dict?.chordLabel ?? "";
      b.text(flow.current ? dictT("dictatingHandsFree", { keys }) : dictT("dictating"));
      if (dict?.sound || dict?.screenReader) playCue(true);
    }
    // Recognizer and microphone start together, and the sound is kept until the model is loaded, so the
    // first words are not lost while a model loads (it can take a second or two the first time).
    let recognizerReady = false;
    let queued: Float32Array[] = [];
    try {
      // "auto" here means the spoken language set in Settings (the shell resolves it); only when that is
      // automatic too does the recognizer detect what is spoken. The interface language is never used.
      // Dictation uses its own language setting ("auto" there means the speech language in Settings).
      const loading = b.stt.start(dict ? dict.language : "auto").then(
        (info) => {
          recognizerReady = true;
          for (const s of queued) b.stt.feed(s);
          queued = [];
          spoken.current = (info as { language?: string } | null)?.language ?? "";
          return null;
        },
        (e: unknown) => e ?? new Error("speech recognition did not start"),
      );
      const mic = getSelectedMic();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (ev) => {
        const samples = new Float32Array(ev.inputBuffer.getChannelData(0));
        if (recognizerReady) b.stt.feed(samples);
        else if (queued.length < 400) queued.push(samples); // at most ~50 s while a model loads
        let peak = 0;
        for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
        const level = Math.min(1, peak * 2.5);
        b.level(level);
        micTick.current(level, performance.now());
      };
      src.connect(node);
      node.connect(ctx.destination);
      audio.current = { ctx, stream, node };
      const failed = await loading;
      if (failed) throw failed;
      starting.current = false;
      if (pendingStop.current !== null) {
        const send = pendingStop.current;
        pendingStop.current = null;
        void stopRef.current(send, true);
      }
    } catch (e) {
      starting.current = false;
      pendingStop.current = null;
      // A press queued behind this start must not swallow the next real release (the microphone would
      // stay open with nothing to stop it).
      queuedStart.current = null;
      stopAudio();
      void b.stt.stop().catch(() => {});
      fail(e instanceof Error ? e.message : String(e));
    }
  }, [dictT, endAnswer, fail, setMode, stopAudio]);
  const startRef = useRef(startListening);
  startRef.current = startListening;

  const stopListening = useCallback(async (send: boolean, deferred = false) => {
    const b = okFilowBridge();
    if (!b) return;
    // A press that came while the last one was still finishing waits in queuedStart; its own release
    // (before it could start) just drops it. `deferred`: this is the stop that was waiting for the
    // microphone to open, not that press's release, so the recording is stopped and the press starts after.
    if (queuedStart.current && !deferred) { queuedStart.current = null; return; }
    if (starting.current) { pendingStop.current = send; return; }
    if (!audio.current) return;
    stopping.current = true;
    // Hands-free dictation: from here the rest is typed below, not phrase by phrase.
    const phrases = flow.current;
    flow.current = null;
    /**
     * A press that came while this recording was finishing starts now. Once per stop: by the time this
     * stop's words are in the app another recording may be stopping, and its flag is not ours to clear.
     */
    let handedOver = false;
    const startQueued = () => {
      if (handedOver) return;
      handedOver = true;
      stopping.current = false;
      const next = queuedStart.current;
      queuedStart.current = null;
      if (next) void startRef.current(next);
    };
    try {
    const why = purpose.current;
    const sid = session.current;
    stopAudio();
    try { await b.stt.stop(); } catch { /* the error already reached onResult */ }
    // The recognizer's last words can land up to about a second after the keys go up: wait for them.
    // Dictation stops waiting as soon as there is text: the worker sends its last phrase before it
    // acknowledges the stop, so the text is complete here and every 50 ms is felt.
    const minWait = why === "dictate" ? 0 : 150;
    for (let waited = 0; waited < 1500; waited += 50) {
      if (why === "dictate" && waited === 0 && joinTranscript(committed.current, partial.current)) break;
      await new Promise((r) => setTimeout(r, 50));
      if (waited >= minWait && joinTranscript(committed.current, partial.current)) break;
      // The keys were pressed again (the second brief press of a pair): its words must not wait for this.
      if (why === "dictate" && queuedStart.current) break;
    }
    // A new recording started meanwhile (a press during hands-free): leave its state alone.
    if (session.current !== sid) return;
    const question = joinTranscript(committed.current, partial.current);
    const dict = statusRef.current?.dictationStatus;
    if (why === "dictate" && (dict?.sound || dict?.screenReader)) playCue(false);
    if (!send) { typingRun.current++; b.text(""); return setMode("idle"); }
    if (why === "dictate") {
      // The words of this dictation are complete. A press that came meanwhile starts recording now, not
      // after these words are in the app: putting them there waits for the user's keys to be up, and
      // they are down again, so the next dictation would lose its first seconds (or all of it).
      const spokenIn = spoken.current;
      startQueued();
      /** False once the next press took the panel over: its bubble and state are left alone. */
      const mine = () => session.current === sid;
      const say = (text: string) => { if (mine()) b.text(text); };
      const idle = (extra?: { holdMs?: number }) => { if (mine()) setMode("idle", extra); };
      // Phrases of a hands-free dictation still on their way into the app go first.
      await typing.current;
      // The bubble near the mouse says what happened when the user must act (copied) or nothing came.
      if (!question && phrases?.typed) { say(""); return idle(); }
      if (!question) {
        // Issue #7: a press too short to say anything used to end without a word about what to do.
        // The shell logs it and keeps it for "Report a problem" (an empty text is never typed).
        void b.typeText("", spokenIn, false).catch(() => null);
        say(phrases ? dictT("nothing") : dictT("nothingHint", { keys: dict?.chordLabel ?? "" }));
        return idle({ holdMs: phrases ? 2500 : 5000 });
      }
      say("");
      const r = await b.typeText(question, spokenIn, Boolean(phrases)).catch(() => null);
      const paste = pasteKeys(dict?.platform ?? "win32");
      // Only filler sounds were heard: nothing to type, said like "nothing heard".
      if (r?.action === "none") { say(phrases?.typed ? "" : dictT("nothing")); return idle(phrases?.typed ? {} : { holdMs: 2500 }); }
      if (!r || !r.ok) { setNote(dictT("failed")); setTyped(question); say(dictT("failed")); return idle({ holdMs: 4500 }); }
      if (r.action === "refused") {
        // A password box: nothing was typed, copied or kept, and the words leave the panel too.
        if (mine()) setHeard("");
        setNote(dictT("refusedPassword"));
        say(dictT("refusedPassword"));
        return idle({ holdMs: 5000 });
      }
      if (r.action === "copy") {
        const line = dictT(copiedKey(r.reason), { paste });
        setNote(line);
        say(line);
        return idle({ holdMs: 5000 });
      }
      setNote(dictT("typed"));
      return idle();
    }
    if (!question) {
      if (why === "handsfree" && handsFree.current) { setMode("idle"); return listenAgain.current(); }
      b.text(t("notHeard"));
      return setMode("error", { error: t("notHeard") });
    }
    void ask(question);
    } finally {
      startQueued();
    }
  }, [ask, dictT, setMode, stopAudio, t]);
  const stopRef = useRef(stopListening);
  stopRef.current = stopListening;
  listenAgain.current = () => { if (handsFree.current) void startListening("handsfree"); };


  /** Hands-free dictation: one phrase into the focused field, after the phrases before it; the mic stays open. */
  const typePhrase = useCallback((text: string) => {
    const b = okFilowBridge();
    const f = flow.current;
    if (!b || !f) return;
    committed.current = f.pending();
    if (!text) return;
    const keys = statusRef.current?.dictationStatus?.chordLabel ?? "";
    b.text(joinTranscript(committed.current, partial.current) || dictT("dictatingHandsFree", { keys }));
    const lang = spoken.current;
    const mine = typingRun.current;
    typing.current = typing.current.then(async () => {
      if (typingRun.current !== mine) return; // Escape or an error came first
      const r = await b.typeText(text, lang, true).catch(() => null);
      if (r?.action === "none") return; // only filler sounds
      if (!r || !r.ok) { setNote(dictT("failed")); setTyped((was) => joinTranscript([was, text], "")); return; }
      if (r.action === "refused") { setNote(dictT("refusedPassword")); if (flow.current === f) { setHeard(""); b.text(dictT("refusedPassword")); } return; }
      if (r.action === "copy") {
        const line = dictT(copiedKey(r.reason), { paste: pasteKeys(statusRef.current?.dictationStatus?.platform ?? "win32") });
        setNote(line);
        if (flow.current === f) b.text(line);
      } else setNote(dictT("typed"));
    });
  }, [dictT]);
  // The pause detector: it ends a hands-free question, and tells a hands-free dictation to type what was said.
  micTick.current = (level, now) => {
    const f = flow.current;
    if (vad.current?.push(level, now)) {
      if (!f) { vad.current = null; void stopRef.current(true); return; }
      vad.current = createVad();
      typePhrase(f.pause(now));
    } else if (f) typePhrase(f.tick(now));
  };

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
        // Hands-free dictation: the phrase goes to the flow, which hands back what to type now (if anything).
        const f = r.committed ? flow.current : null;
        if (f) { committed.current.pop(); typePhrase(f.committed(r.committed, performance.now())); }
        const live = joinTranscript(committed.current, partial.current);
        setHeard(live);
        if (live || !flow.current) b.text(live);
      }),
      b.onPress((p) => {
        if (p?.upgrade) {
          // The second brief press of a pair: the dictation that just started goes on hands-free.
          dictHandsFree.current = true;
          if (purpose.current === "dictate" && (audio.current || starting.current) && !stopping.current && !flow.current) {
            const f = createPhraseFlow();
            for (const c of committed.current) f.committed(c, performance.now());
            committed.current = f.pending();
            flow.current = f;
            vad.current = createVad();
            b.text(dictT("dictatingHandsFree", { keys: statusRef.current?.dictationStatus?.chordLabel ?? "" }));
            // Heard as well as seen: the microphone now stays open with the keys up.
            const ds = statusRef.current?.dictationStatus;
            if (ds?.sound || ds?.screenReader) playCue(true);
          }
          return;
        }
        if (handsFree.current) { handsFree.current = false; setHandsFreeOn(false); b.handsFreeOff(); void stopListening(false); }
        dictHandsFree.current = p?.purpose === "dictate" && Boolean(p.handsFree);
        void startListening(p?.purpose === "dictate" ? "dictate" : "talk");
      }),
      b.onRelease(() => void stopListening(true)),
      b.onCancel(() => void stopListening(false)),
      // The Stop button next to the pointer, or Escape anywhere (the desktop shell tells us).
      b.onStop?.(() => { stopAnswer(); }) ?? (() => {}),
      // The eye, Pause and Resume on the pill next to the pointer, and their shortcuts.
      b.onControl?.((p) => { if (p && (p.action === "eye" || p.action === "pause" || p.action === "resume")) control(p.action); }) ?? (() => {}),
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
  }, [ask, bridge, control, dictT, fail, setHandsFree, setMode, speak, startListening, stopAnswer, stopListening, t, typePhrase]);

  // The pill follows: the eye as it is now (the effective setting), paused, and whether a stopped answer can be carried on.
  const seesNow = seesScreen(status?.seeScreen, askRoute(status), localScreen);
  useEffect(() => {
    bridge?.pill?.({ sees: seesNow, paused, resumable });
  }, [bridge, seesNow, paused, resumable]);
  // An answer that is over (it ended, a preview took the voice) is not paused.
  useEffect(() => {
    if (mode === "thinking" || mode === "speaking" || !pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    drawClock.current.resume(performance.now());
    speaker.resume();
  }, [mode, speaker]);

  if (!bridge) return <main className="okf-panel"><p>{t("desktopOnly")}</p></main>;
  const c = status;
  const configure = async (patch: Partial<OkFilowStatus>) => {
    setStatus(await bridge.configure(patch));
    // The recipient follows the settings (provider, model, offline): the notes must name the new one.
    void outRef.current?.recipients();
  };
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
  const ds = c?.dictationStatus;
  const dictHint = ds?.enabled && ds.check.ok ? dictT(ds.mode === "toggle" ? "hintToggle" : "hintHold", { keys: ds.chordLabel }) : "";
  const answering = mode === "thinking" || mode === "speaking";
  // "Look at my screen": the one setting (okFilow.seeScreen in the desktop settings), shown as on or off.
  const route = askRoute(c);
  const sees = seesScreen(c?.seeScreen, route, localScreen);
  // on "Local" the screen leaves only for the user's own server (Settings > Advanced)
  const seeWho = !recipients ? "" : route === "local" ? (recipients.server ? localServer(recipients.server, t("outServer")).names.join("") : "") : joinNames(localNames((route === "freellm" ? recipients.freellm?.names : recipients.ask.names) ?? [], t("freeName")), t("outAnd"));

  return (
    // Escape stops the answer when the panel has the keyboard (the desktop shell does the same from anywhere).
    <main className="okf-panel" onKeyDown={(e) => { if (e.key === "Escape" && stopAnswer()) e.stopPropagation(); }}>
      <header className="okf-head">
        <span className={`okf-dot okf-dot--${mode}`} aria-hidden />
        <h1>OK Filow</h1>
        <button className="okf-x" aria-label={t("close")} title={t("close")} onClick={() => bridge.hidePanel()}>×</button>
      </header>

      {notice && <OutboundNotice notice={notice} t={t} onDecide={(d) => void out.decide(d)} />}

      {/* One live region: the mode and, while something is leaving this PC, who receives it. */}
      <div className="okf-status-row">
        <p className="okf-status" role="status">
          <span>{t(answering && paused ? "paused" : mode === "thinking" && !asksSee ? "mode_thinkingWords" : (`mode_${mode}` as OkfKey))}</span>
          <OutboundPill snap={outSnap} t={t} />
        </p>
        {/* Pause or Resume, and Stop: only while there is an answer to act on; the row keeps its height, so nothing moves. */}
        <AnswerControls view={{ first: answering ? (paused ? "resume" : "pause") : resumable ? "resume" : null, stop: answering }} t={t} pauseKey={keyLabel(c?.pauseKey)} onAction={(action) => {
          if (action !== "stop") return control(action);
          // The button goes away once pressed: the keyboard goes to the question box, not nowhere.
          const had = document.activeElement?.getAttribute("data-testid") === "okf-stop";
          if (!stopAnswer()) bridge.stopAnswer?.("panel");
          if (had) typeBox.current?.focus();
        }} />
      </div>
      <p className="okf-hint">
        {c?.hook === "toggle" ? t("hintToggle") : t("hintHold").replace("{key}", hotkey ?? "")}
      </p>
      {c?.hook !== "toggle" && <p className="okf-hint">{t("hintMore")}{dictHint ? ` ${dictHint}` : ""}{hotkey ? ` ${dictT("handsFreeQuestions", { talk: hotkey })}` : ""}</p>}
      {c?.hookPermission && <p className="okf-hint">{t(c.hookPermission === "accessibility" ? "hintMacAccessibility" : "hintMacInput")}</p>}
      {/* Issue #6: the keyboard hook is not registered (Filow keeps trying): say so, and which key works meanwhile. */}
      {c?.hook === "toggle" && c.hookError && !c.hookPermission && <p className="okf-note okf-hookdown" role="status">{t("hookDown").replace("{key}", hotkey ?? "")}</p>}
      {handsFreeOn && (
        <p className="okf-handsfree" role="status">
          {t("handsFreeOn")}
          <button type="button" onClick={() => { bridge.handsFreeOff(); setHandsFree(false); }}>{t("handsFreeStop")}</button>
        </p>
      )}
      {note && <p className="okf-note" role="status">{note}</p>}

      {(heard || answer || error || stopped) && (
        <section className="okf-convo">
          {heard && <p className="okf-q">{heard}</p>}
          {answer && <p className="okf-a">{answer}</p>}
          {stopped && <p className="okf-stopped" data-testid="okf-stopped" role="status">{t("stopped")}</p>}
          {error && <p className="okf-err">{error}{freeDown && <> <a href={FREELLM_DOWNLOAD_URL} target="_blank" rel="noreferrer">{t("freeGet")}</a></>}</p>}
        </section>
      )}

      {sttReady === false && <p className="okf-warn">{t("noStt")} <a href="/settings/local" target="_blank" rel="noreferrer">{t("openSettings")}</a></p>}

      <form className="okf-type" onSubmit={(e) => { e.preventDefault(); const q = typed.trim(); if (q) { setTyped(""); bridge.hidePanel(); void ask(q, { typed: true }); } }}>
        <input ref={typeBox} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("typePlaceholder")} aria-label={t("typePlaceholder")} />
        <button type="submit" disabled={!typed.trim()}>{t("ask")}</button>
      </form>
      {/* Always here, in everyday words: whether a question takes the screen with it. */}
      {c && (
        <SeeScreenSwitch on={sees} slow={slowToSee(route, localScreen)} leaves={(screenLeaves(true, route) || (route === "local" && Boolean(recipients?.server))) && Boolean(seeWho)} who={seeWho} t={t} keyLabel={keyLabel(c.eyeKey)}
          onChange={(next) => void configure({ seeScreen: next ? "on" : "off" })} />
      )}
      {bridge.showWhiteboard && <p className="okf-hint okf-board-link"><button type="button" onClick={() => { bridge.showWhiteboard?.(typed.trim()); setTyped(""); }}>{t("whiteboard")}</button> {t("whiteboardHint")}</p>}

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
          {/* The two shortcuts of the pill: a short list each, like the talk keys; said in plain words when Windows refused one. */}
          {c.eyeKeys && <KeyChoice label={t("eyeKeyLabel")} value={c.eyeKey ?? c.eyeKeys[0]} choices={c.eyeKeys} state={c.eyeKeyState} t={t} onChange={(eyeKey) => void configure({ eyeKey })} />}
          {c.pauseKeys && <KeyChoice label={t("pauseKeyLabel")} value={c.pauseKey ?? c.pauseKeys[0]} choices={c.pauseKeys} state={c.pauseKeyState} t={t} onChange={(pauseKey) => void configure({ pauseKey })} />}
          <label className="okf-row">
            <span>{t("brain")}</span>
            <select className="okf-select-wide" value={c.offline ? "local" : c.provider} onChange={(e) => void configure({ provider: e.target.value as OkFilowStatus["provider"] })} disabled={c.offline}>
              <option value="local">{localAnswersLabel(recipients?.server, t("brainLocal"), t("brainServer"))}</option>
              <option value="freellm">{t("brainFree")}</option>
              <option value="cloud">{t("brainCloud")}</option>
            </select>
          </label>
          <FreeLlmPanelNotes provider={c.offline ? "local" : c.provider} t={t} />
          <VoiceSettings bridge={bridge} status={c} t={t} configure={configure}
            preview={() => {
              // The sample takes the turn like a new question: the answer stops for good and hands-free does not reopen the mic over it.
              const id = ++run.current;
              if (mode === "speaking" || mode === "thinking") setMode("idle");
              void speaker.speak(t("voiceSample"), id, { voice: "natural", lang });
            }} />
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
            <span>{t("dictation")}{c.dictationStatus ? ` (${c.dictationStatus.chordLabel})` : ""}</span>
            <input type="checkbox" checked={c.dictation} onChange={(e) => void configure({ dictation: e.target.checked })} />
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
          <button type="button" className="okf-link" onClick={() => { history.current = []; saveHistory([]); turn.current.discard(); setResumable(false); setNote(t("historyCleared")); }}>{t("clearHistory")}</button>
          {askRoute(c) === "cloud" && recipients && <p className="okf-note">{t(sees ? "cloudNote" : "cloudNoteWords").replace("{who}", whoPhrase(recipients.ask, t("outVia"), t("outAnd"), t("outViaPicked")))}</p>}
          {voiceRoute(c) === "cloud" && recipients && <p className="okf-note">{t("voiceNote").replace("{who}", whoPhrase(recipients.voice, t("outVia"), t("outAnd"), t("outViaPicked")))}</p>}
          {c.offline && <p className="okf-note">{t("offlineNote")}</p>}
          <ConsentList consent={c.consent} t={t} onForget={(key) => void out.forget(key)} />
        </section>
      )}
    </main>
  );
}
