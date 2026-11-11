"use client";
// The OK Filow windows (panel, overlay, 3D model) speak the interface language the user picked: the same
// preference the main window reads (useUiLang), kept in sync across windows by lib/prefs.
import type { ReactNode } from "react";
import { LangProvider } from "@filow/ui";
import { useUiLang } from "@/components/LangSwitch";

export default function OkFilowLayout({ children }: { children: ReactNode }) {
  const [lang] = useUiLang();
  return <LangProvider lang={lang}>{children}</LangProvider>;
}
