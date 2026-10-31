import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("POST /api/script/generate", () => {
  it("rejects callers without an engine token when a password is set", async () => {
    process.env.ACCESS_PASSWORD = "pw";
    const res = await POST(new Request("http://x/api/script/generate", { method: "POST", body: JSON.stringify({ slides: [{ index: 0, text: "a" }] }) }));
    expect(res.status).toBe(401);
  });
  it("validates the body", async () => {
    delete process.env.ACCESS_PASSWORD;
    expect((await POST(new Request("http://x", { method: "POST", body: "nope" }))).status).toBe(400);
    expect((await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ slides: [] }) }))).status).toBe(400);
  });
});
