namespace DeskLink.Agent;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (args.Contains("--self-test")) return SelfTest.Run(args.Contains("--skip-capture"));
        Application.Run(new AgentForm());
        return 0;
    }
}
