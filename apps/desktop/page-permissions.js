// SEC-08 (docs/autoloop/STANDARDS.md): which web permissions a page in a Filow window is granted.
// (Not to be confused with mac-permissions.js, which is about macOS System Settings for the keyboard hook.)
//
// Only Filow's own pages get anything: the pages of the local app server (isAppPage from main.js, the
// same test the navigation guard uses) and an exact list of the shell's own file pages that need it
// (today only welcome.html, which tests the microphone). They get only:
//   - the microphone: a "media" request or check about audio only; one that names the camera, names
//     nothing or says "unknown" is refused;
//   - "display-capture": getDisplayMedia, used by OK Filow and the screen watcher; the source itself is
//     still chosen by setDisplayMediaRequestHandler in main.js;
//   - "notifications": apps/web/lib/notify.ts.
// Everything else (camera, geolocation, MIDI, clipboard, fullscreen, wake lock, ...) is refused, on every
// page. The wider csp.js isOwnOrigin (localhost, LAN addresses) is deliberately not used here: those are
// for other devices reaching the server, not for pages inside Filow's windows.

/** The permissions an own page may have when nothing narrows them further. */
const GRANTABLE = ["media", "display-capture", "notifications"];

/**
 * @param {{ isAppPage: (url: string) => boolean, filePages: string[], permitted?: (permission: string) => boolean }} pages
 *   isAppPage: true for a page of the local app server; filePages: exact file: URLs that are trusted;
 *   permitted: the shell's own rule for a permission name (main.js passes permissionFor, which also
 *   withholds the real microphone from a test instance). It can only narrow what a page gets.
 */
function createPagePermissions({ isAppPage, filePages, permitted = () => true }) {
  const isOwnPage = (url) => isAppPage(url) || filePages.includes(url);
  /**
   * @param {string} permission Electron's permission name
   * @param {string} url the requesting frame's URL
   * @param {string[]} mediaTypes what a "media" permission is about ("audio", "video", "unknown")
   */
  const allowed = (permission, url, mediaTypes) => {
    if (!isOwnPage(url) || !GRANTABLE.includes(permission) || !permitted(permission)) return false;
    return permission !== "media" || (mediaTypes.length > 0 && mediaTypes.every((t) => t === "audio"));
  };
  return {
    allowed,
    /** session.setPermissionRequestHandler: Electron always passes the frame's requestingUrl here. */
    request: (_webContents, permission, callback, details = {}) =>
      callback(allowed(permission, details.requestingUrl || "", details.mediaTypes || [])),
    /**
     * session.setPermissionCheckHandler: the frame's URL when Electron gives one, else its origin. A file
     * page's origin is only "file://", which matches no file page, so a check without a URL fails closed.
     */
    check: (_webContents, permission, requestingOrigin, details = {}) =>
      allowed(permission, details.requestingUrl || requestingOrigin || "", details.mediaType ? [details.mediaType] : []),
  };
}

module.exports = { createPagePermissions };
