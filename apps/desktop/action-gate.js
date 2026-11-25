// Filow's grant gate for X-14 Computer Use (bound per N-04: user, target window, action, payload, turn).
// Decides every step BEFORE any input is sent to any app.
const crypto = require("node:crypto");

const GRANT_TTL_MS = 120_000;

const HARD_DENY_CATEGORIES = new Set([
  "own_window",
  "elevated_target",
  "password_field",
  "target_changed",
  "model_blocked",
  "invalid_binding",
]);

const RISKY_PATTERNS = [
  {
    category: "payment",
    pattern: /\b(pay\s*now|payment|checkout|purchase|buy\s*now|place\s*order|complete\s*order|credit\s*card|debit\s*card|cvv|billing|wire\s*transfer|send\s*money|donate\s*now|stripe|paypal)\b/i,
  },
  {
    category: "account_creation",
    pattern: /\b(create\s*(an?\s*)?account|sign\s*up|signup|register\s*(now|account)?|new\s*account|join\s*now|create\s*profile)\b/i,
  },
  {
    category: "terms_acceptance",
    pattern: /\b(terms\s*of\s*(service|use)|privacy\s*policy|accept\s*(all\s*)?(terms|cookies|agreement)|i\s*agree|cookie\s*consent|eula|end\s*user\s*license|legal\s*agreement)\b/i,
  },
  {
    category: "sending_message",
    pattern: /\b(send\s*(email|e-mail|message|mail|chat|reply|sms|dm)|compose\s*email|post\s*(comment|reply|message|tweet)|publish\s*post|submit\s*comment)\b/i,
  },
];

const PASSWORD_PATTERN = /\b(password|passcode|passphrase|pin\s*code|one-time\s*code|otp|2fa|mfa\s*code|secret\s*key)\b/i;

function payloadDigest(action) {
  const canonical = JSON.stringify({
    name: action?.name || "",
    args: action?.args || {},
  });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

/** Find any UIA element covering the target normalized coordinates (x, y). */
function elementAtCoords(action, elements) {
  if (!Array.isArray(elements) || !action?.args) return null;
  const x = typeof action.args.x === "number" ? action.args.x : null;
  const y = typeof action.args.y === "number" ? action.args.y : null;
  if (x === null || y === null) return null;
  // Prefer smallest enclosing element (most specific control)
  let best = null;
  let bestArea = Infinity;
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    if (x >= el.x1 && x <= el.x2 && y >= el.y1 && y <= el.y2) {
      const area = (el.x2 - el.x1) * (el.y2 - el.y1);
      if (area < bestArea) {
        bestArea = area;
        best = el;
      }
    }
  }
  return best;
}

/**
 * Evaluates whether a single proposed step may run.
 * Always refuses (hard deny, confirmable: false):
 *   - Filow's own window
 *   - Elevated / administrator targets
 *   - Password fields
 *   - Target window changed since binding
 *   - Model safety_decision === "blocked"
 * Always refuses unless the user explicitly confirmed this exact step (requiresConfirmation: true):
 *   - Payment / checkout
 *   - Account creation
 *   - Terms acceptance
 *   - Sending messages
 *   - Model safety_decision === "require_confirmation"
 */
