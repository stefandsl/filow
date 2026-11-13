// Full screen of the main window. On Windows and Linux the frame and the menu go with it, so the only
// way back was knowing F11; the page now shows a bar at the top on hover (apps/web/components/
// FullScreenBar.tsx) whose buttons come here. Only the main window's own page, on the app's origin
// (`trusted`, main.js uiSender), can ask, and only for its own window.

/** What each button does to the main window. */
const ACTIONS = {
  "window:exitFullScreen": (win) => win.setFullScreen(false),
  "window:minimize": (win) => win.minimize(),
  "window:close": (win) => win.close(),
};
/** main sends the page this channel with true or false whenever the window enters or leaves full screen. */
const STATE_CHANNEL = "window:fullScreen";

/**
 * @param {{ ipcMain: { on: Function, handle: Function }, mainWindow: () => any, trusted: (event: any) => boolean }} deps
 */
function wireWindowControls({ ipcMain, mainWindow, trusted }) {
  const ourSender = (event) => {
    const win = mainWindow();
    return win && !win.isDestroyed() && event && event.sender === win.webContents && trusted(event) ? win : null;
  };
  for (const [channel, act] of Object.entries(ACTIONS)) {
    ipcMain.on(channel, (event) => { const win = ourSender(event); if (win) act(win); });
  }
  // A page loaded while the window is already in full screen (a reload) asks once.
  ipcMain.handle("window:isFullScreen", (event) => {
    const win = ourSender(event);
    if (!win) throw new Error("Denied");
    return win.isFullScreen();
  });
}

/** Tells the main window's page when the window enters or leaves full screen. */
function forwardFullScreen(win) {
  const send = (on) => { if (!win.isDestroyed()) win.webContents.send(STATE_CHANNEL, on); };
  win.on("enter-full-screen", () => send(true));
  win.on("leave-full-screen", () => send(false));
}

module.exports = { ACTIONS, STATE_CHANNEL, wireWindowControls, forwardFullScreen };
