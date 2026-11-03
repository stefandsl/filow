import { afterEach, describe, expect, it } from "vitest";
import { PUT } from "./route";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("PUT /api/script", () => {
  it("rejects callers without an engine token when a password is set", async () => {
    process.env.ACCESS_PASSWORD = "pw";
    const res = await PUT(new Request("http://x/api/script", { method: "PUT", body: JSON.stringify({ text: "# Pwned\n- by anyone" }) }));
    expect(res.status).toBe(401);
  });
  it("rejects a body without text", async () => {
    delete process.env.ACCESS_PASSWORD;
    expect((await PUT(new Request("http://x/api/script", { method: "PUT", body: "nope" }))).status).toBe(400);
    expect((await PUT(new Request("http://x/api/script", { method: "PUT", body: JSON.stringify({}) }))).status).toBe(400);
  });
});
