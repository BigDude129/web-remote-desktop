using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace DeskLink.Agent;

internal sealed class NativeInputException(string operation, int nativeError) : InvalidOperationException("input_failed")
{
    internal string Operation { get; } = operation;
    internal int NativeError { get; } = Math.Max(0, nativeError);
}

internal sealed class NativeDesktop
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct MouseInput
    {
        public int Dx, Dy;
        public uint MouseData, Flags, Time;
        public UIntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct KeyboardInput
    {
        public ushort VirtualKey, Scan;
        public uint Flags, Time;
        public UIntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)]
    internal struct InputUnion
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct Input { public uint Type; public InputUnion Data; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetUserObjectInformation(IntPtr handle, int index, System.Text.StringBuilder text, int length, out int needed);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseDesktop(IntPtr desktop);

    private readonly object gate = new();
    private readonly HashSet<string> keys = [];
    private readonly HashSet<string> buttons = [];

    internal static bool DesktopAvailable()
    {
        // Read the active input desktop name; never switch desktops or elevate.
        var desktop = OpenInputDesktop(0, false, 0x0001);
        if (desktop == IntPtr.Zero) return false;
        try
        {
            var name = new System.Text.StringBuilder(256);
            return GetUserObjectInformation(desktop, 2, name, name.Capacity * sizeof(char), out _) &&
                name.ToString().Equals("Default", StringComparison.OrdinalIgnoreCase);
        }
        finally { CloseDesktop(desktop); }
    }

    internal static byte[] Capture()
    {
        if (!DesktopAvailable()) throw new InvalidOperationException("desktop_unavailable");
        var bounds = Screen.PrimaryScreen?.Bounds ?? throw new InvalidOperationException("desktop_unavailable");
        using var source = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(source))
            graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, CopyPixelOperation.SourceCopy);
        var scale = Math.Min(1.0, Math.Min(1600.0 / bounds.Width, 900.0 / bounds.Height));
        using var target = new Bitmap(Math.Max(1, (int)(bounds.Width * scale)), Math.Max(1, (int)(bounds.Height * scale)));
        using (var graphics = Graphics.FromImage(target)) graphics.DrawImage(source, new Rectangle(Point.Empty, target.Size));
        var encoder = ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);
        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 55L);
        using var stream = new MemoryStream();
        target.Save(stream, encoder, parameters);
        if (stream.Length > 2 * 1024 * 1024) throw new InvalidOperationException("capture_failed");
        return stream.ToArray();
    }

    internal void Apply(JsonElement input)
    {
        lock (gate)
        {
            var kind = input.GetProperty("kind").GetString();
            if (kind == "release") { ReleaseAll(); return; }
            if (!DesktopAvailable()) throw new InvalidOperationException("desktop_unavailable");
            switch (kind)
            {
                case "move":
                    var x = input.GetProperty("x").GetDouble();
                    var y = input.GetProperty("y").GetDouble();
                    if (!double.IsFinite(x) || !double.IsFinite(y) || x is < 0 or > 1 || y is < 0 or > 1) throw new InvalidDataException();
                    var bounds = Screen.PrimaryScreen!.Bounds;
                    if (!SetCursorPos(bounds.Left + (int)Math.Round(x * (bounds.Width - 1)), bounds.Top + (int)Math.Round(y * (bounds.Height - 1)))) throw new NativeInputException("move", Marshal.GetLastWin32Error());
                    break;
                case "button":
                    var button = input.GetProperty("button").GetString()!;
                    var down = input.GetProperty("down").GetBoolean();
                    Send([MouseButton(button, down)], "button");
                    if (down) buttons.Add(button); else buttons.Remove(button);
                    break;
                case "wheel":
                    var delta = input.GetProperty("delta").GetInt32();
                    if (delta is < -1200 or > 1200) throw new InvalidDataException();
                    Send([new Input { Type = 0, Data = new InputUnion { Mouse = new MouseInput { Flags = 0x0800, MouseData = unchecked((uint)delta) } } }], "wheel");
                    break;
                case "key":
                    var code = input.GetProperty("code").GetString()!;
                    var isDown = input.GetProperty("down").GetBoolean();
                    Send([Key(code, isDown)], "key");
                    if (isDown) keys.Add(code); else keys.Remove(code);
                    break;
                case "text":
                    var text = input.GetProperty("text").GetString()!;
                    if (text.Length is < 1 or > 2000) throw new InvalidDataException();
                    ReleaseAll();
                    foreach (var chunk in Unicode(text).Chunk(100)) Send(chunk, "text");
                    break;
                default: throw new InvalidDataException();
            }
        }
    }

    internal void ReleaseAll()
    {
        lock (gate)
        {
            var inputs = keys.Select(code => Key(code, false)).Concat(buttons.Select(button => MouseButton(button, false))).ToArray();
            if (inputs.Length > 0) SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>());
            keys.Clear(); buttons.Clear();
        }
    }

    private static void Send(Input[] inputs, string operation)
    {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>()) != inputs.Length)
            throw new NativeInputException(operation, Marshal.GetLastWin32Error());
    }

    internal static Input[] Unicode(string text) => text.SelectMany(character => new[] {
        new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { Scan = character, Flags = 0x0004 } } },
        new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { Scan = character, Flags = 0x0004 | 0x0002 } } },
    }).ToArray();

    private static Input MouseButton(string button, bool down) => new()
    {
        Type = 0,
        Data = new InputUnion { Mouse = new MouseInput { Flags = (button, down) switch {
            ("left", true) => 0x0002, ("left", false) => 0x0004,
            ("right", true) => 0x0008, ("right", false) => 0x0010,
            ("middle", true) => 0x0020, ("middle", false) => 0x0040,
            _ => throw new InvalidDataException(),
        } } },
    };

    internal static Input Key(string code, bool down)
    {
        ushort value = code switch
        {
            "Enter" => 0x0D, "Escape" => 0x1B, "Backspace" => 0x08, "Tab" => 0x09, "Space" => 0x20,
            "ArrowLeft" => 0x25, "ArrowUp" => 0x26, "ArrowRight" => 0x27, "ArrowDown" => 0x28,
            "PageUp" => 0x21, "PageDown" => 0x22, "End" => 0x23, "Home" => 0x24, "Insert" => 0x2D, "Delete" => 0x2E,
            "ShiftLeft" => 0xA0, "ShiftRight" => 0xA1, "ControlLeft" => 0xA2, "ControlRight" => 0xA3,
            "AltLeft" => 0xA4, "AltRight" => 0xA5, "MetaLeft" => 0x5B, "MetaRight" => 0x5C,
            "CapsLock" => 0x14, "Lang1" => 0x15, "Backquote" => 0xC0, "Minus" => 0xBD, "Equal" => 0xBB,
            "BracketLeft" => 0xDB, "BracketRight" => 0xDD, "Backslash" => 0xDC, "Semicolon" => 0xBA,
            "Quote" => 0xDE, "Comma" => 0xBC, "Period" => 0xBE, "Slash" => 0xBF,
            _ when code.Length == 4 && code.StartsWith("Key") && code[3] is >= 'A' and <= 'Z' => code[3],
            _ when code.Length == 6 && code.StartsWith("Digit") && char.IsAsciiDigit(code[5]) => code[5],
            _ when code.StartsWith('F') && int.TryParse(code.AsSpan(1), out var f) && f is >= 1 and <= 12 => (ushort)(0x70 + f - 1),
            _ => throw new InvalidDataException(),
        };
        var extended = code is "ControlRight" or "AltRight" or "MetaLeft" or "MetaRight" or
            "ArrowLeft" or "ArrowRight" or "ArrowUp" or "ArrowDown" or "Home" or "End" or "PageUp" or "PageDown" or "Insert" or "Delete";
        return new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { VirtualKey = value, Flags = (down ? 0u : 2u) | (extended ? 1u : 0u) } } };
    }
}
