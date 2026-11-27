import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { trayTemplate } = require("./okfilow-tray-menu.js") as {
  trayTemplate: (d: Record<string, unknown>) => Array<{ label?: string; type?: string; click?: () => void }>;
};

describe("OK Filow tray menu", () => {
  const base = { menuText: (k: string) => k, cfg: { showAlways: false, enabled: true }, phones: 0, togglePanel() {}, applyConfig() {} };

  it("ends with a way to quit Filow, after a separator", () => {
    const quit = vi.fn();
    const items = trayTemplate({ ...base, quit });
    expect(items.at(-2)?.type).toBe("separator");
    expect(items.at(-1)?.label).toBe("quit");
    items.at(-1)?.click?.();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing entries and the phone count first", () => {
    const items = trayTemplate({ ...base, phones: 2, quit() {} });
    expect(items.map((i) => i.label ?? i.type)).toEqual(["okfPhoneWaiting", "okfOpen", "okfShowAlways", "okfEnabled", "separator", "quit"]);
  });
});
