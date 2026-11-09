import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { extractSecrets, migrateSecrets, NOTE } = require("./secrets.js");

const env = ["# keys", "OPENROUTER_API_KEY=sk-or-v1-abc123", "ELEVENLABS_API_KEY=", "OPENAI_API_KEY=your-key-here",
  "CLOUDFLARE_API_TOKEN=\"tok 42\"", "OLLAMA_URL=http://127.0.0.1:11434", "GENERATE_PROVIDER=ollama"].join("\r\n");

it("blanks real secrets, keeps placeholders, empty keys and other settings, and keeps CRLF", () => {
  const { text, found } = extractSecrets(env);
  expect(found).toEqual({ OPENROUTER_API_KEY: "sk-or-v1-abc123", CLOUDFLARE_API_TOKEN: "tok 42" });
  expect(text).not.toContain("sk-or-v1-abc123");
  expect(text).not.toContain("tok 42");
  expect(text).toContain("OPENAI_API_KEY=your-key-here");
  expect(text).toContain("OLLAMA_URL=http://127.0.0.1:11434");
  expect(text).toContain(`${NOTE}\r\nOPENROUTER_API_KEY=\r\n`);
  expect(text.split("\r\n").length).toBeGreaterThan(env.split("\r\n").length);
});

function fakeWorld(envText: string | null) {
  const files: Record<string, string> = {};
  if (envText != null) files.env = envText;
  const fsx = { read: (p: string) => files[p] ?? null, write: (p: string, t: string) => { files[p] = t; } };
  const crypto = { available: () => true, encrypt: (s: string) => Buffer.from(`enc:${s}`).toString("base64"), decrypt: (b: string) => Buffer.from(b, "base64").toString().replace(/^enc:/, "") };
  return { files, fsx, crypto };
}

it("moves secrets into the store, never leaves plain text on disk, and a new value replaces the old one", () => {
  const w = fakeWorld(env);
  const first = migrateSecrets({ envFile: "env", storeFile: "store", fsx: w.fsx, crypto: w.crypto });
  expect(first).toEqual({ OPENROUTER_API_KEY: "sk-or-v1-abc123", CLOUDFLARE_API_TOKEN: "tok 42" });
  expect(w.files.env).not.toContain("sk-or-v1-abc123");
  expect(w.files.store).not.toContain("sk-or-v1-abc123");
  // second start: nothing new in .env, secrets still come back
  expect(migrateSecrets({ envFile: "env", storeFile: "store", fsx: w.fsx, crypto: w.crypto }).OPENROUTER_API_KEY).toBe("sk-or-v1-abc123");
  // the user types a new key into .env
  w.files.env = w.files.env.replace("OPENROUTER_API_KEY=", "OPENROUTER_API_KEY=sk-or-v1-new");
  expect(migrateSecrets({ envFile: "env", storeFile: "store", fsx: w.fsx, crypto: w.crypto }).OPENROUTER_API_KEY).toBe("sk-or-v1-new");
  expect(w.files.env).not.toContain("sk-or-v1-new");
});

it("leaves everything alone when OS encryption is unavailable", () => {
  const w = fakeWorld(env);
  expect(migrateSecrets({ envFile: "env", storeFile: "store", fsx: w.fsx, crypto: { ...w.crypto, available: () => false } })).toEqual({});
  expect(w.files.env).toBe(env);
});
