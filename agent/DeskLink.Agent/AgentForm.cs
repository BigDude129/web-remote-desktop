using Microsoft.Win32;
using System.Diagnostics;
using System.Text.Json;

namespace DeskLink.Agent;

internal sealed class AgentForm : Form
{
    private readonly TextBox address = new() { Name = "ServerAddress", Text = "http://localhost:3000" };
    private readonly TextBox username = new() { Name = "Username" };
    private readonly TextBox password = new() { Name = "Password", UseSystemPasswordChar = true };
    private readonly TextBox deviceName = new() { Name = "DeviceName", Text = Environment.MachineName };
    private readonly Button login = new() { Name = "AllowRemote", Text = "로그인하고 원격 허용", BackColor = Color.FromArgb(64, 93, 230), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
    private readonly Button stop = new() { Name = "StopRemote", Text = "원격 허용 중단 / 로그아웃", Enabled = false };
    private readonly Label status = new() { Text = "로그아웃 상태 · 화면을 공유하지 않습니다.", AutoSize = false, ForeColor = Color.FromArgb(77, 99, 139) };
    private readonly AgentClient client = new();
    private readonly Button checkUpdate = new() { Text = "업데이트 확인", AutoSize = true };
    private readonly LinkLabel updateLink = new() { Text = "", AutoSize = true, MaximumSize = new Size(370, 0) };
    private string? releaseUrl;
    private bool closing;
    private bool working;
    private bool signedIn;

    internal AgentForm()
    {
        Text = "DeskLink · Windows Agent";
        ClientSize = new Size(460, 760);
        MinimumSize = new Size(470, 770);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Malgun Gothic", 10);
        BackColor = Color.FromArgb(248, 250, 253);
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(30), ColumnCount = 1, AutoScroll = true, AutoSize = true };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(panel);
        panel.Controls.Add(new Label { Text = "DeskLink", Font = new Font("Segoe UI", 25, FontStyle.Bold), ForeColor = Color.FromArgb(35, 52, 84), AutoSize = true });
        panel.Controls.Add(new Label { Text = "내 PC의 현재 화면을 웹에서 연결하세요.", AutoSize = true, Margin = new Padding(0, 3, 0, 20) });
        AddField(panel, "서버 주소", address);
        AddField(panel, "계정", username);
        AddField(panel, "비밀번호", password);
        AddField(panel, "기기 이름", deviceName);
        username.MaxLength = 120; password.MaxLength = 128; deviceName.MaxLength = 80;
        login.Height = 42; login.Dock = DockStyle.Top; login.Margin = new Padding(0, 17, 0, 7);
        stop.Height = 36; stop.Dock = DockStyle.Top; stop.Margin = new Padding(0, 0, 0, 15);
        status.Dock = DockStyle.Top; status.Height = 60;
        panel.Controls.Add(login); panel.Controls.Add(stop); panel.Controls.Add(status);
        panel.Controls.Add(new Label { Text = $"로그인하면 같은 계정의 웹 사용자가 화면과 입력을 제어할 수 있습니다. 창을 닫거나 중단하면 즉시 연결을 해제합니다.\n기본 모니터 · 5 FPS · 잠금/UAC 미지원 · v{AgentInfo.Version}", AutoSize = true, MaximumSize = new Size(380, 0), ForeColor = Color.SlateGray, Font = new Font("Malgun Gothic", 9) });
        panel.Controls.Add(checkUpdate); panel.Controls.Add(updateLink);
        var license = new LinkLabel { Text = "MIT 라이선스", AutoSize = true, Margin = new Padding(0, 10, 0, 0) };
        panel.Controls.Add(license);
        license.LinkClicked += (_, _) =>
        {
            var path = Path.Combine(AppContext.BaseDirectory, "LICENSE.txt");
            if (File.Exists(path)) Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            else MessageBox.Show("DeskLink는 MIT 라이선스입니다. 저장소 LICENSE와 docs/licenses.md를 확인하세요.", "라이선스");
        };
        var notices = new LinkLabel { Text = "제3자 라이선스 고지", AutoSize = true };
        panel.Controls.Add(notices);
        notices.LinkClicked += (_, _) =>
        {
            var path = Path.Combine(AppContext.BaseDirectory, "THIRD-PARTY-NOTICES.txt");
            if (File.Exists(path)) Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            else MessageBox.Show("패키지의 THIRD-PARTY-NOTICES.txt 또는 저장소 docs/licenses.md를 확인하세요.", "제3자 고지");
        };
        checkUpdate.Click += async (_, _) => await CheckUpdateAsync();
        updateLink.LinkClicked += (_, _) =>
        {
            if (releaseUrl is not null) Process.Start(new ProcessStartInfo(releaseUrl) { UseShellExecute = true });
        };
        AcceptButton = login;
        login.Click += LoginClicked;
        stop.Click += async (_, _) => await SignOutAsync();
        client.Status += message => OnUi(() => status.Text = message);
        client.SignedOut += () => OnUi(() => { signedIn = false; SetControls(); });
        SystemEvents.SessionSwitch += SessionSwitched;
        FormClosing += CloseRequested;
    }

