// Filow's one change to libuiohook's Windows hook registration (libuiohook/src/windows/input_hook.c), as a
// function over the source text so build.mjs can apply it and a test can check it still fits the library.

/** The two lines of the library that register the hooks for its own DLL (`hInst`). */
export const ORIGINAL = `    keyboard_event_hhook = SetWindowsHookEx(WH_KEYBOARD_LL, keyboard_hook_event_proc, hInst, 0);
    mouse_event_hhook = SetWindowsHookEx(WH_MOUSE_LL, mouse_hook_event_proc, hInst, 0);
`;

/**
 * Added right after them. A low-level hook runs in the thread that registered it, so Windows needs no DLL
 * to load into other programs; the module handle is only a name it keeps. When it refuses that name
 * (ERROR_MOD_NOT_FOUND, 126: seen on Windows 11 for every DLL while the program's own module and no module
 * at all were still accepted), register the same procedures for the program itself, then with no module.
 */
export const ADDED = `
    // Filow patch (apps/desktop/native/uiohook): Windows can refuse low-level hooks registered for a DLL
    // with ERROR_MOD_NOT_FOUND (126) while it accepts them for the program itself or for no module.
    if (keyboard_event_hhook == NULL || mouse_event_hhook == NULL) {
        DWORD first_error = GetLastError();
        HINSTANCE fallback[2] = { GetModuleHandle(NULL), NULL };
        for (int i = 0; i < 2 && (keyboard_event_hhook == NULL || mouse_event_hhook == NULL); i++) {
            if (fallback[i] == hInst) {
                continue;
            }
            if (keyboard_event_hhook == NULL) {
                keyboard_event_hhook = SetWindowsHookEx(WH_KEYBOARD_LL, keyboard_hook_event_proc, fallback[i], 0);
            }
            if (mouse_event_hhook == NULL) {
                mouse_event_hhook = SetWindowsHookEx(WH_MOUSE_LL, mouse_hook_event_proc, fallback[i], 0);
            }
        }
        if (keyboard_event_hhook != NULL && mouse_event_hhook != NULL) {
            logger(LOG_LEVEL_WARN, "%s [%u]: SetWindowsHookEx() refused the library module (%#lX); hooks registered without it.\\n",
                    __FUNCTION__, __LINE__, (unsigned long) first_error);
        }
    }
`;

/** input_hook.c with the fallback added. Throws when the library's lines are not where they were. */
export function patchInputHook(source) {
  const text = source.replace(/\r\n/g, "\n");
  if (text.includes("Filow patch")) return text;
  const at = text.indexOf(ORIGINAL);
  if (at < 0 || text.indexOf(ORIGINAL, at + 1) >= 0) throw new Error("uiohook-napi changed: the hook registration lines were not found exactly once in input_hook.c");
  return text.slice(0, at + ORIGINAL.length) + ADDED + text.slice(at + ORIGINAL.length);
}
