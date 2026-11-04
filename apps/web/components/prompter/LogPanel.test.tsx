import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { LogPanel, closeLogPanel } from "./LogPanel";

it("renders a focusable log with a labelled close action and preserves full entries", () => {
  const html = renderToStaticMarkup(<LogPanel triggerRef={{ current: null }} onClose={() => {}}>Full log entry</LogPanel>);
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain('aria-label="Close"');
  expect(html).toContain('Full log entry');
});

it("returns focus to the overflow trigger before removing the log panel", () => {
  const order: string[] = [];
  closeLogPanel({ focus: () => order.push("trigger") }, () => order.push("unmount"));
  expect(order).toEqual(["trigger", "unmount"]);
  const close = vi.fn();
  closeLogPanel(null, close);
  expect(close).toHaveBeenCalledOnce();
});
