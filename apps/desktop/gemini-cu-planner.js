// Gemini Computer Use planner adapter (X-14 pilot).
// Builds Interactions API requests, parses and strictly validates function_call responses,
// tracks interaction_id and bytesSent, and sends screenshots back with safety_acknowledgement
// ONLY when explicitly confirmed by a user click. Never executes any UI action itself.
// Reference loop studied: google-gemini/computer-use-preview (Apache-2.0, commit 77c9797e943aad63bbc963b7fd092a9e51c07863).

const { SUPPORTED_DESKTOP_ACTIONS, COORD_MIN, COORD_MAX } = require("./action-driver");

const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL = "gemini-4-hydrogen";
// Free-tier models documented on ai.google.dev/gemini-api/docs/pricing + computer-use.
const FREE_TIER_CU_MODELS = new Set([
  "gemini-4-hydrogen",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3-flash-preview",
]);

const VALID_DIRECTIONS = new Set(["up", "down", "left", "right"]);
const VALID_SAFETY_DECISIONS = new Set(["allowed", "require_confirmation", "blocked"]);

const PROGRESS_INSTRUCTION = "Inspect the current screenshot before each action. Never send an input that does not advance the task. Skip clearing an already empty field. If the required starting state is absent and recovery would violate the instructions, stop.";
const SYSTEM_INSTRUCTION = [
  PROGRESS_INSTRUCTION,
  "You are Filow's desktop UI planner acting on ONE target application window.",
  "Every coordinate is normalized 0-999 relative to the provided target window screenshot.",
  "Propose at most one clear desktop action per turn with a short plain-language intent.",
  "NEVER click or type into password fields, payment or checkout buttons, account creation forms, legal terms acceptance, or send-message buttons without triggering user confirmation.",
  "When the user's goal is completely done and verified on screen, respond with a short text summary and NO function_call.",
].join("\n");

class QuotaOrBillingError extends Error {
  constructor(status, message) {
    super(message || `Gemini quota or billing limit reached (HTTP ${status})`);
    this.name = "QuotaOrBillingError";
    this.status = status;
  }
}

function isCoord(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= COORD_MIN && v <= COORD_MAX;
}

function validateSafetyDecision(raw) {
  if (raw === undefined) return { ok: true, value: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "malformed_safety_decision" };
  }
  if (typeof raw.decision !== "string" || !VALID_SAFETY_DECISIONS.has(raw.decision)) {
    return { ok: false, error: "invalid_safety_decision" };
  }
  const explanation = typeof raw.explanation === "string" ? raw.explanation.slice(0, 600) : "";
  return { ok: true, value: { decision: raw.decision, explanation } };
}

