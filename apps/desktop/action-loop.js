// Filow Computer Use execution loop and controller (X-14 pilot).
// Connects Gemini Computer Use planner -> Filow's N-04 grant gate -> Filow's ActionDriver.
// Enforces consent, offline refusal, step/time caps, immediate Stop, and log sanitization.
const crypto = require("node:crypto");
const { snapAction } = require("./action-driver");
const grantGate = require("./action-gate");
const { evaluateActionGate, createStepGrant } = grantGate;
const { QuotaOrBillingError } = require("./gemini-cu-planner");

const DEFAULT_MAX_STEPS = 12;
const HARD_MAX_STEPS = 25;
const DEFAULT_MAX_DURATION_MS = 90_000;

/**
 * Removes base64 screenshots, data URLs, and API keys before any metadata touches logs.
 */
function sanitizeString(s) {
  return String(s ?? "")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "<screenshot-omitted>")
    .replace(/\b(iVBORw0KGgo|\/9j\/)[A-Za-z0-9+/=]{16,}/g, "<screenshot-omitted>")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "<key-redacted>")
    .replace(/(x-goog-api-key|GOOGLE_GEMINI_API_KEY|ORGO_API_KEY|authorization)(["']?\s*[:=]\s*["']?)(bearer\s+)?[^\s"',}]+/gi, "$1$2$3<secret>");
}

function sanitizeActionLog(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeActionLog);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/^(screenshot|pngBase64|image|images|data|dataUrl|apiKey|x-goog-api-key)$/i.test(k)) {
      out[k] = "<omitted>";
      continue;
    }
    out[k] = sanitizeActionLog(v);
  }
  return out;
}

