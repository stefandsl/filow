import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { CancelledStart, StartAttempts } from "./startAttempt";

for (const phase of ["readiness", "plan", "microphone", "backend"]) {
  it(`ignores a late ${phase} result after cancellation and a new start`, async () => {
    const attempts = new StartAttempts();
    const old = attempts.begin();
    let resolve!: (value: string) => void;
    const update = vi.fn();
    const pending = old.wait(new Promise<string>(done => { resolve = done; })).then(update);
    const rejected = expect(pending).rejects.toBeInstanceOf(CancelledStart);
    attempts.cancel();
    const next = attempts.begin();
    resolve(phase);
    await rejected;
    expect(update).not.toHaveBeenCalled();
    expect(old.isCurrent()).toBe(false);
    expect(await next.wait(Promise.resolve("new take"))).toBe("new take");
    expect(next.isCurrent()).toBe(true);
  });
}

it("does not report a late failure from a cancelled attempt", async () => {
  const attempts = new StartAttempts();
  const old = attempts.begin();
  let reject!: (reason: Error) => void;
  const pending = old.wait(new Promise<void>((_, fail) => { reject = fail; }));
  const rejected = expect(pending).rejects.toBeInstanceOf(CancelledStart);
  attempts.cancel();
  reject(new Error("late network failure"));
  await rejected;
});

it("guards every startup boundary and only cleans up the obsolete backend", () => {
  const source = readFileSync(new URL('../components/Teleprompter.tsx', import.meta.url), 'utf8');
  for (const operation of ['loadReadiness()', 'fetchPlan({ probe: true, apply: true })', 'preopenMic()', 'probeMic(attempt)', 'b.start(handlers)']) {
    expect(source).toContain(`await attempt.wait(${operation})`);
  }
  expect(source).toContain('pendingBackend?.stop();');
  expect(source).not.toContain('cancelRef');
});
