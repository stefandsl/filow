import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const loadTrial = createRequire(import.meta.url);

const input = { task: "Press Ready", screenshotBase64: "cG5n" };
const action = { type: "function_call", id: "step", name: "click", arguments: { x: 200, y: 350 } };
const reply = (content: string) => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
function planner(fetch: ReturnType<typeof vi.fn>, options = {}) {
  return loadTrial("../../tools/computer-use/colibri-planner.cjs").createColibriPlanner({ enabled: true, fetch, ...options });
}

it("rejects malformed output without returning input", async () => {
  for (const content of ["not json", "[]", JSON.stringify([action]), JSON.stringify({ ...action, next: action }),
    JSON.stringify({ ...action, arguments: { ...action.arguments, next: action } })]) {
    expect(await planner(vi.fn().mockResolvedValue(reply(content))).start(input)).toMatchObject({ ok: false, calls: [] });
  }
});
it("rejects out-of-range coordinates", async () => {
  const content = JSON.stringify({ ...action, arguments: { x: 1000, y: 1 } });
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
  expect(result.calls[0]).toMatchObject({ name: "click", args: action.arguments });
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
