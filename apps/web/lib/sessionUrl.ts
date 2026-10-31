/**
 * Where the session server lives, as seen from the browser.
 * 1. Desktop app: window.intelliprompter.sessionUrl (LAN relay or hosted server).
 * 2. NEXT_PUBLIC_SESSION_URL set at build time: use it ("" = same origin, hosted mode behind Caddy).
 * 3. Otherwise: same host, port 4748 (dev).
 */
export type DesktopBridge = {
  desktop: true;
  mode: "lan" | "hosted";
  sessionUrl: string;
  mirrorOrigin: string;
  /** Relay URL for the phone when it differs from the engine's (public tunnel). */
  mirrorServerUrl?: string;
  remoteShare?: boolean;
  setRemoteShare?: (on: boolean) => void;
  /** The engine page tells the shell its session so local views (PowerPoint pane) can join it. */
  reportSession?: (info: { id: string; code: string }) => void;
  remoteStatus?: () => Promise<RemoteStatus>;
  onRemoteStatus?: (fn: (s: RemoteStatus) => void) => () => void;
  accessPassword: string;
};

export type RemoteStatus = {
  state: "off" | "downloading" | "connecting" | "on" | "error";
  url: string;
  error: string;
  wanted?: boolean;
};

export function desktopBridge(): DesktopBridge | null {
  return (globalThis as { intelliprompter?: DesktopBridge }).intelliprompter ?? null;
}

export function sessionServerUrl(): string {
  const bridge = desktopBridge();
  if (bridge) return bridge.sessionUrl;
  const configured = process.env.NEXT_PUBLIC_SESSION_URL;
  if (configured !== undefined && configured !== "auto") {
    return configured === "" ? window.location.origin : configured;
  }
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4748`;
}

/** Origin a phone should open for /mirror. */
export function mirrorOrigin(): string {
  return desktopBridge()?.mirrorOrigin ?? window.location.origin;
}

/** Relay URL the phone should use; the engine's own URL unless the desktop app exposes a public one. */
export function mirrorServerUrl(): string {
  return desktopBridge()?.mirrorServerUrl || sessionServerUrl();
}
