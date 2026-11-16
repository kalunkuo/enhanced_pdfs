using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;

namespace MarkupReview.Core.Mcp;

/// <summary>
/// Accepts bridge connections on a per-session named pipe. The first line on each connection must be the session token;
/// anything else is dropped before the handler sees a byte.
/// </summary>
public static class PipeHost
{
    private const int MaxTokenBytes = 256;

    public static async Task RunAsync(string pipeName, string token, Func<Stream, Task> handler, CancellationToken cancel, Action<string>? log = null)
    {
        byte[] expected = Encoding.UTF8.GetBytes(token);
        var running = new List<Task>();
        log?.Invoke($"pipe: listening on {pipeName}");
        while (!cancel.IsCancellationRequested)
        {
            var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            try { await pipe.WaitForConnectionAsync(cancel); }
            catch (OperationCanceledException) { await pipe.DisposeAsync(); break; }
            log?.Invoke("pipe: client connected, verifying token");

            running.Add(Task.Run(async () =>
            {
                await using (pipe)
                {
                    byte[]? presented = await ReadLineBytes(pipe, cancel);
                    if (presented is null) { log?.Invoke("pipe: client disconnected before sending a token"); return; }
                    if (!CryptographicOperations.FixedTimeEquals(presented, expected)) { log?.Invoke("pipe: token mismatch, dropping connection"); return; }
                    log?.Invoke("pipe: token accepted, handing off to the MCP handler");
                    try { await handler(pipe); }
                    catch (Exception e) when (e is IOException or OperationCanceledException) { log?.Invoke($"pipe: handler ended ({e.GetType().Name})"); }
                }
            }, CancellationToken.None));
        }
        await Task.WhenAll(running);
    }

    /// <summary>Reads one '\n'-terminated line byte by byte, so nothing after it is buffered away from the handler.</summary>
    private static async Task<byte[]?> ReadLineBytes(Stream stream, CancellationToken cancel)
    {
        var buffer = new List<byte>();
        var one = new byte[1];
        while (buffer.Count <= MaxTokenBytes)
        {
            int read;
            try { read = await stream.ReadAsync(one, cancel); }
            catch (Exception e) when (e is IOException or OperationCanceledException) { return null; }
            if (read == 0) return null;
            if (one[0] == (byte)'\n') return [.. buffer.SkipLast(buffer.Count > 0 && buffer[^1] == (byte)'\r' ? 1 : 0)];
            buffer.Add(one[0]);
        }
        return null;
    }
}
