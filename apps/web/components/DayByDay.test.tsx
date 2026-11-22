import { it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useState } from "react";
import DayByDay from "../app/day-by-day/page";
import { t, type Lang } from "../../../packages/core/src/i18n";
const surface = vi.hoisted(() => ({ lang: "en" as Lang }));
vi.mock("./LangSwitch", () => ({ useUiLang: () => [surface.lang], useUiTheme: () => ["light", () => {}], ThemeSwitch: () => null }));
vi.mock("react", async load => {
  const react = await load<typeof import("react")>();
  return { ...react, useState: vi.fn(react.useState) };
});
for (const lang of ["en","it"] as const) it("shows the daily date, editable row, evidence and person choice in " + lang, () => {
  surface.lang = lang;
  const row = { id: "task-id", rev: 3, text: "Give Bea the plans", due: "2026-06-02", evidence: "Bea got the plans", done: true, undo: true };
  vi.mocked(useState).mockReturnValueOnce([{ session: "session", version: 4, day: row.due, tasks: [row], offset: 0,
    review: { token: "decision", type: "reopen", words: "Correction", which: true, targets: [row] } }, () => {}]);
  const html = renderToStaticMarkup(<DayByDay />);
  for (const key of ["daily.title","daily.task","daily.which","daily.undo","daily.evidence","daily.talk","daily.off"] as const)
    expect(html).toContain(t(key,lang));
  expect(html).toContain(row.evidence);
  expect(html).toContain('data-id="task-id" data-revision="3"');
  expect(html).toContain(new Intl.DateTimeFormat(lang,{ dateStyle:"full" }).format(new Date(row.due+"T12:00:00")));
});

it("offers an in-page confirmation before erasing every date", () => {
  surface.lang = "en";
  vi.mocked(useState).mockReturnValueOnce([{ session: "session", version: 0, day: "2026-06-02", tasks: [], offset: 0 }, () => {}]);
  const html = renderToStaticMarkup(<DayByDay />);
  expect(html).toMatch(/<details[^>]*><summary[^>]*>Delete entire list<\/summary>/);
  expect(html).toContain(t("daily.clearConfirm", "en"));
});

it("discloses the local data flow and model download before consent", () => {
  surface.lang = "en";
  vi.mocked(useState).mockReturnValueOnce([{ session:"s", version:0, day:"2026-06-02", tasks:[], offset:0 }, () => {}]);
  const html = renderToStaticMarkup(<DayByDay />);
  for (const term of ["task text", "report", "loopback", "Settings", "4.3 GiB", "Ollama", "Apache 2.0"]) expect(html).toContain(term);
});
