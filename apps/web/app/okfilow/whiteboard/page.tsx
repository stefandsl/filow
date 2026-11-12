"use client";
// The whiteboard tutor (docs/whiteboard/SPEC.md): ask about a hard concept and OK Filow explains it
// on a board, one step at a time, drawn here and spoken with the voice chosen in OK Filow.
// Local by default. Cloud only when chosen on this page, and then only through the same notice,
// consent and going-outside signal as every other OK Filow question (lib/buddy/outboundClient.ts).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import { useLang } from "@filow/ui";
import "katex/dist/katex.min.css";
import { okFilowBridge, type OkFilowStatus } from "@/lib/buddy/bridge";
import { okfText, OLLAMA_STOPPED_ANSWER, type OkfKey } from "@/lib/buddy/text";
import { askRoute, askRouteRecipient, changesStored, type AskRoute, type BuddyRecipients, type NoticeRequest, type OutboundSnapshot, type Recipient } from "@/lib/buddy/outbound";
import { createOutboundController, type OutboundController } from "@/lib/buddy/outboundClient";
import { createSpeaker, webAudioPlayer } from "@/lib/buddy/voice";
import { freellmCodeOf, localizeFreeLlmError } from "@/lib/freellm";
import { getSetupPreference } from "@/lib/prefs";
import { buddyLang } from "@/lib/buddy/lang";
import { ExcalidrawBoard, type DrawnInfo } from "@/components/whiteboard/ExcalidrawBoard";
import { ExcalidrawCanvas } from "@/components/whiteboard/ExcalidrawCanvas";
import { ModelPicker, useWhiteboardModel } from "@/components/whiteboard/ModelPicker";
import { initialLesson, lessonReducer, readLessonStream } from "@/lib/whiteboard/client";
import { fileStem, saveBlob } from "@/lib/whiteboard/export";
import { createRecorder, type LessonRecorder } from "@/lib/whiteboard/video";
import { BOARD_SIZE, layoutBoard, type BoardShape, type Box } from "@/lib/whiteboard/layout";
import { LIMITS, lessonMarkdown, validateLesson, type Lesson } from "@/lib/whiteboard/lesson";
import { boardLesson, pendingScene, sceneFromLayout, type Scene } from "@/lib/whiteboard/scene";
import { BOARD_KEY, MAX_SAVED_BYTES, applyEdits, applyOps, cameraFor, changesToOps, diffEdits, excalidrawFile, frameBox, hasEdits, noEdits, parseExcalidrawFile, readScene, withFrame, type SceneEdits, type ToolOp } from "@/lib/whiteboard/doc";
import type { EditPlan } from "@/lib/whiteboard/edits";
import { checkScene, countProblems, fixOps, type CheckCounts } from "@/lib/whiteboard/check";
import { fontCss, prepareScene, scenePng } from "@/lib/whiteboard/excalidraw";
import { PaceMeter, drawMsFor, stepSchedule } from "@/lib/whiteboard/pace";
import { initialPlayer, playerReducer, readingMs } from "@/lib/whiteboard/player";
import { placeholderLeaks } from "@/lib/pii/guard";
import { wbText, type WbKey } from "@/lib/whiteboard/text";
import { OutboundNoticeModal, OutboundPill } from "../outbound-ui";
import "../outbound.css";
import "./whiteboard.css";

const REPLAY_KEY = "filow.whiteboard.replay";
/** The two looks of the board: Excalidraw's light scene, and the same scene in its dark mode. */
type BoardLook = "light" | "dark";
const BOARD_COLOURS: Record<BoardLook, { page: string; ink: string }> = { light: { page: "#ffffff", ink: "#1e1e1e" }, dark: { page: "#121212", ink: "#e3e3e8" } };
/** How many times the code check may tidy one step before it is left as it is (it never holds the voice). */
const FIX_ROUNDS = 3;
/** The vision check waits this long at most; the next step never waits for it. */
const LOOK_MS = 9000;
type SavedBoard = { v: 1; lesson: Lesson | null; scene?: Scene; edits: SceneEdits; fixes: SceneEdits };
const blobBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
/** Who receives a whiteboard question with this online model: read from the server each time, never from fixed text. */
async function boardRecipients(model: string, headers: Record<string, string>): Promise<BuddyRecipients | null> {
  const res = await fetch(`/api/whiteboard/recipients?model=${encodeURIComponent(model)}`, { headers });
  return res.ok ? ((await res.json()) as BuddyRecipients) : null;
}
/** After this many seconds of planning the page says how long it has waited. */
const WAIT_SAID_AFTER_S = 10;
const LOOK_KEY = "filow.whiteboard.look";
// Set once a lesson showed that the online account hides names: later questions spell their names out from the first call.
const SPELL_KEY = "filow.whiteboard.spell";
const knownToHideNames = () => {
  try { return localStorage.getItem(SPELL_KEY) === "1"; } catch { return false; }
};
const EXAMPLES: WbKey[] = ["example1", "example2", "example3", "example4"];

