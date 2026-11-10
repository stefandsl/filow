"use client";
import { useEffect, useState } from "react";
import { desktopBridge, type RemoteStatus } from "./sessionUrl";

/**
 * The desktop shell's public link, live: null until the shell answers (and always in a browser).
 * The link comes up a few seconds after the window opens; pages follow it with this hook instead of
 * being reloaded.
 */
export function useRemoteStatus(): RemoteStatus | null {
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.remoteStatus) return;
    let alive = true;
    void bridge.remoteStatus().then((s) => alive && setRemote(s)).catch(() => undefined);
    const off = bridge.onRemoteStatus?.((s) => alive && setRemote(s));
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return remote;
}

/** Is the phone link open to any network right now? Falls back to what the page was loaded with. */
export function publicLinkOn(remote: RemoteStatus | null): boolean {
  return remote ? remote.state === "on" && Boolean(remote.url) : Boolean(desktopBridge()?.remoteShare);
}
