import type { Metadata, Viewport } from "next";
import "./globals.css";
import { UiPreferencesProvider } from "../components/UiPreferencesProvider";

// The manifest comes from app/manifest.ts (Next.js links it). appleWebApp and the extra meta tag make the
// phone mirror open full screen from the iOS home screen (iOS before 16.4 ignores the manifest);
// formatDetection stops iOS from turning a pairing code into a phone-number link.
export const metadata: Metadata = {
  title: "Filow",
  description: "Speak freely. Stay on point. Filow listens as you present, checks off your talking points as you cover them and shows what you missed.",
  icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon.png", sizes: "512x512" }], apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Filow", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  other: { "apple-mobile-web-app-capable": "yes" },
};

// Browser and phone status-bar colour: the page background of each theme (apps/web/app/theme-tokens.css).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><UiPreferencesProvider>{children}</UiPreferencesProvider></body>
    </html>
  );
}
