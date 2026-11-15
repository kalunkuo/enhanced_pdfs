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
    public async Task Length_value_is_parsed_and_formatted_by_the_model()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Unconnected Height", ParamScope.Instance, "12.5 ft"));
        Assert.True(r.Ok, r.Error);
        Assert.Equal("12' - 6\"", r.NormalisedValue);
    }

    [Fact]
    public async Task Length_value_the_model_cannot_parse_is_rejected()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Unconnected Height", ParamScope.Instance, "1hr"));
        Assert.False(r.Ok);
        Assert.Contains("could not read", r.Error);
    }

    [Fact]
    public async Task Length_equal_to_current_once_formatted_is_already_matching()
    {
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Unconnected Height", ParamScope.Instance, "10 ft"));
        Assert.False(r.Ok);
        Assert.Contains("already", r.Error);
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
        Assert.Equal("Single-Flush: 32\" x 84\"", r.OldValue);
        Assert.Equal("Single-Flush: 36\" x 84\"", r.NormalisedValue);
    }

    private void AddDoorTypes(params ModelType[] types) => _model.Types["door-uid"].AddRange(types);

    [Fact]
    public async Task Bare_type_name_prefers_the_elements_current_family()
    {
        AddDoorTypes(new ModelType("Double-Flush", "36\" x 84\""));
        var r = await Validate(FixturePdf.DoorKey, new ChangeType("36\" x 84\""));
        Assert.True(r.Ok, r.Error);
        Assert.Equal("Single-Flush: 36\" x 84\"", r.NormalisedValue);
    }

    [Fact]
    public async Task Bare_type_name_found_only_in_several_other_families_is_rejected_as_ambiguous()
    {
        AddDoorTypes(new ModelType("Double-Flush", "40\" x 84\""), new ModelType("Bifold", "40\" x 84\""));
        var r = await Validate(FixturePdf.DoorKey, new ChangeType("40\" x 84\""));
        Assert.False(r.Ok);
        Assert.Contains("Double-Flush: 40\" x 84\"", r.Error);
        Assert.Contains("Bifold: 40\" x 84\"", r.Error);
    }

    [Fact]
    public async Task Family_qualified_name_picks_that_family_even_when_the_name_repeats()
    {
        AddDoorTypes(new ModelType("Double-Flush", "36\" x 84\""));
        var r = await Validate(FixturePdf.DoorKey, new ChangeType("Double-Flush: 36\" x 84\""));
        Assert.True(r.Ok, r.Error);
        Assert.Equal("Double-Flush: 36\" x 84\"", r.NormalisedValue);
    }

    [Fact]
    public async Task Same_type_name_in_another_family_is_a_real_change()
    {
        AddDoorTypes(new ModelType("Double-Flush", "32\" x 84\""));
        var r = await Validate(FixturePdf.DoorKey, new ChangeType("Double-Flush: 32\" x 84\""));
        Assert.True(r.Ok, r.Error);
        Assert.Equal("Single-Flush: 32\" x 84\"", r.OldValue);
    }

    [Fact]
    public async Task Type_swap_reports_only_the_sizes_that_change()
    {
        var r = await Validate(FixturePdf.DoorKey, new ChangeType("36\" x 84\""));
        Assert.True(r.Ok, r.Error);
        Assert.Equal([new SizeChange("Width", "2' - 8\"", "3' - 0\"")], r.SizeChanges);
    }

    [Fact]
    public async Task Flip_facing_on_a_flippable_door_is_valid()
    {
        var r = await Validate(FixturePdf.DoorKey, new FlipInstance(FlipSide.Facing));
        Assert.True(r.Ok, r.Error);
        Assert.Equal(("not flipped", "flipped"), (r.OldValue, r.NormalisedValue));
    }

    [Fact]
    public async Task Flipping_an_already_flipped_door_flips_it_back()
    {
        _model.Elements["door-uid"] = _model.Elements["door-uid"] with { HandFlipped = true };
        var r = await Validate(FixturePdf.DoorKey, new FlipInstance(FlipSide.Hand));
        Assert.True(r.Ok, r.Error);
        Assert.Equal(("flipped", "not flipped"), (r.OldValue, r.NormalisedValue));
    }

    [Fact]
    public async Task Flip_on_an_element_revit_cannot_flip_is_rejected()
    {
        var r = await Validate(FixturePdf.WallKey, new FlipInstance(FlipSide.Facing));
        Assert.False(r.Ok);
        Assert.Contains("cannot be flipped", r.Error);
    }

    [Fact]
    public async Task New_wall_type_reports_the_width_change_and_names_the_type()
    {
        var p = P(FixturePdf.WallKey, new NewWallType("1.75 ft", null));
        var r = await ProposalValidator.ValidateAsync(p, _model, _tables);
        Assert.True(r.Ok, r.Error);
        Assert.Equal(("1' - 2\"", "1' - 9\""), (r.OldValue, r.NormalisedValue));
        Assert.Equal([new SizeChange("Width", "1' - 2\"", "1' - 9\"")], r.SizeChanges);
        Assert.Equal(new NewWallType("1' - 9\"", "Exterior - Brick (1' - 9\")", "Basic Wall: Exterior - Brick"), r.NormalisedChange);
        Assert.Equal(1, r.AffectsCount); // a new type for this wall only: other walls of the old type are untouched
    }

    [Fact]
    public async Task New_wall_type_with_an_existing_name_points_to_change_type()
    {
        var r = await Validate(FixturePdf.WallKey, new NewWallType("1.75 ft", "Exterior - Brick"));
        Assert.False(r.Ok);
        Assert.Contains("change_type", r.Error);
    }

    [Fact]
    public async Task New_wall_type_on_a_door_is_rejected()
    {
        var r = await Validate(FixturePdf.DoorKey, new NewWallType("1.75 ft", null));
        Assert.False(r.Ok);
        Assert.Contains("basic wall", r.Error);
    }

    [Fact]
    public async Task New_wall_type_at_the_same_width_is_rejected()
    {
        var r = await Validate(FixturePdf.WallKey, new NewWallType("1.1666666667 ft", null));
        Assert.False(r.Ok);
        Assert.Contains("already", r.Error);
    }

    [Fact]
    public async Task New_wall_type_with_an_unreadable_width_is_rejected()
    {
        var r = await Validate(FixturePdf.WallKey, new NewWallType("thicker", null));
        Assert.False(r.Ok);
        Assert.Contains("could not read", r.Error);
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
    public async Task Changed_element_with_value_unset_at_export_but_set_now_is_blocked()
    {
        // The exporter only writes populated parameters, so "no exported row" means "was empty".
        _model.Elements["wall-uid"] = _model.Elements["wall-uid"] with { VersionGuid = "v-wall-2" };
        _model.SetValue("wall-uid", "Mark", "W-9");
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Mark", ParamScope.Instance, "W-1"));
        Assert.True(r.Ok);
        Assert.Contains("changed since export", r.BlockReason);
    }

    [Fact]
    public async Task Changed_element_with_value_still_unset_is_not_blocked()
    {
        _model.Elements["wall-uid"] = _model.Elements["wall-uid"] with { VersionGuid = "v-wall-2" };
        var r = await Validate(FixturePdf.WallKey, new SetParameter("Mark", ParamScope.Instance, "W-1"));
        Assert.True(r.Ok, r.Error);
        Assert.Null(r.BlockReason);
    }

    [Fact]
    public async Task Type_swap_on_element_whose_type_changed_since_export_is_blocked()
    {
        _model.Elements["door-uid"] = _model.Elements["door-uid"] with { VersionGuid = "v-door-2", Type = "34\" x 84\"" };
        _model.Types["door-uid"].Add(new ModelType("Single-Flush", "34\" x 84\""));
        var r = await Validate(FixturePdf.DoorKey, new ChangeType("36\" x 84\""));
        Assert.True(r.Ok, r.Error);
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
