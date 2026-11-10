/**
 * The relay a phone's mirror page connects to, from its ?server= parameter (docs/PLATFORMS.md, phones).
 * - "trusted": the relay the desktop's own QR code points to, so no question is asked: this page's own
 *   origin, or the same host one port up (web app on one port, relay on the next, e.g. :4747 and :4748).
 * - "ask": anything else, another port on this host included (another program on the same computer, a
 *   shared tunnel host) and the public link, whose page and relay are two different hosts; the user confirms.
 * - "invalid": not an http(s) URL; never used.
 */
export function classifyServer(serverParam: string, pageOrigin: string): { kind: "trusted" | "ask" | "invalid"; url: string; host: string } {
  let u: URL, page: URL;
  try {
    u = new URL(serverParam);
    page = new URL(pageOrigin);
  } catch {
    return { kind: "invalid", url: "", host: "" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { kind: "invalid", url: "", host: "" };
  const port = (x: URL) => Number(x.port) || (x.protocol === "https:" ? 443 : 80);
  // The next port up only over the same scheme: no drop from an https page to a plain-http relay.
  const nextPort = u.hostname === page.hostname && u.protocol === page.protocol && port(u) === port(page) + 1;
  return { kind: u.origin === page.origin || nextPort ? "trusted" : "ask", url: u.origin, host: u.host };
}
