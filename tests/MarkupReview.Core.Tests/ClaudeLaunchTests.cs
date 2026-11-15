using System.Text.Json.Nodes;
using MarkupReview.Core.Claude;
using MarkupReview.Core.Tests.Fixtures;

namespace MarkupReview.Core.Tests;

public sealed class ClaudeLaunchTests : IDisposable
{
    private readonly TempDir _dir = new();
    public void Dispose() => _dir.Dispose();

    private System.Diagnostics.ProcessStartInfo Build() =>
        ClaudeLaunch.Build(@"C:\tools\claude.exe", @"C:\addin\MarkupReview.Bridge.exe", "pipe-1", "tok-1", _dir.Path);

    [Fact]
    public void Args_never_contain_bare()
    {
        Assert.DoesNotContain("--bare", Build().ArgumentList);
        Assert.DoesNotContain("--dangerously-skip-permissions", Build().ArgumentList);
    }

    [Fact]
    public void Args_contain_strict_mcp_and_empty_tools()
    {
        var args = Build().ArgumentList.ToList();
        Assert.Equal("-p", args[0]);
        Assert.Contains("--strict-mcp-config", args);
        Assert.Equal("", args[args.IndexOf("--tools") + 1]);
        Assert.Equal("mcp__revit__*", args[args.IndexOf("--allowedTools") + 1]);
        Assert.Equal("stream-json", args[args.IndexOf("--output-format") + 1]);
        Assert.Contains("--verbose", args);
        Assert.Contains("--no-session-persistence", args);
        Assert.Equal("2", args[args.IndexOf("--max-budget-usd") + 1]);
    }

    [Fact]
    public void Runs_in_the_session_work_dir()
    {
        var info = Build();
        Assert.Equal(_dir.Path, info.WorkingDirectory);
        Assert.True(info.RedirectStandardOutput);
        Assert.False(info.UseShellExecute);
        Assert.True(info.CreateNoWindow);
    }

    [Fact]
    public void Reads_claude_output_as_utf8()
    {
        // Windows defaults to the OEM code page; Claude's stream-json is UTF-8 ("→" arrived as "â†’").
        Assert.Equal(65001, Build().StandardOutputEncoding?.CodePage);
        Assert.Equal(65001, Build().StandardErrorEncoding?.CodePage);
    }

    [Fact]
    public void Mcp_config_points_to_bridge_with_pipe_and_token()
    {
        var args = Build().ArgumentList.ToList();
        string configPath = args[args.IndexOf("--mcp-config") + 1];
        Assert.StartsWith(_dir.Path, configPath);
        var server = JsonNode.Parse(File.ReadAllText(configPath))!["mcpServers"]!["revit"]!;
        Assert.Equal("stdio", (string?)server["type"]);
        Assert.Equal(@"C:\addin\MarkupReview.Bridge.exe", (string?)server["command"]);
        Assert.Equal(["--pipe", "pipe-1", "--token", "tok-1"], server["args"]!.AsArray().Select(a => (string)a!));
    }

    [Fact]
    public void Prompt_asks_to_finish_each_markup_before_the_next()
    {
        // The reviewer starts approving while Claude works, so proposals must arrive one markup at a time.
        Assert.Contains("before you look at the next markup", Build().ArgumentList[1]);
    }

    [Fact]
    public void Prompt_names_every_review_tool()
    {
        string prompt = Build().ArgumentList[1];
        foreach (var tool in new[] { "list_markups", "get_element", "propose_change", "add_review_note", "finish_review" })
            Assert.Contains(tool, prompt);
    }
}

public sealed class StreamEventsTests
{
    [Fact]
    public void Parses_tool_use_event()
    {
        var events = StreamEvents.Parse("""{"type":"assistant","message":{"content":[{"type":"text","text":"Reading markups"},{"type":"tool_use","id":"t1","name":"mcp__revit__list_markups","input":{}}]}}""");
        Assert.Equal([new Thinking("Reading markups"), new ToolCall("list_markups")], events);
    }

    [Fact]
    public void Result_error_max_budget_is_reported()
    {
        var e = Assert.Single(StreamEvents.Parse("""{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":2.01}"""));
        Assert.Equal(new Result(true, "error_max_budget_usd", 2.01, null), e);
    }

    [Fact]
    public void Result_success_is_reported()
    {
        var e = Assert.Single(StreamEvents.Parse("""{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.42,"result":"done"}"""));
        Assert.Equal(new Result(false, "success", 0.42, "done"), e);
    }

    [Fact]
    public void Result_carries_its_text()
    {
        var e = Assert.Single(StreamEvents.Parse("""{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key · Please run /login"}"""));
        Assert.Equal("Invalid API key · Please run /login", ((Result)e).Text);
    }

    [Fact]
    public void Sign_in_failure_points_to_claude_auth_login()
    {
        string status = ClaudeStatus.Stopped(new Result(true, "success", null, "Invalid API key · Please run /login"), "");
        Assert.Contains("claude auth login", status);
    }

    [Fact]
    public void Sign_in_failure_seen_only_on_stderr_points_to_claude_auth_login()
    {
        Assert.Contains("claude auth login", ClaudeStatus.Stopped(null, "Error: Not logged in. Please run claude auth login"));
    }

    [Fact]
    public void Budget_stop_names_the_cap()
    {
        Assert.Contains("$2", ClaudeStatus.Stopped(new Result(true, "error_max_budget_usd", 2.01, null), ""));
    }

    [Fact]
    public void Other_errors_show_claudes_own_message()
    {
        Assert.Contains("Overloaded", ClaudeStatus.Stopped(new Result(true, "error_during_execution", null, "API Error: 529 Overloaded"), ""));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("""{"type":"system","subtype":"init"}""")]
    [InlineData("""{"type":"user","message":{"content":[{"type":"tool_result"}]}}""")]
    public void Ignores_unknown_lines(string line) => Assert.Empty(StreamEvents.Parse(line));
}
