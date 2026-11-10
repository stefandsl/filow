import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { PANES, keyboardPermission, createKeyboardPermissionPrompt } = require("./mac-permissions.js");

// uiohook-napi throws these (src/lib/addon.c) when macOS refuses the keyboard hook.
const hookError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("keyboardPermission", () => {
  const prefs = (trusted: boolean) => ({ isTrustedAccessibilityClient: vi.fn(() => trusted) });
  it("asks nothing off macOS", () => {
    const p = prefs(false);
    expect(keyboardPermission({ platform: "win32", systemPreferences: p })).toBeNull();
    expect(keyboardPermission({ platform: "linux", systemPreferences: p, error: hookError("UIOHOOK_ERROR_AXAPI_DISABLED", "x") })).toBeNull();
    expect(p.isTrustedAccessibilityClient).not.toHaveBeenCalled();
  });
  it("before the hook starts: Accessibility not granted holds the hook back, without showing macOS's own prompt", () => {
    const p = prefs(false);
    expect(keyboardPermission({ platform: "darwin", systemPreferences: p })).toBe("accessibility");
    expect(p.isTrustedAccessibilityClient).toHaveBeenCalledWith(false);
    expect(keyboardPermission({ platform: "darwin", systemPreferences: prefs(true) })).toBeNull();
  });
  it("reads the hook's own error: assistive devices is Accessibility, the event port is Input Monitoring", () => {
    const p = prefs(true);
    expect(keyboardPermission({ platform: "darwin", systemPreferences: p, error: hookError("UIOHOOK_ERROR_AXAPI_DISABLED", "Failed to enable access for assistive devices.") })).toBe("accessibility");
    expect(keyboardPermission({ platform: "darwin", systemPreferences: p, error: hookError("UIOHOOK_ERROR_CREATE_EVENT_PORT", "Failed to create apple event port.") })).toBe("inputMonitoring");
    expect(keyboardPermission({ platform: "darwin", systemPreferences: p, error: new Error("Failed to create apple event port.") })).toBe("inputMonitoring");
    expect(keyboardPermission({ platform: "darwin", systemPreferences: p, error: hookError("UIOHOOK_ERROR_OUT_OF_MEMORY", "Failed to allocate memory.") })).toBeNull();
  });
  it("a check that throws lets the hook try (its error decides)", () => {
    expect(keyboardPermission({ platform: "darwin", systemPreferences: { isTrustedAccessibilityClient: () => { throw new Error("no"); } } })).toBeNull();
  });
});

describe("the permission prompt", () => {
  function setup(response: number) {
    const deps = {
      dialog: { showMessageBox: vi.fn(async () => ({ response })) },
      systemPreferences: { isTrustedAccessibilityClient: vi.fn(() => false) },
      openSystemSettings: vi.fn(async () => undefined), menuText: (k: string) => `<${k}>`, logLine: vi.fn(),
    };
    return { deps, ask: createKeyboardPermissionPrompt(deps) };
  }
  it("explains in the user's words which pane, and opens exactly that pane", async () => {
    const s = setup(0);
    expect(await s.ask("inputMonitoring")).toBe(true);
    expect(s.deps.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message: "<macKeysMessage>", detail: "<macKeysInput>", buttons: ["<macKeysOpen>", "<macKeysLater>"], cancelId: 1 }));
    expect(s.deps.openSystemSettings).toHaveBeenCalledWith(PANES.inputMonitoring);
    expect(PANES.inputMonitoring).toMatch(/^x-apple\.systempreferences:.*Privacy_ListenEvent$/);
  });
  it("for Accessibility, lists Filow in the pane (prompt=true) before opening it", async () => {
    const s = setup(0);
    await s.ask("accessibility");
    expect(s.deps.systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
    expect(s.deps.openSystemSettings).toHaveBeenCalledWith(PANES.accessibility);
  });
  it("asks once per launch, and Not now opens nothing", async () => {
    const s = setup(1);
    expect(await s.ask("accessibility")).toBe(false);
    expect(await s.ask("accessibility")).toBe(false);
    expect(s.deps.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(s.deps.openSystemSettings).not.toHaveBeenCalled();
    expect(await s.ask("camera")).toBe(false);
  });
});
