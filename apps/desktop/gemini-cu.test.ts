import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

// Tests written before implementation (X-14 Gemini Computer Use pilot).
// Must fail on origin/main, then pass once implemented.

describe("X-14 Gemini Computer Use: coordinate mapping (DPI and multi-monitor)", () => {
  it("maps 0-999 normalized coordinates accurately at 100%, 125%, and 150% DPI", () => {
    const { mapNormalizedToPhysical, dipRectToPhysical } = require("./action-driver.js");

    // 100% DPI: 1920x1080 display, window at DIP (100, 50, 800x600)
    const win100 = dipRectToPhysical({ x: 100, y: 50, width: 800, height: 600 }, { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 });
    expect(win100).toEqual({ x: 100, y: 50, width: 800, height: 600 });
    expect(mapNormalizedToPhysical(500, 500, win100)).toEqual({ x: 500, y: 350 });

    // 125% DPI: 1920x1080 physical (1536x864 DIP), window at DIP (80, 40, 800x600) -> physical (100, 50, 1000x750)
    const win125 = dipRectToPhysical({ x: 80, y: 40, width: 800, height: 600 }, { bounds: { x: 0, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25 });
    expect(win125).toEqual({ x: 100, y: 50, width: 1000, height: 750 });
    expect(mapNormalizedToPhysical(500, 200, win125)).toEqual({ x: 600, y: 200 });

    // 150% DPI: 1920x1080 physical (1280x720 DIP), window at DIP (100, 60, 600x400) -> physical (150, 90, 900x600)
    const win150 = dipRectToPhysical({ x: 100, y: 60, width: 600, height: 400 }, { bounds: { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 });
    expect(win150).toEqual({ x: 150, y: 90, width: 900, height: 600 });
    expect(mapNormalizedToPhysical(999, 999, win150)).toEqual({ x: 1049, y: 689 });
    expect(mapNormalizedToPhysical(0, 0, win150)).toEqual({ x: 150, y: 90 });
  });

  it("maps coordinates across two monitors with negative offsets and mixed DPI to virtual SendInput space", () => {
    const { mapNormalizedToPhysical, dipRectToPhysical, physicalToVirtualAbsolute } = require("./action-driver.js");

    // Left secondary monitor at physical (-1920, 0, 1920x1080) @ 100%, primary at (0, 0, 2880x1620) @ 150%
    const leftMonitor = { bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, physicalOrigin: { x: -1920, y: 0 } };
    const winOnLeft = dipRectToPhysical({ x: -1820, y: 100, width: 1000, height: 800 }, leftMonitor);
    expect(winOnLeft).toEqual({ x: -1820, y: 100, width: 1000, height: 800 });

    const physLeft = mapNormalizedToPhysical(500, 500, winOnLeft);
    expect(physLeft).toEqual({ x: -1320, y: 500 });

    // Virtual desktop spans x: -1920..2880 (width 4800), y: 0..1620 (height 1620)
    const virtualScreen = { x: -1920, y: 0, width: 4800, height: 1620 };
    const absLeft = physicalToVirtualAbsolute(physLeft.x, physLeft.y, virtualScreen);
    expect(absLeft.dx).toBe(Math.round(((-1320 - -1920) * 65535) / 4799));
    expect(absLeft.dy).toBe(Math.round((500 * 65535) / 1619));

    // Right primary monitor @ 150% DPI
    const rightMonitor = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5, physicalOrigin: { x: 0, y: 0 } };
    const winOnRight = dipRectToPhysical({ x: 200, y: 100, width: 800, height: 600 }, rightMonitor);
    expect(winOnRight).toEqual({ x: 300, y: 150, width: 1200, height: 900 });
    const physRight = mapNormalizedToPhysical(250, 750, winOnRight);
    expect(physRight).toEqual({ x: 600, y: 825 });
  });

  it("rejects out-of-range coordinates and unsupported actions without guessing", async () => {
    const { mapNormalizedToPhysical, createActionDriver } = require("./action-driver.js");
    expect(() => mapNormalizedToPhysical(-1, 500, { x: 0, y: 0, width: 1000, height: 1000 })).toThrow();
    expect(() => mapNormalizedToPhysical(1000, 500, { x: 0, y: 0, width: 1000, height: 1000 })).toThrow();
    expect(() => mapNormalizedToPhysical(Number.NaN, 500, { x: 0, y: 0, width: 1000, height: 1000 })).toThrow();

    const sendSpy = vi.fn();
    const driver = createActionDriver({ sendCommand: sendSpy });
    const res = await driver.execute({ name: "teleport_window", args: { x: 100, y: 100 } }, { targetRect: { x: 0, y: 0, width: 1000, height: 1000 } });
    expect(res.ok).toBe(false);
    expect(res.refused).toBe(true);
    expect(res.reason).toBe("unsupported_action");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("X-14 Gemini Computer Use: parser validation", () => {
  it("parses valid desktop function calls, intent, interaction id, and safety_decision", () => {
    const { parseInteractionResponse } = require("./gemini-cu-planner.js");
    const parsed = parseInteractionResponse({
      id: "v1_interaction_abc",
      steps: [
        {
          type: "function_call",
          id: "call_1",
          name: "click",
          arguments: {
            x: 450,
            y: 220,
            intent: "Click the Save button",
            safety_decision: { decision: "require_confirmation", explanation: "Confirm saving file" },
          },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.interactionId).toBe("v1_interaction_abc");
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.calls[0]).toMatchObject({
      id: "call_1",
      name: "click",
      intent: "Click the Save button",
      args: { x: 450, y: 220 },
      safetyDecision: { decision: "require_confirmation", explanation: "Confirm saving file" },
    });
  });

  it("rejects malformed function calls across all invalid shapes", () => {
    const { parseInteractionResponse } = require("./gemini-cu-planner.js");
    const badPayloads = [
      null,
      {},
      { id: "i1", steps: [{ type: "function_call", id: "c1", name: "unknown_tool", arguments: {} }] },
      { id: "i1", steps: [{ type: "function_call", id: "", name: "click", arguments: { x: 10, y: 20 } }] },
      { id: "i1", steps: [{ type: "function_call", id: "c1", name: "click", arguments: { x: 1200, y: 20 } }] },
      { id: "i1", steps: [{ type: "function_call", id: "c1", name: "click", arguments: { x: -5, y: 20 } }] },
      { id: "i1", steps: [{ type: "function_call", id: "c1", name: "click", arguments: "not-an-object" }] },
      { id: "i1", steps: [{ type: "function_call", id: "c1", name: "type", arguments: { text: 123 } }] },
      { id: "i1", steps: [{ type: "function_call", id: "c1", name: "scroll", arguments: { x: 100, y: 100, direction: "diagonal" } }] },
      { id: "i1", steps: [{ type: "function_call", id: "c1", name: "hotkey", arguments: { keys: [] } }] },
      { id: "i1", steps: [{ type: "function_call", id: "c1", name: "drag_and_drop", arguments: { start_x: 10, start_y: 10 } }] },
      { id: "i1", steps: [{ type: "function_call", id: "c1", name: "click", arguments: { x: 10, y: 10, safety_decision: { decision: "auto_approve" } } }] },
    ];
    for (const payload of badPayloads) {
      const parsed = parseInteractionResponse(payload);
      expect(parsed.ok, `expected rejection for ${JSON.stringify(payload)}`).toBe(false);
    }
  });
});

describe("X-14 Gemini Computer Use: Filow grant gate refusals", () => {
  const baseTarget = {
    hwnd: 12345,
    pid: 4242,
    exe: "notepad.exe",
    cls: "Notepad",
    title: "Untitled - Notepad",
    own: false,
    elevated: false,
    password: false,
    bounds: { x: 0, y: 0, width: 1000, height: 700 },
    focusedElement: { name: "Text Editor", type: "Edit", isPassword: false },
  };
  const baseBinding = { userId: "presenter-1", turnId: "turn-1", targetHwnd: 12345, snapshotId: "snap-1" };

  it("refuses every forbidden or risky category without confirmation", () => {
    const { evaluateActionGate } = require("./action-gate.js");

    // 1. Filow's own window (hard deny)
    const own = evaluateActionGate({
      binding: baseBinding,
      target: { ...baseTarget, own: true, exe: "Filow.exe" },
      action: { id: "c1", name: "click", args: { x: 100, y: 100 }, intent: "Click button" },
    });
    expect(own.allowed).toBe(false);
    expect(own.category).toBe("own_window");
    expect(own.confirmable).toBe(false);

    // 2. Elevated target (hard deny)
    const elevated = evaluateActionGate({
      binding: baseBinding,
      target: { ...baseTarget, elevated: true, exe: "cmd.exe" },
      action: { id: "c1", name: "click", args: { x: 100, y: 100 }, intent: "Click admin window" },
    });
    expect(elevated.allowed).toBe(false);
    expect(elevated.category).toBe("elevated_target");
    expect(elevated.confirmable).toBe(false);

    // 3. Password field (hard deny)
    const password = evaluateActionGate({
      binding: baseBinding,
      target: { ...baseTarget, password: true, focusedElement: { name: "Password", type: "Edit", isPassword: true } },
      action: { id: "c1", name: "type", args: { text: "secret123" }, intent: "Enter password" },
    });
    expect(password.allowed).toBe(false);
    expect(password.category).toBe("password_field");
    expect(password.confirmable).toBe(false);

    // 4. Payment
    const payment = evaluateActionGate({
      binding: baseBinding,
      target: { ...baseTarget, title: "Checkout - Pay $49.00" },
      action: { id: "c1", name: "click", args: { x: 500, y: 500 }, intent: "Click Pay Now to complete purchase" },
    });
    expect(payment.allowed).toBe(false);
    expect(payment.category).toBe("payment");
    expect(payment.requiresConfirmation).toBe(true);

    // 5. Account creation
    const account = evaluateActionGate({
      binding: baseBinding,
      target: { ...baseTarget, title: "Sign up - Create Account" },
      action: { id: "c1", name: "click", args: { x: 500, y: 500 }, intent: "Click Create account button" },
    });
    expect(account.allowed).toBe(false);
    expect(account.category).toBe("account_creation");
    expect(account.requiresConfirmation).toBe(true);

    // 6. Terms acceptance
    const terms = evaluateActionGate({
      binding: baseBinding,
      target: { ...baseTarget, title: "Terms of Service" },
      action: { id: "c1", name: "click", args: { x: 500, y: 500 }, intent: "Click I Agree to accept terms of service" },
    });
    expect(terms.allowed).toBe(false);
    expect(terms.category).toBe("terms_acceptance");
    expect(terms.requiresConfirmation).toBe(true);

    // 7. Sending messages
    const sendMsg = evaluateActionGate({
      binding: baseBinding,
      target: { ...baseTarget, title: "Compose Email - Mail" },
      action: { id: "c1", name: "click", args: { x: 500, y: 500 }, intent: "Click Send message button" },
    });
    expect(sendMsg.allowed).toBe(false);
    expect(sendMsg.category).toBe("sending_message");
    expect(sendMsg.requiresConfirmation).toBe(true);

    // 8. Changed target window (N-04 binding)
    const switched = evaluateActionGate({
      binding: baseBinding,
      target: { ...baseTarget, hwnd: 99999 },
      action: { id: "c1", name: "click", args: { x: 100, y: 100 }, intent: "Click file menu" },
    });
    expect(switched.allowed).toBe(false);
    expect(switched.category).toBe("target_changed");
  });

  it("refuses private/offline mode and missing per-provider consent", async () => {
    const { runComputerUseTask } = require("./action-loop.js");
    const planner = { start: vi.fn(), continueWithResult: vi.fn() };
    const driver = { inspectTarget: vi.fn(), captureTarget: vi.fn(), execute: vi.fn(), readBack: vi.fn(), abort: vi.fn() };

    const offlineRes = await runComputerUseTask({
      task: "Type hello in Notepad",
      userId: "u1",
      targetHwnd: 12345,
      enabled: true,
      offline: true,
      consentGranted: true,
      planner,
      driver,
    });
    expect(offlineRes.ok).toBe(false);
    expect(offlineRes.reason).toBe("offline_mode");
    expect(planner.start).not.toHaveBeenCalled();
    expect(driver.execute).not.toHaveBeenCalled();

    const noConsentRes = await runComputerUseTask({
      task: "Type hello in Notepad",
      userId: "u1",
      targetHwnd: 12345,
      enabled: true,
      offline: false,
      consentGranted: false,
      planner,
      driver,
    });
    expect(noConsentRes.ok).toBe(false);
    expect(noConsentRes.reason).toBe("consent_required");
    expect(planner.start).not.toHaveBeenCalled();
    expect(driver.execute).not.toHaveBeenCalled();
  });
});

describe("X-14 Gemini Computer Use: require_confirmation, Stop, and log safety", () => {
  const fakePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64").toString("base64");
  const safeTarget = {
    hwnd: 12345,
    pid: 4242,
    exe: "notepad.exe",
    cls: "Notepad",
    title: "Untitled - Notepad",
    own: false,
    elevated: false,
    password: false,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    focusedElement: { name: "Editor", type: "Edit", isPassword: false },
  };

  it("require_confirmation without an explicit user click never executes and never sets safety_acknowledgement", async () => {
    const { runComputerUseTask } = require("./action-loop.js");
    const continueSpy = vi.fn();
    const executeSpy = vi.fn();

    const planner = {
      start: vi.fn(async () => ({
        ok: true,
        interactionId: "int-1",
        bytesSent: 500,
        calls: [
          {
            id: "call-1",
            name: "click",
            args: { x: 200, y: 300 },
            intent: "Click confirm checkbox",
            safetyDecision: { decision: "require_confirmation", explanation: "Confirm external action" },
          },
        ],
        text: "",
      })),
      continueWithResult: continueSpy,
    };
    const driver = {
      inspectTarget: vi.fn(async () => safeTarget),
      captureTarget: vi.fn(async () => ({ pngBase64: fakePng, width: 800, height: 600, bounds: safeTarget.bounds, snapshotId: "snap-1", elements: [] })),
      execute: executeSpy,
      readBack: vi.fn(async () => ({ title: "Untitled - Notepad", elements: [] })),
      abort: vi.fn(),
    };

    // User declines / closes dialog without clicking allow
    const res = await runComputerUseTask({
      task: "Check the box",
      userId: "u1",
      targetHwnd: 12345,
      enabled: true,
      offline: false,
      consentGranted: true,
      planner,
      driver,
      confirmStep: async () => ({ confirmed: false, clicked: false }),
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("confirmation_declined");
    expect(executeSpy).not.toHaveBeenCalled();
    expect(continueSpy).not.toHaveBeenCalled();
  });

  it("require_confirmation with an explicit user click executes once and sets safety_acknowledgement: true", async () => {
    const { runComputerUseTask } = require("./action-loop.js");
    const continueSpy = vi.fn(async () => ({ ok: true, interactionId: "int-2", bytesSent: 400, calls: [], text: "Done." }));
    const executeSpy = vi.fn(async () => ({ ok: true, latencyMs: 12 }));

    const planner = {
      start: vi.fn(async () => ({
        ok: true,
        interactionId: "int-1",
        bytesSent: 500,
        calls: [
          {
            id: "call-1",
            name: "click",
            args: { x: 200, y: 300 },
            intent: "Click confirm checkbox",
            safetyDecision: { decision: "require_confirmation", explanation: "Confirm this step" },
          },
        ],
        text: "",
      })),
      continueWithResult: continueSpy,
    };
    const driver = {
      focusTarget: vi.fn(async () => ({ ok: true })),
      inspectTarget: vi.fn(async () => safeTarget),
      captureTarget: vi.fn(async () => ({ pngBase64: fakePng, width: 800, height: 600, bounds: safeTarget.bounds, snapshotId: "snap-1", elements: [] })),
      execute: executeSpy,
      readBack: vi.fn(async () => ({ title: "Untitled - Notepad", elements: [] })),
      abort: vi.fn(),
    };

    const res = await runComputerUseTask({
      task: "Check the box",
      userId: "u1",
      targetHwnd: 12345,
      enabled: true,
      offline: false,
      consentGranted: true,
      planner,
      driver,
      confirmStep: async (req: { explanation: string; nonce: string }) => {
        expect(req.explanation).toBe("Confirm this step");
        return { confirmed: true, clicked: true, nonce: req.nonce };
      },
    });

    expect(res.ok).toBe(true);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(continueSpy).toHaveBeenCalledTimes(1);
    expect(continueSpy.mock.calls[0][0].safetyAcknowledgement).toBe(true);
  });

  it("Stop during a pending planner call cancels it immediately and sends zero input", async () => {
    const { createComputerUseController } = require("./action-loop.js");
    const executeSpy = vi.fn();
    const abortSpy = vi.fn();
    let resolvePlanner!: (v: unknown) => void;
    let capturedSignal!: AbortSignal;

    const planner = {
      start: vi.fn((_req: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return new Promise((resolve) => {
          resolvePlanner = resolve;
        });
      }),
      continueWithResult: vi.fn(),
    };
    const driver = {
      inspectTarget: vi.fn(async () => safeTarget),
      captureTarget: vi.fn(async () => ({ pngBase64: fakePng, width: 800, height: 600, bounds: safeTarget.bounds, snapshotId: "snap-1", elements: [] })),
      execute: executeSpy,
      readBack: vi.fn(async () => ({ title: "Untitled - Notepad", elements: [] })),
      abort: abortSpy,
    };

    const controller = createComputerUseController({ planner, driver });
    const runPromise = controller.run({
      task: "Type hello",
      userId: "u1",
      targetHwnd: 12345,
      enabled: true,
      offline: false,
      consentGranted: true,
    });

    // Wait until planner.start is invoked
    await vi.waitFor(() => expect(planner.start).toHaveBeenCalledTimes(1));
    controller.stop("keyboard_escape");
    expect(capturedSignal.aborted).toBe(true);
    expect(abortSpy).toHaveBeenCalled();

    // Even if the pending promise later resolves with a valid action, zero input may run!
    resolvePlanner({
      ok: true,
      interactionId: "int-late",
      bytesSent: 500,
      calls: [{ id: "c-late", name: "type", args: { text: "SHOULD NOT TYPE" }, intent: "Type text" }],
      text: "",
    });

    const result = await runPromise;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("stopped");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("never writes screenshots or API keys to logs", async () => {
    const { runComputerUseTask, sanitizeActionLog } = require("./action-loop.js");
    const logs: string[] = [];
    const secretKey = "AIzaSyFakeTestKeyDoNotLog1234567890123456";
    const bigPng = "iVBORw0KGgo" + "A".repeat(200);

    const sanitized = sanitizeActionLog({
      event: "step",
      screenshot: bigPng,
      dataUrl: `data:image/png;base64,${bigPng}`,
      headers: { "x-goog-api-key": secretKey },
      message: `GOOGLE_GEMINI_API_KEY=${secretKey}`,
    });
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain(bigPng);
    expect(text).not.toContain("iVBORw0KGgo");
    expect(text).not.toContain(secretKey);

    const planner = {
      start: vi.fn(async () => ({ ok: true, interactionId: "int-1", bytesSent: 300, calls: [], text: "Done" })),
      continueWithResult: vi.fn(),
    };
    const driver = {
      inspectTarget: vi.fn(async () => safeTarget),
      captureTarget: vi.fn(async () => ({ pngBase64: bigPng, width: 800, height: 600, bounds: safeTarget.bounds, snapshotId: "snap-1", elements: [] })),
      execute: vi.fn(),
      readBack: vi.fn(async () => ({ title: "Untitled - Notepad", elements: [] })),
      abort: vi.fn(),
    };

    await runComputerUseTask({
      task: "Check screen",
      userId: "u1",
      targetHwnd: 12345,
      enabled: true,
      offline: false,
      consentGranted: true,
      planner,
      driver,
      logLine: (line: string) => logs.push(line),
    });

    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain("iVBORw0KGgo");
      expect(line).not.toContain("data:image/");
      expect(line).not.toContain(secretKey);
    }
  });

  it("keeps computer use setting off by default in okfilow DEFAULTS", () => {
    const { DEFAULTS, nextCfg } = require("./okfilow.js");
    expect(DEFAULTS.computerUse).toBe(false);
    expect(nextCfg(DEFAULTS, {}).computerUse).toBe(false);
    expect(nextCfg(DEFAULTS, { computerUse: "yes" }).computerUse).toBe(false);
    expect(nextCfg(DEFAULTS, { computerUse: true }).computerUse).toBe(true);
  });

  it("refuses an unknown password scan before capture or input", async () => {
    const { runComputerUseTask } = require("./action-loop.js");
    const planner = { start: vi.fn() };
    const driver = {
      inspectTarget: vi.fn(async () => ({ ...safeTarget, passwordUnknown: true })),
      captureTarget: vi.fn(), execute: vi.fn(), abort: vi.fn(),
    };
    const result = await runComputerUseTask({
      task: "Type a note", userId: "u1", targetHwnd: 12345, enabled: true,
      offline: false, consentGranted: true, driver, planner,
    });
    expect(result.reason).toBe("password_field");
    expect(result.bytesSent).toBe(0);
    expect(driver.captureTarget).not.toHaveBeenCalled();
    expect(driver.execute).not.toHaveBeenCalled();
    expect(planner.start).not.toHaveBeenCalled();
  });
  it("refuses a window containing a visible password element BEFORE sending any screenshot to the planner (R322)", async () => {
    const { runComputerUseTask } = require("./action-loop.js");
    const planner = { start: vi.fn(), continueWithResult: vi.fn() };
    const driver = {
      inspectTarget: vi.fn(async () => ({ ...safeTarget, password: false, hasPasswordField: false })),
      captureTarget: vi.fn(async () => ({
        pngBase64: fakePng,
        width: 800,
        height: 600,
        bounds: safeTarget.bounds,
        snapshotId: "snap-pw",
        elements: [{ name: "Password", type: "Edit", isPassword: true, x1: 100, y1: 100, x2: 400, y2: 140 }],
      })),
      execute: vi.fn(),
      readBack: vi.fn(),
      abort: vi.fn(),
    };
    const res = await runComputerUseTask({
      task: "Sign in",
      userId: "u1",
      targetHwnd: 12345,
      enabled: true,
      offline: false,
      consentGranted: true,
      planner,
      driver,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("password_field");
    expect(res.bytesSent).toBe(0);
    expect(planner.start).not.toHaveBeenCalled();
    expect(driver.execute).not.toHaveBeenCalled();
  });
});

describe("X-14 dispatch boundaries", () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 1000 };
  const target = { hwnd: 42, bounds };
  const click = { id: "c1", name: "click", args: { x: 490, y: 500 }, intent: "Choose option" };
  const pay = { name: "Pay now", x1: 495, x2: 505, y1: 495, y2: 505 };
  const opts = { enabled: true, consentGranted: true, task: "Choose option", targetHwnd: 42 };

  function setup(elements: object[] = [], calls = [click]) {
    const { createComputerUseController } = require("./action-loop.js");
    const driver = {
      focusTarget: vi.fn(async (_hwnd: number) => ({ ok: true })),
      inspectTarget: vi.fn(async () => target),
      captureTarget: vi.fn(async () => ({ bounds, elements, snapshotId: "s1" })),
      execute: vi.fn(async () => ({ ok: true })),
      readBack: vi.fn(async () => ({})),
    };
    const planner = {
      start: async () => ({ ok: true, calls }),
      continueWithResult: vi.fn(async () => ({ ok: true, calls: [] })),
    };
    return { controller: createComputerUseController({ driver, planner }), driver, planner };
  }

  it("refuses the payment element at the snapped point", async () => {
    const { controller, driver } = setup([pay]);
    expect(await controller.run(opts)).toMatchObject({ category: "payment", reason: "confirmation_declined" });
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it("dispatches the approved center and ignores any legacy driver snap hints", async () => {
    const { controller, driver } = setup([{ ...pay, name: "Open" }]);
    await controller.run(opts);
    expect(driver.execute).toHaveBeenCalledWith({ ...click, args: { x: 500, y: 500 } }, expect.anything());
    const sendCommand = vi.fn(async () => ({ ok: true }));
    await require("./action-driver.js").createActionDriver({ sendCommand }).execute(click, {
      hwnd: 42, targetRect: bounds, snapElements: [pay],
    });
    expect(sendCommand).toHaveBeenCalledWith("exec", expect.objectContaining({ physX: 490, physY: 500 }), undefined);
  });

  it.each(["x", "y", "width", "height"])("rejects changed capture %s", async (field) => {
    const { controller, driver } = setup();
    driver.inspectTarget.mockResolvedValue({ ...target, bounds: { ...bounds, [field]: 123 } });
    expect(await controller.run(opts)).toMatchObject({ reason: "target_changed" });
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it.each([true, false])("restores the granted window after Allow (focus succeeds: %s)", async (canFocus) => {
    const { controller, driver } = setup([pay]);
    let foreground = "panel";
    driver.focusTarget.mockImplementation(async () => {
      if (canFocus) foreground = "target";
      return { ok: canFocus };
    });
    driver.execute.mockImplementation(async () => {
      expect(foreground).toBe("target");
      return { ok: true };
    });
    const confirmStep = ({ nonce }: { nonce: string }) => ({ nonce, clicked: true, confirmed: true });
    const result = await controller.run({ ...opts, confirmStep });
    expect(driver.focusTarget).toHaveBeenCalledWith(42);
    expect(result.ok).toBe(canFocus);
    expect(driver.execute).toHaveBeenCalledTimes(canFocus ? 1 : 0);
  });

  it.skipIf(process.platform !== "win32")("releases exactly the held keys for every prefix of a three-key chord", () => {
    const { execFileSync } = require("node:child_process");
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cu-chord-"));
    try {
      execFileSync(process.execPath, [require.resolve("./native/action/build.mjs"), "--out", dir]);
      const probe = [
        "$ErrorActionPreference='Stop'",
        "[void][Reflection.Assembly]::LoadFrom((Resolve-Path './filow-action.exe').Path)",
        "0..6 | ForEach-Object { '[' + ([FilowActionHelper]::KeysToRelease([UInt16[]](17,16,65), $_) -join ',') + ']' }",
      ].join("; ");
      const rows = execFileSync("powershell.exe", ["-NoProfile", "-Command", probe], { cwd: dir, encoding: "utf8" });
      expect(rows.trim().split(/\r?\n/)).toEqual(["[]", "[17]", "[16,17]", "[65,16,17]", "[16,17]", "[17]", "[]"]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 20_000);

  it("releases partially sent hotkeys even if the target lost focus", () => {
    const native = require("node:fs").readFileSync(require.resolve("./native/action/filow-action.cs"), "utf8");
    expect(native).toMatch(/SendAll\(up, null\)/);
    expect(native).toContain("if (check != null) check();");
  });

  it("parses exactly one trial action, explicit completion or a refusal", () => {
    const { parseReply } = require("../../tools/computer-use/codex-planner.cjs");
    const action = { type: "function_call", name: "click", id: "1", arguments: { x: 501, y: 999 } };
    expect(parseReply(JSON.stringify(action)).calls[0].args).toEqual(action.arguments);
    expect(parseReply('{"done":true}').calls).toEqual([]);
    for (const invalid of [[action, action], { ...action, arguments: { x: 1000, y: 0 } }, {}]) {
      expect(parseReply(JSON.stringify(invalid)).ok).toBe(false);
    }
  });

  it("refuses a resize while awaiting the payment click", async () => {
    const { controller, driver } = setup([pay]);
    const confirmStep = ({ nonce }: { nonce: string }) => {
      driver.inspectTarget.mockResolvedValue({ ...target, bounds: { ...bounds, width: 999 } });
      return { nonce, clicked: true, confirmed: true };
    };
    expect(await controller.run({ ...opts, confirmStep })).toMatchObject({ reason: "target_changed" });
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it("declines a stale panel nonce for the snapped payment", async () => {
    const { controller, driver, planner } = setup([pay]);
    const confirmStep = () => ({ nonce: "previous", clicked: true, confirmed: true });
    expect(await controller.run({ ...opts, confirmStep })).toMatchObject({ reason: "confirmation_declined" });
    expect(driver.execute).not.toHaveBeenCalled();
    expect(planner.continueWithResult).not.toHaveBeenCalled();
  });

  it.each(["stop", "reuse"])("checks %s at grant consumption before dispatch", async (mode) => {
    const { controller, driver } = setup([pay]);
    const gate = require("./action-gate.js");
    const consume = gate.consumeStepGrant;
    const hook = vi.spyOn(gate, "consumeStepGrant").mockImplementation((grant) => {
      if (mode === "stop") controller.stop();
      else consume(grant);
      return consume(grant);
    });
    try {
      const confirmStep = ({ nonce }: { nonce: string }) => ({ nonce, clicked: true, confirmed: true });
      const res = await controller.run({ ...opts, confirmStep });
      expect(res.reason).toBe(mode === "stop" ? "stopped" : "grant_reused");
      expect(driver.execute).not.toHaveBeenCalled();
    } finally { hook.mockRestore(); }
  });

  it("ends the turn on a native foreground refusal", async () => {
    const { controller, driver, planner } = setup();
    const sendCommand = vi.fn(async () => ({ ok: false, refused: true, error: "target_not_foreground", sent: 0 }));
    driver.execute.mockImplementation(require("./action-driver.js").createActionDriver({ sendCommand }).execute);
    expect(await controller.run(opts)).toMatchObject({ ok: false, reason: "target_not_foreground" });
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(planner.continueWithResult).not.toHaveBeenCalled();
  });

  it("rejects the whole response when two calls arrive together", async () => {
    const { controller, driver, planner } = setup([], [click, { ...click, id: "c2" }]);
    expect(await controller.run(opts)).toMatchObject({ reason: "multiple_function_calls", steps: 0 });
    expect(driver.execute).not.toHaveBeenCalled();
    expect(planner.continueWithResult).not.toHaveBeenCalled();
  });
});
