"use client";
// Whether a page shows its link to /account: only in the desktop app, and only in a build that has
// accounts (the origin is set at build time, apps/desktop/account.js buildAccountOrigin). A normal
// release has none, so the link is never shown there.
import { useEffect, useState } from "react";
import { desktopBridge } from "@/lib/sessionUrl";

export function useAccountLink(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    const ask = desktopBridge()?.account?.configured;
    if (!ask) return;
    ask().then((on) => { if (live) setShown(on === true); }, () => {});
    return () => { live = false; };
  }, []);
  return shown;
}