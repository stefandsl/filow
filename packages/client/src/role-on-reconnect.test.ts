// Regression test (audit candidate C1, 0.9.42): a device whose role changed while its socket was down
// must take the role the relay sends in `welcome` when it reconnects (ARCHITECTURE.md 5.4:
// `server -> client {t:"welcome", role, version}`; apps/server/src/server.ts:618 sends the current role).
// Deterministic: a fake WebSocket driven by hand and fake timers for the reconnect backoff; no network.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connect } from "./index";

class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  constructor(public url: string) {
    FakeWS.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
  }
  // test helpers
  serverOpens() {
    this.readyState = 1;
    this.onopen?.();
  }
  serverSays(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drops() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" });
  }
}

beforeEach(() => {
  FakeWS.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function phoneWith(role: "pending" | "viewer" | "controller", roles: string[]) {
  const p = connect({
    serverUrl: "http://relay.test",
    session: { id: "s1", token: "view-token", role },
    WebSocketImpl: FakeWS as unknown as typeof WebSocket,
    onRole: (r) => roles.push(r),
  });
  const first = FakeWS.all[0];
  first.serverOpens();
  first.serverSays({ t: "welcome", role, version: 1, canAsk: false, approved: role !== "pending" });
  return p;
}

async function reconnectWelcomedAs(role: string, approved: boolean) {
  FakeWS.all[FakeWS.all.length - 1].drops();
  await vi.advanceTimersByTimeAsync(500); // the client's first reconnect backoff
  const again = FakeWS.all[FakeWS.all.length - 1];
  expect(FakeWS.all.length).toBe(2);
  again.serverOpens();
  again.serverSays({ t: "welcome", role, version: 2, canAsk: false, approved });
}

it("a pending phone accepted as controller while its socket was down is a controller after it reconnects", async () => {
  const roles: string[] = [];
  const phone = await phoneWith("pending", roles);
  expect(phone.role).toBe("pending");
  await reconnectWelcomedAs("controller", true);
  expect(phone.role).toBe("controller");
  expect(roles).toEqual(["controller"]);
});

it("a viewer promoted to controller while its screen was locked gets the controls after it reconnects", async () => {
  const roles: string[] = [];
  const phone = await phoneWith("viewer", roles);
  await reconnectWelcomedAs("controller", true);
  expect(phone.role).toBe("controller");
  expect(roles).toEqual(["controller"]);
});

it("a controller demoted to viewer while away no longer believes it is a controller", async () => {
  const roles: string[] = [];
  const phone = await phoneWith("controller", roles);
  await reconnectWelcomedAs("viewer", true);
  expect(phone.role).toBe("viewer");
  expect(roles).toEqual(["viewer"]);
});

it("an unchanged role on reconnect reports no role change", async () => {
  const roles: string[] = [];
  const phone = await phoneWith("controller", roles);
  await reconnectWelcomedAs("controller", true);
  expect(phone.role).toBe("controller");
  expect(roles).toEqual([]);
});
