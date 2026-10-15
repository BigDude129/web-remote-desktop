namespace DeskLink.Agent;

internal static class AgentInfo
{
    internal static string Version => typeof(AgentInfo).Assembly.GetName().Version!.ToString(3);
    internal const int ProtocolVersion = 1;
}
