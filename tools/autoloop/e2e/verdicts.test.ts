import { describe, expect, it } from "vitest";
import { hotkeyVerdict, secretsVerdict, sttVerdict, words } from "./verdicts.mjs";

const KEY = "sk-linux-probe-0000";
const NAME = "FILOW_PROBE_API_KEY";
const NOTE = "# stored encrypted by Filow; type a new value after = to replace it";
const movedEnv = `${NOTE}\n${NAME}=\n`;
const keptEnv = `${NAME}=${KEY}\n`;
const store = JSON.stringify({ [NAME]: "djEwXz9hYmNkZWY=" });
const log = `2026-11-10T01:00:00Z secrets: encrypted ${NAME}\n`;

describe("secretsVerdict", () => {
  it("passes the key-ring branch only with every sign of the move", () => {
    expect(secretsVerdict({ envText: movedEnv, storeText: store, startupLog: log, fakeKey: KEY, name: NAME }).ok).toBe(true);
    expect(secretsVerdict({ envText: movedEnv, storeText: store, startupLog: log, fakeKey: KEY, name: NAME, keyring: "yes" }).ok).toBe(true);
    // no log line: auto expects "kept", and the key is gone, so it fails
    expect(secretsVerdict({ envText: movedEnv, storeText: store, startupLog: "", fakeKey: KEY, name: NAME }).ok).toBe(false);
    // the plain key written into the store
    expect(secretsVerdict({ envText: movedEnv, storeText: JSON.stringify({ [NAME]: KEY }), startupLog: log, fakeKey: KEY, name: NAME }).ok).toBe(false);
    // the line removed instead of blanked
    expect(secretsVerdict({ envText: `${NOTE}\n`, storeText: store, startupLog: log, fakeKey: KEY, name: NAME }).ok).toBe(false);
    // logged and stored, but the key still in .env
    expect(secretsVerdict({ envText: keptEnv, storeText: store, startupLog: log, fakeKey: KEY, name: NAME }).ok).toBe(false);
  });

  it("passes the no-key-ring branch only when nothing was touched", () => {
    expect(secretsVerdict({ envText: keptEnv, storeText: "", startupLog: "", fakeKey: KEY, name: NAME }).ok).toBe(true);
    expect(secretsVerdict({ envText: keptEnv, storeText: store, startupLog: "", fakeKey: KEY, name: NAME }).ok).toBe(false);
    expect(secretsVerdict({ envText: keptEnv, storeText: "", startupLog: "secrets: encrypted OTHER_API_KEY\n", fakeKey: KEY, name: NAME }).ok).toBe(false);
  });

  it("holds the run to the branch the caller expects", () => {
    expect(secretsVerdict({ envText: keptEnv, storeText: "", startupLog: "", fakeKey: KEY, name: NAME, keyring: "yes" }).ok).toBe(false);
    expect(secretsVerdict({ envText: movedEnv, storeText: store, startupLog: log, fakeKey: KEY, name: NAME, keyring: "no" }).ok).toBe(false);
    expect(secretsVerdict({ envText: keptEnv, storeText: "", startupLog: "", fakeKey: KEY, name: NAME, keyring: "no" }).ok).toBe(true);
    // files look moved but the app never said it encrypted the key (left over from an earlier run)
    expect(secretsVerdict({ envText: movedEnv, storeText: store, startupLog: "", fakeKey: KEY, name: NAME, keyring: "yes" }).ok).toBe(false);
  });
});

describe("sttVerdict", () => {
  const ready = "stt: nemotron ready in 812 ms (4 threads)";
  it("needs the ready line, no errors and enough words", () => {
    expect(sttVerdict({ ready, text: "the quick brown fox", errors: [] }).ok).toBe(true);
    expect(sttVerdict({ ready: "", text: "the quick brown fox", errors: [] }).ok).toBe(false);
    expect(sttVerdict({ ready, text: "the quick brown fox", errors: ["worker died"] }).ok).toBe(false);
    expect(sttVerdict({ ready, text: "uh [the quick]", errors: [] }).ok).toBe(false);
  });

  it("checks the heard words against the recording when they are known", () => {
    const expectText = "Hello everyone, today we talk about the weather.";
    expect(sttVerdict({ ready, text: "hello everyone today we talk about weather", expect: expectText }).ok).toBe(true);
    expect(sttVerdict({ ready, text: "yellow every one to day walk a bout", expect: expectText }).ok).toBe(false);
  });

  it("splits words without punctuation or the partial tail", () => {
    expect(words("Hello, world! [still talk]")).toEqual(["hello", "world"]);
    expect(words("Ciao, è l'ora")).toEqual(["ciao", "è", "l'ora"]);
  });
});

describe("hotkeyVerdict", () => {
  it("passes only when the hook started", () => {
    expect(hotkeyVerdict("x okfilow: hold-to-talk hook started\n")).toMatchObject({ ok: true, final: true });
    expect(hotkeyVerdict("x okfilow: keyboard hook not ready (EACCES), retry 1 of 4\n")).toMatchObject({ ok: false, final: false });
    const gave = hotkeyVerdict("x okfilow: keyboard hook unavailable (no X server); falling back to Ctrl+Alt+O toggle\n");
    expect(gave).toMatchObject({ ok: false, final: true });
    expect(gave.detail).toMatch(/no X server/);
    expect(hotkeyVerdict("x okfilow failed to start: TypeError: boom\n")).toMatchObject({ ok: false, final: true });
    expect(hotkeyVerdict("")).toMatchObject({ ok: false, final: false });
  });
});
