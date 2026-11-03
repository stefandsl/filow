import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("POST /api/local/plan", () => {
  it("rejects callers without an engine token when a password is set", async () => {
    process.env.ACCESS_PASSWORD = "pw";
    const res = await POST(new Request("http://x/api/local/plan", { method: "POST", body: JSON.stringify({ apply: true }) }));
    expect(res.status).toBe(401);
  });
});
