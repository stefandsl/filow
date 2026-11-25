// Filow Windows ActionDriver native helper (X-14 pilot).
// Compiled at vendor/prestart time with Windows .NET Framework 4 csc.exe (no external SDK).
// Protocol: one command line in on stdin, one JSON line out on stdout.
//   inspect <hwnd> <parentPid>           target window metadata, elevation, password status, physical bounds, DPI
//   capture <hwnd> <maxWidth> <parentPid> target-window-only PNG (PrintWindow) + UIA elements of that window
//   readback <hwnd>                      UIA read-back of visible text, values, toggles and elements of target window
//   exec <json>                          execute one validated desktop mouse/keyboard action via SendInput
//   focus <hwnd>                         bring granted target window to foreground
//   quit                                 exit cleanly
// Never prints secrets, never captures the full desktop.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

[assembly: System.Reflection.AssemblyTitle("Filow Windows action helper")]
[assembly: System.Reflection.AssemblyProduct("Filow")]

public static class FilowActionHelper {
  [StructLayout(LayoutKind.Sequential)]
  struct RECT { public int L, T, R, B; }

  [StructLayout(LayoutKind.Sequential)]
  struct POINT { public int X, Y; }

  [StructLayout(LayoutKind.Sequential)]
  struct GUITHREADINFO {
    public int cbSize;
    public int flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct TOKEN_ELEVATION { public uint TokenIsElevated; }

  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct HARDWAREINPUT {
    public uint uMsg;
    public ushort wParamL;
    public ushort wParamH;
  }

  [StructLayout(LayoutKind.Explicit)]
  struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct INPUT {
    public uint type;
    public INPUTUNION u;
  }

