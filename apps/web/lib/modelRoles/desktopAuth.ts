// Only the Filow desktop window may change where tasks run. main.js makes a token at each launch and
// hands it to this in-process server (globalThis) and, through the preload bridge over a guarded IPC
// channel, to its own window only. A paired phone, the PowerPoint pane, the browser extension or a
// tunnel visitor never has it, whatever address they use.
import { timingSafeEqual } from "node:crypto";
import { DESKTOP_HEADER } from "./view";

export { DESKTOP_HEADER };

/** The token of this launch; FILOW_DESKTOP_TOKEN in tests. Null outside the desktop app. */
export const desktopToken = (): string | null =>
  (globalThis as { __filowDesktopToken?: string }).__filowDesktopToken || process.env.FILOW_DESKTOP_TOKEN || null;

/**
 * True when the request comes from the desktop window. Without a desktop app (the web app on its
 * own, for development) there is no token: changes are allowed only when no password guards the
 * server, that is when nothing else can reach it as a paired client.
 */
export function fromDesktop(req: Request): boolean {
  const token = desktopToken();
  if (!token) return !process.env.ACCESS_PASSWORD;
  const given = Buffer.from(req.headers.get(DESKTOP_HEADER) ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}
