# Filow's build of the uiohook-napi Windows binary

`prebuilds/win32-x64/uiohook-napi.node` is uiohook-napi 1.5.5 (MIT, with libuiohook, GPL-3.0) built from
its published sources with one change, in `patch.mjs`. `apps/desktop/uiohook.js` makes the library load
this file on Windows instead of its own prebuilt one; macOS, Linux and Windows on ARM use the stock binary.

## Why (issue #6)

The library registers its low-level keyboard and mouse hooks with
`SetWindowsHookEx(WH_KEYBOARD_LL, proc, hInst, 0)` where `hInst` is its own DLL. On the owner's PC
(Windows 11 build 26300) that call started failing with error 126 (ERROR_MOD_NOT_FOUND) for every DLL,
system DLLs included, while the same call with the program's own module handle or with no module was
accepted (measured with a few lines of P/Invoke, and with plain Node outside Electron). The OK Filow and
dictation keys were then dead for the whole session. A low-level hook runs in the thread that registered
it and is never loaded into other programs, so the module is not needed.

The change: when the registration for the DLL fails, register the same procedures for the program itself
(`GetModuleHandle(NULL)`), then with no module. Where the stock call works, nothing changes.

## Rebuild

On Windows with the Visual Studio C++ build tools and Python:

    node apps/desktop/native/uiohook/build.mjs --arch x64

After a uiohook-napi upgrade, run it again and commit the new binary; `uiohook.test.ts` fails when the
patch no longer fits the library's source or the binary was built from another version.
