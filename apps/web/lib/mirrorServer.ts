/**
 * The relay a phone's mirror page connects to, from its ?server= parameter (docs/PLATFORMS.md, phones).
 * - "trusted": the relay runs on the host that served this page. The desktop's own QR code always points
 *   there (web app on one port, relay on the next, e.g. :4747 and :4748), so no question is asked.
 * - "ask": another host (for example a public tunnel link pasted from elsewhere); the user confirms first.
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
  // Same host and no downgrade from an https page to a plain-http relay.
  const sameHost = u.hostname === page.hostname && !(page.protocol === "https:" && u.protocol === "http:");
  return { kind: sameHost ? "trusted" : "ask", url: u.origin, host: u.host };
}
