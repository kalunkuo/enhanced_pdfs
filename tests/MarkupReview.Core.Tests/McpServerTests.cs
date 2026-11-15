using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using MarkupReview.Core.Mcp;
using MarkupReview.Core.Tests.Fixtures;

namespace MarkupReview.Core.Tests;

public sealed class McpServerTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly ReviewSession _session;
    private readonly FakeModelGateway _model = FakeModelGateway.Snowdon();

    public McpServerTests()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(
                new { id = "m1", page = 1, kind = "rect", from = new { x = 1.0, y = 1.0 }, to = new { x = 9.0, y = 9.0 }, text = "should be 1 HR per code review", elementKey = FixturePdf.WallKey },
                new { id = "m2", page = 1, kind = "text", from = new { x = 1.0, y = 1.0 }, to = new { x = 1.0, y = 1.0 }, text = "check with structural" },
                new { id = "m3", page = 1, kind = "comment", from = new { x = 5.0, y = 5.0 }, to = new { x = 5.0, y = 5.0 }, text = "door too narrow", elementKey = FixturePdf.DoorKey }),
        };
        var pdf = ReturnedPdf.Open(fixture.Save(_dir.Path));
        var tables = ExportTables.Load(pdf);
        var (markups, source) = MarkupSources.Read(pdf, tables);
        _session = new ReviewSession(pdf, tables, markups, source);
    }

    public void Dispose() => _dir.Dispose();

    private async Task<List<JsonNode>> Exchange(params object[] requests)
    {
        string input = string.Concat(requests.Select(r => JsonSerializer.Serialize(r) + "\n"));
        var output = new MemoryStream();
        await McpServer.RunAsync(new MemoryStream(Encoding.UTF8.GetBytes(input)), output, new ReviewTools(_session, _model), CancellationToken.None);
        return [.. Encoding.UTF8.GetString(output.ToArray()).Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => JsonNode.Parse(l)!)];
    }

    private static object Call(int id, string tool, object args) =>
        new { jsonrpc = "2.0", id, method = "tools/call", @params = new { name = tool, arguments = args } };

    [Fact]
    public async Task Initialize_echoes_protocol_and_names_server_revit()
    {
        var r = Assert.Single(await Exchange(
            new { jsonrpc = "2.0", id = 1, method = "initialize", @params = new { protocolVersion = "2025-06-18", capabilities = new { }, clientInfo = new { name = "claude-code", version = "x" } } },
            new { jsonrpc = "2.0", method = "notifications/initialized" }));
        Assert.Equal("2025-06-18", (string?)r["result"]!["protocolVersion"]);
        Assert.Equal("revit", (string?)r["result"]!["serverInfo"]!["name"]);
        Assert.NotNull(r["result"]!["capabilities"]!["tools"]);
    }

    [Fact]
    public async Task Tools_list_has_exactly_the_seven_review_tools()
    {
        var r = Assert.Single(await Exchange(new { jsonrpc = "2.0", id = 2, method = "tools/list" }));
        var names = r["result"]!["tools"]!.AsArray().Select(t => (string)t!["name"]!).Order().ToList();
        Assert.Equal(["add_review_note", "finish_review", "get_element", "get_parameter_options", "list_markups", "list_types", "propose_change"], names);
        Assert.All(r["result"]!["tools"]!.AsArray(), t => Assert.Equal("object", (string?)t!["inputSchema"]!["type"]));
    }

    [Fact]
    public async Task No_tool_name_suggests_model_write()
    {
        var r = Assert.Single(await Exchange(new { jsonrpc = "2.0", id = 2, method = "tools/list" }));
        foreach (var t in r["result"]!["tools"]!.AsArray())
        {
            string name = (string)t!["name"]!;
            Assert.DoesNotContain("set_", name);
            Assert.DoesNotContain("apply", name);
            Assert.DoesNotContain("delete", name);
        }
    }

    [Fact]
    public async Task List_markups_returns_links_with_match_status()
    {
        var r = Assert.Single(await Exchange(Call(3, "list_markups", new { })));
        var payload = JsonNode.Parse((string)r["result"]!["content"]![0]!["text"]!)!;
        var m1 = payload["markups"]!.AsArray().Single(m => (string?)m!["id"] == "m1")!;
        Assert.Equal("should be 1 HR per code review", (string?)m1["text"]);
        var link = m1["elements"]![0]!;
        Assert.Equal(FixturePdf.WallKey, (string?)link["handle"]);
        Assert.Equal("linked", (string?)link["relation"]);
        Assert.Equal("matched", (string?)link["status"]);
        Assert.Equal("Walls", (string?)link["category"]);
    }

    [Fact]
    public async Task Propose_change_valid_adds_pending_proposal_with_reason()
    {
        var r = Assert.Single(await Exchange(Call(4, "propose_change", new
        {
            markup_id = "m1", handle = FixturePdf.WallKey, reason = "Markup says 'should be 1 HR'.",
            change = new { set_parameter = new { name = "Fire Rating", scope = "type", value = "1 HR" } },
        })));
        Assert.NotEqual(true, (bool?)r["result"]!["isError"]);
        var p = Assert.Single(_session.Proposals);
        Assert.Equal((ProposalStatus.Pending, "2 HR", "1 HR", 14, "Markup says 'should be 1 HR'."), (p.Status, p.OldValue, p.NewValue, p.AffectsCount, p.Reason));
        Assert.Contains("14", (string)r["result"]!["content"]![0]!["text"]!);
    }

    [Fact]
    public async Task List_types_includes_each_types_sizes()
    {
        var r = Assert.Single(await Exchange(Call(11, "list_types", new { handle = FixturePdf.DoorKey })));
        var payload = JsonNode.Parse((string)r["result"]!["content"]![0]!["text"]!)!;
        var wide = payload["types"]!.AsArray().Single(t => (string?)t!["name"] == "36\" x 84\"")!;
        Assert.Equal("3' - 0\"", (string?)wide["sizes"]!["Width"]);
    }

    [Fact]
    public async Task Propose_type_swap_keeps_size_changes_and_reports_them()
    {
        var r = Assert.Single(await Exchange(Call(10, "propose_change", new
        {
            markup_id = "m3", handle = FixturePdf.DoorKey, reason = "Markup says the door is too narrow.",
            change = new { change_type = new { type_name = "36\" x 84\"" } },
        })));
        Assert.NotEqual(true, (bool?)r["result"]!["isError"]);
        Assert.Equal([new SizeChange("Width", "2' - 8\"", "3' - 0\"")], Assert.Single(_session.Proposals).SizeChanges);
        Assert.Contains("Width 2' - 8\" → 3' - 0\"", (string)r["result"]!["content"]![0]!["text"]!);
    }

    [Fact]
    public async Task Propose_change_invalid_returns_isError_and_stages_nothing()
    {
        var r = Assert.Single(await Exchange(Call(5, "propose_change", new
        {
            markup_id = "m1", handle = FixturePdf.WallKey, reason = "x",
            change = new { set_parameter = new { name = "Fire Rating", scope = "type", value = "2 HR" } },
        })));
        Assert.True((bool?)r["result"]!["isError"]);
        Assert.Empty(_session.Proposals);
    }

    [Fact]
    public async Task Propose_change_on_element_not_linked_to_the_markup_is_rejected()
    {
        var r = Assert.Single(await Exchange(Call(6, "propose_change", new
        {
            markup_id = "m1", handle = FixturePdf.DoorKey, reason = "x",
            change = new { change_type = new { type_name = "36\" x 84\"" } },
        })));
        Assert.True((bool?)r["result"]!["isError"]);
        Assert.Contains("not linked", (string)r["result"]!["content"]![0]!["text"]!);
        Assert.Empty(_session.Proposals);
    }

    [Fact]
    public async Task Propose_on_element_linked_by_a_related_markup_is_accepted()
    {
        // A text box (m2, untied) that belongs with a comment on the door (m3): the pair together names the element.
        var r = Assert.Single(await Exchange(Call(12, "propose_change", new
        {
            markup_id = "m2", related_markup_ids = new[] { "m3" }, handle = FixturePdf.DoorKey, reason = "Text box and door comment together.",
            change = new { change_type = new { type_name = "Single-Flush: 36\" x 84\"" } },
        })));
        Assert.NotEqual(true, (bool?)r["result"]!["isError"]);
        Assert.Equal(["m3"], Assert.Single(_session.Proposals).RelatedMarkupIds);
    }

    [Fact]
    public async Task Propose_flip_stages_a_flip_proposal()
    {
        var r = Assert.Single(await Exchange(Call(14, "propose_change", new
        {
            markup_id = "m3", handle = FixturePdf.DoorKey, reason = "Markup: doors should open outwards.",
            change = new { flip = new { side = "facing" } },
        })));
        Assert.NotEqual(true, (bool?)r["result"]!["isError"]);
        Assert.Equal(new FlipInstance(FlipSide.Facing), Assert.Single(_session.Proposals).Change);
    }

    private Proposal StageWallProposal() => _session.Add(new Proposal
    {
        Id = _session.NextProposalId(), MarkupId = "m1", ElementKey = FixturePdf.WallKey, Reason = "first try",
        Change = new SetParameter("Fire Rating", ParamScope.Type, "1 HR"), OldValue = "2 HR", NewValue = "1 HR",
    });

    [Fact]
    public async Task Propose_with_replaces_marks_the_old_proposal_revised()
    {
        var old = StageWallProposal();
        var r = Assert.Single(await Exchange(Call(15, "propose_change", new
        {
            markup_id = "m1", replaces = old.Id, handle = FixturePdf.WallKey, reason = "Reviewer: make it 3 HR instead.",
            change = new { set_parameter = new { name = "Fire Rating", scope = "type", value = "3 HR" } },
        })));
        Assert.NotEqual(true, (bool?)r["result"]!["isError"]);
        var fresh = _session.Proposals.Single(p => p.Id != old.Id);
        Assert.Equal((ProposalStatus.Revised, fresh.Id), (old.Status, old.RevisedBy));
        Assert.Equal((ProposalStatus.Pending, old.Id, "3 HR"), (fresh.Status, fresh.Replaces, fresh.NewValue));
    }

    [Fact]
    public async Task Replacing_a_decided_or_unknown_proposal_is_rejected()
    {
        var old = StageWallProposal();
        old.Status = ProposalStatus.Approved;
        foreach (var id in new[] { old.Id, "proposal-99" })
        {
            var r = Assert.Single(await Exchange(Call(16, "propose_change", new
            {
                markup_id = "m1", replaces = id, handle = FixturePdf.WallKey, reason = "x",
                change = new { set_parameter = new { name = "Fire Rating", scope = "type", value = "3 HR" } },
            })));
            Assert.True((bool?)r["result"]!["isError"]);
        }
        Assert.Single(_session.Proposals);
    }

    [Fact]
    public async Task Unknown_related_markup_is_rejected()
    {
        var r = Assert.Single(await Exchange(Call(13, "propose_change", new
        {
            markup_id = "m2", related_markup_ids = new[] { "nope" }, handle = FixturePdf.DoorKey, reason = "x",
            change = new { change_type = new { type_name = "Single-Flush: 36\" x 84\"" } },
        })));
        Assert.True((bool?)r["result"]!["isError"]);
        Assert.Empty(_session.Proposals);
    }

    [Fact]
    public async Task Add_review_note_and_finish_review_update_the_session()
    {
        string? finished = null;
        _session.Finished += s => finished = s;
        await Exchange(Call(7, "add_review_note", new { markup_id = "m2", text = "Not a model change: coordinate with structural." }),
                       Call(8, "finish_review", new { summary = "1 change, 1 note" }));
        Assert.Equal("Not a model change: coordinate with structural.", Assert.Single(_session.Notes).Text);
        Assert.Equal("1 change, 1 note", finished);
    }

    [Fact]
    public async Task Unknown_method_returns_jsonrpc_error_minus_32601()
    {
        var r = Assert.Single(await Exchange(new { jsonrpc = "2.0", id = 9, method = "resources/list" }));
        Assert.Equal(-32601, (int?)r["error"]!["code"]);
    }

    [Fact]
    public async Task Malformed_line_returns_parse_error_and_keeps_serving()
    {
        var output = new MemoryStream();
        var input = new MemoryStream(Encoding.UTF8.GetBytes("{not json\n" + JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method = "ping" }) + "\n"));
        await McpServer.RunAsync(input, output, new ReviewTools(_session, _model), CancellationToken.None);
        var lines = Encoding.UTF8.GetString(output.ToArray()).Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => JsonNode.Parse(l)!).ToList();
        Assert.Equal(-32700, (int?)lines[0]["error"]!["code"]);
        Assert.NotNull(lines[1]["result"]);
    }

    [Fact]
    public async Task Pipe_host_rejects_wrong_token_and_serves_right_token()
    {
        string pipe = "mr-test-" + Guid.NewGuid().ToString("N");
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var served = new List<string>();
        var host = PipeHost.RunAsync(pipe, "good-token", async stream =>
        {
            using var reader = new StreamReader(stream, leaveOpen: true);
            served.Add(await reader.ReadLineAsync() ?? "");
        }, cts.Token);

        await Send(pipe, "bad-token\nhello-bad\n");
        await Send(pipe, "good-token\nhello-good\n");
        await Task.Delay(300);
        cts.Cancel();
        await host;

        Assert.Equal(["hello-good"], served);
    }

    private static async Task Send(string pipe, string text)
    {
        using var client = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous);
        await client.ConnectAsync(5000);
        try
        {
            await client.WriteAsync(Encoding.UTF8.GetBytes(text));
            await client.FlushAsync();
        }
        catch (IOException) { } // the host hangs up on a wrong token
        await Task.Delay(200);
    }
}
