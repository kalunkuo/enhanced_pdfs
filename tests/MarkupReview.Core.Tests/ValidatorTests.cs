using MarkupReview.Core.Tests.Fixtures;

namespace MarkupReview.Core.Tests;

public sealed class ValidatorTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly FakeModelGateway _model = FakeModelGateway.Snowdon();
    private readonly ExportTables _tables;

    public ValidatorTests() => _tables = ExportTables.Load(ReturnedPdf.Open(new FixturePdf().Save(_dir.Path)));
    public void Dispose() => _dir.Dispose();

    private static Proposal P(string key, Change change) =>
        new() { Id = "p1", MarkupId = "m1", ElementKey = key, Change = change, Reason = "test" };

    private Task<ValidationResult> Validate(string key, Change change) =>
        ProposalValidator.ValidateAsync(P(key, change), _model, _tables);

    [Fact]
    public async Task Valid_type_parameter_change_reports_old_value_and_instance_count()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Fire Rating", ParamScope.Type, "1 HR"));
        Assert.True(r.Ok, r.Error);
        Assert.Null(r.BlockReason);
        Assert.Equal("2 HR", r.OldValue);
        Assert.Equal("1 HR", r.NormalisedValue);
        Assert.Equal(14, r.AffectsCount);
    }

    [Fact]
    public async Task Unknown_parameter_rejected_with_name_list()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Fire Ratng", ParamScope.Type, "1 HR"));
        Assert.False(r.Ok);
        Assert.Contains("Fire Rating", r.Error);
    }

    [Fact]
    public async Task Readonly_parameter_rejected()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Area", ParamScope.Instance, "10"));
        Assert.False(r.Ok);
        Assert.Contains("read-only", r.Error);
    }

    [Fact]
    public async Task Integer_param_rejects_non_number()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Count", ParamScope.Instance, "three"));
        Assert.False(r.Ok);
        Assert.Contains("whole number", r.Error);
    }

    [Fact]
    public async Task Allowed_values_normalised_case_and_whitespace()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Structural Usage", ParamScope.Instance, " non-bearing "));
        Assert.True(r.Ok, r.Error);
        Assert.Equal("Non-bearing", r.NormalisedValue);
    }

    [Fact]
    public async Task Value_outside_allowed_values_lists_them()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Structural Usage", ParamScope.Instance, "Load bearing"));
        Assert.False(r.Ok);
        Assert.Contains("Shear", r.Error);
    }

    [Fact]
    public async Task Text_param_accepts_any_string()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Mark", ParamScope.Instance, "W-12 (see detail 4)"));
        Assert.True(r.Ok, r.Error);
        Assert.Equal(1, r.AffectsCount);
    }

    [Fact]
    public async Task Type_swap_to_existing_type_is_valid()
    {
        var r = await Validate(FixturePdf.DoorKey, new ChangeType("36\" x 84\""));
        Assert.True(r.Ok, r.Error);
        Assert.Equal("32\" x 84\"", r.OldValue);
        Assert.Equal("36\" x 84\"", r.NormalisedValue);
    }

    [Fact]
    public async Task Unknown_type_name_rejected()
    {
        var r = await Validate(FixturePdf.DoorKey, new ChangeType("40\" x 84\""));
        Assert.False(r.Ok);
        Assert.Contains("36\" x 84\"", r.Error);
    }

    [Fact]
    public async Task Unknown_handle_rejected()
    {
        var r = await Validate("model-key-1:999", new SetParameter("Mark", ParamScope.Instance, "x"));
        Assert.False(r.Ok);
        Assert.Contains("not in this PDF", r.Error);
    }

    [Fact]
    public async Task Missing_element_is_blocked()
    {
        _model.Elements.Remove("door-uid");
        var r = await Validate(FixturePdf.DoorKey, new ChangeType("36\" x 84\""));
        Assert.True(r.Ok);
        Assert.Equal("Element no longer in model", r.BlockReason);
    }

    [Fact]
    public async Task Changed_element_with_conflicting_value_is_blocked()
    {
        _model.Elements["wall-uid"] = _model.Elements["wall-uid"] with { VersionGuid = "v-wall-2" };
        _model.SetValue("wall-uid", "Fire Rating", "3 HR");
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Fire Rating", ParamScope.Type, "1 HR"));
        Assert.True(r.Ok);
        Assert.Contains("changed since export", r.BlockReason);
    }

    [Fact]
    public async Task Revalidate_after_value_changed_reports_new_old_value()
    {
        _model.SetValue("wall-uid", "Mark", "W-1");
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Mark", ParamScope.Instance, "W-2"));
        Assert.True(r.Ok, r.Error);
        Assert.Equal("W-1", r.OldValue);
    }

    [Fact]
    public async Task Value_already_set_is_rejected_as_already_matches()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Fire Rating", ParamScope.Type, "2 hr"));
        Assert.False(r.Ok);
        Assert.Contains("already", r.Error);
    }
}

public sealed class MatcherTests
{
    private static readonly ExportedElement Wall = new() { ElementKey = "k", UniqueId = "u", VersionGuid = "v1" };
    private static ModelElement Model(string version, bool linked = false) => new("u", version, "Walls", null, null, linked, [], 1);

    [Fact] public void Same_version_is_matched() => Assert.Equal(MatchStatus.Matched, ElementMatcher.Match(Wall, Model("v1")));
    [Fact] public void Version_guid_change_is_changed_since_export() => Assert.Equal(MatchStatus.ChangedSinceExport, ElementMatcher.Match(Wall, Model("v2")));
    [Fact] public void Absent_is_missing() => Assert.Equal(MatchStatus.Missing, ElementMatcher.Match(Wall, null));

    [Fact]
    public void Linked_element_is_linked_model()
    {
        var linked = new ExportedElement { ElementKey = "k", UniqueId = "u", VersionGuid = "v1", LinkInstanceId = 42 };
        Assert.Equal(MatchStatus.LinkedModel, ElementMatcher.Match(linked, null));
    }
}
