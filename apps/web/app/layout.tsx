import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Filow",
  description: "Speak freely. Stay on point. Filow listens as you present, checks off your talking points as you cover them and shows what you missed.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon.png", sizes: "512x512" }], apple: "/apple-touch-icon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
