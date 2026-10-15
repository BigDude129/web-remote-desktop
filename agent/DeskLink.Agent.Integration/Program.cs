using System.Text.Json;
using DeskLink.Agent;

Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
using var input = JsonDocument.Parse(Console.ReadLine() ?? throw new InvalidOperationException("Test input required"));
var data = input.RootElement;
var origin = AgentClient.ValidateServer(data.GetProperty("origin").GetString()!);
if (!origin.IsLoopback) throw new InvalidOperationException("Integration tests are loopback-only.");
using var client = new AgentClient();
client.Status += message => { if (message.StartsWith("온라인")) Console.WriteLine("ONLINE"); };
await client.LoginAsync(origin.ToString(), data.GetProperty("username").GetString()!, data.GetProperty("password").GetString()!, "Native integration fixture");
await Task.WhenAny(Task.Run(Console.ReadLine), Task.Delay(TimeSpan.FromSeconds(20)));
await client.LogoutAsync();
Console.WriteLine("STOPPED");
