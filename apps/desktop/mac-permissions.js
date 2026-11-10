// macOS: OK Filow's hold-to-talk listens to the keyboard through uiohook, which needs two permissions
// the user grants in System Settings > Privacy & Security:
//   - Accessibility: libuiohook checks it before it starts (UIOHOOK_ERROR_AXAPI_DISABLED), and typing a
//     dictation (a synthetic Cmd+V) needs it too;
//   - Input Monitoring: macOS 10.15+ refuses a keyboard event tap without it
//     (UIOHOOK_ERROR_CREATE_EVENT_PORT, "Failed to create apple event port").
// Until both are granted hold-to-talk stays off, the Cmd+Option+O toggle works instead, and a
// plain-words prompt opens the right pane. Untested on a real Mac (docs/PLATFORMS.md, macOS).

const PANES = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  inputMonitoring: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
};

/**
 * Which permission hold-to-talk is missing on this Mac: "accessibility", "inputMonitoring" or null
 * (always null off macOS). Without `error` it is the check before the hook starts; with the hook's own
 * error it reads which one macOS refused.
 */
function keyboardPermission({ platform, systemPreferences, error }) {
  if (platform !== "darwin") return null;
  if (error) {
    const code = String((error && error.code) || ""), message = String((error && error.message) || error);
    if (code === "UIOHOOK_ERROR_AXAPI_DISABLED" || /assistive devices/i.test(message)) return "accessibility";
    if (code === "UIOHOOK_ERROR_CREATE_EVENT_PORT" || /apple event port/i.test(message)) return "inputMonitoring";
    return null;
  }
  try {
    return systemPreferences.isTrustedAccessibilityClient(false) ? null : "accessibility";
  } catch {
    return null; // no answer: let the hook try, its own error says what is missing
  }
}

/**
 * The prompt, once per launch for each permission: what is missing in plain words, a button that
 * opens that pane of System Settings, and what works meanwhile. menuText reads MENU_TEXT (en, it).
 */
function createKeyboardPermissionPrompt({ dialog, systemPreferences, openSystemSettings, menuText, logLine }) {
  const asked = new Set();
  return async function ask(permission) {
    if (!PANES[permission] || asked.has(permission)) return false;
    asked.add(permission);
    logLine(`okfilow: macOS has not allowed hold-to-talk yet (${permission}); asking the user`);
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Filow",
      message: menuText("macKeysMessage"),
      detail: menuText(permission === "accessibility" ? "macKeysAccessibility" : "macKeysInput"),
      buttons: [menuText("macKeysOpen"), menuText("macKeysLater")],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return false;
    // Asking with prompt=true also puts Filow in the Accessibility list, so the user only flips it on.
    if (permission === "accessibility") {
      try { systemPreferences.isTrustedAccessibilityClient(true); } catch { /* the pane still opens */ }
    }
    await openSystemSettings(PANES[permission]);
    return true;
  };
}

module.exports = { PANES, keyboardPermission, createKeyboardPermissionPrompt };
