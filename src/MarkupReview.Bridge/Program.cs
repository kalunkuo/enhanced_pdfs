// stdio MCP server that Claude Code launches; relays bytes to the review session inside Revit over a named pipe.
// Usage: MarkupReview.Bridge --pipe <name> --token <token>
using System.IO.Pipes;
using System.Text;

string? pipeName = null, token = null;
for (int i = 0; i + 1 < args.Length; i += 2)
{
    if (args[i] == "--pipe") pipeName = args[i + 1];
    else if (args[i] == "--token") token = args[i + 1];
}
if (pipeName is null || token is null)
{
    Console.Error.WriteLine("usage: MarkupReview.Bridge --pipe <name> --token <token>");
    return 2;
}

using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
try { await pipe.ConnectAsync(10_000); }
catch (TimeoutException)
{
    Console.Error.WriteLine($"Could not reach the Revit review session on pipe '{pipeName}'. Is the review still open in Revit?");
    return 1;
}

await pipe.WriteAsync(Encoding.UTF8.GetBytes(token + "\n"));
await pipe.FlushAsync();

using var stdin = Console.OpenStandardInput();
using var stdout = Console.OpenStandardOutput();
var toRevit = CopyAsync(stdin, pipe);
var toClaude = CopyAsync(pipe, stdout);
await Task.WhenAny(toRevit, toClaude);
return 0;

static async Task CopyAsync(Stream from, Stream to)
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
    catch (IOException) { }
}
