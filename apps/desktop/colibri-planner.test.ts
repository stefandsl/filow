import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const loadTrial = createRequire(import.meta.url);

const input = { task: "Press Ready", screenshotBase64: "cG5n" };
const action = { action: "click", x_1000: 200, y_1000: 350 };
const reply = (content: string) => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
function planner(fetch: ReturnType<typeof vi.fn>, options = {}) {
  return loadTrial("../../tools/computer-use/colibri-planner.cjs").createColibriPlanner({ enabled: true, fetch, ...options });
}

it("rejects malformed output without returning input", async () => {
  for (const content of ["not json", "[]", JSON.stringify([action]), JSON.stringify({ ...action, next: action }),
    JSON.stringify({ action: "click", x: 200, y: 350 })]) {
    expect(await planner(vi.fn().mockResolvedValue(reply(content))).start(input)).toMatchObject({ ok: false, calls: [] });
  }
});
it("refuses unlabelled pixel points within the grid range", async () => {
  const pixels = { type: "function_call", id: "step", name: "click", arguments: { x: 800, y: 450 } };
  expect(await planner(vi.fn().mockResolvedValue(reply(JSON.stringify(pixels)))).start(input))
    .toMatchObject({ ok: false, calls: [] });
});
it("rejects pixel coordinates even if labelled as normalized when outside the scale", async () => {
  const content = JSON.stringify({ ...action, x_1000: 1858 });
  expect(await planner(vi.fn().mockResolvedValue(reply(content))).start(input)).toMatchObject({ ok: false, calls: [] });
});
it("returns zero input when the server is down", async () => {
  expect(await planner(vi.fn().mockRejectedValue(new Error("refused"))).start(input))
    .toMatchObject({ ok: false, error: "server_unavailable", calls: [] });
});
it("disables this session after a timeout", async () => {
  const fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason))));
  const session = planner(fetch, { timeoutMs: 10 });
  expect(await session.start(input)).toMatchObject({ error: "timeout", calls: [] });
  expect(await session.start(input)).toMatchObject({ error: "disabled", calls: [] });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps the task and last result with the fresh screenshot on follow-up", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(JSON.stringify(action))).mockResolvedValueOnce(reply('{"done":true}'));
  const session = planner(fetch);
  const result = await session.start(input);
  expect(result.calls[0]).toMatchObject({ name: "click", args: { x: 200, y: 350 } });
  expect(await session.continueWithResult({ previousInteractionId: result.interactionId, callId: "step",
    name: "click", resultMeta: { status: "ok" }, screenshotBase64: "bmV3" })).toMatchObject({ ok: true, calls: [] });
  const [url, request] = fetch.mock.calls[1];
  expect(url).toBe("http://127.0.0.1:8000/v1/chat/completions");
  expect(request.redirect).toBe("error");
  expect(request.body).toContain(input.task);
  expect(request.body).toContain("bmV3");
  expect(request.body).toContain("status");
});
it("requires opt-in before transmitting a screenshot", async () => {
  const fetch = vi.fn();
  expect(await planner(fetch, { enabled: undefined }).start(input)).toMatchObject({ error: "disabled", calls: [] });
  expect(fetch).not.toHaveBeenCalled();
});

it("maps normalized 0-1000 to Filow's grid for clicks and scrolls", async () => {
  for (const move of [action, { action: "scroll", direction: "down" }]) {
    const content = JSON.stringify({ ...move, x_1000: 1000, y_1000: 750 });
    const fetch = vi.fn().mockResolvedValue(reply(content));
    const result = await planner(fetch).start(input);
    expect(result.calls[0]).toMatchObject({ name: move.action, args: { x: 999, y: 749 } });
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[0].content).toContain("normalized 0-1000");
  }
});
