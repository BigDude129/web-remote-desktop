using System.Runtime.InteropServices;
using Forms = System.Windows.Forms;

namespace DeskLink.DesktopProbe;

internal sealed class ProbeForm : Forms.Form
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);

    private readonly Forms.TextBox editor = new() { Multiline = true, Font = new Font("Segoe UI", 16), AccessibleName = "VM test editor" };
    private readonly Forms.Button button = new() { Text = "Click target", Font = new Font("Segoe UI", 14) };
    private readonly InputPad pad = new() { BackColor = Color.FromArgb(70, 54, 140), TabStop = true };
    private readonly Forms.Panel marker = new() { BackColor = Color.FromArgb(22, 167, 123) };
    private readonly Forms.Label title = new() { Text = "DeskLink · isolated Windows VM input probe", AutoSize = true, ForeColor = Color.White, Font = new Font("Segoe UI", 17) };
    private int clicks, wheel, dragDistance, keyUps;
    private Point? dragStart;

    internal ProbeForm()
    {
        Text = "DeskLink disposable VM test surface";
        FormBorderStyle = Forms.FormBorderStyle.None;
        StartPosition = Forms.FormStartPosition.Manual;
        Bounds = Forms.Screen.PrimaryScreen!.Bounds;
        BackColor = Color.FromArgb(23, 39, 62);
        TopMost = true;
        KeyPreview = true;
        Controls.AddRange([title, editor, button, pad, marker]);
        title.Location = new Point(35, 30);
        editor.SetBounds(40, 100, Math.Min(700, ClientSize.Width - 80), 150);
        button.SetBounds(40, 280, 230, 65);
        pad.SetBounds(310, 280, Math.Min(400, ClientSize.Width - 350), 170);
        marker.SetBounds(40, 390, 160, 80);
        button.Click += (_, _) => clicks++;
        pad.MouseDown += (_, e) => { pad.Focus(); if (e.Button == Forms.MouseButtons.Left) dragStart = e.Location; };
        pad.MouseMove += (_, e) =>
        {
            if (dragStart is { } start && e.Button.HasFlag(Forms.MouseButtons.Left))
                dragDistance = Math.Max(dragDistance, Math.Abs(e.X - start.X) + Math.Abs(e.Y - start.Y));
        };
        pad.MouseUp += (_, _) => dragStart = null;
        pad.MouseWheel += (_, e) => wheel += e.Delta;
        KeyUp += (_, _) => keyUps++;
    }

    internal void BringToTestForeground() { Show(); BringToFront(); Activate(); editor.Focus(); }

    internal object Snapshot()
    {
        var bounds = Forms.Screen.PrimaryScreen!.Bounds;
        object RectangleOf(Forms.Control control)
        {
            var rectangle = control.RectangleToScreen(control.ClientRectangle);
            return new { x = rectangle.X - bounds.X, y = rectangle.Y - bounds.Y, width = rectangle.Width, height = rectangle.Height };
        }
        return new
        {
            foreground = GetForegroundWindow() == Handle,
            screen = new { width = bounds.Width, height = bounds.Height },
            editor = RectangleOf(editor), button = RectangleOf(button), pad = RectangleOf(pad), marker = RectangleOf(marker),
            text = editor.Text, clicks, wheel, dragDistance, keyUps,
            controlDown = (GetAsyncKeyState(0x11) & 0x8000) != 0,
            leftButtonDown = (GetAsyncKeyState(0x01) & 0x8000) != 0,
        };
    }

    private sealed class InputPad : Forms.Panel
    {
        internal InputPad() { SetStyle(Forms.ControlStyles.Selectable, true); }
    }
}