function validateDesktopCall(step) {
  if (!step || typeof step !== "object") return { ok: false, error: "malformed_step" };
  const id = typeof step.id === "string" && step.id.trim()
    ? step.id.trim()
    : (typeof step.call_id === "string" && step.call_id.trim() ? step.call_id.trim() : "");
  const name = typeof step.name === "string" ? step.name.trim() : "";
  const rawArgs = step.arguments !== undefined ? step.arguments : step.args;
  if (!id) return { ok: false, error: "missing_call_id" };
  if (!name || !SUPPORTED_DESKTOP_ACTIONS.has(name)) return { ok: false, error: `unsupported_function:${name || "empty"}` };
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) return { ok: false, error: "malformed_arguments" };

  const safetyCheck = validateSafetyDecision(rawArgs.safety_decision);
  if (!safetyCheck.ok) return safetyCheck;

  const intent = typeof rawArgs.intent === "string" ? rawArgs.intent.trim().slice(0, 240) : "";
  const args = {};

  if (["click", "double_click", "triple_click", "middle_click", "right_click", "mouse_down", "mouse_up", "move"].includes(name)) {
    if (!isCoord(rawArgs.x) || !isCoord(rawArgs.y)) return { ok: false, error: "invalid_coordinates" };
    args.x = rawArgs.x;
    args.y = rawArgs.y;
  } else if (name === "type") {
    if (typeof rawArgs.text !== "string" || rawArgs.text.length === 0 || rawArgs.text.length > 4000) {
      return { ok: false, error: "invalid_type_text" };
    }
    args.text = rawArgs.text;
    args.press_enter = rawArgs.press_enter === true;
    if (rawArgs.x !== undefined || rawArgs.y !== undefined) {
      if (!isCoord(rawArgs.x) || !isCoord(rawArgs.y)) return { ok: false, error: "invalid_type_coordinates" };
      args.x = rawArgs.x;
      args.y = rawArgs.y;
    }
  } else if (name === "drag_and_drop") {
    const sx = rawArgs.start_x !== undefined ? rawArgs.start_x : rawArgs.x;
    const sy = rawArgs.start_y !== undefined ? rawArgs.start_y : rawArgs.y;
    const ex = rawArgs.end_x !== undefined ? rawArgs.end_x : rawArgs.destination_x;
    const ey = rawArgs.end_y !== undefined ? rawArgs.end_y : rawArgs.destination_y;
    if (!isCoord(sx) || !isCoord(sy) || !isCoord(ex) || !isCoord(ey)) {
      return { ok: false, error: "invalid_drag_coordinates" };
    }
    args.start_x = sx;
    args.start_y = sy;
    args.end_x = ex;
    args.end_y = ey;
  } else if (name === "scroll") {
    if (!isCoord(rawArgs.x) || !isCoord(rawArgs.y)) return { ok: false, error: "invalid_scroll_coordinates" };
    if (typeof rawArgs.direction !== "string" || !VALID_DIRECTIONS.has(rawArgs.direction)) {
      return { ok: false, error: "invalid_scroll_direction" };
    }
    args.x = rawArgs.x;
    args.y = rawArgs.y;
    args.direction = rawArgs.direction;
    const mag = rawArgs.magnitude_in_pixels !== undefined ? rawArgs.magnitude_in_pixels : rawArgs.magnitude;
    if (mag !== undefined) {
      if (typeof mag !== "number" || !Number.isFinite(mag) || mag < 1 || mag > 2000) {
        return { ok: false, error: "invalid_scroll_magnitude" };
      }
      args.magnitude_in_pixels = mag;
    }
  } else if (name === "wait") {
    const sec = rawArgs.seconds !== undefined ? rawArgs.seconds : 1;
    if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0 || sec > 30) {
      return { ok: false, error: "invalid_wait_seconds" };
    }
    args.seconds = sec;
  } else if (name === "press_key" || name === "key_down" || name === "key_up") {
    if (typeof rawArgs.key !== "string" || !rawArgs.key.trim() || rawArgs.key.length > 40) {
      return { ok: false, error: "invalid_key" };
    }
    args.key = rawArgs.key.trim();
  } else if (name === "hotkey") {
    if (!Array.isArray(rawArgs.keys) || rawArgs.keys.length === 0 || rawArgs.keys.length > 6 || rawArgs.keys.some((k) => typeof k !== "string" || !k.trim() || k.length > 40)) {
      return { ok: false, error: "invalid_hotkey_keys" };
    }
    args.keys = rawArgs.keys.map((k) => k.trim());
  } else if (name === "take_screenshot") {
    // no required args
  }

  return {
    ok: true,
    call: {
      id,
      name,
      args,
      intent,
      safetyDecision: safetyCheck.value,
    },
  };
}

/**
 * Parses and strictly validates an Interactions API response.
 * Rejects any malformed payload or malformed function call.
 */
function parseInteractionResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "malformed_response" };
  }
  const interactionId = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
  if (!interactionId) return { ok: false, error: "missing_interaction_id" };
  const steps = Array.isArray(raw.steps) ? raw.steps : (Array.isArray(raw.outputs) ? raw.outputs : null);
  if (!steps) return { ok: false, error: "missing_steps" };

  const calls = [];
  const texts = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    if (step.type === "function_call") {
      const checked = validateDesktopCall(step);
      if (!checked.ok) return { ok: false, error: checked.error, interactionId };
      calls.push(checked.call);
    } else if (step.type === "model_output" && Array.isArray(step.content)) {
      for (const block of step.content) {
        if (block && block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          texts.push(block.text.trim());
        }
      }
    } else if (step.type === "text" && typeof step.text === "string" && step.text.trim()) {
      texts.push(step.text.trim());
    }
  }

  return {
    ok: true,
    interactionId,
    calls,
    text: texts.join(" ").trim(),
    usage: raw.usage && typeof raw.usage === "object" ? raw.usage : null,
  };
}

function buildTools({ excludedPredefinedFunctions = [], customFunctions = [] } = {}) {
  const cu = {
    type: "computer_use",
    environment: "desktop",
    enable_prompt_injection_detection: true,
    ...(Array.isArray(excludedPredefinedFunctions) && excludedPredefinedFunctions.length
      ? { excluded_predefined_functions: excludedPredefinedFunctions }
      : {}),
  };
  return [cu, ...(Array.isArray(customFunctions) ? customFunctions : [])];
}