  const uint INPUT_MOUSE = 0;
  const uint INPUT_KEYBOARD = 1;
  const uint MOUSEEVENTF_MOVE = 0x0001;
  const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  const uint MOUSEEVENTF_LEFTUP = 0x0004;
  const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  const uint MOUSEEVENTF_WHEEL = 0x0800;
  const uint MOUSEEVENTF_HWHEEL = 0x1000;
  const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
  const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;
  const uint PW_RENDERFULLCONTENT = 0x00000002;
  const int GWL_STYLE = -16;
  const int ES_PASSWORD = 0x0020;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const uint TOKEN_QUERY = 0x0008;
  const int TokenElevation = 20;
  const int TokenIntegrityLevel = 25;
  const uint SECURITY_MANDATORY_HIGH_RID = 0x3000;
  const int SM_XVIRTUALSCREEN = 76;
  const int SM_YVIRTUALSCREEN = 77;
  const int SM_CXVIRTUALSCREEN = 78;
  const int SM_CYVIRTUALSCREEN = 79;
  const uint MONITOR_DEFAULTTONEAREST = 2;

  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int nCmdShow);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO info);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int idx);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFO info);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int cbSize);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] static extern short VkKeyScanW(char ch);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr hProc, uint flags, StringBuilder buf, ref int size);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr hProc, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, out TOKEN_ELEVATION info, int len, out int retLen);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buf, int len, out int retLen);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint subAuth);

  static readonly JavaScriptSerializer SER = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
  static readonly Regex SPACES = new Regex("\\s+");
  static readonly HashSet<string> UIA_TYPES = new HashSet<string>(new[] {
    "Button", "Edit", "Document", "CheckBox", "RadioButton", "ComboBox", "MenuItem",
    "ListItem", "TabItem", "Hyperlink", "Text", "Slider", "Spinner", "ToggleButton",
    "SplitButton", "TreeItem", "Window", "Pane", "Custom", "Group"
  });

  static readonly Dictionary<string, ushort> VK_MAP = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase) {
    { "enter", 0x0D }, { "return", 0x0D }, { "tab", 0x09 }, { "escape", 0x1B }, { "esc", 0x1B },
    { "backspace", 0x08 }, { "bs", 0x08 }, { "delete", 0x2E }, { "del", 0x2E }, { "insert", 0x2D },
    { "space", 0x20 }, { " ", 0x20 },
    { "up", 0x26 }, { "arrowup", 0x26 }, { "down", 0x28 }, { "arrowdown", 0x28 },
    { "left", 0x25 }, { "arrowleft", 0x25 }, { "right", 0x27 }, { "arrowright", 0x27 },
    { "home", 0x24 }, { "end", 0x23 }, { "pageup", 0x21 }, { "page_up", 0x21 }, { "pagedown", 0x22 }, { "page_down", 0x22 },
    { "ctrl", 0x11 }, { "control", 0x11 }, { "control_l", 0xA2 }, { "control_r", 0xA3 },
    { "alt", 0x12 }, { "alt_l", 0xA4 }, { "alt_r", 0xA5 }, { "option", 0x12 },
    { "shift", 0x10 }, { "shift_l", 0xA0 }, { "shift_r", 0xA1 },
    { "meta", 0x5B }, { "win", 0x5B }, { "super", 0x5B }, { "command", 0x5B }, { "cmd", 0x5B }, { "lwin", 0x5B }, { "rwin", 0x5C },
    { "capslock", 0x14 }, { "numlock", 0x90 }, { "printscreen", 0x2C },
    { "f1", 0x70 }, { "f2", 0x71 }, { "f3", 0x72 }, { "f4", 0x73 }, { "f5", 0x74 }, { "f6", 0x75 },
    { "f7", 0x76 }, { "f8", 0x77 }, { "f9", 0x78 }, { "f10", 0x79 }, { "f11", 0x7A }, { "f12", 0x7B },
    { "plus", 0xBB }, { "+", 0xBB }, { "minus", 0xBD }, { "-", 0xBD }, { "=", 0xBB }, { "equal", 0xBB },
    { "*", 0x6A }, { "multiply", 0x6A }, { "/", 0xBF }, { "slash", 0xBF }, { ".", 0xBE }, { "period", 0xBE },
    { ",", 0xBC }, { "comma", 0xBC }, { ";", 0xBA }, { "semicolon", 0xBA },
  };

  static readonly HashSet<ushort> EXTENDED_VKS = new HashSet<ushort> {
    0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C, 0xA3, 0xA5
  };

  static uint IntegrityRid(IntPtr token) {
    int needed = 0;
    GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out needed);
    if (needed <= 0) return 0;
    IntPtr buf = Marshal.AllocHGlobal(needed);
    try {
      int ret = 0;
      if (!GetTokenInformation(token, TokenIntegrityLevel, buf, needed, out ret)) return 0;
      IntPtr sid = Marshal.ReadIntPtr(buf);
      if (sid == IntPtr.Zero) return 0;
      byte count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
      if (count == 0) return 0;
      return unchecked((uint)Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1))));
    } finally {
      Marshal.FreeHGlobal(buf);
    }
  }

  // Returns 1 when process runs at High/System integrity (or access denied -> higher privilege), 0 for Medium/Low, -1 unknown.
  static int IsElevated(uint pid) {
    IntPtr p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (p == IntPtr.Zero) return Marshal.GetLastWin32Error() == 5 ? 1 : -1;
    try {
      IntPtr t;
      if (!OpenProcessToken(p, TOKEN_QUERY, out t)) return Marshal.GetLastWin32Error() == 5 ? 1 : -1;
      try {
        uint il = IntegrityRid(t);
        if (il > 0) return il >= SECURITY_MANDATORY_HIGH_RID ? 1 : 0;
        TOKEN_ELEVATION e; int ret;
        if (GetTokenInformation(t, TokenElevation, out e, Marshal.SizeOf(typeof(TOKEN_ELEVATION)), out ret))
          return e.TokenIsElevated != 0 ? 1 : 0;
        return -1;
      } finally { CloseHandle(t); }
    } finally { CloseHandle(p); }
  }

  static string ExeName(uint pid) {
    IntPtr p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (p == IntPtr.Zero) return "";
    try {
      var sb = new StringBuilder(1024); int sz = sb.Capacity;
      if (!QueryFullProcessImageName(p, 0, sb, ref sz)) return "";
      return Path.GetFileName(sb.ToString());
    } finally { CloseHandle(p); }
  }

  static RECT WindowBounds(IntPtr hwnd) {
    RECT r;
    if (DwmGetWindowAttribute(hwnd, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0 && r.R > r.L && r.B > r.T) return r;
    GetWindowRect(hwnd, out r);
    return r;
  }

  static Dictionary<string, object> RectDict(RECT r) {
    return new Dictionary<string, object> {
      { "x", r.L }, { "y", r.T }, { "width", Math.Max(0, r.R - r.L) }, { "height", Math.Max(0, r.B - r.T) }
    };
  }

  static Dictionary<string, object> VirtualScreenDict() {
    return new Dictionary<string, object> {
      { "x", GetSystemMetrics(SM_XVIRTUALSCREEN) },
      { "y", GetSystemMetrics(SM_YVIRTUALSCREEN) },
      { "width", Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN)) },
      { "height", Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN)) }
    };
  }

  static Dictionary<string, object> InspectWindow(long rawHwnd, uint parentPid) {
    IntPtr hwnd = rawHwnd > 0 ? new IntPtr(rawHwnd) : GetForegroundWindow();
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return new Dictionary<string, object> { { "ok", false }, { "error", "no_window" } };
    uint pid; uint tid = GetWindowThreadProcessId(hwnd, out pid);
    var cls = new StringBuilder(256); GetClassName(hwnd, cls, 256);
    var title = new StringBuilder(512); GetWindowText(hwnd, title, 512);
    RECT bounds = WindowBounds(hwnd);
    IntPtr hMon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    var mi = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
    GetMonitorInfo(hMon, ref mi);
    uint dpi = 96;
    try { dpi = GetDpiForWindow(hwnd); if (dpi == 0) dpi = 96; } catch { dpi = 96; }
    bool password = false;
    bool passwordChecked = false;
    string focusCls = "";
    var gi = new GUITHREADINFO { cbSize = Marshal.SizeOf(typeof(GUITHREADINFO)) };
    if (tid != 0 && GetGUIThreadInfo(tid, ref gi) && gi.hwndFocus != IntPtr.Zero) {
      var fcls = new StringBuilder(256); GetClassName(gi.hwndFocus, fcls, 256);
      focusCls = fcls.ToString();
      long style = GetWindowLongPtr(gi.hwndFocus, GWL_STYLE).ToInt64();
      if ((style & ES_PASSWORD) != 0 && string.Equals(focusCls, "Edit", StringComparison.OrdinalIgnoreCase)) {
        password = true;
        passwordChecked = true;
      }
    }
    var focusedInfo = new Dictionary<string, object>();
    uint selfPid = (uint)Process.GetCurrentProcess().Id;
    bool own = (pid == selfPid) || (parentPid > 0 && pid == parentPid);
    bool hasPasswordField = password;
    if (!own) {
      try {
        var fe = AutomationElement.FocusedElement;
        if (fe != null) {
          bool isPw = fe.Current.IsPassword;
          passwordChecked = true;
          if (isPw) { password = true; hasPasswordField = true; }
          focusedInfo["name"] = (fe.Current.Name ?? "").Trim();
          focusedInfo["type"] = fe.Current.ControlType.ProgrammaticName.Replace("ControlType.", "");
          focusedInfo["isPassword"] = isPw;
          object pat;
          if (!isPw && fe.TryGetCurrentPattern(ValuePattern.Pattern, out pat)) {
            string val = ((ValuePattern)pat).Current.Value ?? "";
            focusedInfo["value"] = val.Length > 400 ? val.Substring(0, 400) : val;
          }
        }
      } catch { }
      if (!hasPasswordField) {
        try {
          var root = AutomationElement.FromHandle(hwnd);
          if (root != null) {
            var pwEl = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.IsPasswordProperty, true));
            if (pwEl != null) {
              passwordChecked = true;
              if (!pwEl.Current.IsOffscreen) { hasPasswordField = true; password = true; }
            }
          }
        } catch { }
      }
    }
    int elev = IsElevated(pid);
    int selfElev = IsElevated(parentPid > 0 ? parentPid : selfPid);
    return new Dictionary<string, object> {
      { "ok", true },
      { "hwnd", hwnd.ToInt64() },
      { "pid", (long)pid },
      { "exe", ExeName(pid) },
      { "cls", cls.ToString() },
      { "focusCls", focusCls },
      { "title", title.ToString() },
      { "own", own },
      { "elevated", elev == 1 },
      { "rawElevated", elev },
      { "selfElevated", selfElev },
      { "password", password },
      { "hasPasswordField", hasPasswordField },
      { "passwordChecked", passwordChecked },
      { "bounds", RectDict(bounds) },
      { "monitorBounds", RectDict(mi.rcMonitor) },
      { "virtualScreen", VirtualScreenDict() },
      { "dpi", (int)dpi },
      { "scaleFactor", Math.Round(dpi / 96.0, 4) },
      { "focusedElement", focusedInfo }
    };
  }

  static List<Dictionary<string, object>> ReadUiaElements(IntPtr hwnd, RECT bounds, int budgetMs, int maxElements) {
    var list = new List<Dictionary<string, object>>();
    var sw = Stopwatch.StartNew();
    int bw = Math.Max(1, bounds.R - bounds.L);
    int bh = Math.Max(1, bounds.B - bounds.T);
    try {
      var root = AutomationElement.FromHandle(hwnd);
      if (root == null) return list;
      var q = new Queue<KeyValuePair<AutomationElement, int>>();
      q.Enqueue(new KeyValuePair<AutomationElement, int>(root, 0));
      int seen = 0;
      while (q.Count > 0 && list.Count < maxElements && seen < 1200 && sw.ElapsedMilliseconds < budgetMs) {
        var pair = q.Dequeue();
        AutomationElement child = null;
        try { child = TreeWalker.ControlViewWalker.GetFirstChild(pair.Key); } catch { }
        while (child != null && list.Count < maxElements && seen < 1200 && sw.ElapsedMilliseconds < budgetMs) {
          seen++;
          try {
            var cur = child.Current;
            var r = cur.BoundingRectangle;
            string type = cur.ControlType.ProgrammaticName.Replace("ControlType.", "");
            bool isPw = cur.IsPassword;
            string name = SPACES.Replace((cur.Name ?? "").Trim(), " ");
            if (name.Length > 120) name = name.Substring(0, 120);
            string val = "";
            string toggle = "";
            if (!isPw) {
              object pat;
              if (child.TryGetCurrentPattern(ValuePattern.Pattern, out pat)) {
                val = ((ValuePattern)pat).Current.Value ?? "";
                if (val.Length > 300) val = val.Substring(0, 300);
              }
              if (val.Length == 0 && child.TryGetCurrentPattern(TextPattern.Pattern, out pat)) {
                val = ((TextPattern)pat).DocumentRange.GetText(300) ?? "";
              }
              if (child.TryGetCurrentPattern(TogglePattern.Pattern, out pat)) {
                toggle = ((TogglePattern)pat).Current.ToggleState.ToString();
              }
            }
            if (!r.IsEmpty && !cur.IsOffscreen && r.Width >= 2 && r.Height >= 2 && UIA_TYPES.Contains(type) && (name.Length > 0 || val.Length > 0 || isPw)) {
              double x1 = Math.Max(0, Math.Min(1000, ((r.X - bounds.L) / bw) * 1000.0));
              double y1 = Math.Max(0, Math.Min(1000, ((r.Y - bounds.T) / bh) * 1000.0));
              double x2 = Math.Max(0, Math.Min(1000, ((r.X + r.Width - bounds.L) / bw) * 1000.0));
              double y2 = Math.Max(0, Math.Min(1000, ((r.Y + r.Height - bounds.T) / bh) * 1000.0));
              if (x2 > x1 && y2 > y1) {
                var item = new Dictionary<string, object> {
                  { "name", name }, { "type", type }, { "isPassword", isPw },
                  { "x1", Math.Round(x1, 1) }, { "y1", Math.Round(y1, 1) },
                  { "x2", Math.Round(x2, 1) }, { "y2", Math.Round(y2, 1) }
                };
                if (val.Length > 0) item["value"] = val;
                if (toggle.Length > 0) item["toggleState"] = toggle;
                list.Add(item);
              }
            }
            if (pair.Value < 10) q.Enqueue(new KeyValuePair<AutomationElement, int>(child, pair.Value + 1));
          } catch { }
          try { child = TreeWalker.ControlViewWalker.GetNextSibling(child); } catch { child = null; }
        }
      }
    } catch { }
    return list;
  }

  static bool LooksBlank(Bitmap bmp) {
    int stepX = Math.Max(1, bmp.Width / 12);
    int stepY = Math.Max(1, bmp.Height / 12);
    Color first = bmp.GetPixel(0, 0);
    for (int y = 0; y < bmp.Height; y += stepY) {
      for (int x = 0; x < bmp.Width; x += stepX) {
        Color c = bmp.GetPixel(x, y);
        if (c.R != first.R || c.G != first.G || c.B != first.B) return false;
      }
    }
    return true;
  }

  static Dictionary<string, object> CaptureWindow(long rawHwnd, int maxWidth, uint parentPid) {
    IntPtr hwnd = rawHwnd > 0 ? new IntPtr(rawHwnd) : GetForegroundWindow();
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return new Dictionary<string, object> { { "ok", false }, { "error", "no_window" } };
    RECT bounds = WindowBounds(hwnd);
    int w = bounds.R - bounds.L;
    int h = bounds.B - bounds.T;
    if (w < 4 || h < 4) return new Dictionary<string, object> { { "ok", false }, { "error", "empty_window" } };
    using (var rawBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
      bool captured = false;
      using (var g = Graphics.FromImage(rawBmp)) {
        IntPtr hdc = g.GetHdc();
        try { captured = PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT); } finally { g.ReleaseHdc(hdc); }
      }
      if (!captured || LooksBlank(rawBmp)) {
        // Fallback: crop strictly to the target window rectangle only (never full desktop).
        using (var g = Graphics.FromImage(rawBmp)) {
          g.CopyFromScreen(bounds.L, bounds.T, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
        }
      }
      Bitmap finalBmp = rawBmp;
      bool ownsFinal = false;
      if (maxWidth > 0 && w > maxWidth) {
        int nh = Math.Max(1, (int)Math.Round(h * (maxWidth / (double)w)));
        finalBmp = new Bitmap(maxWidth, nh, PixelFormat.Format32bppArgb);
        ownsFinal = true;
        using (var g = Graphics.FromImage(finalBmp)) {
          g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
          g.DrawImage(rawBmp, 0, 0, maxWidth, nh);
        }
      }
      try {
        string b64;
        using (var ms = new MemoryStream()) {
          finalBmp.Save(ms, ImageFormat.Png);
          b64 = Convert.ToBase64String(ms.ToArray());
        }
        var info = InspectWindow(hwnd.ToInt64(), parentPid);
        var elements = ReadUiaElements(hwnd, bounds, 600, 250);
        return new Dictionary<string, object> {
          { "ok", true },
          { "hwnd", hwnd.ToInt64() },
          { "pngBase64", b64 },
          { "width", finalBmp.Width },
          { "height", finalBmp.Height },
          { "bounds", RectDict(bounds) },
          { "info", info },
          { "elements", elements }
        };
      } finally {
        if (ownsFinal) finalBmp.Dispose();
      }
    }
  }

  static Dictionary<string, object> ReadBackWindow(long rawHwnd) {
    IntPtr hwnd = rawHwnd > 0 ? new IntPtr(rawHwnd) : GetForegroundWindow();
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return new Dictionary<string, object> { { "ok", false }, { "error", "no_window" } };
    var title = new StringBuilder(512); GetWindowText(hwnd, title, 512);
    RECT bounds = WindowBounds(hwnd);
    var elements = ReadUiaElements(hwnd, bounds, 700, 300);
    return new Dictionary<string, object> {
      { "ok", true },
      { "hwnd", hwnd.ToInt64() },
      { "title", title.ToString() },
      { "bounds", RectDict(bounds) },
      { "elements", elements }
    };
  }

  static void ToVirtualAbs(int physX, int physY, out int dx, out int dy) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = Math.Max(2, GetSystemMetrics(SM_CXVIRTUALSCREEN));
    int vh = Math.Max(2, GetSystemMetrics(SM_CYVIRTUALSCREEN));
    dx = (int)Math.Round(((physX - vx) * 65535.0) / (vw - 1));
    dy = (int)Math.Round(((physY - vy) * 65535.0) / (vh - 1));
    if (dx < 0) dx = 0; if (dx > 65535) dx = 65535;
    if (dy < 0) dy = 0; if (dy > 65535) dy = 65535;
  }

  static INPUT MakeMouse(int dx, int dy, uint flags, uint mouseData) {
    var i = new INPUT { type = INPUT_MOUSE };
    i.u.mi.dx = dx;
    i.u.mi.dy = dy;
    i.u.mi.mouseData = mouseData;
    i.u.mi.dwFlags = flags;
    return i;
  }

  static INPUT MakeKey(ushort vk, ushort scan, uint flags) {
    var i = new INPUT { type = INPUT_KEYBOARD };
    i.u.ki.wVk = vk;
    i.u.ki.wScan = scan;
    i.u.ki.dwFlags = flags;
    return i;
  }

  static uint SendAll(List<INPUT> list) {
    if (list.Count == 0) return 0;
    int cb = Marshal.SizeOf(typeof(INPUT));
    uint total = 0;
    for (int at = 0; at < list.Count; at += 64) {
      int n = Math.Min(64, list.Count - at);
      var slice = new INPUT[n];
      list.CopyTo(at, slice, 0, n);
      uint sent = SendInput((uint)n, slice, cb);
      total += sent;
      if (sent != (uint)n) break;
    }
    return total;
  }

  static bool ResolveVk(string key, out ushort vk) {
    vk = 0;
    if (string.IsNullOrEmpty(key)) return false;
    string k = key.Trim();
    if (VK_MAP.TryGetValue(k, out vk)) return true;
    if (k.Length == 1) {
      char ch = k[0];
      if (ch >= 'a' && ch <= 'z') { vk = (ushort)char.ToUpperInvariant(ch); return true; }
      if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) { vk = (ushort)ch; return true; }
      short mapped = VkKeyScanW(ch);
      if (mapped != -1) { vk = (ushort)(mapped & 0xFF); return true; }
    }
    return false;
  }

  static int GetInt(Dictionary<string, object> d, string k, int fallback) {
    object v;
    if (!d.TryGetValue(k, out v) || v == null) return fallback;
    return Convert.ToInt32(v, CultureInfo.InvariantCulture);
  }

  static bool GetBool(Dictionary<string, object> d, string k, bool fallback) {
    object v;
    if (!d.TryGetValue(k, out v) || v == null) return fallback;
    return Convert.ToBoolean(v, CultureInfo.InvariantCulture);
  }

  static string GetStr(Dictionary<string, object> d, string k) {
    object v;
    if (!d.TryGetValue(k, out v) || v == null) return "";
    return Convert.ToString(v, CultureInfo.InvariantCulture) ?? "";
  }

  static Dictionary<string, object> ExecAction(string json) {
    var sw = Stopwatch.StartNew();
    var req = SER.Deserialize<Dictionary<string, object>>(json);
    if (req == null) return new Dictionary<string, object> { { "ok", false }, { "error", "bad_json" } };
    string action = GetStr(req, "action");
    long hwndVal = req.ContainsKey("hwnd") && req["hwnd"] != null ? Convert.ToInt64(req["hwnd"], CultureInfo.InvariantCulture) : 0;
    if (hwndVal > 0) {
      IntPtr h = new IntPtr(hwndVal);
      if (IsWindow(h)) {
        if (IsIconic(h)) ShowWindow(h, 9);
        SetForegroundWindow(h);
        Thread.Sleep(25);
      }
    }
    var inputs = new List<INPUT>();
    if (action == "move" || action == "click" || action == "double_click" || action == "triple_click" ||
        action == "right_click" || action == "middle_click" || action == "mouse_down" || action == "mouse_up") {
      int px = GetInt(req, "physX", 0), py = GetInt(req, "physY", 0);
      int dx, dy; ToVirtualAbs(px, py, out dx, out dy);
      uint moveFlag = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
      inputs.Add(MakeMouse(dx, dy, moveFlag, 0));
      if (action == "click" || action == "double_click" || action == "triple_click") {
        int count = action == "triple_click" ? 3 : (action == "double_click" ? 2 : 1);
        for (int c = 0; c < count; c++) {
          inputs.Add(MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_LEFTDOWN, 0));
          inputs.Add(MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_LEFTUP, 0));
        }
      } else if (action == "right_click") {
        inputs.Add(MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_RIGHTDOWN, 0));
        inputs.Add(MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_RIGHTUP, 0));
      } else if (action == "middle_click") {
        inputs.Add(MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_MIDDLEDOWN, 0));
        inputs.Add(MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_MIDDLEUP, 0));
      } else if (action == "mouse_down") {
        inputs.Add(MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_LEFTDOWN, 0));
      } else if (action == "mouse_up") {
        inputs.Add(MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_LEFTUP, 0));
      }
      uint sent = SendAll(inputs);
      return new Dictionary<string, object> { { "ok", sent > 0 }, { "sent", (int)sent }, { "latencyMs", sw.ElapsedMilliseconds } };
    }
    if (action == "drag_and_drop") {
      int sx = GetInt(req, "startPhysX", 0), sy = GetInt(req, "startPhysY", 0);
      int ex = GetInt(req, "endPhysX", 0), ey = GetInt(req, "endPhysY", 0);
      int sdx, sdy, edx, edy;
      ToVirtualAbs(sx, sy, out sdx, out sdy);
      ToVirtualAbs(ex, ey, out edx, out edy);
      uint moveFlag = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
      SendAll(new List<INPUT> { MakeMouse(sdx, sdy, moveFlag, 0), MakeMouse(sdx, sdy, moveFlag | MOUSEEVENTF_LEFTDOWN, 0) });
      for (int step = 1; step <= 8; step++) {
        int ix = sdx + ((edx - sdx) * step) / 8;
        int iy = sdy + ((edy - sdy) * step) / 8;
        SendAll(new List<INPUT> { MakeMouse(ix, iy, moveFlag, 0) });
        Thread.Sleep(15);
      }
      uint sent = SendAll(new List<INPUT> { MakeMouse(edx, edy, moveFlag | MOUSEEVENTF_LEFTUP, 0) });
      return new Dictionary<string, object> { { "ok", sent > 0 }, { "sent", (int)sent }, { "latencyMs", sw.ElapsedMilliseconds } };
    }
    if (action == "scroll") {
      int px = GetInt(req, "physX", 0), py = GetInt(req, "physY", 0);
      string dir = GetStr(req, "direction");
      int mag = Math.Max(60, Math.Min(2400, GetInt(req, "magnitude", 300)));
      int dx, dy; ToVirtualAbs(px, py, out dx, out dy);
      uint moveFlag = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
      inputs.Add(MakeMouse(dx, dy, moveFlag, 0));
      int clicks = Math.Max(1, (int)Math.Round(mag / 100.0));
      int delta = clicks * 120;
      if (dir == "up") inputs.Add(MakeMouse(dx, dy, MOUSEEVENTF_WHEEL, unchecked((uint)delta)));
      else if (dir == "down") inputs.Add(MakeMouse(dx, dy, MOUSEEVENTF_WHEEL, unchecked((uint)(-delta))));
      else if (dir == "right") inputs.Add(MakeMouse(dx, dy, MOUSEEVENTF_HWHEEL, unchecked((uint)delta)));
      else if (dir == "left") inputs.Add(MakeMouse(dx, dy, MOUSEEVENTF_HWHEEL, unchecked((uint)(-delta))));
      else return new Dictionary<string, object> { { "ok", false }, { "error", "bad_direction" } };
      uint sent = SendAll(inputs);
      return new Dictionary<string, object> { { "ok", sent > 0 }, { "sent", (int)sent }, { "latencyMs", sw.ElapsedMilliseconds } };
    }
    if (action == "type") {
      if (req.ContainsKey("physX") && req.ContainsKey("physY") && req["physX"] != null && req["physY"] != null) {
        int px = GetInt(req, "physX", 0), py = GetInt(req, "physY", 0);
        int dx, dy; ToVirtualAbs(px, py, out dx, out dy);
        uint moveFlag = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
        SendAll(new List<INPUT> { MakeMouse(dx, dy, moveFlag, 0), MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_LEFTDOWN, 0), MakeMouse(dx, dy, moveFlag | MOUSEEVENTF_LEFTUP, 0) });
        Thread.Sleep(25);
      }
      string text = GetStr(req, "text");
      bool pressEnter = GetBool(req, "pressEnter", false);
      foreach (char ch in text) {
        if (ch == '\r') continue;
        if (ch == '\n') {
          ushort sc = (ushort)MapVirtualKey(0x0D, 0);
          inputs.Add(MakeKey(0x0D, sc, 0));
          inputs.Add(MakeKey(0x0D, sc, KEYEVENTF_KEYUP));
          continue;
        }
        inputs.Add(MakeKey(0, ch, KEYEVENTF_UNICODE));
        inputs.Add(MakeKey(0, ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
      }
      if (pressEnter) {
        ushort sc = (ushort)MapVirtualKey(0x0D, 0);
        inputs.Add(MakeKey(0x0D, sc, 0));
        inputs.Add(MakeKey(0x0D, sc, KEYEVENTF_KEYUP));
      }
      uint sent = SendAll(inputs);
      return new Dictionary<string, object> { { "ok", inputs.Count == 0 || sent > 0 }, { "sent", (int)sent }, { "latencyMs", sw.ElapsedMilliseconds } };
    }
    if (action == "press_key" || action == "key_down" || action == "key_up") {
      ushort vk;
      if (!ResolveVk(GetStr(req, "key"), out vk)) return new Dictionary<string, object> { { "ok", false }, { "error", "unknown_key" } };
      ushort sc = (ushort)MapVirtualKey(vk, 0);
      uint ext = EXTENDED_VKS.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0;
      if (action == "press_key" || action == "key_down") inputs.Add(MakeKey(vk, sc, ext));
      if (action == "press_key" || action == "key_up") inputs.Add(MakeKey(vk, sc, ext | KEYEVENTF_KEYUP));
      uint sent = SendAll(inputs);
      return new Dictionary<string, object> { { "ok", sent > 0 }, { "sent", (int)sent }, { "latencyMs", sw.ElapsedMilliseconds } };
    }
    if (action == "hotkey") {
      var rawKeys = req.ContainsKey("keys") ? req["keys"] as System.Collections.ArrayList : null;
      if (rawKeys == null || rawKeys.Count == 0) return new Dictionary<string, object> { { "ok", false }, { "error", "bad_keys" } };
      var vks = new List<ushort>();
      foreach (object item in rawKeys) {
        ushort vk;
        if (!ResolveVk(Convert.ToString(item, CultureInfo.InvariantCulture) ?? "", out vk))
          return new Dictionary<string, object> { { "ok", false }, { "error", "unknown_key" } };
        vks.Add(vk);
      }
      for (int i = 0; i < vks.Count; i++) {
        ushort vk = vks[i];
        ushort sc = (ushort)MapVirtualKey(vk, 0);
        uint ext = EXTENDED_VKS.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0;
        inputs.Add(MakeKey(vk, sc, ext));
      }
      for (int i = vks.Count - 1; i >= 0; i--) {
        ushort vk = vks[i];
        ushort sc = (ushort)MapVirtualKey(vk, 0);
        uint ext = EXTENDED_VKS.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0;
        inputs.Add(MakeKey(vk, sc, ext | KEYEVENTF_KEYUP));
      }
      uint sent = SendAll(inputs);
      if (sent > 0 && sent != (uint)inputs.Count) {
        // Release all keys so nothing stays stuck down
        var up = new List<INPUT>();
        for (int i = vks.Count - 1; i >= 0; i--) {
          ushort vk = vks[i];
          uint ext = EXTENDED_VKS.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0;
          up.Add(MakeKey(vk, (ushort)MapVirtualKey(vk, 0), ext | KEYEVENTF_KEYUP));
        }
        SendAll(up);
      }
      return new Dictionary<string, object> { { "ok", sent == (uint)inputs.Count }, { "sent", (int)sent }, { "latencyMs", sw.ElapsedMilliseconds } };
    }
    return new Dictionary<string, object> { { "ok", false }, { "refused", true }, { "error", "unsupported_action" } };
  }

  public static int Main(string[] args) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
    var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    output.WriteLine("{\"ready\":true}");
    while (true) {
      string line = input.ReadLine();
      if (line == null) return 0;
      line = line.Trim();
      if (line == "quit") return 0;
      if (line.Length == 0) continue;
      try {
        int sp = line.IndexOf(' ');
        string cmd = sp > 0 ? line.Substring(0, sp) : line;
        string rest = sp > 0 ? line.Substring(sp + 1).Trim() : "";
        Dictionary<string, object> res;
        if (cmd == "inspect") {
          var parts = rest.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
          long hw = parts.Length >= 1 ? long.Parse(parts[0], CultureInfo.InvariantCulture) : 0;
          uint ppid = parts.Length >= 2 ? uint.Parse(parts[1], CultureInfo.InvariantCulture) : 0;
          res = InspectWindow(hw, ppid);
        } else if (cmd == "capture") {
          var parts = rest.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
          long hw = parts.Length >= 1 ? long.Parse(parts[0], CultureInfo.InvariantCulture) : 0;
          int maxW = parts.Length >= 2 ? int.Parse(parts[1], CultureInfo.InvariantCulture) : 1280;
          uint ppid = parts.Length >= 3 ? uint.Parse(parts[2], CultureInfo.InvariantCulture) : 0;
          res = CaptureWindow(hw, maxW, ppid);
        } else if (cmd == "readback") {
          long hw = rest.Length > 0 ? long.Parse(rest, CultureInfo.InvariantCulture) : 0;
          res = ReadBackWindow(hw);
        } else if (cmd == "focus") {
          long hw = rest.Length > 0 ? long.Parse(rest, CultureInfo.InvariantCulture) : 0;
          IntPtr h = new IntPtr(hw);
          bool ok = hw > 0 && IsWindow(h);
          if (ok) { if (IsIconic(h)) ShowWindow(h, 9); SetForegroundWindow(h); }
          res = new Dictionary<string, object> { { "ok", ok } };
        } else if (cmd == "exec") {
          res = ExecAction(rest);
        } else {
          res = new Dictionary<string, object> { { "ok", false }, { "error", "unknown_command" } };
        }
        output.WriteLine(SER.Serialize(res));
      } catch (Exception ex) {
        output.WriteLine(SER.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", ex.Message } }));
      }
    }
  }
}
