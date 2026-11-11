// Filow's dictation target helper for Windows (see README.md in this folder). N-API, no dependencies.
//   info()        -> facts about the window that has the keyboard right now: process name, window class,
//                    whether it runs as administrator, whether the focused control is a password box,
//                    whether this is a remote desktop session. Never a window title, never any text.
//   sendPaste()   -> presses Ctrl + V with SendInput; returns how many of the 4 key events Windows accepted
//                    (0 when the target refuses input from this program, for example an administrator window).
//   typeText(s)   -> types the string as Unicode characters with SendInput (for terminals, where Ctrl + V is
//                    not paste); returns how many key events Windows accepted (2 per UTF-16 unit).
#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <ole2.h>
#include <uiautomation.h>
#include <node_api.h>
#include <string>
#include <vector>

static IUIAutomation* g_uia = nullptr;
static bool g_uiaTried = false;

static IUIAutomation* Uia() {
  if (g_uiaTried) return g_uia;
  g_uiaTried = true;
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) return nullptr;
  if (FAILED(CoCreateInstance(__uuidof(CUIAutomation8), nullptr, CLSCTX_INPROC_SERVER, __uuidof(IUIAutomation), (void**)&g_uia))) {
    if (FAILED(CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER, __uuidof(IUIAutomation), (void**)&g_uia))) { g_uia = nullptr; return nullptr; }
  }
  // A program that does not answer must not hold the dictation up: short time limits on every call.
  IUIAutomation2* two = nullptr;
  if (SUCCEEDED(g_uia->QueryInterface(__uuidof(IUIAutomation2), (void**)&two)) && two) {
    two->put_ConnectionTimeout(300);
    two->put_TransactionTimeout(500);
    two->Release();
  }
  return g_uia;
}

// 1 elevated (or not readable from here, which blocks input the same way), 0 not, -1 unknown.
static int Elevated(DWORD pid) {
  HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!p) return GetLastError() == ERROR_ACCESS_DENIED ? 1 : -1;
  HANDLE t = nullptr;
  int out = -1;
  if (OpenProcessToken(p, TOKEN_QUERY, &t)) {
    TOKEN_ELEVATION e; DWORD n = 0;
    if (GetTokenInformation(t, TokenElevation, &e, sizeof(e), &n)) out = e.TokenIsElevated ? 1 : 0;
    CloseHandle(t);
  } else if (GetLastError() == ERROR_ACCESS_DENIED) out = 1;
  CloseHandle(p);
  return out;
}

static std::wstring ExeName(DWORD pid) {
  HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!p) return L"";
  wchar_t buf[1024]; DWORD n = 1024;
  std::wstring out;
  if (QueryFullProcessImageNameW(p, 0, buf, &n)) {
    std::wstring full(buf, n);
    size_t at = full.find_last_of(L"\\/");
    out = at == std::wstring::npos ? full : full.substr(at + 1); // the file name only: a path can hold a user name
  }
  CloseHandle(p);
  return out;
}

static void SetStr(napi_env env, napi_value obj, const char* key, const std::wstring& v) {
  napi_value s; napi_create_string_utf16(env, (const char16_t*)v.c_str(), v.size(), &s); napi_set_named_property(env, obj, key, s);
}
static void SetNum(napi_env env, napi_value obj, const char* key, double v) {
  napi_value n; napi_create_double(env, v, &n); napi_set_named_property(env, obj, key, n);
}
static void SetBool(napi_env env, napi_value obj, const char* key, bool v) {
  napi_value b; napi_get_boolean(env, v, &b); napi_set_named_property(env, obj, key, b);
}

