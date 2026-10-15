using System.Runtime.InteropServices;

namespace DeskLink.Agent;

internal static class SelfTest
{
    internal static int Run(bool skipCapture = false)
    {
        try
        {
            Check(Marshal.SizeOf<NativeDesktop.Input>() == (IntPtr.Size == 8 ? 40 : 28), "Win32 INPUT ABI");
            Check(NativeDesktop.Key("KeyA", true).Data.Keyboard.VirtualKey == 0x41, "Letter mapping");
            Check(NativeDesktop.Key("ControlRight", false).Data.Keyboard.Flags == 3, "Extended key release");
            Check(NativeDesktop.Key("Lang1", true).Data.Keyboard.VirtualKey == 0x15, "Korean language key");
            var unicode = NativeDesktop.Unicode("한글🙂");
            Check(unicode.Length == 8 && unicode[0].Data.Keyboard.Scan == '한' && unicode[1].Data.Keyboard.Flags == 6, "UTF-16 Unicode pairs");
            Check(AgentClient.ValidateServer("http://localhost:3000").IsLoopback, "Loopback development");
            Check(AgentClient.ValidateServer("https://remote.example.com").Scheme == "https", "HTTPS server");
            var rejected = false;
            try { AgentClient.ValidateServer("http://192.0.2.1:3000"); } catch (InvalidOperationException) { rejected = true; }
            Check(rejected, "Reject remote plaintext HTTP");
            if (!skipCapture && NativeDesktop.DesktopAvailable())
            {
                var frame = NativeDesktop.Capture();
                using var image = Image.FromStream(new MemoryStream(frame));
                Check(frame[0] == 0xff && frame[1] == 0xd8 && frame.Length <= 2 * 1024 * 1024 && image.Width <= 1600 && image.Height <= 900, "Live JPEG capture (memory only)");
            }
            else Console.WriteLine(skipCapture ? "SKIP: live capture explicitly disabled on this CI host." : "SKIP: live capture requires an unlocked interactive desktop.");
            Console.WriteLine("Agent self-test passed. No OS input was injected.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine($"Self-test failed: {error.GetType().Name}: {error.Message}"); return 1; }
    }

    private static void Check(bool condition, string description)
    {
        if (!condition) throw new InvalidOperationException(description);
        Console.WriteLine($"PASS: {description}");
    }
}
