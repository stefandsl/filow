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
    let receivedEvent = false;
    const off = bridge.onRemoteStatus?.((s) => {
      receivedEvent = true;
      if (alive) setRemote(s);
    });
    void bridge.remoteStatus().then((s) => { if (alive && !receivedEvent) setRemote(s); }).catch(() => undefined);
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
