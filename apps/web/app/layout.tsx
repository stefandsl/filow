import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intelliprompter",
  description: "A teleprompter that checks off your talking points as you say them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
