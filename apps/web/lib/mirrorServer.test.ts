import { expect, it } from "vitest";
import { classifyServer } from "./mirrorServer";

it("trusts the relay the desktop's own QR code points to: same host, next port up (web :4747, relay :4748)", () => {
  expect(classifyServer("http://192.168.1.100:4748", "http://192.168.1.100:4747")).toEqual({ kind: "trusted", url: "http://192.168.1.100:4748", host: "192.168.1.100:4748" });
  expect(classifyServer("https://relay.example:443/x?y=1", "https://relay.example")).toMatchObject({ kind: "trusted", url: "https://relay.example" });
  expect(classifyServer("https://relay.example:444", "https://relay.example").kind).toBe("trusted");
});

it("asks before any other port on the same host: another program on that computer, a shared tunnel host", () => {
  expect(classifyServer("http://192.168.1.100:9999", "http://192.168.1.100:4747").kind).toBe("ask");
  expect(classifyServer("http://192.168.1.100:4746", "http://192.168.1.100:4747").kind).toBe("ask");
  expect(classifyServer("http://192.168.1.100", "http://192.168.1.100:4747").kind).toBe("ask");
  expect(classifyServer("http://tcp.tunnel.example:19999", "http://tcp.tunnel.example:12345").kind).toBe("ask");
  // the same address written another way is still that address, and still the wrong port
  expect(classifyServer("http://3232235876:9999", "http://192.168.1.100:4747").kind).toBe("ask");
  expect(classifyServer("http://0xC0A80164:4748", "http://192.168.1.100:4747").kind).toBe("trusted");
});

it("asks before another host, and before an https page would drop to a plain-http relay", () => {
  expect(classifyServer("https://abc.trycloudflare.com", "http://192.168.1.100:4747").kind).toBe("ask");
  expect(classifyServer("http://192.168.1.100.evil.example:4748", "http://192.168.1.100:4747").kind).toBe("ask");
  expect(classifyServer("http://web.example:4748", "https://web.example").kind).toBe("ask");
  expect(classifyServer("http://web.example:444", "https://web.example").kind).toBe("ask");
});

it("never uses a relay that is not http(s) or not a URL", () => {
  expect(classifyServer("javascript:alert(1)", "http://192.168.1.100:4747").kind).toBe("invalid");
  expect(classifyServer("ws://192.168.1.100:4748", "http://192.168.1.100:4747").kind).toBe("invalid");
  expect(classifyServer("not a url", "http://192.168.1.100:4747").kind).toBe("invalid");
});