function buildInitialRequest({ model = DEFAULT_MODEL, task, screenshotBase64, mimeType = "image/png", systemInstruction = SYSTEM_INSTRUCTION, excludedPredefinedFunctions, customFunctions }) {
  return {
    model,
    system_instruction: systemInstruction,
    input: [
      { type: "text", text: String(task || "") },
      { type: "image", data: String(screenshotBase64 || ""), mime_type: mimeType },
    ],
    tools: buildTools({ excludedPredefinedFunctions, customFunctions }),
  };
}

function buildFollowUpRequest({ model = DEFAULT_MODEL, previousInteractionId, callId, name, screenshotBase64, mimeType = "image/png", resultMeta = {}, safetyAcknowledgement = false, excludedPredefinedFunctions, customFunctions }) {
  const meta = { ...(resultMeta && typeof resultMeta === "object" ? resultMeta : {}) };
  // Never set safety_acknowledgement unless explicitly true from a verified user click.
  if (safetyAcknowledgement === true) meta.safety_acknowledgement = true;
  else delete meta.safety_acknowledgement;

  return {
    model,
    previous_interaction_id: previousInteractionId,
    input: [
      {
        type: "function_result",
        name,
        call_id: callId,
        result: [
          { type: "text", text: JSON.stringify(meta) },
          { type: "image", data: String(screenshotBase64 || ""), mime_type: mimeType },
        ],
      },
    ],
    tools: buildTools({ excludedPredefinedFunctions, customFunctions }),
  };
}

function resolveFreeTierModel(requested) {
  const chosen = String(requested || process.env.GEMINI_CU_MODEL || DEFAULT_MODEL).trim();
  if (!FREE_TIER_CU_MODELS.has(chosen)) {
    throw new QuotaOrBillingError(402, `Model "${chosen}" is not on the free tier allowlist`);
  }
  return chosen;
}

/**
 * Creates the Gemini Computer Use planner adapter.
 * Reads API key from `apiKey` or `process.env.GOOGLE_GEMINI_API_KEY`. Never logs or prints keys.
 */
function createGeminiPlanner(opts = {}) {
  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const fetchImpl = opts.fetch || globalThis.fetch;
  const model = resolveFreeTierModel(opts.model);
  const getKey = () => String(typeof opts.apiKey === "function" ? opts.apiKey() : (opts.apiKey ?? process.env.GOOGLE_GEMINI_API_KEY ?? "")).trim();

  async function postInteraction(bodyObj, signal) {
    const key = getKey();
    if (!key) throw new Error("GOOGLE_GEMINI_API_KEY is missing");
    const serialized = JSON.stringify(bodyObj);
    const bytesSent = Buffer.byteLength(serialized, "utf8");
    const t0 = Date.now();
    const res = await fetchImpl(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: serialized,
    });
    const latencyMs = Date.now() - t0;
    const rawText = await res.text();
    if (res.status === 402 || res.status === 429 || (res.status === 403 && /quota|billing|payment|limit/i.test(rawText))) {
      throw new QuotaOrBillingError(res.status, `Gemini free-tier quota or billing refusal (HTTP ${res.status})`);
    }
    if (!res.ok) {
      // Never leak key; return concise status error only.
      let code = `http_${res.status}`;
      try {
        const parsedErr = JSON.parse(rawText);
        if (parsedErr?.error?.code) code = String(parsedErr.error.code);
      } catch {}
      throw new Error(`Gemini API error (${res.status}: ${code})`);
    }
    let json;
    try {
      json = JSON.parse(rawText);
    } catch {
      return { ok: false, error: "invalid_json", bytesSent, latencyMs };
    }
    const parsed = parseInteractionResponse(json);
    return { ...parsed, bytesSent, latencyMs };
  }

  return {
    model,
    start({ task, screenshotBase64, mimeType, excludedPredefinedFunctions, customFunctions }, signal) {
      const body = buildInitialRequest({ model, task, screenshotBase64, mimeType, excludedPredefinedFunctions, customFunctions });
      return postInteraction(body, signal);
    },
    continueWithResult({ previousInteractionId, callId, name, screenshotBase64, mimeType, resultMeta, safetyAcknowledgement, excludedPredefinedFunctions, customFunctions }, signal) {
      const body = buildFollowUpRequest({
        model,
        previousInteractionId,
        callId,
        name,
        screenshotBase64,
        mimeType,
        resultMeta,
        safetyAcknowledgement: safetyAcknowledgement === true,
        excludedPredefinedFunctions,
        customFunctions,
      });
      return postInteraction(body, signal);
    },
  };
}

module.exports = {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  FREE_TIER_CU_MODELS,
  SYSTEM_INSTRUCTION,
  PROGRESS_INSTRUCTION,
  QuotaOrBillingError,
  parseInteractionResponse,
  buildInitialRequest,
  buildFollowUpRequest,
  resolveFreeTierModel,
  createGeminiPlanner,
};
