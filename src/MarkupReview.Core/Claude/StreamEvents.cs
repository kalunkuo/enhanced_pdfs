using System.Text.Json;
using System.Text.Json.Nodes;

namespace MarkupReview.Core.Claude;

public abstract record ProgressEvent;
public sealed record Thinking(string Text) : ProgressEvent;
public sealed record ToolCall(string Name) : ProgressEvent;
public sealed record Result(bool IsError, string? Subtype, double? CostUsd) : ProgressEvent;

/// <summary>Maps Claude Code's stream-json output lines to progress events for the review panel.</summary>
public static class StreamEvents
{
    private const string ToolPrefix = "mcp__revit__";

    public static IReadOnlyList<ProgressEvent> Parse(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return [];
        JsonNode? node;
        try { node = JsonNode.Parse(line); }
        catch (JsonException) { return []; }
        if (node is not JsonObject o) return [];

        switch ((string?)o["type"])
        {
            case "assistant":
                var events = new List<ProgressEvent>();
                if (o["message"]?["content"] is not JsonArray blocks) return events;
                foreach (var block in blocks.OfType<JsonObject>())
                {
                    switch ((string?)block["type"])
                    {
                        case "text" when !string.IsNullOrWhiteSpace((string?)block["text"]):
                            events.Add(new Thinking(((string)block["text"]!).Trim()));
                            break;
                        case "tool_use":
                            string name = (string?)block["name"] ?? "";
                            events.Add(new ToolCall(name.StartsWith(ToolPrefix, StringComparison.Ordinal) ? name[ToolPrefix.Length..] : name));
                            break;
                    }
                }
                return events;
            case "result":
                return [new Result((bool?)o["is_error"] ?? false, (string?)o["subtype"], (double?)o["total_cost_usd"])];
            default:
                return [];
        }
    }
}
