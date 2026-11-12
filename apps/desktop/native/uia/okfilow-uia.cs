// OK Filow: the names and rectangles of what is visible on one display, read from Windows' own
// accessibility interfaces (UI Automation, and the desktop icon list through MSAA). Read only: it sends
// no key or mouse input, moves no window and changes no focus. Nothing leaves this process except one
// line of JSON per request on standard output, read by apps/desktop/okfilow-uia.js.
//
// Built at package time by native/uia/build.mjs with the C# compiler of the .NET Framework that ships
// with Windows (csc.exe, C# 5): no SDK, nothing downloaded, nothing compiled on the user's PC.
//
// One call into an app that does not answer can outlast the allowance (Windows ends it after its own
// timeout); okfilow-uia.js then stops asking and ends this process after 10 s.
//
// Protocol (one line in, one line out):
//   scan <x> <y> <width> <height> <budgetMs> <maxElements> <skip>   the screens' rectangle in physical pixels;
//        skip: the window handles (decimal, comma separated, or "-") that are left out of the screenshot
//        too (OK Filow's own panel and overlays): they hide nothing and name nothing. Every other
//        window, the app's main window included, is in the picture and is read like any other.
//   -> {"ms":123,"partial":false,"elements":[["name","Button",x,y,w,h], ...]}   physical pixels, topmost first
//   quit   (or the end of standard input: the app that started it is gone)
// The first line it writes is {"ready":true}.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Automation;
using Accessibility;

[assembly: System.Reflection.AssemblyTitle("Filow screen names helper")]
[assembly: System.Reflection.AssemblyProduct("Filow")]

