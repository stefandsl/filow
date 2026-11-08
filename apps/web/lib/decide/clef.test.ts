import { afterEach, describe, expect, it, vi } from "vitest";
import { warmClefLocal } from "./clef";

afterEach(() => vi.unstubAllGlobals());

describe("warmClefLocal", () => {
  it("loads Clef through the System One endpoint with keep_alive -1 (Clef has no generate capability)", async () => {
    // Reproduced on Ollama 0.40.13: POST /api/generate {model: "clef-flash"} answers 400
    // '"clef-flash" does not support generate', so the warm-up never loaded the model and the
    // first decisions of a local take timed out while Ollama was still loading it.
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ answers: { warmup: { noul: 0.5 } } }), { status: 200 });
    });
    const r = await warmClefLocal();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/v1\/systemone$/);
    expect(calls[0].body).toMatchObject({ model: "clef-flash", keep_alive: -1 });
    expect(Object.keys(calls[0].body.questions as object)).toHaveLength(1);
  });

  it("reports Ollama's error text instead of claiming the model is warm", async () => {
    vi.stubGlobal("fetch", async () => new Response("model not found", { status: 404 }));
    const r = await warmClefLocal();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("model not found");
  });
});
