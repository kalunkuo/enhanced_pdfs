namespace MarkupReview.Core.Claude;

/// <summary>Turns how a Claude run ended into a line the reviewer can act on.</summary>
public static class ClaudeStatus
{
    private static readonly string[] SignInSigns = ["/login", "auth login", "not logged in", "invalid api key", "authentication", "401", "oauth"];

    /// <param name="result">The run's result event, or null when the stream ended without one.</param>
    /// <param name="stderrTail">The end of Claude Code's stderr, where start-up failures land.</param>
    public static string Stopped(Result? result, string stderrTail)
    {
        string evidence = $"{result?.Text} {stderrTail}";
        if (SignInSigns.Any(s => evidence.Contains(s, StringComparison.OrdinalIgnoreCase)))
            return "Claude Code is not signed in. Run `claude auth login` in a terminal once, then import again. Proposals so far are kept.";
        if (result?.Subtype == "error_max_budget_usd")
            return $"Claude stopped at the ${ClaudeLaunch.BudgetUsd} spending cap for one review. Proposals so far are kept.";
        string detail = (result?.Text ?? Last(stderrTail))?.Trim() ?? "";
        if (detail.Length > 200) detail = detail[..199] + "…";
        return detail.Length > 0
            ? $"Claude stopped: {detail} Proposals so far are kept."
            : "Claude stopped before finishing. Proposals so far are kept.";
    }

    private static string? Last(string text) =>
        text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).LastOrDefault();
}