public static class OkfScan {
  struct RECT { public int L, T, R, B; }
  delegate bool EnumProc(IntPtr hwnd, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT v, int size);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object acc);

  const int MAX_ELEMENTS = 2400, MAX_NODES = 2500, MAX_DEPTH = 12, DESKTOP_EXTRA_MS = 300;
  static readonly HashSet<string> TYPES = new HashSet<string>(new string[] { "Button", "ListItem", "TabItem", "MenuItem", "Edit", "Hyperlink", "CheckBox", "RadioButton", "ComboBox", "SplitButton", "TreeItem", "Text", "Group", "ToolBar", "Document", "Image", "Window", "Pane" });
  static readonly Regex SPACES = new Regex("\\s+");
  static CacheRequest cache;

  /** Physical pixels on every display, whatever its scaling. */
  static void Init() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } // per monitor v2; older Windows: the call is missing
    cache = new CacheRequest();
    cache.Add(AutomationElement.NameProperty); cache.Add(AutomationElement.ControlTypeProperty);
    cache.Add(AutomationElement.BoundingRectangleProperty); cache.Add(AutomationElement.IsOffscreenProperty);
  }

  class Win { public IntPtr H; public string Cls; public RECT R; }
  // Top-level windows a person can see, topmost first.
  static List<Win> Windows() {
    var list = new List<Win>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4); if (cloaked != 0) return true;
      if ((GetWindowLong(h, -20) & 0x20) != 0) return true; // click-through overlays cover nothing a person can use
      // the frame a person sees (DWM), without the invisible resize borders that reach into the next screen
      RECT r; if (DwmGetWindowAttribute(h, 9, out r, 16) != 0 && !GetWindowRect(h, out r)) return true;
      if (r.R - r.L < 2 || r.B - r.T < 2) return true;
      var cls = new StringBuilder(128); GetClassName(h, cls, 128);
      list.Add(new Win { H = h, Cls = cls.ToString(), R = r });
      return true;
    }, IntPtr.Zero);
    return list;
  }

  static string Json(string s) {
    var b = new StringBuilder(s.Length + 8);
    foreach (char c in s) { if (c == '"' || c == '\\') { b.Append('\\').Append(c); } else if (c < ' ') { b.Append(' '); } else { b.Append(c); } }
    return b.ToString();
  }

  static string Scan(int sx, int sy, int sw, int sh, int budget, int max, HashSet<long> skip) {
    var clock = Stopwatch.StartNew();
    var above = new List<RECT>(); // the windows already walked: they cover what comes after
    var json = new StringBuilder("\"elements\":[");
    int count = 0; bool partial = false;
    Action<string, string, double, double, double, double> keep = delegate(string name, string type, double x, double y, double w, double h) {
      if (count >= max || w < 6 || h < 6 || name == null) return;
      double cx = x + w / 2, cy = y + h / 2;
      if (cx < sx || cx >= sx + sw || cy < sy || cy >= sy + sh) return;
      foreach (RECT a in above) if (cx >= a.L && cx < a.R && cy >= a.T && cy < a.B) return;
      string n = SPACES.Replace(name.Trim(), " ");
      if (n.Length == 0) return;
      if (n.Length > 80) n = n.Substring(0, 80);
      if (count++ > 0) json.Append(',');
      json.Append("[\"").Append(Json(n)).Append("\",\"").Append(type).Append("\",").Append((int)x).Append(',').Append((int)y).Append(',').Append((int)w).Append(',').Append((int)h).Append(']');
    };
    foreach (Win win in Windows()) {
      // OK Filow's panel and overlays are left out of the screenshot, so they hide nothing and name nothing here.
      if (skip.Contains(win.H.ToInt64())) continue;
      bool desktop = win.Cls == "Progman" || win.Cls == "WorkerW";
      bool onScreen = win.R.R > sx && win.R.L < sx + sw && win.R.B > sy && win.R.T < sy + sh;
      // The desktop is last and cheap (366 icons in 0.15 s measured): a window that used the whole
      // allowance does not cost the icons, which get a little time of their own.
      long allowance = desktop ? budget + DESKTOP_EXTRA_MS : budget;
      if (onScreen && clock.ElapsedMilliseconds >= allowance) partial = true;
      else if (onScreen) {
        try {
          AutomationElement root = AutomationElement.FromHandle(win.H);
          if (desktop) {
            // the desktop: its icons come from the list's own accessibility interface (UI Automation shows none on some PCs)
            AutomationElement lv = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ClassNameProperty, "SysListView32"));
            if (lv != null) {
              Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71"); object o;
              if (AccessibleObjectFromWindow(new IntPtr(lv.Current.NativeWindowHandle), 0xFFFFFFFC, ref iid, out o) == 0) {
                IAccessible a = (IAccessible)o; int n = Math.Min(a.accChildCount, 1500);
                for (int i = 1; i <= n; i++) {
                  if (clock.ElapsedMilliseconds >= allowance) { partial = true; break; }
                  try { int x, y, w, h; a.accLocation(out x, out y, out w, out h, i); keep(a.get_accName(i), "ListItem", x, y, w, h); } catch { }
                }
              }
            }
          } else {
            // breadth first with one cached read per node; a browser's tree can hold thousands of nodes
            var queue = new Queue<KeyValuePair<AutomationElement, int>>();
            queue.Enqueue(new KeyValuePair<AutomationElement, int>(root, 0));
            int seen = 0; bool stop = false;
            while (queue.Count > 0 && !stop) {
              var pair = queue.Dequeue();
              AutomationElement child = null;
              try { child = TreeWalker.ControlViewWalker.GetFirstChild(pair.Key, cache); } catch { }
              while (child != null) {
                seen++;
                try {
                  var c = child.Cached; System.Windows.Rect r = c.BoundingRectangle;
                  if (!r.IsEmpty && !c.IsOffscreen) {
                    string type = c.ControlType.ProgrammaticName.Replace("ControlType.", "");
                    if (TYPES.Contains(type)) keep(c.Name, type, r.X, r.Y, r.Width, r.Height);
                    if (pair.Value < MAX_DEPTH) queue.Enqueue(new KeyValuePair<AutomationElement, int>(child, pair.Value + 1));
                  }
                } catch { }
                if (seen >= MAX_NODES || clock.ElapsedMilliseconds >= budget) { partial = true; stop = true; break; }
                try { child = TreeWalker.ControlViewWalker.GetNextSibling(child, cache); } catch { child = null; }
              }
            }
          }
        } catch { }
      }
      // the desktop window spans every screen and covers nothing
      if (!desktop) above.Add(win.R);
    }
    return "{\"ms\":" + clock.ElapsedMilliseconds + ",\"partial\":" + (partial ? "true" : "false") + "," + json.ToString() + "]}";
  }

  public static int Main(string[] args) {
    Init();
    var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
    output.AutoFlush = true;
    output.NewLine = "\n";
    var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    output.WriteLine("{\"ready\":true}");
    while (true) {
      string line = input.ReadLine();
      if (line == null || line.Trim() == "quit") return 0;
      string[] a = line.Trim().Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
      int[] n = new int[6];
      var skip = new HashSet<long>();
      bool ok = a.Length >= 8 && a[0] == "scan";
      for (int i = 0; ok && i < 6; i++) ok = int.TryParse(a[i + 1], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out n[i]);
      if (ok && a[7] != "-") foreach (string s in a[7].Split(',')) { long hw; if (long.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out hw)) skip.Add(hw); else ok = false; }
      if (!ok) { output.WriteLine("{\"error\":\"bad request\"}"); continue; }
      string reply = "{\"error\":\"scan failed\"}";
      try { reply = Scan(n[0], n[1], n[2], n[3], n[4], Math.Max(1, Math.Min(MAX_ELEMENTS, n[5])), skip); } catch { }
      output.WriteLine(reply);
    }
  }
}
