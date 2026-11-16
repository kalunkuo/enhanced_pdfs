// stdio MCP server that Claude Code launches; relays bytes to the review session inside Revit over a named pipe.
// Usage: MarkupReview.Bridge --pipe <name> --token <token> [--log <path>]
using System.IO.Pipes;
using System.Text;

string? pipeName = null, token = null, logPath = null;
for (int i = 0; i + 1 < args.Length; i += 2)
{
    if (args[i] == "--pipe") pipeName = args[i + 1];
    else if (args[i] == "--token") token = args[i + 1];
    else if (args[i] == "--log") logPath = args[i + 1];
}
// Claude Code manages this process's own stdio/stderr as the MCP transport; nothing here is guaranteed visible
// to the user otherwise, so write directly to a file next to the review session's log when one is given.
void Log(string message)
{
    if (logPath is null) return;
    try { File.AppendAllText(logPath, $"{DateTime.Now:O} {message}\n"); } catch (IOException) { }
}

Log($"bridge: started, pipe={pipeName} pid={Environment.ProcessId}");
if (pipeName is null || token is null)
{
    Log("bridge: missing --pipe or --token");
    Console.Error.WriteLine("usage: MarkupReview.Bridge --pipe <name> --token <token> [--log <path>]");
    return 2;
}

using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
try { await pipe.ConnectAsync(10_000); }
catch (TimeoutException)
{
    Log("bridge: ConnectAsync timed out after 10s");
    Console.Error.WriteLine($"Could not reach the Revit review session on pipe '{pipeName}'. Is the review still open in Revit?");
    return 1;
}
catch (Exception e)
{
    Log($"bridge: ConnectAsync failed: {e}");
    Console.Error.WriteLine($"Could not connect to pipe '{pipeName}': {e.Message}");
    return 1;
}
Log("bridge: connected, sending token");

await pipe.WriteAsync(Encoding.UTF8.GetBytes(token + "\n"));
await pipe.FlushAsync();
Log("bridge: token sent, relaying stdio <-> pipe");

using var stdin = Console.OpenStandardInput();
using var stdout = Console.OpenStandardOutput();
var toRevit = CopyAsync(stdin, pipe);
var toClaude = CopyAsync(pipe, stdout);
await Task.WhenAny(toRevit, toClaude);
Log("bridge: relay ended, exiting");
return 0;

async Task CopyAsync(Stream from, Stream to)
{
    var buffer = new byte[16 * 1024];
    try
    {
        int read;
        while ((read = await from.ReadAsync(buffer)) > 0)
        {
            await to.WriteAsync(buffer.AsMemory(0, read));
            await to.FlushAsync();
        }
    }
    catch (IOException e) { Log($"bridge: copy loop ended ({e.Message})"); }
}
