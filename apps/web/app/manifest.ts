import type { MetadataRoute } from "next";

/**
 * Web app manifest for the phone companion (docs/PLATFORMS.md, Android and iOS). Served by Next.js at
 * /manifest.webmanifest and linked from every page. The installable app is the mirror only: id, start_url
 * and scope are /mirror, so desktop pages never show as installable and the phone app never wanders into
 * them. With no pairing code in the URL /mirror asks for one, so the home-screen icon always works.
 *
 * No service worker on purpose: Chrome (Android and desktop) no longer requires one to install, iOS never
 * did, and the mirror is useless offline. A worker would only risk serving stale pages after an update or
 * getting between the phone and the live session (fetch to /api/session*, WebSocket /ws/session).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/mirror",
    name: "Filow Mirror",
    short_name: "Filow",
    description: "Speak freely. Stay on point. Filow listens as you present and checks off your talking points.",
    start_url: "/mirror",
    scope: "/mirror",
    display: "standalone",
    orientation: "any",
    background_color: "#121212",
    theme_color: "#121212",
    categories: ["productivity", "education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
