using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;
using Microsoft.Win32;
using Forms = System.Windows.Forms;

namespace DeskLink.DesktopProbe;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = Console.OutputEncoding = new UTF8Encoding(false);
        var model = (string?)Registry.GetValue(@"HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\BIOS", "SystemProductName", "") ?? "";
        var virtualMachine = new[] { "Virtual Machine", "VirtualBox", "VMware", "KVM", "QEMU", "HVM domU", "Parallels" }
            .Any(value => model.Contains(value, StringComparison.OrdinalIgnoreCase));
        var allowed = Environment.GetEnvironmentVariable("DESKLINK_VM_TEST") == "1" && virtualMachine && Environment.UserInteractive;
        if (args.Contains("--preflight") || !allowed)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { allowed, virtualMachine, interactive = Environment.UserInteractive, model,
                os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
                sessionId = Process.GetCurrentProcess().SessionId }));
            if (!allowed) Console.Error.WriteLine("Desktop input tests require an explicitly enabled disposable Windows VM. Physical workstations are refused.");
            return allowed ? 0 : 2;
        }
        ApplicationConfiguration.Initialize();
        using var probe = new ProbeForm();
        probe.Shown += (_, _) => _ = Task.Run(() => Commands(probe));
        Forms.Application.Run(probe);
        return 0;
    }

    private static void Commands(ProbeForm probe)
    {
        using var agent = new AgentUi();
        try
        {
            while (Console.ReadLine() is { } line)
            {
                using var document = JsonDocument.Parse(line);
                var request = document.RootElement;
                var id = request.GetProperty("id").GetInt32();
                try
                {
                    object result;
                    switch (request.GetProperty("op").GetString())
                    {
                        case "start-agent":
                            agent.Start(request);
                            result = probe.Invoke(() => { probe.BringToTestForeground(); return probe.Snapshot(); });
                            break;
                        case "state": result = probe.Invoke(probe.Snapshot); break;
                        case "focus": result = probe.Invoke(() => { probe.BringToTestForeground(); return probe.Snapshot(); }); break;
                        case "sign-out-agent": agent.SignOut(); result = new { invoked = true }; break;
                        case "shutdown":
                            agent.Dispose();
                            Console.WriteLine(JsonSerializer.Serialize(new { id, ok = true, result = new { stopped = true } }));
                            return;
                        default: throw new InvalidOperationException("Unsupported test command");
                    }
                    Console.WriteLine(JsonSerializer.Serialize(new { id, ok = true, result }));
                }
                catch (Exception error)
                {
                    // Never echo a command: start-agent contains disposable credentials.
                    Console.WriteLine(JsonSerializer.Serialize(new { id, ok = false, error = error.GetType().Name }));
                }
            }
        }
        finally { if (!probe.IsDisposed) probe.BeginInvoke(probe.Close); }
    }
}

internal sealed class AgentUi : IDisposable
{
    private Process? process;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr parameter, string text);

    private AutomationElement Root
    {
        get
        {
            if (process is null || process.HasExited) throw new InvalidOperationException("Agent exited");
            process.Refresh();
            if (process.MainWindowHandle == IntPtr.Zero) throw new InvalidOperationException("Agent window unavailable");
            return AutomationElement.FromHandle(process.MainWindowHandle);
        }
    }

    private AutomationElement Control(string id, string label, ControlType type)
    {
        var condition = new AndCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, type),
            new OrCondition(new PropertyCondition(AutomationElement.AutomationIdProperty, id),
                new PropertyCondition(AutomationElement.NameProperty, label)));
        return Root.FindFirst(TreeScope.Descendants, condition) ?? throw new InvalidOperationException($"Missing control {id}");
    }

    private void Fill(string id, string label, string value)
    {
        var element = Control(id, label, ControlType.Edit);
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern)) ((ValuePattern)pattern).SetValue(value);
        else
        {
            // Some password controls do not expose ValuePattern. Address only the
            // edit window belonging to the agent process that this harness started.
            if (element.Current.ProcessId != process!.Id || element.Current.NativeWindowHandle == 0)
                throw new InvalidOperationException("Invalid agent edit window");
            SendMessage(new IntPtr(element.Current.NativeWindowHandle), 0x000C, IntPtr.Zero, value);
        }
    }

    internal void Start(JsonElement request)
    {
        if (process is not null) throw new InvalidOperationException("Agent already started");
        var path = Path.GetFullPath(request.GetProperty("path").GetString()!);
        var root = Path.GetFullPath("local/vm-e2e") + Path.DirectorySeparatorChar;
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || Path.GetFileName(path) != "DeskLink.Agent.exe")
            throw new InvalidOperationException("Only the downloaded VM test package can be started");
        process = Process.Start(new ProcessStartInfo(path) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(path) })
            ?? throw new InvalidOperationException("Agent did not start");
        var wait = Stopwatch.StartNew();
        while (process.MainWindowHandle == IntPtr.Zero && !process.HasExited && wait.Elapsed < TimeSpan.FromSeconds(20))
        { Thread.Sleep(100); process.Refresh(); }
        Fill("ServerAddress", "서버 주소", request.GetProperty("origin").GetString()!);
        Fill("Username", "계정", request.GetProperty("username").GetString()!);
        Fill("Password", "비밀번호", request.GetProperty("password").GetString()!);
        Fill("DeviceName", "기기 이름", "Windows VM validation");
        ((InvokePattern)Control("AllowRemote", "로그인하고 원격 허용", ControlType.Button).GetCurrentPattern(InvokePattern.Pattern)).Invoke();
        wait.Restart();
        while (!Control("StopRemote", "원격 허용 중단 / 로그아웃", ControlType.Button).Current.IsEnabled)
        {
            if (wait.Elapsed > TimeSpan.FromSeconds(20)) throw new TimeoutException("Agent GUI login failed");
            Thread.Sleep(100);
        }
        ((WindowPattern)Root.GetCurrentPattern(WindowPattern.Pattern)).SetWindowVisualState(WindowVisualState.Minimized);
    }

    internal void SignOut() => ((InvokePattern)Control("StopRemote", "원격 허용 중단 / 로그아웃", ControlType.Button)
        .GetCurrentPattern(InvokePattern.Pattern)).Invoke();

    public void Dispose()
    {
        if (process is null) return;
        try
        {
            if (!process.HasExited)
            {
                process.CloseMainWindow();
                if (!process.WaitForExit(5000)) process.Kill(entireProcessTree: true);
            }
        }
        finally { process.Dispose(); process = null; }
    }
}