    private static void AddField(TableLayoutPanel panel, string label, TextBox field)
    {
        field.AccessibleName = label;
        panel.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 8, 0, 5) });
        field.Dock = DockStyle.Top; field.Margin = new Padding(0, 0, 0, 5); panel.Controls.Add(field);
    }

    private async void LoginClicked(object? sender, EventArgs args)
    {
        if (working || signedIn) return;
        working = true; SetControls();
        var secret = password.Text; password.Clear();
        try
        {
            if (string.IsNullOrWhiteSpace(username.Text) || string.IsNullOrWhiteSpace(deviceName.Text) || secret.Length == 0)
                throw new InvalidOperationException("계정, 비밀번호, 기기 이름을 입력하세요.");
            status.Text = "로그인하는 중…";
            await client.LoginAsync(address.Text, username.Text.Trim(), secret, deviceName.Text.Trim());
            signedIn = true;
        }
        catch (Exception error) when (error is InvalidOperationException or HttpRequestException or TaskCanceledException or IOException)
        {
            status.Text = error is InvalidOperationException ? error.Message : "서버에 연결하지 못했습니다. 주소와 네트워크를 확인하세요.";
        }
        finally { working = false; SetControls(); }
        if (signedIn) _ = CheckUpdateAsync();
    }

    private async Task SignOutAsync()
    {
        if (working) return;
        working = true; SetControls();
        await client.LogoutAsync();
        signedIn = false; working = false;
        status.Text = "로그아웃 상태 · 화면을 공유하지 않습니다.";
        SetControls();
    }

    private void SetControls()
    {
        login.Enabled = !working && !signedIn;
        stop.Enabled = !working && signedIn;
        address.Enabled = username.Enabled = password.Enabled = deviceName.Enabled = !working && !signedIn;
    }

    private void SessionSwitched(object sender, SessionSwitchEventArgs args)
    {
        if (args.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.SessionLogoff or SessionSwitchReason.ConsoleDisconnect or SessionSwitchReason.RemoteDisconnect)
            OnUi(async () => await SignOutAsync());
    }

    private async void CloseRequested(object? sender, FormClosingEventArgs args)
    {
        if (closing) return;
        args.Cancel = true;
        if (working) return;
        working = true; SetControls();
        await client.LogoutAsync();
        SystemEvents.SessionSwitch -= SessionSwitched;
        client.Dispose(); closing = true; Close();
    }

    private void OnUi(Action action)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(action); } catch (InvalidOperationException) { }
    }

    private async Task CheckUpdateAsync()
    {
        if (!checkUpdate.Enabled) return;
        checkUpdate.Enabled = false; releaseUrl = null; updateLink.Text = "최신 릴리즈 확인 중…";
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
            var origin = AgentClient.ValidateServer(address.Text);
            using var response = await http.GetAsync(new Uri(origin, "/api/agent/releases/latest"));
            response.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var data = json.RootElement;
            if (!data.GetProperty("available").GetBoolean()) { updateLink.Text = "게시된 릴리즈가 없거나 현재 확인할 수 없습니다."; return; }
            var version = data.GetProperty("version").GetString()!;
            var current = new Version(AgentInfo.Version);
            if (!Version.TryParse(version, out var latest)) throw new InvalidDataException();
            var stale = data.GetProperty("stale").GetBoolean();
            if (latest <= current) { updateLink.Text = stale ? "업데이트 정보를 새로 확인하지 못했습니다." : $"현재 버전 v{AgentInfo.Version} · 새 업데이트 없음"; return; }
            var target = new Uri(data.GetProperty("releaseUrl").GetString()!);
            if (target.Scheme != "https" || target.Host != "github.com" || !target.AbsolutePath.Contains("/releases/tag/")) throw new InvalidDataException();
            releaseUrl = target.AbsoluteUri;
            updateLink.Text = $"v{version} 다운로드 / 변경 사항 보기" + (stale ? " (최근 확인한 정보)" : "");
            if (data.GetProperty("protocolVersion").GetInt32() != AgentInfo.ProtocolVersion) updateLink.Text += " · 서버도 함께 업데이트 필요";
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException or KeyNotFoundException or UriFormatException or InvalidDataException)
        { updateLink.Text = "업데이트 확인 실패 · 잠시 후 다시 확인하세요."; }
        finally { if (!IsDisposed) checkUpdate.Enabled = true; }
    }
}
