import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import { it } from "vitest";
import { LangProvider, StageView } from "@filow/ui";
import { Engine, currentPoint, parseScript, pointDisplayState } from "@filow/core";
import { PointsList } from "./prompter/PointsList";
import { PreparedWaterCycle } from "./Teleprompter";
import { Icon } from "./icons";

for (const [lang, title, rows] of [
  ["en", "Prepared water-cycle board", [
    ["Evaporation", "Surface water", "Water vapour"],
    ["Condensation", "Water vapour", "Cloud droplets"],
    ["Precipitation", "Clouds", "Ground"],
    ["Runoff", "Ground", "Lake"],
  ]],
  ["it", "Lavagna preparata sul ciclo dell’acqua", [
    ["Evaporazione", "Acqua in superficie", "Vapore acqueo"],
    ["Condensazione", "Vapore acqueo", "Goccioline nella nube"],
    ["Precipitazioni", "Nuvole", "Suolo"],
    ["Ruscellamento", "Suolo", "Lago"],
  ]],
] as const) it(`renders the prepared board and local photograph input in ${lang}`, () => {
  const html = renderToStaticMarkup(<LangProvider lang={lang}><PreparedWaterCycle onClose={() => {}} /></LangProvider>);
  const arrow = renderToStaticMarkup(<Icon name="right" />);
  assert.ok(html.includes(title));
  for (const [process, from, to] of rows) {
    const cells = `<th scope="row">${process}</th><td>${from}</td><td aria-hidden="true">${arrow}</td><td>${to}</td>`;
    assert.ok(html.includes(`<tr>${cells}</tr>`), process);
  }
  assert.ok(html.includes('type="file"'));
  assert.ok(html.includes("image/png"));
});

it("keeps the anchored waiting point and its preceding manual mark on both paused views", () => {
  const script = parseScript("# Water cycle\n- Evaporation\n- Runoff");
  script.sections[0].bullets[0].id = "evaporation";
  script.sections[0].bullets[1].id = "runoff-next";
  const engine = new Engine({ decide: async () => { throw Error("unexpected decision"); }, setInterval: () => 0, clearInterval: () => {} });
  engine.loadScript(script);
  engine.start();
  engine.dispatch({ type: "markStarted", id: "evaporation" });
  engine.dispatch({ type: "anchor", idx: 0, pointId: "runoff-next" });
  const place = engine.committedPlace();
  engine.stop("interruption");
  engine.feed({ committed: "Runoff" });
  engine.resumeControlEpoch(engine.getState().controlEpoch ?? 0);
  assert.deepEqual(engine.committedPlace(), place);
  const state = engine.getState();
  const points: Parameters<typeof PointsList>[0]["points"] = script.sections[0].bullets.map(b => {
    const p = state.points[b.id] ?? { status: "waiting" as const, confidence: 0 };
    return { ...p, id: b.id, text: b.text, state: pointDisplayState(p) };
  });
  for (const view of [<StageView key="phone" state={state} stage />, <PointsList key="desktop" points={points} current={currentPoint(state)} />]) {
    const html = renderToStaticMarkup(view);
    const tags = html.match(/<[^>]+data-point-id="[^"]+"[^>]*>/g) ?? [];
    const waiting = tags.find(tag => tag.includes('data-point-id="runoff-next"'));
    assert.ok(waiting);
    assert.ok(waiting.includes('data-state="waiting"'));
    assert.ok(waiting.includes('aria-current="step"'));
    assert.ok(tags.find(tag => tag.includes('data-point-id="evaporation"'))?.includes('data-state="done"'));
  }
});

it("disables Open once synchronously across two clicks before render", async () => {
  const { OpenOnceButton } = await import("./Teleprompter");
  let requests = 0;
  const button = OpenOnceButton({ label:"Open once", approve:() => { requests++; } });
  const currentTarget = { disabled:false };
  button.props.onClick({ currentTarget });
  button.props.onClick({ currentTarget });
  assert.equal(currentTarget.disabled, true);
  assert.equal(requests, 1);
});

it("discloses Edge background connections before the presenter starts it", () => {
  const g = globalThis as { filow?: unknown };
  const before = g.filow;
  try {
    g.filow = {lesson:{}};
    const html = renderToStaticMarkup(<LangProvider lang="en"><PreparedWaterCycle onClose={() => {}} /></LangProvider>);
    assert.ok(html.indexOf("Edge can contact Microsoft") >= 0);
    assert.ok(html.indexOf("Edge can contact Microsoft") < html.indexOf("Prepare an Edge lesson window"));
  } finally { g.filow = before; }
});
