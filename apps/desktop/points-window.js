// Floating windows of the shell: the presenter overlay (points over the slide show) and the points
// window for calls (a small always-on-top window to present over Teams or Zoom). One machinery for
// both: a frameless, sandboxed window with the app's preload, on top of everything (full-screen slide
// shows and every workspace included), crash reload, navigation guard, and its size and place kept.
// Both show the mirror page in overlay mode, so they read the app's own session like a paired phone.
"use strict";

/** Windows 10 2004+ and macOS can leave a window out of screen capture and sharing; Linux cannot. */
function captureHidingWorks(platform) {
  return platform === "win32" || platform === "darwin";
}

/**
 * Opens a floating window. `deps`: BrowserWindow, preload (path), reloadOnCrash(win, name),
 * guardNavigation(win), onFocus(). `spec`: name, title, url, bounds ({width, height, x?, y?}),
 * background, opacity, hidden (left out of screen capture), saveBounds(bounds), onClosed().
 */
function createFloatingWindow(deps, spec) {
  const b = spec.bounds;
  const win = new deps.BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    minimizable: false,
    skipTaskbar: true,
    hasShadow: true,
    opacity: spec.opacity,
    backgroundColor: spec.background,
    title: spec.title,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: deps.preload },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  deps.reloadOnCrash(win, spec.name);
  deps.guardNavigation(win);
  win.on("focus", () => deps.onFocus?.());
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(Boolean(spec.hidden));
  win.loadURL(spec.url);
  const remember = () => {
    if (!win.isDestroyed()) spec.saveBounds(win.getBounds());
  };
  win.on("moved", remember);
  win.on("resized", remember);
  win.on("closed", () => spec.onClosed?.());
  return win;
}

/** The mirror page as the points window: compact, with the "only you see this" line where capture hiding works. */
function pointsUrl(appUrl, code, platform) {
  return `${appUrl}/mirror?compact=1&overlay=1&points=1&private=${captureHidingWorks(platform) ? 1 : 0}${code ? `&code=${code}` : ""}`;
}

const POINTS_SIZE = { width: 380, height: 340 };

/** First place of the points window: top centre of the screen, right under where a webcam usually sits. */
function defaultPointsBounds(workArea) {
  return {
    ...POINTS_SIZE,
    x: Math.round(workArea.x + (workArea.width - POINTS_SIZE.width) / 2),
    y: workArea.y + 8,
  };
}

/** Saved bounds are used only when they still overlap a screen (a monitor may have been unplugged). */
function usableBounds(saved, workAreas) {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return null;
  if (saved.width < 200 || saved.height < 120) return null;
  const visible = workAreas.some((a) => saved.x < a.x + a.width - 40 && saved.x + saved.width > a.x + 40 && saved.y >= a.y - 8 && saved.y < a.y + a.height - 40);
  return visible ? saved : null;
}

/**
 * The points window for calls. Always left out of screen capture where the system allows it (the
 * page says so in its bar), since it is the presenter's prompter, not something to show the audience.
 * `deps`: the createFloatingWindow deps plus screen, platform, appUrl, sessionCode(), freshCode()
 * (a promise of an unspent pairing code), theme(), bounds() / saveBounds(b) (the settings store),
 * onChange(open).
 */
function createPointsWindow(deps) {
  let win = null;
  /** an opening in progress (it waits for a fresh pairing code): a second switch-on joins it */
  let opening = null;
  /** switched off while the code was on its way: do not open after all */
  let cancelled = false;
  const isOpen = () => Boolean(win && !win.isDestroyed());
  const url = (code) => pointsUrl(deps.appUrl, code, deps.platform);
  function show() {
    cancelled = false;
    if (isOpen()) {
      win.show();
      return Promise.resolve();
    }
    opening = opening || open().finally(() => (opening = null));
    return opening;
  }
  async function open() {
    // Pairing codes are single use: the window joins with one nobody has spent (main.js freshSessionCode).
    const code = deps.freshCode ? await deps.freshCode() : deps.sessionCode();
    if (cancelled || isOpen()) return;
    const screens = deps.screen.getAllDisplays().map((d) => d.workArea);
    const bounds = usableBounds(deps.bounds(), screens) || defaultPointsBounds(deps.screen.getPrimaryDisplay().workArea);
    win = createFloatingWindow(deps, {
      name: "points",
      title: "Filow points",
      url: url(code),
      bounds,
      background: deps.theme() === "dark" ? "#08090b" : "#f7f7f5",
      opacity: 1,
      hidden: captureHidingWorks(deps.platform),
      saveBounds: deps.saveBounds,
      onClosed: () => {
        win = null;
        deps.onChange(false);
      },
    });
    deps.onChange(true);
  }
  function hide() {
    cancelled = true;
    if (isOpen()) win.close(); // "closed" reports the change
    win = null;
    return Promise.resolve();
  }
  return {
    show,
    hide,
    set: (on) => (on === true ? show() : hide()),
    isOpen,
    /** Whether an IPC event came from this window (its close button asks to close it). */
    owns: (sender) => isOpen() && sender === win.webContents,
    webContents: () => (isOpen() ? win.webContents : null),
    /** The session changed (a new pairing code): load the page again so it joins the new one. */
    reload: () => {
      if (isOpen()) win.loadURL(url(deps.sessionCode()));
    },
  };
}

module.exports = { createFloatingWindow, createPointsWindow, pointsUrl, defaultPointsBounds, usableBounds, captureHidingWorks };
