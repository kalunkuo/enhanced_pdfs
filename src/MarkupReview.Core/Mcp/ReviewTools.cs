using System.Text.Json;
using System.Text.Json.Nodes;

namespace MarkupReview.Core.Mcp;

/// <summary>The review-only tool surface. Nothing here writes to the model; proposals only enter the session.</summary>
public sealed class ReviewTools(ReviewSession session, IModelGateway model)
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };

    public static JsonArray Definitions() =>
    [
        Tool("list_markups", "List every markup on the returned PDF: id, kind, author, text, and the elements it is linked to or mentions (handle, relation, match status against the open model, category, family, type).",
            new JsonObject()),
        Tool("get_element", "Current state of one element in the open Revit model: category, family, type, instance and type parameters (name, scope, storage, current value, read-only), and the value exported in the PDF where it differs.",
            Props(("handle", Str("Element handle from list_markups."))), "handle"),
        Tool("get_parameter_options", "Valid values for a parameter where Revit can enumerate them, otherwise its storage type and unit.",
            Props(("handle", Str("Element handle.")), ("parameter", Str("Parameter name.")), ("scope", Enum("instance", "type"))), "handle", "parameter", "scope"),
        Tool("list_types", "Types this element can be swapped to.",
            Props(("handle", Str("Element handle."))), "handle"),
        Tool("propose_change", "Stage one proposed change for the user to approve or reject. Does not change the model. The value is validated; an error explains what is allowed. `change` holds exactly one of set_parameter or change_type.",
            Props(
                ("markup_id", Str("The markup this change comes from.")),
                ("handle", Str("Element handle linked to or mentioned by that markup.")),
                ("reason", Str("One line for the reviewer, citing the markup's words.")),
                ("change", new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["set_parameter"] = Obj(Props(("name", Str("Parameter name.")), ("scope", Enum("instance", "type")), ("value", Str("New value as Revit displays it."))), "name", "scope", "value"),
                        ["change_type"] = Obj(Props(("type_name", Str("Family-qualified type name \"Family: Name\" from list_types (names repeat across families)."))), "type_name"),
                    },
                })),
            "markup_id", "handle", "reason", "change"),
        Tool("add_review_note", "Record a markup that is not a concrete parameter or type change, or that cannot be resolved, so the reviewer reads it.",
            Props(("markup_id", Str("Markup id.")), ("text", Str("What the markup asks and why it is a note."))), "markup_id", "text"),
        Tool("finish_review", "Call once after every markup has a proposal or a note.",
            Props(("summary", Str("One or two lines for the top of the review panel."))), "summary"),
    ];

    public async Task<JsonObject> CallAsync(string name, JsonObject args)
    {
        try
        {
            return name switch
            {
                "list_markups" => Ok(await ListMarkups()),
                "get_element" => Ok(await GetElement(Arg(args, "handle"))),
                "get_parameter_options" => Ok(await GetOptions(Arg(args, "handle"), Arg(args, "parameter"), Scope(Arg(args, "scope")))),
                "list_types" => Ok(await ListTypes(Arg(args, "handle"))),
                "propose_change" => await Propose(args),
                "add_review_note" => AddNote(Arg(args, "markup_id"), Arg(args, "text")),
                "finish_review" => Finish(Arg(args, "summary")),
                _ => Fail($"Unknown tool '{name}'."),
            };
        }
        catch (ToolError e) { return Fail(e.Message); }
    }

    private async Task<JsonNode> ListMarkups()
    {
        var markups = new JsonArray();
        foreach (var m in session.Markups)
        {
            var elements = new JsonArray();
            foreach (var link in m.Links)
            {
                var entry = new JsonObject { ["handle"] = link.ElementKey, ["relation"] = link.Relation };
                if (session.Tables.ElementsByKey.TryGetValue(link.ElementKey, out var e))
                {
                    var current = e.LinkInstanceId is null ? await model.FindAsync(e.UniqueId) : null;
                    entry["status"] = Status(ElementMatcher.Match(e, current));
                    entry["element_id"] = e.ElementId;
                    entry["category"] = e.Category;
                    entry["family"] = e.Family;
                    entry["type"] = e.Type;
                }
                else entry["status"] = "not_in_pdf";
                elements.Add(entry);
            }
            markups.Add(new JsonObject
            {
                ["id"] = m.Id, ["page"] = m.Page, ["kind"] = m.Kind, ["author"] = m.Author, ["text"] = m.Text, ["elements"] = elements,
            });
        }
        return new JsonObject { ["source"] = session.Source, ["markups"] = markups };
    }

    private async Task<JsonNode> GetElement(string handle)
    {
        var (exported, current) = await Resolve(handle);
        var parameters = new JsonArray();
        foreach (var p in current.Parameters)
        {
            string owner = p.Scope == ParamScope.Type ? exported.TypeKey ?? "" : exported.ElementKey;
            string? exportedValue = session.Tables.ParametersByOwner[owner].FirstOrDefault(x => x.Name == p.Name)?.DisplayValue;
            var entry = new JsonObject
            {
                ["name"] = p.Name, ["scope"] = p.Scope == ParamScope.Type ? "type" : "instance", ["storage"] = p.Storage,
                ["value"] = p.DisplayValue, ["read_only"] = p.ReadOnly,
            };
            if (exportedValue is not null && exportedValue != p.DisplayValue) entry["exported_value"] = exportedValue;
            parameters.Add(entry);
        }
        return new JsonObject
        {
            ["handle"] = handle, ["element_id"] = exported.ElementId, ["status"] = Status(ElementMatcher.Match(exported, current)),
            ["category"] = current.Category, ["family"] = current.Family, ["type"] = current.Type,
            ["type_instance_count"] = current.TypeInstanceCount, ["parameters"] = parameters,
        };
    }

    private async Task<JsonNode> GetOptions(string handle, string parameter, ParamScope scope)
    {
        var (_, current) = await Resolve(handle);
        var options = await model.GetOptionsAsync(current.UniqueId, parameter, scope);
        return new JsonObject
        {
            ["storage"] = options.Storage, ["unit"] = options.Unit,
            ["allowed"] = options.Allowed is null ? null : new JsonArray([.. options.Allowed.Select(a => (JsonNode)a)]),
        };
    }

    private async Task<JsonNode> ListTypes(string handle)
    {
        var (_, current) = await Resolve(handle);
        var types = await model.ListTypesAsync(current.UniqueId);
        return new JsonObject
        {
            ["current"] = current.Family is null ? current.Type : $"{current.Family}: {current.Type}",
            ["types"] = new JsonArray([.. types.Select(t => (JsonNode)new JsonObject
            {
                ["full_name"] = t.FullName, ["family"] = t.Family, ["name"] = t.Name,
                ["sizes"] = new JsonObject([.. t.Sizes.Select(s => KeyValuePair.Create(s.Key, (JsonNode?)s.Value))]),
            })]),
        };
    }

    private async Task<JsonObject> Propose(JsonObject args)
    {
        string markupId = Arg(args, "markup_id"), handle = Arg(args, "handle"), reason = Arg(args, "reason");
        var markup = session.FindMarkup(markupId) ?? throw new ToolError($"No markup '{markupId}'.");
        if (markup.Links.All(l => l.ElementKey != handle))
            throw new ToolError($"Element '{handle}' is not linked to or mentioned by markup '{markupId}'. Propose only on that markup's elements: {string.Join(", ", markup.Links.Select(l => l.ElementKey))}.");

        Change change = args["change"] switch
        {
            JsonObject c when c["set_parameter"] is JsonObject s =>
                new SetParameter(Arg(s, "name"), Scope(Arg(s, "scope")), Arg(s, "value")),
            JsonObject c when c["change_type"] is JsonObject t => new ChangeType(Arg(t, "type_name")),
            _ => throw new ToolError("`change` must contain set_parameter or change_type."),
        };

        var proposal = new Proposal { Id = session.NextProposalId(), MarkupId = markupId, ElementKey = handle, Change = change, Reason = reason };
        var result = await ProposalValidator.ValidateAsync(proposal, model, session.Tables);
        if (!result.Ok) return Fail(result.Error!);

        proposal.OldValue = result.OldValue;
        proposal.NewValue = result.NormalisedValue;
        proposal.AffectsCount = result.AffectsCount;
        proposal.SizeChanges = result.SizeChanges;
        if (result.BlockReason is not null) { proposal.Status = ProposalStatus.Blocked; proposal.BlockReason = result.BlockReason; }
        session.Add(proposal);

        string text = result.BlockReason is not null
            ? $"Staged {proposal.Id} as blocked: {result.BlockReason}. The reviewer will see it but cannot approve it."
            : $"Staged {proposal.Id}: '{result.OldValue}' → '{result.NormalisedValue}'" + (result.AffectsCount > 1 ? $" (type change, affects {result.AffectsCount} elements)." : ".")
              + (result.SizeChanges.Count > 0 ? " Size: " + string.Join("; ", result.SizeChanges.Select(s => $"{s.Name} {s.OldValue ?? "—"} → {s.NewValue ?? "—"}")) + "." : "");
        return Text(text, isError: false);
    }

    private JsonObject AddNote(string markupId, string text)
    {
        if (session.FindMarkup(markupId) is null) throw new ToolError($"No markup '{markupId}'.");
        var note = session.AddNote(markupId, text);
        return Text($"Recorded {note.Id}.", isError: false);
    }

    private JsonObject Finish(string summary)
    {
        session.Finish(summary);
        return Text("Review finished. The reviewer will approve or reject each proposal in Revit.", isError: false);
    }

    private async Task<(ExportedElement Exported, ModelElement Current)> Resolve(string handle)
    {
        if (!session.Tables.ElementsByKey.TryGetValue(handle, out var exported))
            throw new ToolError($"Element handle '{handle}' is not in this PDF.");
        if (exported.LinkInstanceId is not null)
            throw new ToolError("Element is in a linked model; it cannot be changed from this model. Use add_review_note.");
        var current = await model.FindAsync(exported.UniqueId)
            ?? throw new ToolError("Element is no longer in the open model.");
        return (exported, current);
    }

    private static string Status(MatchStatus s) => s switch
    {
        MatchStatus.Matched => "matched",
        MatchStatus.ChangedSinceExport => "changed_since_export",
        MatchStatus.Missing => "missing",
        _ => "linked_model",
    };

    private static ParamScope Scope(string s) => s.Trim().ToLowerInvariant() switch
    {
        "type" => ParamScope.Type,
        "instance" => ParamScope.Instance,
        _ => throw new ToolError($"scope must be 'instance' or 'type', not '{s}'."),
    };

    private static string Arg(JsonObject args, string name) =>
        args[name] is JsonValue v && v.TryGetValue(out string? s) && !string.IsNullOrWhiteSpace(s) ? s : throw new ToolError($"Missing argument '{name}'.");

    private static JsonObject Ok(JsonNode payload) => Text(payload.ToJsonString(Json), isError: false);
    private static JsonObject Fail(string message) => Text(message, isError: true);
    private static JsonObject Text(string text, bool isError) => new()
    {
        ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text }),
        ["isError"] = isError,
    };

    private static JsonObject Tool(string name, string description, JsonObject properties, params string[] required) =>
        new() { ["name"] = name, ["description"] = description, ["inputSchema"] = Obj(properties, required) };

    private static JsonObject Obj(JsonObject properties, params string[] required) => new()
    {
        ["type"] = "object", ["properties"] = properties,
        ["required"] = new JsonArray([.. required.Select(r => (JsonNode)r)]), ["additionalProperties"] = false,
    };

    private static JsonObject Props(params (string Name, JsonObject Schema)[] props)
    {
        var o = new JsonObject();
        foreach (var (n, s) in props) o[n] = s;
        return o;
    }

    private static JsonObject Str(string description) => new() { ["type"] = "string", ["description"] = description };
    private static JsonObject Enum(params string[] values) => new() { ["type"] = "string", ["enum"] = new JsonArray([.. values.Select(v => (JsonNode)v)]) };

    private sealed class ToolError(string message) : Exception(message);
}