export default function WhiteboardPage() {
  const lang = useLang();
  const t = useCallback((k: WbKey, values?: Record<string, string | number>) => wbText(lang, k, values), [lang]);
  const okfT = useCallback((k: OkfKey) => okfText(lang)(k), [lang]);

  const [status, setStatus] = useState<OkFilowStatus | null>(null);
  const statusRef = useRef<OkFilowStatus | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [question, setQuestion] = useState("");
  const [follow, setFollow] = useState("");
  const [from, setFrom] = useState<AskRoute>("local");
  const [voiceOn, setVoiceOn] = useState(true);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<NoticeRequest | null>(null);
  const [snap, setSnap] = useState<OutboundSnapshot | null>(null);
  const [shape, setShape] = useState<BoardShape>("wide");
  const [theme, setTheme] = useState<BoardLook>("dark");
  // The look of the board: a whiteboard or a blackboard. It follows the app's theme until the user picks one here.
  const [look, setLook] = useState<"auto" | BoardLook>("auto");
  const board: BoardLook = look === "auto" ? theme : look;
  // How long this voice takes to say a sentence, learned as the lesson is spoken (lib/whiteboard/pace.ts).
  const meter = useMemo(() => new PaceMeter(), []);
  /** The turn whose sentence has been said to its end: its drawing is complete. */
  const [saidTurn, setSaidTurn] = useState(-1);
  // A lesson being saved as a video (lib/whiteboard/video.ts).
  const recorderRef = useRef<LessonRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [videoInfo, setVideoInfo] = useState<{ bytes: number; frames: number; sound: boolean; type: string } | null>(null);
  const captionRef = useRef("");
  const boardRef = useRef<BoardLook>("dark");
  boardRef.current = board;
  const [ls, dispatchLesson] = useReducer(lessonReducer, initialLesson);
  const [player, dispatchPlayer] = useReducer(playerReducer, initialPlayer);
  const lsRef = useRef(ls);
  lsRef.current = ls;
  const playerRef = useRef(player);
  playerRef.current = player;

  const abortRef = useRef<AbortController | null>(null);
  const askSeq = useRef(0);
  const lastAsk = useRef<{ text: string; more: boolean } | null>(null);
  const jumpTo = useRef<number | null>(null);
  const token = useRef<string | null>(null);
  const turnRef = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  /** When each step's data arrived while the board was waiting for it, to measure how fast it shows. */
  const arrived = useRef(new Map<number, number>());
  const [shownMs, setShownMs] = useState<number | null>(null);
  // The board as a document (lib/whiteboard/doc.ts): the compiled lesson, Filow's own tidying, and
  // the changes asked for or made by hand, kept by element id.
  const [edits, setEdits] = useState<SceneEdits>(noEdits);
  const [fixes, setFixes] = useState<SceneEdits>(noEdits);
  const [camera, setCamera] = useState<Box | null>(null);
  const [imported, setImported] = useState<Scene | null>(null);
  const [pendingTitle, setPendingTitle] = useState("");
  const [canvasOpen, setCanvasOpen] = useState(false);
  const undoStack = useRef<SceneEdits[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [checks, setChecks] = useState<CheckCounts | null>(null);
  const [fixedCount, setFixedCount] = useState(0);
  const fixRounds = useRef(new Map<string, number>());
  /** When the question was asked and when its first stroke was on the board (shown on the page as data). */
  const strokeClock = useRef<{ start: number; first: number | null; firstModel: number | null }>({ start: 0, first: null, firstModel: null });
  const [firstStroke, setFirstStroke] = useState<{ any: number | null; model: number | null }>({ any: null, model: null });
  const [savedBoard, setSavedBoard] = useState(false);
  const [editing, setEditing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [vision, setVision] = useState<{ looks: number; found: number; ms: number[] }>({ looks: 0, found: 0, ms: [] });

  const engineHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const b = okFilowBridge();
    if (!b?.accessPassword) return {};
    if (!token.current) {
      const res = await fetch(`${b.sessionUrl}/api/session`, { method: "POST", headers: { "X-Access-Password": b.accessPassword } });
      if (res.ok) token.current = ((await res.json()) as { engineToken?: string }).engineToken ?? null;
    }
    return token.current ? { Authorization: `Bearer ${token.current}` } : {};
  }, []);

  // Nothing carrying the user's words leaves this window except through this controller: it asks
  // before the first send to each recipient, adds the header the server checks, and drives the signal.
  const outRef = useRef<OutboundController | null>(null);
  if (!outRef.current) {
    outRef.current = createOutboundController({
      consent: () => statusRef.current?.consent,
      save: async (_next, also, changes) => {
        const b = okFilowBridge();
        if (!b) return false;
        const s = await b.configure({ consentChanges: changes, ...also });
        statusRef.current = s;
        setStatus(s);
        return changesStored(s.consent ?? {}, changes);
      },
      fetchRecipients: async () => {
        const res = await fetch(`/api/whiteboard/recipients?model=${encodeURIComponent(modelRef.current)}`, { headers: await engineHeaders() });
        return res.ok ? ((await res.json()) as BuddyRecipients) : null;
      },
      signal: {
        begin: (id, kind, names) => okFilowBridge()?.outbound?.begin(id, kind, names),
        end: (id, o) => okFilowBridge()?.outbound?.end(id, o),
      },
      onNotice: setNotice,
    });
  }
  const out = outRef.current;

  const langRef = useRef(lang);
  langRef.current = lang;
  // The online model of the whiteboard (its own, chosen here or in Settings); each model's maker gets its own yes.
  const [cloudModel, chooseCloudModel] = useWhiteboardModel();
  const modelRef = useRef(cloudModel);
  modelRef.current = cloudModel;
  // The voices of OK Filow (natural on this PC, the system voice). No cloud voice from this page:
  // without `cloudAudio` the speaker falls back to the system voice and sends nothing.
  const speaker = useMemo(() => createSpeaker({ player: () => recorderRef.current?.player() ?? webAudioPlayer(), bridge: okFilowBridge, status: () => statusRef.current, isCurrent: (id) => turnRef.current === id, uiLang: () => langRef.current }), []);

  const ask = useCallback(async (raw: string, more: boolean) => {
    const text = raw.trim().slice(0, LIMITS.question);
    const current = lsRef.current.lesson;
    if (!text || (more && !current)) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const id = ++askSeq.current;
    lastAsk.current = { text, more };
    setNote("");
    arrived.current.clear();
    dispatchLesson({ type: "ask", more });
    jumpTo.current = more ? current!.steps.length : null;
    if (!more) {
      dispatchPlayer({ type: "reset", expected: 0 });
      // a new board: the question is its title at once, before the model has written anything
      setEdits(noEdits());
      setFixes(noEdits());
      setCamera(null);
      setImported(null);
      setCanvasOpen(false);
      undoStack.current = [];
      setUndoCount(0);
      fixRounds.current.clear();
      shrunk.current.clear();
      setFixedCount(0);
      setPendingTitle(text);
      strokeClock.current = { start: performance.now(), first: null, firstModel: null };
      setFirstStroke({ any: null, model: null });
    }
    try {
      // Offline mode always means this PC; otherwise what was chosen on this page.
      let route: AskRoute = statusRef.current?.offline ? "local" : from;
      let to: Recipient | null = null;
      if (route !== "local") {
        if (!okFilowBridge()) {
          route = "local";
          setNote(wbText(langRef.current, "cloudNeedsApp"));
        } else {
          // the online model of the whiteboard is its own, and may have been changed since the last question: asked for afresh
          const all = route === "cloud" ? await boardRecipients(modelRef.current, await engineHeaders()) : await out.recipients();
          // who receives the question on this route: OpenRouter and the model's maker, or the user's FreeLLMAPI router
          const target = all ? askRouteRecipient(route, all) : null;
          if (!target) throw new Error(okfT("noticeUnknown"));
          const rec = { ask: target };
          if (out.standing("ask", rec.ask) === "ask") setNote(wbText(langRef.current, "noticeWaiting"));
          const decision = await out.allow("ask", rec.ask);
          if (askSeq.current !== id) return;
          setNote("");
          if (decision === "dismissed") return dispatchLesson({ type: "cancel" });
          if (decision === "declined") {
            route = "local";
            setNote(wbText(langRef.current, "keptLocal"));
          } else to = rec.ask;
        }
      }
      const send = async (consent: Record<string, string>, quiet?: () => void) => {
        const res = await fetch("/api/whiteboard/lesson", {
          method: "POST",
          signal: abort.signal,
          headers: { "Content-Type": "application/json", ...(await engineHeaders()), ...consent },
          body: JSON.stringify({ question: text, provider: route, setup: getSetupPreference(), language: more ? lsRef.current.meta?.lang ?? "auto" : "auto", lesson: more ? current : undefined, spell: route !== "local" && knownToHideNames(), model: route === "cloud" ? modelRef.current : undefined }),
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { code: j.code || "model" });
        }
        // The server answered from this PC after all (offline switch): nothing went outside.
        if (res.headers.get("X-Buddy-Provider") === "local") quiet?.();
        let ended = false;
        await readLessonStream(res.body, (event) => {
          if (askSeq.current !== id) return;
          if (event.type === "done" || event.type === "error") ended = true;
          if (event.type === "step") {
            const p = playerRef.current;
            const index = lsRef.current.base + event.index;
            if (p.phase === "waiting" && p.playing && p.index + 1 === index) arrived.current.set(index, performance.now());
          }
          dispatchLesson({ type: "event", event });
        });
        // The answer stopped without saying it was done (the server went away): do not wait forever.
        if (!ended && askSeq.current === id) throw new Error("the answer stopped before the lesson was complete");
      };
      await (to ? out.sending("ask", to, send) : send({}));
    } catch (e) {
      if (abort.signal.aborted || askSeq.current !== id) return;
      dispatchLesson({ type: "fail", code: (e as { code?: string }).code ?? "model", message: e instanceof Error ? e.message : String(e) });
    }
  }, [engineHeaders, from, okfT, out]);
  const askRef = useRef(ask);
  askRef.current = ask;

  // The desktop bridge: settings, the going-outside signal, and topics sent from the OK Filow panel.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("voice") === "off") setVoiceOn(false);
    // A saved lesson handed to this window (tools/whiteboard/shots.mjs puts one in sessionStorage to
    // photograph its final board): checked like anything a model wrote, shown silently at its last step.
    try {
      const saved = window.sessionStorage.getItem(REPLAY_KEY);
      window.sessionStorage.removeItem(REPLAY_KEY);
      const lesson = saved ? validateLesson(JSON.parse(saved), { maxSteps: 12, sketch: true }) : null;
      if (lesson) {
        setVoiceOn(false);
        dispatchLesson({ type: "ask", more: false });
        dispatchPlayer({ type: "reset", expected: 0 });
        dispatchLesson({ type: "event", event: { type: "start", provider: "local", model: "saved lesson", lang: "en", lite: false, more: false } });
        dispatchLesson({ type: "event", event: { type: "outline", title: lesson.title, scene: lesson.scene, says: lesson.steps.map((s) => s.say) } });
        lesson.steps.forEach((step, index) => dispatchLesson({ type: "event", event: { type: "step", index, step } }));
        dispatchLesson({ type: "event", event: { type: "done", cards: lesson.steps.filter((s) => s.card).length, stalled: false } });
        jumpTo.current = lesson.steps.length - 1;
        return;
      }
    } catch { /* not a lesson: the page opens as usual */ }
    const q = params.get("q");
    const b = okFilowBridge();
    if (!b) {
      if (q) {
        setQuestion(q);
        void askRef.current(q, false);
      }
      return;
    }
    setDesktop(true);
    const apply = (s: OkFilowStatus) => {
      statusRef.current = s;
      setStatus(s);
    };
    void b.status().then((s) => {
      apply(s);
      // the whiteboard starts on the source OK Filow answers from: this PC, FreeLLMAPI or Cloud
      setFrom(askRoute(s));
      if (s.voice === "off") setVoiceOn(false);
    }).catch(() => {});
    const offs = [b.onConfig(apply)];
    if (b.outbound) {
      offs.push(b.outbound.onChange(setSnap));
      b.outbound.ready();
    }
    if (b.onWhiteboard) {
      offs.push(b.onWhiteboard((topic) => {
        if (typeof topic !== "string" || !topic.trim()) return;
        setQuestion(topic.trim());
        void askRef.current(topic, false);
      }));
    }
    b.whiteboardReady?.();
    return () => { for (const off of offs) off(); };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "light" ? "light" : "dark");
    read();
    try {
      const kept = localStorage.getItem(LOOK_KEY);
      if (kept === "light" || kept === "dark") setLook(kept);
    } catch { /* no storage: the board follows the theme */ }
    const watch = new MutationObserver(read);
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const narrow = window.matchMedia("(max-width: 700px)");
    const size = () => setShape(narrow.matches ? "tall" : "wide");
    size();
    narrow.addEventListener("change", size);
    return () => {
      watch.disconnect();
      narrow.removeEventListener("change", size);
    };
  }, []);

  useEffect(() => {
    if (!ls.spelled.length) return;
    try { localStorage.setItem(SPELL_KEY, "1"); } catch { /* the next question finds it out again */ }
  }, [ls.spelled]);

  // The player follows the lesson as it arrives.
  const stepCount = ls.lesson?.steps.length ?? 0;
  useEffect(() => {
    dispatchPlayer({ type: "arrived", total: stepCount });
    dispatchPlayer({ type: "expect", expected: ls.expected });
    if (jumpTo.current !== null && stepCount > jumpTo.current) {
      dispatchPlayer({ type: "goto", index: jumpTo.current });
      jumpTo.current = null;
    }
  }, [stepCount, ls.expected]);

  // One step: speak its sentence (or give it reading time), then tell the player it is done.
  const say = player.index >= 0 ? ls.lesson?.steps[player.index]?.say ?? "" : "";
  const lessonLang = ls.meta?.lang;
  captionRef.current = say;
  const speaking = player.phase === "showing" && player.playing;
  useEffect(() => {
    if (!speaking) return;
    const turn = player.turn;
    turnRef.current = turn;
    let over = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => { if (!over) dispatchPlayer({ type: "spoken", turn }); };
    if (voiceOn && say) {
      const started = performance.now();
      void speaker.speak(say, turn, { lang: lessonLang }).catch(() => {}).then(() => {
        if (over) return;
        // the voice has ended: what is left of the drawing is completed at once, and the clock learns this voice
        setSaidTurn(turn);
        meter.learn(say, performance.now() - started);
        // No voice spoke (none installed, or it failed at once): leave time to read instead.
        timer = setTimeout(finish, performance.now() - started < 500 ? readingMs(say) : 450);
      });
    } else timer = setTimeout(finish, readingMs(say));
    return () => {
      over = true;
      clearTimeout(timer);
      speaker.stop();
    };
  }, [speaking, player.turn, say, voiceOn, lessonLang, speaker, meter]);

  // How long after its data arrived a step was on the board (only when the board was waiting for it).
  useEffect(() => {
    const at = arrived.current.get(player.index);
    if (at === undefined) return;
    arrived.current.delete(player.index);
    // An effect runs once the step's SVG is in the document (the paint follows in the same frame).
    // Not requestAnimationFrame: that waits for as long as the window is hidden.
    setShownMs(Math.round(performance.now() - at));
  }, [player.index, player.turn]);

  useEffect(() => () => {
    abortRef.current?.abort();
    speaker.stop();
  }, [speaker]);

  const layout = useMemo(() => (ls.lesson && player.index >= 0 ? layoutBoard(boardLesson(ls.lesson), player.index, shape) : null), [ls.lesson, player.index, shape]);
  const busy = ls.phase === "planning" || ls.phase === "drawing";
  const lite = Boolean(ls.meta?.lite);
  // The drawing of the step being said takes the time of its sentence: measured from this voice, or the reading time with the voice off.
  const stepMs = speaking && say ? (voiceOn ? meter.estimate(say) : readingMs(say)) : 0;
  const timing = useMemo(() => (layout && stepMs && !lite ? stepSchedule(layout, player.index, drawMsFor(stepMs)) : undefined), [layout, stepMs, lite, player.index]);
  const rest = !speaking || saidTurn === player.turn;
  const offline = Boolean(status?.offline);

  // ---- The board as an Excalidraw scene ----
  const compiled = useMemo<Scene | null>(() => {
    if (imported) return imported;
    if (layout) return sceneFromLayout(layout, { plain: lite });
    return busy && pendingTitle ? pendingScene(pendingTitle, BOARD_SIZE[shape]) : null;
  }, [imported, layout, lite, busy, pendingTitle, shape]);
  // what the user's changes sit on: the lesson as compiled, tidied by the checks
  const fixedBase = useMemo(() => (compiled ? applyEdits(compiled, fixes) : null), [compiled, fixes]);
  const raw = useMemo(() => (fixedBase ? applyEdits(fixedBase, edits) : null), [fixedBase, edits]);
  // Measured by Excalidraw with its own fonts before it is drawn or checked.
  const [prepared, setPrepared] = useState<Scene | null>(null);
  useEffect(() => {
    if (!raw) { setPrepared(null); return; }
    let live = true;
    void prepareScene(raw).then((s) => { if (live) setPrepared(s); }).catch(() => { if (live) setPrepared(raw); });
    return () => { live = false; };
  }, [raw]);
  const boardStep = imported ? 0 : Math.max(0, player.index);

  // See and fix, in code: every step is checked as soon as it is measured, before its strokes reach
  // the screen, and what is wrong is tidied by id (smaller type, a bent arrow, a label slid along).
  useEffect(() => {
    if (!prepared || !compiled) return;
    const problems = checkScene(prepared);
    setChecks(countProblems(problems));
    if (!problems.length || canvasOpen) return;
    const round = `${imported ? "file" : boardStep}`;
    const n = fixRounds.current.get(round) ?? 0;
    if (n >= FIX_ROUNDS) return;
    fixRounds.current.set(round, n + 1);
    const ops = fixOps(prepared, problems);
    if (!ops.length) return;
    setFixedCount((c) => c + new Set(ops.map((o) => ("id" in o ? o.id : ""))).size);
    setFixes((f) => applyOps(compiled, f, ops).edits);
  }, [prepared]); // eslint-disable-line react-hooks/exhaustive-deps

  // See and fix, with eyes: once a step is on the board its picture goes to the vision model on this
  // PC (when one is installed), which names labels that are cut, covered or hard to read. Its answer
  // is used for the next look; the voice never waits for it.
  const looking = useRef(false);
  const looked = useRef("");
  const shrunk = useRef(new Set<string>());
  const lookAt = useCallback(async (scene: Scene, base: Scene) => {
    if (looking.current || lite) return;
    looking.current = true;
    const started = performance.now();
    try {
      const png = await scenePng(scene.elements, scene.files, { dark: false, maxSide: 896 });
      const labels = readScene(scene).filter((x) => x.text).slice(0, 60).map((x) => ({ id: x.id, text: String(x.text).slice(0, 80) }));
      const res = await fetch("/api/whiteboard/look", { method: "POST", signal: AbortSignal.timeout(LOOK_MS), headers: { "Content-Type": "application/json", ...(await engineHeaders()) }, body: JSON.stringify({ png: await blobBase64(png), labels }) });
      if (!res.ok) return;
      const j = (await res.json()) as { problems?: Array<{ id: string; issue: string }> };
      const byId = new Map(scene.elements.map((e) => [e.id, e]));
      // A small vision model also sees problems that are not there: its word only ever sets the
      // words of a box a little smaller (never below a readable 15, once per box); it never moves anything.
      const ops: ToolOp[] = [];
      for (const p of j.problems ?? []) {
        const e = byId.get(p.id);
        if (!e || (p.issue !== "cut" && p.issue !== "unreadable") || shrunk.current.has(p.id)) continue;
        const label = e.type === "text" ? e : scene.elements.find((x) => x.containerId === e.id);
        const box = label?.containerId ? byId.get(label.containerId) : undefined;
        if (!label || !box || !["rectangle", "ellipse", "diamond"].includes(box.type) || (label.fontSize ?? 0) <= 15) continue;
        shrunk.current.add(p.id);
        ops.push({ op: "update", id: label.id, props: { fontSize: Math.max(15, Math.round((label.fontSize ?? 20) * 0.92)) } });
      }
      setVision((v) => ({ looks: v.looks + 1, found: v.found + (j.problems?.length ?? 0), ms: [...v.ms, Math.round(performance.now() - started)] }));
      if (ops.length) {
        setFixedCount((c) => c + ops.length);
        setFixes((f) => applyOps(base, f, ops).edits);
      }
    } catch { /* no vision model, or it was too slow: the code check stands alone */ } finally {
      looking.current = false;
    }
  }, [engineHeaders, lite]);

  // The first stroke: the moment anything (the question as the title) and anything the model wrote is on the board.
  const onDrawn = useCallback((info: DrawnInfo) => {
    const c = strokeClock.current;
    if (!c.start) return;
    const now = performance.now();
    if (c.first === null && info.visible.length > 1) c.first = now;
    if (c.firstModel === null && info.visible.some((e) => (e.customData?.wb?.step ?? -1) >= 0)) c.firstModel = now;
    setFirstStroke({ any: c.first === null ? null : Math.round(c.first - c.start), model: c.firstModel === null ? null : Math.round(c.firstModel - c.start) });
    // one look per step (a fix redraws the step; that redraw is not looked at again)
    const key = `${strokeClock.current.start}:${boardStep}`;
    if (info.complete && prepared && compiled && !imported && looked.current !== key && layout) {
      looked.current = key;
      void lookAt(prepared, compiled);
    }
  }, [lookAt, prepared, compiled, imported, boardStep, layout]);

  // The last board is kept on this PC (never sent anywhere), so it can be opened again.
  useEffect(() => {
    try { setSavedBoard(Boolean(localStorage.getItem(BOARD_KEY))); } catch { /* no storage */ }
  }, []);
  useEffect(() => {
    if (busy || (!ls.lesson && !imported)) return;
    const saved: SavedBoard = { v: 1, lesson: imported ? null : ls.lesson, ...(imported ? { scene: imported } : {}), edits, fixes };
    try {
      const json = JSON.stringify(saved);
      if (json.length <= MAX_SAVED_BYTES) localStorage.setItem(BOARD_KEY, json);
    } catch { /* full or private: the board is not kept */ }
  }, [busy, ls.lesson, imported, edits, fixes]);

  const chooseLook = (next: BoardLook) => {
    setLook(next);
    try { localStorage.setItem(LOOK_KEY, next); } catch { /* private mode: the choice lasts for this page */ }
  };
  const onAsk = (ev: FormEvent) => {
    ev.preventDefault();
    void ask(question, false);
  };
  /** A change of the board: kept for "Undo", then made. */
  const changeBoard = (next: SceneEdits, nextCamera: Box | null = camera) => {
    undoStack.current.push(edits);
    setUndoCount(undoStack.current.length);
    setEdits(next);
    setCamera(nextCamera);
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (prev) setEdits(prev);
  };
  // A follow-up first goes to the board's tools ("make the arrow red", "zoom into step 2"): the model
  // on this PC reads the scene and names what to change by id. Anything that needs new explaining
  // ("add an example") continues the lesson on the same board, as before.
  const followUp = async (text: string) => {
    const scene = prepared;
    const words = text.trim().slice(0, LIMITS.question);
    if (!words) return;
    if (!scene || !fixedBase) return void ask(words, true);
    setEditing(true);
    setNote(t("editWorking"));
    try {
      const res = await fetch("/api/whiteboard/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await engineHeaders()) },
        body: JSON.stringify({ request: words, scene: readScene(scene).slice(0, 80), steps: imported ? [] : ls.lesson?.steps.map((s) => s.say) ?? [], setup: getSetupPreference() }),
      });
      const j = res.ok ? ((await res.json()) as EditPlan) : null;
      if (!j || j.kind === "explain") {
        setNote("");
        if (ls.lesson && !imported) void ask(words, true);
        else setNote(t("editNone"));
        return;
      }
      const { ops, camera: look } = changesToOps(scene, Array.isArray(j.changes) ? j.changes : []);
      const { edits: next, skipped } = applyOps(fixedBase, edits, ops);
      const board = frameBox(scene);
      const cam = look ? (look.all ? null : cameraFor(scene, look.step ? { step: look.step - 1 } : { ids: look.ids ?? [] }, board)) : camera;
      if (skipped.length === ops.length && !look) { setNote(t("editNone")); return; }
      changeBoard(next, cam);
      setNote(t("editApplied", { what: j.said || words }));
    } catch {
      setNote(t("editNone"));
    } finally {
      setEditing(false);
    }
  };
  const onFollow = (ev: FormEvent) => {
    ev.preventDefault();
    const text = follow;
    setFollow("");
    void followUp(text);
  };
  const boardName = () => (imported ? "board" : ls.lesson?.title ?? pendingTitle ?? "board");
  const savePng = async () => {
    if (!prepared) return;
    try {
      saveBlob(await scenePng(prepared.elements, prepared.files, { dark: board === "dark" }), `${fileStem(boardName())}.png`);
      setNote(t("saved"));
    } catch {
      setNote(t("exportFailed"));
    }
  };
  const saveExcalidraw = () => {
    if (!prepared) return;
    saveBlob(new Blob([excalidrawFile(prepared, board === "dark")], { type: "application/vnd.excalidraw+json" }), `${fileStem(boardName())}.excalidraw`);
    setNote(t("saved"));
  };
  const openFile = async (file: File | undefined) => {
    if (!file) return;
    const scene = file.size <= 20_000_000 ? parseExcalidrawFile(await file.text()) : null;
    if (!scene || !scene.elements.length) { setNote(t("openFailed")); return; }
    abortRef.current?.abort();
    speaker.stop();
    dispatchLesson({ type: "cancel" });
    dispatchPlayer({ type: "pause" });
    setImported(scene);
    setEdits(noEdits());
    setFixes(noEdits());
    setCamera(null);
    undoStack.current = [];
    setUndoCount(0);
    fixRounds.current.clear();
    setNote(t("openedNote", { name: file.name }));
  };
  const openLast = () => {
    let saved: SavedBoard | null = null;
    try { saved = JSON.parse(localStorage.getItem(BOARD_KEY) ?? "null") as SavedBoard | null; } catch { saved = null; }
    if (!saved || saved.v !== 1) return;
    const lesson = saved.lesson ? validateLesson(saved.lesson, { maxSteps: 40, sketch: true }) : null;
    const scene = !lesson && saved.scene ? parseExcalidrawFile(JSON.stringify({ type: "excalidraw", elements: saved.scene.elements, files: saved.scene.files })) : null;
    if (!lesson && !scene) return;
    abortRef.current?.abort();
    if (lesson) {
      setImported(null);
      setVoiceOn(false);
      dispatchLesson({ type: "ask", more: false });
      dispatchPlayer({ type: "reset", expected: 0 });
      dispatchLesson({ type: "event", event: { type: "start", provider: "local", model: "saved board", lang: buddyLang(lessonLang) ?? "en", lite: false, more: false } });
      dispatchLesson({ type: "event", event: { type: "outline", title: lesson.title, scene: lesson.scene, says: lesson.steps.map((s) => s.say) } });
      lesson.steps.forEach((step, index) => dispatchLesson({ type: "event", event: { type: "step", index, step } }));
      dispatchLesson({ type: "event", event: { type: "done", cards: lesson.steps.filter((s) => s.card).length, stalled: false } });
      jumpTo.current = lesson.steps.length - 1;
    } else if (scene) setImported(withFrame(scene));
    const clean = (e: SceneEdits | undefined) => (e && typeof e === "object" && e.patch && Array.isArray(e.added) && Array.isArray(e.deleted) ? { patch: e.patch, added: e.added.map((a) => parseExcalidrawFile(JSON.stringify({ type: "excalidraw", elements: [a] }))?.elements[0]).filter((a): a is NonNullable<typeof a> => Boolean(a)), deleted: e.deleted.filter((d) => typeof d === "string"), files: {} } : noEdits());
    setEdits(clean(saved.edits));
    setFixes(clean(saved.fixes));
    setCamera(null);
  };
  const closeCanvas = (els: Scene["elements"], files: Scene["files"]) => {
    setCanvasOpen(false);
    if (!prepared || !fixedBase) return;
    // what the user changed by hand, compared with what the canvas was given
    const hand = diffEdits(prepared, noEdits(), els, files);
    if (!hasEdits(hand)) return;
    changeBoard({ patch: { ...edits.patch, ...Object.fromEntries(Object.entries(hand.patch).map(([id, p]) => [id, { ...edits.patch[id], ...p }])) }, added: [...edits.added.filter((a) => !hand.deleted.includes(a.id) && !hand.patch[a.id]), ...edits.added.filter((a) => hand.patch[a.id]).map((a) => ({ ...a, ...hand.patch[a.id] })), ...hand.added], deleted: [...new Set([...edits.deleted, ...hand.deleted.filter((id) => !edits.added.some((a) => a.id === id))])], files: { ...edits.files, ...hand.files } });
  };
  // The lesson as a video: it is played again from its first step while the board is recorded
  // (lib/whiteboard/video.ts). The natural voice of this PC goes into the video; any other voice
  // cannot be recorded by a page, so the video is then silent and carries the sentences as captions.
  const startVideo = async () => {
    const svg = frame.current?.querySelector<SVGSVGElement>("svg.wb-board");
    if (!svg || !ls.lesson || !prepared) return;
    const natural = voiceOn && statusRef.current?.voice === "natural" && Boolean(okFilowBridge()?.tts);
    // the copy of the board drawn into each frame carries Excalidraw's fonts, inlined
    const whole = layoutBoard(boardLesson(ls.lesson), ls.lesson.steps.length - 1, shape);
    const made = createRecorder({
      board: () => frame.current?.querySelector<SVGSVGElement>("svg.wb-board") ?? null,
      caption: () => captionRef.current,
      colours: () => BOARD_COLOURS[boardRef.current],
      css: () => { const s = sceneFromLayout(whole); return fontCss(s.elements, s.files); },
      sound: natural,
    });
    if (!made) {
      setNote(t("videoUnsupported"));
      return;
    }
    recorderRef.current = made;
    setRecording(true);
    setNote(t("videoRecording"));
    await made.start();
    dispatchPlayer({ type: "goto", index: 0 });
  };
  const endVideo = async (save: boolean) => {
    const made = recorderRef.current;
    if (!made) return;
    recorderRef.current = null;
    setRecording(false);
    const blob = await made.stop();
    if (!save || !ls.lesson) {
      setNote("");
      return;
    }
    saveBlob(blob, `${fileStem(ls.lesson.title)}.webm`);
    setVideoInfo({ bytes: blob.size, frames: made.frames(), sound: made.sound, type: blob.type });
    setNote(t(made.sound ? "videoSavedVoice" : "videoSavedSilent"));
  };
  // The lesson has played to its end: the recording ends with it, after a moment on the finished board.
  const endVideoRef = useRef(endVideo);
  endVideoRef.current = endVideo;
  useEffect(() => {
    if (!recording || player.phase !== "done") return;
    const timer = setTimeout(() => void endVideoRef.current(true), 900);
    return () => clearTimeout(timer);
  }, [recording, player.phase]);  const saveMd = () => {
    if (!ls.lesson) return;
    saveBlob(new Blob([lessonMarkdown(ls.lesson, { step: t("mdStep"), drawing: t("mdBoard") })], { type: "text/markdown;charset=utf-8" }), `${fileStem(ls.lesson.title)}.md`);
    setNote(t("saved"));
  };
  const retry = (via: "same" | "cloud" | "local") => {
    const last = lastAsk.current;
    if (!last) return;
    if (via === "local") {
      // on this PC nothing leaves, so no notice: the same question, asked of the local model
      setFrom("local");
      setTimeout(() => void askRef.current(last.text, last.more), 0);
    } else if (via === "cloud") {
      // the user's own press: the next ask goes through the notice like any cloud question
      setFrom("cloud");
      setTimeout(() => void askRef.current(last.text, last.more), 0);
    } else void ask(last.text, last.more);
  };

  // While the lesson is being written the page says how long it has been waiting: an online model that reasons may take minutes.
  const [waited, setWaited] = useState(0);
  const planning = ls.phase === "planning";
  useEffect(() => {
    setWaited(0);
    if (!planning) return;
    const started = Date.now();
    const timer = setInterval(() => setWaited(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [planning]);
  const status_line = ls.phase === "planning" ? `${t("planning")}${waited >= WAIT_SAID_AFTER_S ? ` ${t("waitedFor", { s: waited })}` : ""}` : ls.phase === "drawing" && stepCount < ls.expected ? t("drawingStep", { n: stepCount + 1, total: ls.expected }) : "";
  const errorText = !ls.error ? "" : ls.error.code === "plan" ? t("errPlan") : ls.error.code === "stalled" ? t("errStalled") : ls.error.code === "busy" ? t("errBusy") : ls.error.code === "topic" ? t("errTopic") : ls.error.code === "redacted" ? t("errRedacted", { what: placeholderLeaks(ls.error.message, "").join(", ") || "[...]" }) : ls.error.code === "no_local_helper" ? ls.error.message : OLLAMA_STOPPED_ANSWER.test(ls.error.message) ? okfT("ollamaStopped") : ls.error.code.startsWith("freellm") || freellmCodeOf(ls.error.message) ? localizeFreeLlmError(ls.error.message, lang) : t("errGeneric", { message: ls.error.message });

  return (
    <main className={`wb-page${lite ? " wb-plain" : ""}`} data-phase={ls.phase} data-player={player.phase} data-recording={recording || undefined} data-video={videoInfo ? `${videoInfo.type};bytes=${videoInfo.bytes};frames=${videoInfo.frames};sound=${videoInfo.sound}` : undefined} data-shown-ms={shownMs ?? undefined} data-first-stroke-ms={firstStroke.any ?? undefined} data-first-model-stroke-ms={firstStroke.model ?? undefined} data-checks={checks ? `${checks.overflow},${checks.overlap},${checks.crossing},${checks.offscreen}` : undefined} data-fixed={fixedCount || undefined} data-vision={vision.looks ? `${vision.looks};${vision.found};${vision.ms.join("/")}` : undefined} data-board={imported ? "file" : prepared ? "lesson" : undefined}>
      <header className="wb-head">
        <h1>{t("title")}</h1>
        {ls.meta && <span className="wb-chip" data-source={ls.meta.provider}>{t(ls.meta.provider === "cloud" ? "source_cloud" : ls.meta.provider === "freellm" ? "source_free" : "source_local", { model: ls.meta.model })}</span>}
        {snap?.active && <OutboundPill snap={snap} t={okfT} />}
        <span className="wb-grow" />
        {desktop && <button type="button" className="wb-btn small" onClick={() => okFilowBridge()?.closeWhiteboard?.()}>{t("close")}</button>}
      </header>

      <form className="wb-ask" onSubmit={onAsk}>
        <label className="wb-field">
          {t("askLabel")}
          <input type="text" value={question} maxLength={LIMITS.question} placeholder={t("askPlaceholder")} onChange={(e) => setQuestion(e.target.value)} autoComplete="off" />
        </label>
        <fieldset className="wb-from">
          <legend>{t("fromLabel")}</legend>
          <span className="wb-seg">
            <label><input type="radio" name="wb-from" checked={from === "local" || offline} onChange={() => setFrom("local")} />{t("from_local")}</label>
            <label title={!desktop ? t("cloudNeedsApp") : offline ? t("cloudOffline") : t("onlyQuestion")}>
              <input type="radio" name="wb-from" checked={from === "freellm" && !offline} disabled={!desktop || offline} onChange={() => setFrom("freellm")} />{t("from_free")}
            </label>
            <label title={!desktop ? t("cloudNeedsApp") : offline ? t("cloudOffline") : t("onlyQuestion")}>
              <input type="radio" name="wb-from" checked={from === "cloud" && !offline} disabled={!desktop || offline} onChange={() => setFrom("cloud")} />{t("from_cloud")}
            </label>
          </span>
        </fieldset>
        {from === "cloud" && desktop && !offline && <ModelPicker className="wb-field wb-model" value={cloudModel} onChange={chooseCloudModel} />}
        <button type="submit" className="wb-btn primary" disabled={!question.trim()}>{t("explain")}</button>
      </form>
      {from !== "local" && !offline && desktop && <p className="wb-note">{t("onlyQuestion")}{from === "freellm" ? ` ${okfT("outFreeWarn")}` : ""}</p>}
      {offline && <p className="wb-note">{t("cloudOffline")}</p>}

      {!ls.lesson && !busy && !ls.error && !imported && (
        <div className="wb-try">
          <span>{t("tryLabel")}</span>
          {EXAMPLES.map((k) => (
            <button key={k} type="button" className="wb-btn small" onClick={() => { setQuestion(t(k)); void ask(t(k), false); }}>{t(k)}</button>
          ))}
          {savedBoard && <button type="button" className="wb-btn small" data-action="last-board" onClick={openLast}>{t("lastBoard")}</button>}
          <button type="button" className="wb-btn small" data-action="open" onClick={() => fileInput.current?.click()}>{t("openExcalidraw")}</button>
        </div>
      )}
      <input ref={fileInput} type="file" accept=".excalidraw,application/json,.json" hidden onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ""; }} />

      <p className="wb-note" role="status" aria-live="polite">{[status_line, note].filter(Boolean).join(" ")}</p>

      {ls.error && (
        <div className="wb-alert" role="alert">
          <p>{errorText}</p>
          <button type="button" className="wb-btn small" onClick={() => retry("same")}>{t("retry")}</button>
          {from !== "local" && (ls.error.code === "redacted" || ls.error.code === "topic") && <button type="button" className="wb-btn small primary" data-action="use-local" onClick={() => retry("local")}>{t("useLocal")}</button>}
          {desktop && !offline && from !== "cloud" && <button type="button" className="wb-btn small" onClick={() => retry("cloud")}>{t("useCloud")}</button>}
        </div>
      )}

      <section className="wb-stage" aria-label={t("title")}>
        <div className="wb-frame" ref={frame} data-look={board} data-step-ms={stepMs || undefined} style={prepared ? { background: BOARD_COLOURS[board].page } : undefined}>
          {prepared && canvasOpen ? (
            <ExcalidrawCanvas scene={prepared} dark={board === "dark"} lang={lang} label={t("canvasLabel")} doneLabel={t("editDone")} onDone={closeCanvas} />
          ) : prepared ? (
            <ExcalidrawBoard
              scene={prepared}
              current={boardStep}
              timing={imported ? undefined : timing}
              rest={rest || Boolean(imported)}
              dark={board === "dark"}
              animate={!lite}
              camera={camera}
              label={t("boardLabel", { title: imported ? "" : ls.lesson?.title ?? pendingTitle })}
              onPick={busy || imported || !ls.lesson ? undefined : (_id, text) => void ask(t("againAsk", { name: text }), true)}
              pickLabel={(text) => t("nodeAgain", { name: text })}
              onDrawn={onDrawn}
            />
          ) : (
            <div className="wb-empty">{busy ? t("planning") : t("intro")}</div>
          )}
        </div>
        {canvasOpen && <p className="wb-note">{t("editHint")}</p>}

        {ls.lesson && !imported && (
          <>
            <div className="wb-progress" aria-hidden="true"><span style={{ width: `${Math.round(((player.index + 1) / Math.max(1, ls.expected, stepCount)) * 100)}%` }} /></div>
            <p className="wb-say" aria-live="polite">
              <span className="wb-count">
                {player.index >= 0 ? t("stepOf", { n: player.index + 1, total: Math.max(ls.expected, stepCount) }) : ""}
                {player.phase === "waiting" && stepCount > 0 ? ` ${t("waitingStep")}` : ""}
                {player.phase === "done" ? ` ${t("ended")}` : ""}
              </span>
              {say}
            </p>
            <div className="wb-controls">
              <button type="button" className="wb-btn" onClick={() => dispatchPlayer({ type: "back" })} disabled={player.index <= 0}>{t("back")}</button>
              <button type="button" className="wb-btn primary" onClick={() => dispatchPlayer({ type: player.playing ? "pause" : "play" })} disabled={stepCount === 0}>{player.playing ? t("pause") : t("play")}</button>
              <button type="button" className="wb-btn" onClick={() => dispatchPlayer({ type: "next" })} disabled={player.index + 1 >= stepCount}>{t("next")}</button>
              <button type="button" className="wb-btn" onClick={() => dispatchPlayer({ type: "replay" })} disabled={player.index < 0}>{t("replay")}</button>
              <button type="button" className="wb-btn" aria-pressed={voiceOn} onClick={() => setVoiceOn((v) => !v)}>{voiceOn ? t("voiceOn") : t("voiceOff")}</button>
              <button type="button" className="wb-btn wb-look" data-action="look" title={t("lookSwitch")} onClick={() => chooseLook(board === "dark" ? "light" : "dark")}>{t(board === "dark" ? "lookBlack" : "lookWhite")}</button>
            </div>
          </>
        )}
        {prepared && (ls.lesson || imported) && !busy && (
          <div className="wb-controls" data-tools="board">
            <button type="button" className="wb-btn" data-action="edit" aria-pressed={canvasOpen} onClick={() => setCanvasOpen((o) => !o)} disabled={canvasOpen}>{t("editHand")}</button>
            {undoCount > 0 && <button type="button" className="wb-btn" data-action="undo" onClick={undo}>{t("undoEdit")}</button>}
            {camera && <button type="button" className="wb-btn" data-action="show-all" onClick={() => setCamera(null)}>{t("showAll")}</button>}
            {imported && <button type="button" className="wb-btn wb-look" data-action="look" title={t("lookSwitch")} onClick={() => chooseLook(board === "dark" ? "light" : "dark")}>{t(board === "dark" ? "lookBlack" : "lookWhite")}</button>}
            <span className="wb-grow" />
            <button type="button" className="wb-btn" onClick={() => void savePng()}>{t("exportPng")}</button>
            <button type="button" className="wb-btn" data-action="save-excalidraw" onClick={saveExcalidraw}>{t("exportExcalidraw")}</button>
            <button type="button" className="wb-btn" data-action="open" onClick={() => fileInput.current?.click()}>{t("openExcalidraw")}</button>
            {ls.lesson && !imported && <button type="button" className="wb-btn" onClick={saveMd} disabled={stepCount === 0}>{t("exportMd")}</button>}
            {ls.lesson && !imported && <button type="button" className="wb-btn" data-action="video" aria-pressed={recording} onClick={() => void (recording ? endVideo(false) : startVideo())} disabled={!layout || busy}>{recording ? t("videoStop") : t("exportVideo")}</button>}
          </div>
        )}
        {ls.lesson && !imported && (
          <>
            {/* The local model explains correctly but its boards miss the main relations too often (docs/whiteboard/PROOF.md, round 3): the page says so. Never a switch: only words. */}
            {ls.meta?.provider === "local" && <p className="wb-note" data-advice="cloud">{t("localSimple")}</p>}
            {lite && <p className="wb-note">{t("liteNote")}</p>}
            {ls.spelled.length > 0 && <p className="wb-note" data-spelled={ls.spelled.join(",")}>{t("spelledNote", { names: ls.spelled.join(", ") })}</p>}
            {ls.unchecked.length > 0 && <p className="wb-note" data-unchecked={ls.unchecked.join(",")}>{t("uncheckedNote", { steps: ls.unchecked.join(", ") })}</p>}
            {ls.doubts && ls.unchecked.length === 0 && <p className="wb-note" data-doubts="1">{t("doubtsNote")}</p>}
            {ls.stalled && <p className="wb-note">{t("stalledNote")}</p>}
            {!ls.stalled && ls.cards > 0 && <p className="wb-note">{t("cardsNote", { n: ls.cards })}</p>}
            {layout && layout.wiped > 0 && <p className="wb-note">{t("wipedNote", { n: layout.wiped })}</p>}
            {fixedCount > 0 && !busy && <p className="wb-note" data-fixed={fixedCount}>{t("fixedNote", { n: fixedCount })}</p>}
            {!busy && layout && layout.nodes.length > 0 && <p className="wb-note">{t("againHint")}</p>}
          </>
        )}
        {prepared && (ls.lesson || imported) && !busy && !canvasOpen && (
          <form className="wb-ask" onSubmit={onFollow}>
            <label className="wb-field">
              {t("followLabel")}
              <input type="text" value={follow} maxLength={LIMITS.question} placeholder={t("followPlaceholder")} onChange={(e) => setFollow(e.target.value)} autoComplete="off" disabled={editing} />
            </label>
            <button type="submit" className="wb-btn" disabled={!follow.trim() || editing}>{t("followSend")}</button>
          </form>
        )}
      </section>

      {notice && <OutboundNoticeModal key={`${notice.kind}:${notice.recipient.id}`} notice={notice} t={okfT} more={`${t("noticeScope")} ${okfT("noticeRemember")}`} onDecide={(d) => void out.decide(d)} />}
    </main>
  );
}
