namespace MarkupReview.Core.Tests;

public sealed class RevertTests
{
    private static Proposal Approved(Change change, string? oldValue, string? newValue) => new()
    {
        Id = "proposal-1", MarkupId = "m1", ElementKey = "k1", Reason = "r", Change = change,
        OldValue = oldValue, NewValue = newValue, Status = ProposalStatus.Approved,
    };

    [Fact]
    public void Parameter_change_reverts_to_the_old_value()
    {
        var inverse = Revert.Inverse(Approved(new SetParameter("Fire Rating", ParamScope.Type, "1 HR"), "2 HR", "1 HR"));
        Assert.Equal(new SetParameter("Fire Rating", ParamScope.Type, "2 HR"), inverse!.Change);
        Assert.Equal(("1 HR", "2 HR"), (inverse.OldValue, inverse.NewValue));
    }

    [Fact]
    public void Type_swap_reverts_to_the_previous_family_qualified_type()
    {
        var inverse = Revert.Inverse(Approved(new ChangeType("Single-Flush: 36\" x 84\""), "Single-Flush: 32\" x 84\"", "Single-Flush: 36\" x 84\""));
        Assert.Equal(new ChangeType("Single-Flush: 32\" x 84\""), inverse!.Change);
    }

    [Fact]
    public void Flip_reverts_by_flipping_the_same_side_again()
    {
        var inverse = Revert.Inverse(Approved(new FlipInstance(FlipSide.Facing), "not flipped", "flipped"));
        Assert.Equal(new FlipInstance(FlipSide.Facing), inverse!.Change);
        Assert.Equal(("flipped", "not flipped"), (inverse.OldValue, inverse.NewValue));
    }

    [Fact]
    public void New_wall_type_reverts_to_the_type_it_came_from()
    {
        var inverse = Revert.Inverse(Approved(new NewWallType("1' - 9\"", "Exterior - Brick (1' - 9\")", "Basic Wall: Exterior - Brick"), "1' - 2\"", "1' - 9\""));
        Assert.Equal(new ChangeType("Basic Wall: Exterior - Brick"), inverse!.Change);
    }

    [Fact]
    public void Parameter_that_was_empty_cannot_be_reverted_to_nothing_for_numbers_but_can_for_text()
    {
        Assert.Equal(new SetParameter("Mark", ParamScope.Instance, ""), Revert.Inverse(Approved(new SetParameter("Mark", ParamScope.Instance, "W-1"), null, "W-1"))!.Change);
    }

    [Fact]
    public void New_wall_type_revert_targets_the_old_type_by_name()
    {
        var inverse = Revert.Inverse(Approved(new NewWallType("1' - 9\"", "Exterior - Brick (1' - 9\")", "Basic Wall: Exterior - Brick"), "1' - 2\"", "1' - 9\""));
        Assert.Equal("Basic Wall: Exterior - Brick", inverse!.NewValue);
    }

    private static ModelElement Wall(string fireRating = "1 HR", string type = "Exterior - Brick") =>
        new("u", "v", "Walls", "Basic Wall", type, false, [new ModelParameter("Fire Rating", ParamScope.Type, "String", fireRating, false)], 3);

    [Fact]
    public void Unchanged_since_approval_can_be_reverted()
    {
        var approved = Approved(new SetParameter("Fire Rating", ParamScope.Type, "1 HR"), "2 HR", "1 HR");
        Assert.Null(Revert.ChangedSinceApproval(approved, Wall("1 hr")));
    }

    [Fact]
    public void Edited_since_approval_refuses_to_revert()
    {
        var approved = Approved(new SetParameter("Fire Rating", ParamScope.Type, "1 HR"), "2 HR", "1 HR");
        Assert.Contains("3 HR", Revert.ChangedSinceApproval(approved, Wall("3 HR")));
    }

    [Fact]
    public void Flip_state_and_type_are_checked_too()
    {
        var flip = Approved(new FlipInstance(FlipSide.Facing), "not flipped", "flipped");
        var door = new ModelElement("u", "v", "Doors", "Single-Flush", "36\" x 84\"", false, [], 1) { FacingFlipped = true };
        Assert.Null(Revert.ChangedSinceApproval(flip, door));
        Assert.NotNull(Revert.ChangedSinceApproval(flip, door with { FacingFlipped = false }));

        var swap = Approved(new ChangeType("Single-Flush: 36\" x 84\""), "Single-Flush: 32\" x 84\"", "Single-Flush: 36\" x 84\"");
        Assert.Null(Revert.ChangedSinceApproval(swap, door));

        var wallType = Approved(new NewWallType("1' - 9\"", "Exterior - Brick (1' - 9\")", "Basic Wall: Exterior - Brick"), "1' - 2\"", "1' - 9\"");
        Assert.Null(Revert.ChangedSinceApproval(wallType, Wall(type: "Exterior - Brick (1' - 9\")")));
        Assert.NotNull(Revert.ChangedSinceApproval(wallType, Wall()));
    }

    [Fact]
    public void Only_approved_proposals_have_an_inverse()
    {
        var pending = Approved(new FlipInstance(FlipSide.Hand), "not flipped", "flipped");
        pending.Status = ProposalStatus.Pending;
        Assert.Null(Revert.Inverse(pending));
    }
}