function createComputerUseController({ planner, driver, logLine = () => {}, onState = () => {}, onOutbound = () => {} }) {
  let active = null;
  let generation = 0;

  function log(event, fields = {}) {
    const clean = sanitizeActionLog({ event, ...fields });
    logLine(`computer-use: ${JSON.stringify(clean)}`);
  }

  function stop(reason = "user_stop") {
    generation++;
    if (!active) return false;
    const current = active;
    current.stopped = true;
    current.stopReason = reason;
    try { current.abort.abort(); } catch {}
    if (typeof current.cancelConfirm === "function") {
      try { current.cancelConfirm(); } catch {}
    }
    try { driver.abort?.(); } catch {}
    log("stopped", { turnId: current.turnId, reason });
    onState({ active: false, mode: "idle", stopped: true, intent: "" });
    return true;
  }

  async function run(opts) {
    const {
      task,
      userId = "presenter",
      targetHwnd,
      enabled = false,
      offline = false,
      consentGranted = false,
      maxSteps = DEFAULT_MAX_STEPS,
      maxDurationMs = DEFAULT_MAX_DURATION_MS,
      confirmStep = null,
      excludedPredefinedFunctions,
      customFunctions,
    } = opts || {};

    if (!enabled) return { ok: false, reason: "disabled", steps: 0, wrongActions: 0, refusals: [], effectAfterStop: 0, bytesSent: 0 };
    if (offline) return { ok: false, reason: "offline_mode", steps: 0, wrongActions: 0, refusals: [], effectAfterStop: 0, bytesSent: 0 };
    if (!consentGranted) return { ok: false, reason: "consent_required", steps: 0, wrongActions: 0, refusals: [], effectAfterStop: 0, bytesSent: 0 };
    if (!task || !String(task).trim()) return { ok: false, reason: "empty_task", steps: 0, wrongActions: 0, refusals: [], effectAfterStop: 0, bytesSent: 0 };

    if (active) stop("superseded");
    const myGen = ++generation;
    const turnId = crypto.randomUUID();
    const abort = new AbortController();
    const startedAt = Date.now();
    const stepCap = Math.max(1, Math.min(HARD_MAX_STEPS, Number(maxSteps) || DEFAULT_MAX_STEPS));
    const timeCap = Math.max(1000, Number(maxDurationMs) || DEFAULT_MAX_DURATION_MS);

    const runState = { turnId, abort, stopped: false, stopReason: "", cancelConfirm: null };
    active = runState;

    const metrics = {
      steps: 0,
      wrongActions: 0,
      refusals: [],
      effectAfterStop: 0,
      bytesSent: 0,
      modelLatenciesMs: [],
      driverLatenciesMs: [],
      interactionId: "",
      finalText: "",
    };

    const isStopped = () => runState.stopped || abort.signal.aborted || generation !== myGen;
    const outId = `cu:${turnId}`;

    try {
      log("start", { turnId, task: String(task).slice(0, 120), targetHwnd });

      // Inspect target BEFORE capturing or sending anything outside.
      const initialTarget = await driver.inspectTarget(targetHwnd);
      if (isStopped()) return { ok: false, reason: "stopped", ...metrics };
      if (!initialTarget || initialTarget.ok === false || !initialTarget.hwnd) {
        return { ok: false, reason: "no_target_window", ...metrics };
      }
      if (initialTarget.own === true) {
        metrics.refusals.push({ step: 0, category: "own_window" });
        return { ok: false, reason: "own_window", ...metrics };
      }
      if (initialTarget.elevated === true) {
        metrics.refusals.push({ step: 0, category: "elevated_target" });
        return { ok: false, reason: "elevated_target", ...metrics };
      }
      if (initialTarget.password === true || initialTarget.hasPasswordField === true) {
        metrics.refusals.push({ step: 0, category: "password_field" });
        return { ok: false, reason: "password_field", ...metrics };
      }

      const boundHwnd = Number(initialTarget.hwnd);
      if (opts.restoreFocusAtStart) {
        const focused = await driver.focusTarget(boundHwnd);
        if (isStopped()) return { ok: false, reason: "stopped", ...metrics };
        if (!focused?.ok) return { ok: false, reason: "target_not_foreground", ...metrics };
      }
      let shot = await driver.captureTarget(boundHwnd, { maxWidth: 1280 });
      if (isStopped()) return { ok: false, reason: "stopped", ...metrics };
      if (Array.isArray(shot.elements) && shot.elements.some((e) => e && e.isPassword === true)) {
        metrics.refusals.push({ step: 0, category: "password_field" });
        return { ok: false, reason: "password_field", ...metrics };
      }

      onState({ active: true, mode: "acting", intent: String(task).slice(0, 120), step: 0, maxSteps: stepCap, targetExe: initialTarget.exe || "" });

      // Initial planner call
      onOutbound("begin", outId);
      let plan;
      try {
        const t0 = Date.now();
        plan = await planner.start({
          task,
          screenshotBase64: shot.pngBase64,
          mimeType: "image/png",
          excludedPredefinedFunctions,
          customFunctions,
        }, abort.signal);
        metrics.modelLatenciesMs.push(Number.isFinite(plan?.latencyMs) ? plan.latencyMs : Date.now() - t0);
      } finally {
        onOutbound("end", outId);
      }

      if (isStopped()) return { ok: false, reason: "stopped", ...metrics };
      metrics.bytesSent += Number(plan?.bytesSent) || 0;
      if (!plan || !plan.ok) {
        log("planner_error", { turnId, error: plan?.error || "planner_failed" });
        return { ok: false, reason: plan?.error || "planner_failed", ...metrics };
      }
      metrics.interactionId = plan.interactionId;

      while (true) {
        if (isStopped()) return { ok: false, reason: "stopped", ...metrics };
        if (Date.now() - startedAt > timeCap) {
          log("time_cap", { turnId, steps: metrics.steps });
          return { ok: false, reason: "time_cap", ...metrics };
        }

        if (!plan.calls || plan.calls.length === 0) {
          metrics.finalText = plan.text || "";
          const readback = await driver.readBack(boundHwnd).catch(() => null);
          log("done", { turnId, steps: metrics.steps, bytesSent: metrics.bytesSent });
          return { ok: true, reason: "completed", readback, ...metrics };
        }

        if (metrics.steps >= stepCap) {
          log("step_cap", { turnId, steps: metrics.steps });
          return { ok: false, reason: "step_cap", ...metrics };
        }

        // Execute one step at a time (one UI action per step, gated before every dispatch).
        if (plan.calls.length !== 1) return { ok: false, reason: "multiple_function_calls", ...metrics };
        const call = snapAction(plan.calls[0], shot.elements);
        metrics.steps += 1;
        onState({
          active: true,
          mode: "acting",
          intent: call.intent || `${call.name}`,
          step: metrics.steps,
          maxSteps: stepCap,
          targetExe: initialTarget.exe || "",
        });

        // Re-inspect live target immediately before gate check
        const liveTarget = await driver.inspectTarget(boundHwnd);
        if (isStopped()) return { ok: false, reason: "stopped", ...metrics };

        const binding = { userId, turnId, targetHwnd: boundHwnd, snapshotId: shot.snapshotId, bounds: shot.bounds };
        let gate = evaluateActionGate({ binding, target: liveTarget, action: call, elements: shot.elements });
        let grant = null;
        let safetyAck = false;

        if (!gate.allowed && gate.requiresConfirmation && gate.confirmable) {
          if (typeof confirmStep !== "function") {
            metrics.refusals.push({ step: metrics.steps, category: gate.category, action: call.name });
            log("refused", { turnId, step: metrics.steps, category: gate.category, action: call.name });
            return { ok: false, reason: "confirmation_declined", category: gate.category, ...metrics };
          }
          const nonce = crypto.randomUUID();
          const confirmPromise = new Promise((resolve) => {
            runState.cancelConfirm = () => resolve({ confirmed: false, clicked: false });
            Promise.resolve(confirmStep({
              nonce,
              turnId,
              step: metrics.steps,
              category: gate.category,
              explanation: gate.explanation || call.safetyDecision?.explanation || gate.reason,
              intent: call.intent || "",
              action: call.name,
              targetExe: liveTarget.exe || "",
              targetTitle: liveTarget.title || "",
            })).then(resolve, () => resolve({ confirmed: false, clicked: false }));
          });
          const userAnswer = await confirmPromise;
          runState.cancelConfirm = null;
          if (isStopped()) return { ok: false, reason: "stopped", ...metrics };

          const validClick = Boolean(
            userAnswer &&
            userAnswer.confirmed === true &&
            userAnswer.clicked === true &&
            userAnswer.nonce === nonce
          );
          if (!validClick) {
            metrics.refusals.push({ step: metrics.steps, category: gate.category, action: call.name });
            log("confirmation_declined", { turnId, step: metrics.steps, category: gate.category, action: call.name });
            return { ok: false, reason: "confirmation_declined", category: gate.category, ...metrics };
          }

          const focused = await driver.focusTarget(boundHwnd);
          if (isStopped()) return { ok: false, reason: "stopped", ...metrics };
          if (!focused?.ok) return { ok: false, reason: "target_not_foreground", ...metrics };

          // Re-inspect target after confirmation to prevent TOCTOU target switch!
          const postConfirmTarget = await driver.inspectTarget(boundHwnd);
          if (isStopped()) return { ok: false, reason: "stopped", ...metrics };
          grant = createStepGrant({ binding, action: call, clicked: true });
          gate = evaluateActionGate({ binding, target: postConfirmTarget, action: call, elements: shot.elements, confirmedGrant: grant });
          if (!gate.allowed) {
            metrics.refusals.push({ step: metrics.steps, category: gate.category, action: call.name });
            log("refused_after_confirm", { turnId, step: metrics.steps, category: gate.category });
            return { ok: false, reason: gate.category, category: gate.category, ...metrics };
          }
          safetyAck = Boolean(gate.safetyAcknowledgement);
        } else if (!gate.allowed) {
          metrics.refusals.push({ step: metrics.steps, category: gate.category, action: call.name });
          log("refused", { turnId, step: metrics.steps, category: gate.category, action: call.name });
          return { ok: false, reason: gate.category, category: gate.category, ...metrics };
        }

        // Consume single-use grant if one was created, and double-check Stop right before input!
        if (grant && !grantGate.consumeStepGrant(grant)) {
          return { ok: false, reason: "grant_reused", ...metrics };
        }
        if (isStopped()) return { ok: false, reason: "stopped", ...metrics };

        const d0 = Date.now();
        const execRes = await driver.execute(call, {
          hwnd: boundHwnd,
          targetRect: shot.bounds,
          snapshotId: shot.snapshotId,
          signal: abort.signal,
        });
        const driverMs = Number.isFinite(execRes?.latencyMs) ? execRes.latencyMs : Date.now() - d0;
        metrics.driverLatenciesMs.push(driverMs);

        if (isStopped()) return { ok: false, reason: "stopped", ...metrics };

        if (execRes?.refused) {
          metrics.refusals.push({ step: metrics.steps, category: execRes.reason, action: call.name });
          return { ok: false, reason: execRes.reason, ...metrics };
        }

        log("executed", {
          turnId,
          step: metrics.steps,
          action: call.name,
          ok: Boolean(execRes?.ok),
          driverMs,
          safetyAck,
        });

        // Fresh screenshot of target window ONLY before next turn
        shot = await driver.captureTarget(boundHwnd, { maxWidth: 1280 });
        if (isStopped()) return { ok: false, reason: "stopped", ...metrics };

        onOutbound("begin", outId);
        try {
          const m0 = Date.now();
          plan = await planner.continueWithResult({
            previousInteractionId: metrics.interactionId,
            callId: call.id,
            name: call.name,
            screenshotBase64: shot.pngBase64,
            mimeType: "image/png",
            resultMeta: execRes?.ok ? { status: "ok" } : { error: execRes?.reason || "exec_failed" },
            safetyAcknowledgement: safetyAck,
            excludedPredefinedFunctions,
            customFunctions,
          }, abort.signal);
          metrics.modelLatenciesMs.push(Number.isFinite(plan?.latencyMs) ? plan.latencyMs : Date.now() - m0);
        } finally {
          onOutbound("end", outId);
        }

        if (isStopped()) return { ok: false, reason: "stopped", ...metrics };
        metrics.bytesSent += Number(plan?.bytesSent) || 0;
        if (!plan || !plan.ok) {
          log("planner_error", { turnId, step: metrics.steps, error: plan?.error || "planner_failed" });
          return { ok: false, reason: plan?.error || "planner_failed", ...metrics };
        }
        metrics.interactionId = plan.interactionId;
      }
    } catch (err) {
      if (isStopped() || err?.name === "AbortError") {
        return { ok: false, reason: "stopped", ...metrics };
      }
      if (err instanceof QuotaOrBillingError) {
        log("quota_or_billing", { turnId, status: err.status });
        return { ok: false, reason: "quota_or_billing", error: err.message, ...metrics };
      }
      log("error", { turnId, error: sanitizeString(err?.message || String(err)) });
      return { ok: false, reason: "error", error: sanitizeString(err?.message || String(err)), ...metrics };
    } finally {
      if (active === runState) {
        driver.finishTurn?.();
        active = null;
        onState({ active: false, mode: "idle", stopped: runState.stopped, intent: "" });
      }
    }
  }

  return {
    run,
    stop,
    active: () => active !== null,
  };
}

function runComputerUseTask(opts) {
  const controller = createComputerUseController({
    planner: opts.planner,
    driver: opts.driver,
    logLine: opts.logLine,
    onState: opts.onState,
    onOutbound: opts.onOutbound,
  });
  return controller.run(opts);
}

module.exports = {
  DEFAULT_MAX_STEPS,
  HARD_MAX_STEPS,
  DEFAULT_MAX_DURATION_MS,
  sanitizeString,
  sanitizeActionLog,
  createComputerUseController,
  runComputerUseTask,
};
