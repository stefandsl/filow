"use strict";
// OK Filow's tray menu. Filow keeps running in the tray after its window closes, so the menu
// must always end with a way to quit (the 0.9.44 tray had none).
function trayTemplate({ menuText, cfg, phones, togglePanel, applyConfig, quit }) {
  return [
    // Phone questions waiting: a count only (never their text), none during a slide show.
    ...(phones ? [{ label: menuText("okfPhoneWaiting", { n: phones }), click: togglePanel }] : []),
    { label: menuText("okfOpen"), click: togglePanel },
    { label: menuText("okfShowAlways"), type: "checkbox", checked: cfg.showAlways, click: (i) => applyConfig({ showAlways: i.checked }) },
    { label: menuText("okfEnabled"), type: "checkbox", checked: cfg.enabled, click: (i) => applyConfig({ enabled: i.checked }) },
    { type: "separator" },
    { label: menuText("quit"), click: () => quit() },
  ];
}

module.exports = { trayTemplate };
