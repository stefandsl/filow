import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Dialog, openDialog, containDialogTab } from "./Dialog";
import { ScriptEditor, SourceChooser, StartModeDialog } from "../Teleprompter";

it("gives each migrated dialog a native modal with an associated visible title", () => {
  const readiness = { openrouterKey: false, sttKey: false, whisper: false, sherpa: false, clef: false, stt: { elevenlabs: false, openai: false }, advice: { local: false, reason: "none" as const }, gpuName: "" };
  for (const element of [
    <Dialog title="Example" onClose={() => {}}>Content</Dialog>,
    <StartModeDialog readiness={readiness} onPick={() => {}} onCancel={() => {}} />,
    <SourceChooser sources={[]} onPick={() => {}} />,
    <ScriptEditor initial="# Title\n- Point" onCancel={() => {}} onSave={() => {}} />,
  ]) {
    const html = renderToStaticMarkup(element);
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-modal="true"');
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('</dialog>');
  }
});

it("enters the native focus scope and restores the opener after closing", () => {
  const calls: string[] = [];
  const dialog = { showModal: () => calls.push("modal"), close: () => calls.push("close") } as unknown as HTMLDialogElement;
  const opener = { isConnected: true, focus: () => calls.push("focus") } as unknown as HTMLElement;
  const cleanup = openDialog(dialog, opener);
  expect(calls).toEqual(["modal"]);
  cleanup();
  expect(calls).toEqual(["modal", "close", "focus"]);
  const detached = { isConnected: false, focus: vi.fn() };
  openDialog(dialog, detached as unknown as HTMLElement)();
  expect(detached.focus).not.toHaveBeenCalled();
});

it("wraps Tab and Shift+Tab at the modal boundary, including empty dialogs", () => {
  const first = { focus: vi.fn() } as unknown as HTMLElement;
  const last = { focus: vi.fn() } as unknown as HTMLElement;
  const dialog = { focus: vi.fn() } as unknown as HTMLElement;
  const event = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
  containDialogTab(event, last, [first, last], dialog);
  expect(first.focus).toHaveBeenCalledOnce();
  expect(event.preventDefault).toHaveBeenCalledOnce();
  containDialogTab({ ...event, shiftKey: true }, first, [first, last], dialog);
  expect(last.focus).toHaveBeenCalledOnce();
  containDialogTab(event, null, [], dialog);
  expect(dialog.focus).toHaveBeenCalledOnce();
  event.preventDefault.mockClear();
  containDialogTab(event, first, [first, last], dialog);
  expect(event.preventDefault).not.toHaveBeenCalled();
});
