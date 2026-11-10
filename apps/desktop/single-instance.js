// One Filow per profile. Without this a second launch on the same profile opened its own splash, started
// a second pair of servers, died on "listen EADDRINUSE" for the session port and left the running
// window where it was (reproduced on the packaged 0.9.30 build, 2026-11-10).
//
// Electron keys the lock on the userData folder, so it must be claimed after FILOW_USER_DATA_DIR has
// been applied: test profiles (tools/autoloop probes) keep running side by side with the user's Filow.
// Filow has no file associations and no link scheme yet, so a second launch carries nothing to hand
// over; if one is added, read it from `argv` in onSecondInstance.

/**
 * Claims the lock for this profile. Returns false when another Filow already runs on it: the caller
 * must then start nothing (no servers, no windows) and leave; Electron has already told the running
 * one, which comes to the front through onSecondInstance.
 */
function claimSingleInstance(app, onSecondInstance) {
  if (!app.requestSingleInstanceLock()) return false;
  app.on("second-instance", (_event, argv, workingDirectory) => onSecondInstance({ argv, workingDirectory }));
  return true;
}

const alive = (w) => Boolean(w && !w.isDestroyed());

/**
 * The window a second launch brings forward: the welcome while it is open, else the main window once
 * it is on screen, else the splash while the app is still starting. A main window still loading
 * behind the splash is not shown early (the startup watchdog decides that).
 */
function windowToFront({ welcome, main, splash }) {
  if (alive(welcome)) return welcome;
  if (alive(main) && main.isVisible()) return main;
  if (alive(splash)) return splash;
  if (alive(main) && main.isMinimized()) return main;
  return null;
}

/** Restores a minimized window, shows it and gives it the keyboard. */
function bringToFront(win) {
  if (!alive(win)) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

module.exports = { claimSingleInstance, windowToFront, bringToFront };
