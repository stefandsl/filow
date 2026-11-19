$ErrorActionPreference = 'Stop'
$lockedPath = $env:FILOW_INSTALL_LOCK_PATH
# A mapped executable identifies its own holder even when Restart Manager
# cannot enumerate applications in the runner's service session.
if ([IO.Path]::GetExtension($lockedPath) -ieq '.exe') {
    $name = [IO.Path]::GetFileNameWithoutExtension($lockedPath)
    $owners = @(Get-Process -Name ([WildcardPattern]::Escape($name)) -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path -ieq $lockedPath })
    if ($owners.Count) {
        foreach ($owner in $owners) { Write-Output "PID $($owner.Id) $($owner.ProcessName)" }
        return
    }
}
# Read-only Windows Restart Manager query. The system releases the session in finally.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class InstallLock {
    [StructLayout(LayoutKind.Sequential)]
    public struct ProcessId { public int pid; public System.Runtime.InteropServices.ComTypes.FILETIME started; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct App {
        public ProcessId process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string service;
        public uint type, status, session;
        public int restartable;
    }
    [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)]
    static extern int RmStartSession(out uint session, uint flags, [Out] System.Text.StringBuilder key);
    [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)]
    static extern int RmRegisterResources(uint session, uint count, string[] files, uint apps, IntPtr processes, uint services, IntPtr names);
    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint session, out uint needed, ref uint count, [In,Out] App[] apps, ref uint reason);
    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint session);
    public static void Report(string path) {
        uint session, needed, count=0, reason=0;
        if (RmStartSession(out session,0,new System.Text.StringBuilder(33)) != 0) return;
        try {
            if (RmRegisterResources(session,1,new[]{path},0,IntPtr.Zero,0,IntPtr.Zero) != 0) return;
            if (RmGetList(session,out needed,ref count,null,ref reason) != 234) return;
            count=needed;
            var apps=new App[count];
            if (RmGetList(session,out needed,ref count,apps,ref reason) == 0)
                for (int i=0;i<count;i++) Console.WriteLine("PID "+apps[i].process.pid+" "+apps[i].name);
        } finally { RmEndSession(session); }
    }
}
"@
[InstallLock]::Report($env:FILOW_INSTALL_LOCK_PATH)
