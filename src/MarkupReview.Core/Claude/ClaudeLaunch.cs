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
        2. Work through the markups one at a time; the reviewer starts approving as soon as your first proposal arrives.
           Finish each markup (its proposals or its note) before you look at the next markup.
           For each one: call get_element for its elements (and get_parameter_options or list_types when you need valid values).
           - Doors and windows that should open the other way ("open outwards", "swing the other way", "wrong hand") are a
             flip: change.flip with side "facing" (opening direction) or "hand" (hinge side), one proposal per door.
           - If the markup's text states or clearly implies a parameter value or a type for one of its elements, call
             propose_change with that exact value and a one-line reason that quotes the markup's words.
             A markup over several elements may need several proposals.
           - Markups often work in pairs: an arrow pointing at an element plus a text box saying what to change, or text
             next to a cloud. Read them together and pass the partner in related_markup_ids; the element may be linked by
             either one. Contradicting markups (e.g. "open outwards" vs "flipped inwards") get a note, not a guess.
           - Otherwise (a question, a coordination request, an ambiguous or unsupported request, a linked-model element,
             a move or delete) call add_review_note explaining what it asks.
           - Never propose a value the markup does not support. If propose_change returns an error, correct the value from the
             error message or fall back to add_review_note.
        3. When every markup has a proposal or a note, call finish_review with a one-line summary.
        Keep your own text short; the reviewer reads the proposals, not your messages.
        """;

    public static ProcessStartInfo Build(string claudePath, string bridgePath, string pipeName, string token, string workDir, string? prompt = null)
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
            // Claude Code writes UTF-8; Windows would otherwise decode with the OEM code page.
            StandardOutputEncoding = new System.Text.UTF8Encoding(false),
            StandardErrorEncoding = new System.Text.UTF8Encoding(false),
        };
        foreach (var arg in new[]
        {
            "-p", prompt ?? Prompt,
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

    /// <summary>
    /// "Approve, but…": a short follow-up run that revises one proposal the way the reviewer asked. No finish_review —
    /// the main run's summary stays at the top of the panel.
    /// </summary>
    public static string RevisionPrompt(Proposal proposal, Markup markup, IReadOnlyList<Markup> related, string instruction)
    {
        string what = proposal.Change switch
        {
            SetParameter s => $"set {s.Scope.ToString().ToLowerInvariant()} parameter '{s.Name}'",
            ChangeType => "change type",
            FlipInstance f => $"flip {f.Side.ToString().ToLowerInvariant()}",
            _ => "change",
        };
        string relatedText = related.Count == 0 ? "" :
            "\nRelated markups read with it:\n" + string.Join("\n", related.Select(m => $"- {m.Id} ({m.Kind}): \"{m.Text}\""));
        return $"""
            You are revising one proposal from a markup review of a Revit model. The reviewer agreed with its intent but
            asked for a change. Your tools are read-only on the model: you can only stage proposals.

            Markup {markup.Id} ({markup.Kind}{(markup.Author is null ? "" : $", by {markup.Author}")}): "{markup.Text}"{relatedText}
            Proposal {proposal.Id} on element {proposal.ElementKey}: {what}, {proposal.OldValue} → {proposal.NewValue}.
            Its reason: {proposal.Reason}

            The reviewer's instruction: "{instruction}"

            Use get_element, get_parameter_options and list_types as needed, then call propose_change once with
            replaces = "{proposal.Id}" and a one-line reason that mentions the reviewer's instruction. It may target
            another element the markup (or a related markup, via related_markup_ids) is tied to.
            If the instruction cannot be done with the available change kinds (set_parameter, change_type, flip), call
            add_review_note for markup {markup.Id} explaining why, and stop. Keep your own text short.
            """;
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