static napi_value Info(napi_env env, napi_callback_info) {
  napi_value o; napi_create_object(env, &o);
  HWND fg = GetForegroundWindow();
  DWORD pid = 0;
  DWORD tid = fg ? GetWindowThreadProcessId(fg, &pid) : 0;
  wchar_t cls[256] = L"";
  if (fg) GetClassNameW(fg, cls, 256);
  wchar_t fcls[256] = L"";
  bool password = false;
  GUITHREADINFO gi; gi.cbSize = sizeof(gi);
  if (tid && GetGUIThreadInfo(tid, &gi) && gi.hwndFocus) {
    GetClassNameW(gi.hwndFocus, fcls, 256);
    // A classic Windows password box.
    if (GetWindowLongPtrW(gi.hwndFocus, GWL_STYLE) & ES_PASSWORD) { if (_wcsicmp(fcls, L"Edit") == 0) password = true; }
  }
  // Browsers, Electron apps and modern Windows apps say it through UI Automation.
  bool uiaOk = false;
  if (fg && !password) {
    IUIAutomation* u = Uia();
    IUIAutomationElement* el = nullptr;
    if (u && SUCCEEDED(u->GetFocusedElement(&el)) && el) {
      BOOL pw = FALSE;
      if (SUCCEEDED(el->get_CurrentIsPassword(&pw))) { uiaOk = true; password = pw != FALSE; }
      el->Release();
    }
  }
  SetNum(env, o, "hwnd", (double)(uintptr_t)fg);
  SetNum(env, o, "pid", (double)pid);
  SetStr(env, o, "exe", pid ? ExeName(pid) : L"");
  SetStr(env, o, "cls", cls);
  SetStr(env, o, "focusCls", fcls);
  SetNum(env, o, "elevated", pid ? Elevated(pid) : -1);
  SetNum(env, o, "selfElevated", Elevated(GetCurrentProcessId()));
  SetBool(env, o, "own", pid == GetCurrentProcessId());
  SetBool(env, o, "password", password);
  SetBool(env, o, "passwordChecked", password || uiaOk);
  SetBool(env, o, "remote", GetSystemMetrics(SM_REMOTESESSION) != 0);
  return o;
}

static UINT Send(std::vector<INPUT>& in) {
  if (in.empty()) return 0;
  UINT sent = 0;
  // In pieces: one very long call can be cut by Windows.
  for (size_t at = 0; at < in.size(); at += 64) {
    UINT n = (UINT)(in.size() - at < 64 ? in.size() - at : 64);
    UINT r = SendInput(n, &in[at], sizeof(INPUT));
    sent += r;
    if (r != n) break;
  }
  return sent;
}

static INPUT Key(WORD vk, WORD scan, DWORD flags) {
  INPUT i; ZeroMemory(&i, sizeof(i));
  i.type = INPUT_KEYBOARD; i.ki.wVk = vk; i.ki.wScan = scan; i.ki.dwFlags = flags;
  return i;
}

static napi_value SendPaste(napi_env env, napi_callback_info) {
  std::vector<INPUT> in;
  WORD sc = (WORD)MapVirtualKeyW(VK_CONTROL, MAPVK_VK_TO_VSC), sv = (WORD)MapVirtualKeyW('V', MAPVK_VK_TO_VSC);
  in.push_back(Key(VK_CONTROL, sc, 0));
  in.push_back(Key('V', sv, 0));
  in.push_back(Key('V', sv, KEYEVENTF_KEYUP));
  in.push_back(Key(VK_CONTROL, sc, KEYEVENTF_KEYUP));
  napi_value out; napi_create_uint32(env, Send(in), &out);
  return out;
}

static napi_value TypeText(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  size_t len = 0;
  napi_value out;
  if (argc < 1 || napi_get_value_string_utf16(env, argv[0], nullptr, 0, &len) != napi_ok || len == 0 || len > 20000) { napi_create_uint32(env, 0, &out); return out; }
  std::vector<char16_t> buf(len + 1);
  napi_get_value_string_utf16(env, argv[0], buf.data(), len + 1, &len);
  std::vector<INPUT> in;
  in.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    char16_t c = buf[i];
    if (c == u'\r') continue;
    if (c == u'\n' || c == u'\t') continue; // never Enter or Tab: in a terminal or a chat box they would send what was said
    in.push_back(Key(0, (WORD)c, KEYEVENTF_UNICODE));
    in.push_back(Key(0, (WORD)c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
  }
  napi_create_uint32(env, Send(in), &out);
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor d[] = {
    { "info", nullptr, Info, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "sendPaste", nullptr, SendPaste, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "typeText", nullptr, TypeText, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
  };
  napi_define_properties(env, exports, 3, d);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
