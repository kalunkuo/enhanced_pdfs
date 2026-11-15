using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MarkupReview.Core.Mcp;

/// <summary>
/// Minimal MCP server over newline-delimited JSON-RPC 2.0 (the MCP stdio transport): initialize, ping, tools/list, tools/call.
/// </summary>
public static class McpServer
{
    public const string ServerName = "revit";
    private const string DefaultProtocol = "2025-06-18";

    public static async Task RunAsync(Stream input, Stream output, ReviewTools tools, CancellationToken cancel)
    {
        using var reader = new StreamReader(input, new UTF8Encoding(false), leaveOpen: true);
        var writeLock = new SemaphoreSlim(1, 1);
        while (!cancel.IsCancellationRequested)
        {
            string? line = await reader.ReadLineAsync(cancel);
            if (line is null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;

            JsonNode? response = await HandleAsync(line, tools);
            if (response is null) continue;
            byte[] bytes = Encoding.UTF8.GetBytes(response.ToJsonString() + "\n");
            await writeLock.WaitAsync(cancel);
            try { await output.WriteAsync(bytes, cancel); await output.FlushAsync(cancel); }
            finally { writeLock.Release(); }
        }
    }

    internal static async Task<JsonNode?> HandleAsync(string line, ReviewTools tools)
    {
        JsonObject request;
        try { request = JsonNode.Parse(line)?.AsObject() ?? throw new JsonException("empty"); }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            return Error(null, -32700, "Parse error");
        }

        JsonNode? id = request["id"]?.DeepClone();
        string? method = (string?)request["method"];
        bool isNotification = !request.ContainsKey("id");
        if (isNotification) return null;

        try
        {
            switch (method)
            {
                case "initialize":
                    string protocol = (string?)request["params"]?["protocolVersion"] ?? DefaultProtocol;
                    return Result(id, new JsonObject
                    {
                        ["protocolVersion"] = protocol,
                        ["capabilities"] = new JsonObject { ["tools"] = new JsonObject() },
                        ["serverInfo"] = new JsonObject { ["name"] = ServerName, ["version"] = "0.1.0" },
                        ["instructions"] = "Review-only tools for markups on an enhanced PDF. No tool changes the Revit model; proposals wait for the user's approval.",
                    });
                case "ping":
                    return Result(id, new JsonObject());
                case "tools/list":
                    return Result(id, new JsonObject { ["tools"] = ReviewTools.Definitions() });
                case "tools/call":
                    string name = (string?)request["params"]?["name"] ?? "";
                    var args = request["params"]?["arguments"] as JsonObject ?? [];
                    return Result(id, await tools.CallAsync(name, args));
                default:
                    return Error(id, -32601, $"Method not found: {method}");
            }
        }
        catch (Exception e)
        {
            return Error(id, -32603, e.Message);
        }
    }

    private static JsonObject Result(JsonNode? id, JsonNode result) =>
        new() { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result };

    private static JsonObject Error(JsonNode? id, int code, string message) =>
        new() { ["jsonrpc"] = "2.0", ["id"] = id, ["error"] = new JsonObject { ["code"] = code, ["message"] = message } };
}
