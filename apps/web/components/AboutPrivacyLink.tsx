"use client";
import { useEffect, useState } from "react";
import { useT } from "@filow/ui";
import { desktopBridge } from "@/lib/sessionUrl";

/**
 * Settings > Privacy: opens the desktop app's "About and privacy" window, where the privacy policy that
 * ships inside the app is shown offline. Only in the desktop app (a browser tab has no such window).
 */
export function AboutPrivacyLink() {
  const t = useT();
  const [canOpen, setCanOpen] = useState(false);
  useEffect(() => setCanOpen(Boolean(desktopBridge()?.openAbout)), []);
  if (!canOpen) return null;
  return (
    <div className="row">
      <button type="button" className="btn" onClick={() => desktopBridge()?.openAbout?.("about")}>
        {t("settings.aboutPrivacy")}
      </button>
      <span className="hint">{t("settings.aboutPrivacyHint")}</span>
    </div>
  );
}
