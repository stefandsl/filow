import { expect, it } from "vitest";
import { classifyServer } from "./mirrorServer";

it("trusts the relay on the host that served the page: the desktop's own QR code (web :4747, relay :4748)", () => {
  expect(classifyServer("http://192.168.1.100:4748", "http://192.168.1.100:4747")).toEqual({ kind: "trusted", url: "http://192.168.1.100:4748", host: "192.168.1.100:4748" });
  expect(classifyServer("https://relay.example:443/x?y=1", "https://relay.example")).toMatchObject({ kind: "trusted", url: "https://relay.example" });
});

it("asks before another host, and before an https page would drop to a plain-http relay", () => {
  expect(classifyServer("https://abc.trycloudflare.com", "http://192.168.1.100:4747").kind).toBe("ask");
  expect(classifyServer("http://192.168.1.100.evil.example:4748", "http://192.168.1.100:4747").kind).toBe("ask");
  expect(classifyServer("http://web.example:4748", "https://web.example").kind).toBe("ask");
});

it("never uses a relay that is not http(s) or not a URL", () => {
  expect(classifyServer("javascript:alert(1)", "http://192.168.1.100:4747").kind).toBe("invalid");
  expect(classifyServer("ws://192.168.1.100:4748", "http://192.168.1.100:4747").kind).toBe("invalid");
  expect(classifyServer("not a url", "http://192.168.1.100:4747").kind).toBe("invalid");
});
