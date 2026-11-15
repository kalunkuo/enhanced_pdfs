namespace MarkupReview.Core.Tests;

/// <summary>In-memory stand-in for the open Revit model, keyed by UniqueId.</summary>
public sealed class FakeModelGateway : IModelGateway
{
    public string ModelKey { get; set; } = Fixtures.FixturePdf.ModelKey;
    public string Title { get; set; } = "Snowdon Towers Sample Architectural";
    public Dictionary<string, ModelElement> Elements { get; } = [];
    public Dictionary<string, List<ModelType>> Types { get; } = [];
    public Dictionary<(string UniqueId, string Parameter), ParameterOptions> Options { get; } = [];

    public static FakeModelGateway Snowdon()
    {
        var gateway = new FakeModelGateway();
        gateway.Elements["wall-uid"] = new ModelElement("wall-uid", "v-wall-1", "Walls", "Basic Wall", "Exterior - Brick", false,
        [
            new ModelParameter("Fire Rating", ParamScope.Type, "String", "2 HR", false),
            new ModelParameter("Mark", ParamScope.Instance, "String", null, false),
            new ModelParameter("Area", ParamScope.Instance, "Double", "12.5 m²", true),
            new ModelParameter("Structural Usage", ParamScope.Instance, "Integer", "Bearing", false),
            new ModelParameter("Count", ParamScope.Instance, "Integer", "3", false),
        ], 14);
        gateway.Options[("wall-uid", "Structural Usage")] = new ParameterOptions("Integer", ["Bearing", "Non-bearing", "Shear"], null);
        gateway.Elements["door-uid"] = new ModelElement("door-uid", "v-door-1", "Doors", "Single-Flush", "32\" x 84\"", false,
            [new ModelParameter("Fire Rating", ParamScope.Type, "String", "", false)], 6);
        gateway.Types["door-uid"] = [new ModelType("Single-Flush", "32\" x 84\""), new ModelType("Single-Flush", "36\" x 84\"")];
        return gateway;
    }

    public void SetValue(string uniqueId, string parameter, string? value)
    {
        var e = Elements[uniqueId];
        Elements[uniqueId] = e with { Parameters = e.Parameters.Select(p => p.Name == parameter ? p with { DisplayValue = value } : p).ToList() };
    }

    public Task<ModelElement?> FindAsync(string uniqueId) =>
        Task.FromResult(Elements.TryGetValue(uniqueId, out var e) ? e : null);

    public Task<IReadOnlyList<ModelType>> ListTypesAsync(string uniqueId) =>
        Task.FromResult<IReadOnlyList<ModelType>>(Types.TryGetValue(uniqueId, out var t) ? t : []);

    public Task<ParameterOptions> GetOptionsAsync(string uniqueId, string parameter, ParamScope scope)
    {
        if (Options.TryGetValue((uniqueId, parameter), out var o)) return Task.FromResult(o);
        var p = Elements[uniqueId].Parameters.First(x => x.Name == parameter);
        return Task.FromResult(new ParameterOptions(p.Storage, null, null));
    }
}
