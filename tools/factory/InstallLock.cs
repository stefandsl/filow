using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Read-only lock diagnosis. Never close another process or its handles.
internal static class InstallLock {
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessId { public int pid; public System.Runtime.InteropServices.ComTypes.FILETIME started; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct App {
        public ProcessId process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string service;
        public uint type, status, session;
        public int restartable;
    }
    [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
    static extern int RmStartSession(out uint session, uint flags, [Out] StringBuilder key);
    [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
    static extern int RmRegisterResources(uint session, uint count, string[] files, uint apps, IntPtr processes, uint services, IntPtr names);
    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint session, out uint needed, ref uint count, [In,Out] App[] apps, ref uint reason);
    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint session);

    static bool ReportMappedImage(string file) {
        bool found = false;
        foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(file))) {
            using (process) {
                try {
                    if (String.Equals(process.MainModule.FileName, file, StringComparison.OrdinalIgnoreCase)) {
                        Console.WriteLine("PID " + process.Id + " " + process.ProcessName);
                        found = true;
                    }
                } catch (Win32Exception) { /* Access to this image is restricted. */ }
                  catch (InvalidOperationException) { /* Process already exited. */ }
            }
        }
        return found;
    }

    static int Main(string[] args) {
        string file = Path.GetFullPath(args[0]);
        if (String.Equals(Path.GetExtension(file), ".exe", StringComparison.OrdinalIgnoreCase) && ReportMappedImage(file))
            return 0;
        uint session, needed, count = 0, reason = 0;
        int result = RmStartSession(out session, 0, new StringBuilder(33));
        if (result != 0) return result;
        try {
            result = RmRegisterResources(session, 1, new[]{file}, 0, IntPtr.Zero, 0, IntPtr.Zero);
            if (result != 0) return result;
            App[] apps = null;
            while ((result = RmGetList(session, out needed, ref count, apps, ref reason)) == 234) {
                count = needed;
                apps = new App[count];
            }
            if (result == 0)
                for (int i = 0; i < count; i++) Console.WriteLine("PID " + apps[i].process.pid + " " + apps[i].name);
            return result;
        } finally { RmEndSession(session); }
    }
}