function evaluateActionGate({ binding, target, action, elements = [], confirmedGrant = null, now = Date.now() }) {
  if (!binding || !binding.userId || !binding.turnId || !binding.targetHwnd || !binding.snapshotId) {
    return { allowed: false, confirmable: false, requiresConfirmation: false, category: "invalid_binding", reason: "Missing N-04 binding fields" };
  }
  if (!target || typeof target !== "object") {
    return { allowed: false, confirmable: false, requiresConfirmation: false, category: "target_changed", reason: "Target window unavailable" };
  }
  if (target.own === true || /^filow(\.exe)?$/i.test(String(target.exe || ""))) {
    return { allowed: false, confirmable: false, requiresConfirmation: false, category: "own_window", reason: "Filow never automates its own window" };
  }
  if (target.elevated === true) {
    return { allowed: false, confirmable: false, requiresConfirmation: false, category: "elevated_target", reason: "Target window is elevated (administrator)" };
  }
  if (Number(target.hwnd) !== Number(binding.targetHwnd)) {
    return { allowed: false, confirmable: false, requiresConfirmation: false, category: "target_changed", reason: "Target window changed since capture" };
  }

  const hitEl = elementAtCoords(action, elements);
  const focused = target.focusedElement || {};
  if (
    target.password === true ||
    focused.isPassword === true ||
    hitEl?.isPassword === true ||
    PASSWORD_PATTERN.test(String(focused.name || "")) ||
    PASSWORD_PATTERN.test(String(hitEl?.name || "")) ||
    PASSWORD_PATTERN.test(String(action?.intent || ""))
  ) {
    return { allowed: false, confirmable: false, requiresConfirmation: false, category: "password_field", reason: "Password or credential field is never automated" };
  }

  const safety = action?.safetyDecision || null;
  if (safety && safety.decision === "blocked") {
    return { allowed: false, confirmable: false, requiresConfirmation: false, category: "model_blocked", reason: safety.explanation || "Blocked by safety policy" };
  }

  const digest = payloadDigest(action);
  const checkConfirmed = () => {
    if (!confirmedGrant || typeof confirmedGrant !== "object") return false;
    if (confirmedGrant.consumed === true) return false;
    if (confirmedGrant.clicked !== true) return false;
    if (Number.isFinite(confirmedGrant.expiresAt) && now > confirmedGrant.expiresAt) return false;
    return (
      confirmedGrant.userId === binding.userId &&
      confirmedGrant.turnId === binding.turnId &&
      Number(confirmedGrant.targetHwnd) === Number(binding.targetHwnd) &&
      confirmedGrant.snapshotId === binding.snapshotId &&
      confirmedGrant.action === action?.name &&
      confirmedGrant.payloadHash === digest
    );
  };

  // Model explicitly asked for confirmation
  if (safety && safety.decision === "require_confirmation") {
    if (checkConfirmed()) {
      return { allowed: true, confirmable: true, requiresConfirmation: true, category: "model_require_confirmation", safetyAcknowledgement: true, payloadHash: digest };
    }
    return {
      allowed: false,
      confirmable: true,
      requiresConfirmation: true,
      category: "model_require_confirmation",
      reason: safety.explanation || "Model requested user confirmation for this step",
      explanation: safety.explanation || "",
      payloadHash: digest,
    };
  }

  // Independent Filow policy inspection of title, focused control, clicked element, intent, and text
  const textPool = [
    target.title || "",
    focused.name || "",
    hitEl?.name || "",
    action?.intent || "",
    action?.args?.text || "",
  ].join(" \n ");

  for (const rule of RISKY_PATTERNS) {
    if (rule.pattern.test(textPool)) {
      if (checkConfirmed()) {
        return { allowed: true, confirmable: true, requiresConfirmation: true, category: rule.category, safetyAcknowledgement: false, payloadHash: digest };
      }
      return {
        allowed: false,
        confirmable: true,
        requiresConfirmation: true,
        category: rule.category,
        reason: `Step matches protected category: ${rule.category}`,
        explanation: action?.intent || `Confirm ${rule.category.replace(/_/g, " ")} step`,
        payloadHash: digest,
      };
    }
  }

  return { allowed: true, confirmable: false, requiresConfirmation: false, category: "allowed", safetyAcknowledgement: false, payloadHash: digest };
}

function createStepGrant({ binding, action, clicked, now = Date.now() }) {
  return {
    id: crypto.randomUUID(),
    userId: binding.userId,
    turnId: binding.turnId,
    targetHwnd: Number(binding.targetHwnd),
    snapshotId: binding.snapshotId,
    action: action.name,
    payloadHash: payloadDigest(action),
    clicked: clicked === true,
    consumed: false,
    expiresAt: now + GRANT_TTL_MS,
  };
}

function consumeStepGrant(grant) {
  if (!grant || grant.consumed) return false;
  grant.consumed = true;
  return true;
}

module.exports = {
  GRANT_TTL_MS,
  HARD_DENY_CATEGORIES,
  payloadDigest,
  elementAtCoords,
  evaluateActionGate,
  createStepGrant,
  consumeStepGrant,
};
