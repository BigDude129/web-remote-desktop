using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text.Json;

namespace DeskLink.Agent;

internal sealed class AgentClient : IDisposable
{
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly SemaphoreSlim sendLock = new(1, 1);
    private readonly NativeDesktop desktop = new();
    private CancellationTokenSource? lifetime;
    private CancellationTokenSource? captureLifetime;
    private Task? worker;
    private Task? captureTask;
    private ClientWebSocket? socket;
    private Uri? server;
    private string? token;
    private string? sessionId;
    private bool disposed;
    internal event Action<string>? Status;
    internal event Action? SignedOut;

    internal static Uri ValidateServer(string address)
    {
        if (!Uri.TryCreate(address.Trim(), UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("https" or "http") || uri.AbsolutePath != "/" ||
            uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.UserInfo.Length != 0)
            throw new InvalidOperationException("서버 주소는 https://서버주소 형식이어야 합니다.");
        // Uri.IsLoopback includes localhost and literal loopback IP addresses.
        if (uri.Scheme != "https" && !uri.IsLoopback)
            throw new InvalidOperationException("외부 서버는 HTTPS 주소를 사용해야 합니다.");
        return uri;
    }

    internal async Task LoginAsync(string address, string username, string password, string name)
    {
        await LogoutAsync();
        server = ValidateServer(address);
        var installationId = InstallationId();
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(server, "/api/agent/login"));
        request.Headers.Add("X-DeskLink-Agent", "1");
        request.Content = JsonContent.Create(new { username, password, installationId, name, platform = "windows", agentVersion = AgentInfo.Version, protocolVersion = AgentInfo.ProtocolVersion });
        using var response = await http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var message = response.StatusCode == System.Net.HttpStatusCode.TooManyRequests
                ? "로그인 시도가 많습니다. 1분 후 다시 시도하세요." : "로그인하지 못했습니다. 서버 주소와 계정을 확인하세요.";
            throw new InvalidOperationException(message);
        }
        using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        token = result.RootElement.GetProperty("token").GetString()!;
        lifetime = new CancellationTokenSource();
        worker = RunAsync(lifetime.Token);
    }

    private async Task RunAsync(CancellationToken cancellation)
    {
        var delay = 1;
        while (!cancellation.IsCancellationRequested)
        {
            using var connection = new ClientWebSocket();
            socket = connection;
            connection.Options.SetRequestHeader("Authorization", $"Bearer {token}");
            connection.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);
            connection.Options.KeepAliveTimeout = TimeSpan.FromSeconds(15);
            connection.Options.CollectHttpResponseDetails = true;
            var address = new UriBuilder(server!) { Scheme = server!.Scheme == "https" ? "wss" : "ws", Path = "/ws/agent" };
            try
            {
                Status?.Invoke("서버에 연결하는 중…");
                using var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                connectTimeout.CancelAfter(TimeSpan.FromSeconds(15));
                await connection.ConnectAsync(address.Uri, connectTimeout.Token);
                delay = 1;
                await ReceiveAsync(connection, cancellation);
                if (!cancellation.IsCancellationRequested) break;
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
            catch (WebSocketException) when (connection.HttpStatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
            {
                Status?.Invoke("인증이 만료되었거나 해제되었습니다. 다시 로그인하세요.");
                break;
            }
            catch (Exception error) when (error is WebSocketException or HttpRequestException or OperationCanceledException or IOException)
            {
                Status?.Invoke($"연결 끊김 · {delay}초 후 다시 연결합니다.");
            }
            catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException)
            {
                Status?.Invoke("서버 메시지를 처리하지 못했습니다. 에이전트 버전을 확인하세요.");
                break;
            }
            finally
            {
                await StopCaptureAsync();
                socket = null;
            }
            try { await Task.Delay(TimeSpan.FromSeconds(delay), cancellation); }
            catch (OperationCanceledException) { break; }
            delay = Math.Min(delay * 2, 15);
        }
        token = null;
        SignedOut?.Invoke();
    }

    private async Task ReceiveAsync(ClientWebSocket connection, CancellationToken cancellation)
    {
        var buffer = new byte[16 * 1024];
        while (!cancellation.IsCancellationRequested && connection.State == WebSocketState.Open)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult received;
            do
            {
                received = await connection.ReceiveAsync(new ArraySegment<byte>(buffer), cancellation);
                if (received.MessageType == WebSocketMessageType.Close) return;
                if (received.MessageType != WebSocketMessageType.Text || message.Length + received.Count > 16 * 1024)
                    throw new IOException("Invalid server message");
                message.Write(buffer, 0, received.Count);
            } while (!received.EndOfMessage);
            using var document = JsonDocument.Parse(message.ToArray());
            var data = document.RootElement;
            switch (data.GetProperty("type").GetString())
            {
                case "welcome":
                    if (data.GetProperty("protocolVersion").GetInt32() != AgentInfo.ProtocolVersion) throw new IOException("Unsupported protocol");
                    Status?.Invoke("온라인 · 내 계정의 원격 연결을 기다립니다.");
                    break;
                case "revoked":
                    Status?.Invoke("서버에서 원격 허용이 해제되었습니다. 다시 로그인하세요.");
                    return;
                case "start":
                    await StopCaptureAsync();
                    sessionId = data.GetProperty("sessionId").GetString()!;
                    if (!Guid.TryParse(sessionId, out _)) throw new IOException("Invalid session");
                    captureLifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                    Status?.Invoke($"원격 제어 중 · {data.GetProperty("viewer").GetString()}");
                    await SendJsonAsync(new { type = "ready", sessionId }, cancellation);
                    var currentSession = sessionId;
                    captureTask = CaptureAsync(currentSession, captureLifetime.Token);
                    break;
                case "stop":
                    if (data.GetProperty("sessionId").GetString() != sessionId) break;
                    await StopCaptureAsync();
                    Status?.Invoke("온라인 · 원격 연결이 종료되었습니다.");
                    break;
                case "input":
                    if (sessionId is null || captureLifetime?.IsCancellationRequested != false || data.GetProperty("sessionId").GetString() != sessionId) break;
                    try { desktop.Apply(data.GetProperty("input")); }
                    catch (Exception error) when (error is InvalidOperationException or InvalidDataException or KeyNotFoundException)
                    {
                        var failedSession = sessionId;
                        await StopCaptureAsync();
                        await SendJsonAsync(new { type = "error", sessionId = failedSession, code = "input_failed" }, cancellation);
                    }
                    break;
            }
        }
    }

    private async Task CaptureAsync(string id, CancellationToken cancellation)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(200));
            do
            {
                var frame = await Task.Run(NativeDesktop.Capture, cancellation);
                cancellation.ThrowIfCancellationRequested();
                // Cancelling a send may abort ClientWebSocket. A session stop waits for
                // the bounded in-flight send, preserving the agent's control connection.
                using var sendTimeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime!.Token);
                sendTimeout.CancelAfter(TimeSpan.FromSeconds(5));
                try { await SendAsync(frame, WebSocketMessageType.Binary, sendTimeout.Token); }
                catch (OperationCanceledException) when (!lifetime.Token.IsCancellationRequested) { socket?.Abort(); throw; }
            } while (await timer.WaitForNextTickAsync(cancellation));
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { socket?.Abort(); }
        catch (Exception)
        {
            desktop.ReleaseAll();
            captureLifetime?.Cancel();
            Status?.Invoke("화면을 공유할 수 없습니다. Windows 잠금과 화면 상태를 확인하세요.");
            try { await SendJsonAsync(new { type = "error", sessionId = id, code = NativeDesktop.DesktopAvailable() ? "capture_failed" : "desktop_unavailable" }, lifetime!.Token); }
            catch (Exception) { socket?.Abort(); }
        }
    }

    private async Task SendAsync(byte[] data, WebSocketMessageType type, CancellationToken cancellation)
    {
        await sendLock.WaitAsync(cancellation);
        try
        {
            if (socket?.State != WebSocketState.Open) throw new WebSocketException();
            await socket.SendAsync(new ArraySegment<byte>(data), type, true, cancellation);
        }
        finally { sendLock.Release(); }
    }

    private Task SendJsonAsync(object data, CancellationToken cancellation) => SendAsync(JsonSerializer.SerializeToUtf8Bytes(data), WebSocketMessageType.Text, cancellation);

    private async Task StopCaptureAsync()
    {
        captureLifetime?.Cancel();
        if (captureTask is not null)
        {
            try { await captureTask; } catch (OperationCanceledException) { }
        }
        desktop.ReleaseAll();
        captureLifetime?.Dispose(); captureLifetime = null; captureTask = null; sessionId = null;
    }

    internal async Task LogoutAsync()
    {
        var oldToken = token; var oldServer = server;
        lifetime?.Cancel(); socket?.Abort();
        if (worker is not null) await worker;
        lifetime?.Dispose(); lifetime = null; worker = null;
        await StopCaptureAsync();
        token = null;
        if (oldToken is not null && oldServer is not null)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(oldServer, "/api/agent/logout"));
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", oldToken);
                request.Headers.Add("X-DeskLink-Agent", "1");
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                using var response = await http.SendAsync(request, timeout.Token);
            }
            catch (Exception error) when (error is HttpRequestException or OperationCanceledException) { }
        }
    }

    private static string InstallationId()
    {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeskLink");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "installation-id");
        if (File.Exists(path) && Guid.TryParse(File.ReadAllText(path), out var id)) return id.ToString();
        var value = Guid.NewGuid().ToString(); File.WriteAllText(path, value); return value;
    }

    public void Dispose()
    {
        if (disposed) return; disposed = true;
        lifetime?.Cancel(); socket?.Abort(); desktop.ReleaseAll(); http.Dispose();
    }
}
