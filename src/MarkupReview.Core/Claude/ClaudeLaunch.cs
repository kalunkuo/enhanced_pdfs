using System.Diagnostics;
using System.Text.Json.Nodes;

namespace MarkupReview.Core.Claude;

/// <summary>Builds the headless Claude Code run for one review session.</summary>
public static class ClaudeLaunch
{
    public const string BudgetUsd = "2";
    public const string ConfigFileName = "revit-mcp.json";

    public const string Prompt = """
        You are reviewing a contractor's markups on a Revit drawing that was exported as an enhanced PDF.
        Your tools are read-only on the model: you can only stage proposals; the reviewer approves or rejects each one in Revit.

        1. Call list_markups.
        2. For every markup: call get_element for its elements (and get_parameter_options or list_types when you need valid values).
           - If the markup's text states or clearly implies a parameter value or a type for one of its elements, call
             propose_change with that exact value and a one-line reason that quotes the markup's words.
             A markup over several elements may need several proposals.
           - Otherwise (a question, a coordination request, an ambiguous or unsupported request, a linked-model element,
             a move or delete) call add_review_note explaining what it asks.
           - Never propose a value the markup does not support. If propose_change returns an error, correct the value from the
             error message or fall back to add_review_note.
        3. When every markup has a proposal or a note, call finish_review with a one-line summary.
        Keep your own text short; the reviewer reads the proposals, not your messages.
        """;

    public static ProcessStartInfo Build(string claudePath, string bridgePath, string pipeName, string token, string workDir)
    {
        Directory.CreateDirectory(workDir);
        string configPath = Path.Combine(workDir, ConfigFileName);
        var config = new JsonObject
        {
            ["mcpServers"] = new JsonObject
            {
                ["revit"] = new JsonObject
                {
                    ["type"] = "stdio",
                    ["command"] = bridgePath,
                    ["args"] = new JsonArray("--pipe", pipeName, "--token", token),
                },
            },
        };
        File.WriteAllText(configPath, config.ToJsonString());

        var info = new ProcessStartInfo(claudePath)
        {
            WorkingDirectory = workDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
        };
        foreach (var arg in new[]
        {
            "-p", Prompt,
            "--mcp-config", configPath,
            "--strict-mcp-config",
            "--tools", "",
            "--allowedTools", "mcp__revit__*",
            "--output-format", "stream-json",
            "--verbose",
            "--no-session-persistence",
            "--max-budget-usd", BudgetUsd,
        })
            info.ArgumentList.Add(arg);
        return info;
    }

    /// <summary>Finds claude.exe on PATH (and the native installer's default location). Null when absent.</summary>
    public static string? Find()
    {
        var dirs = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).ToList();
        dirs.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin"));
        foreach (var dir in dirs)
        {
            string candidate = Path.Combine(dir.Trim('"'), "claude.exe");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
