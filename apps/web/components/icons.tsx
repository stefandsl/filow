import { createElement } from "react";

/** Filow's UI symbols: a single 24-unit, 1.5px stroke set for web and welcome. */
export const iconPaths = {
  check: "M5 12l4 4L19 6",
  close: "M6 6l12 12M18 6L6 18",
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  moon: "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z",
  system: "M4 4h16v12H4ZM8 20h8m-4-4v4",
  left: "M19 12H5m6-6-6 6 6 6",
  right: "M5 12h14m-6-6 6 6-6 6",
  down: "M12 4v16m-6-6 6 6 6-6",
  up: "M12 20V4m-6 6 6-6 6 6",
  chevronRight: "m9 5 7 7-7 7",
  chevronDown: "m5 9 7 7 7-7",
  circle: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  stop: "M6 6h12v12H6Z",
  clock: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 7v5l3 2",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z",
  slides: "M3 4h18v13H3Zm9 13v4m-4 0h8M7 8h10m-10 4h6",
  phone: "M7 2h10v20H7Zm4 17h2",
  sliders: "M4 6h6m4 0h6M4 12h10m4 0h2M4 18h2m4 0h10M10 3v6m4 0v6m-8 0v6",
  grip: "M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01",
} as const;
export type IconName = keyof typeof iconPaths;

export function Icon({ name }: { name: IconName }) {
  return createElement("svg", {
    className: "icon", viewBox: "0 0 24 24", width: 20, height: 20,
    fill: "none", stroke: "currentColor", strokeWidth: 1.5,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false,
  }, createElement("path", { d: iconPaths[name] }));
}

/** DOM renderer for the isolated welcome window; paths never include external input. */
export function mountIcons(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach(host => {
    const name = host.dataset.icon as IconName;
    if (!(name in iconPaths)) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "icon" })) svg.setAttribute(key, value);
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", iconPaths[name]);
    svg.append(path);
    host.replaceChildren(svg);
  });
}
