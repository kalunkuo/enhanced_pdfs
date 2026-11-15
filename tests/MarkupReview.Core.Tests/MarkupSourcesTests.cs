using MarkupReview.Core.Tests.Fixtures;

namespace MarkupReview.Core.Tests;

public sealed class MarkupSourcesTests : IDisposable
{
    private readonly TempDir _dir = new();
    public void Dispose() => _dir.Dispose();

    private (IReadOnlyList<Markup> Markups, string Source, ExportTables Tables) Read(FixturePdf fixture)
    {
        var pdf = ReturnedPdf.Open(fixture.Save(_dir.Path));
        var tables = ExportTables.Load(pdf);
        var (markups, source) = MarkupSources.Read(pdf, tables);
        return (markups, source, tables);
    }

    [Fact]
    public void Exporter_tables_round_trip()
    {
        var fixture = new FixturePdf();
        var pdf = ReturnedPdf.Open(fixture.Save(_dir.Path));
        var tables = ExportTables.Load(pdf);

        Assert.Equal(FixturePdf.ModelKey, tables.ModelKey);
        Assert.Equal("Snowdon Towers Sample Architectural", tables.ModelName);
        var wall = tables.ElementsByKey[FixturePdf.WallKey];
        Assert.Equal("wall-uid", wall.UniqueId);
        Assert.Equal(676281, wall.ElementId);
        Assert.Equal("v-wall-1", wall.VersionGuid);
        Assert.Null(wall.LinkInstanceId);
        Assert.Equal("2 HR", Assert.Single(tables.ParametersByOwner["model-key-1:t1"]).DisplayValue);
        Assert.Equal("view-uid-a101", tables.Drawings.Single().ViewUniqueId);
    }

    [Fact]
    public void Reads_viewer_annotations_json_ties()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(new
            {
                id = "v1", page = 1, kind = "rect",
                from = new { x = 100.0, y = 200.0 }, to = new { x = 150.0, y = 300.0 },
                text = "should be 1 HR per code review", elementKey = FixturePdf.WallKey,
            }),
        };

        var (markups, source, _) = Read(fixture);

        Assert.Equal("viewer", source);
        var markup = Assert.Single(markups);
        Assert.Equal("v1", markup.Id);
        Assert.Equal("rect", markup.Kind);
        Assert.Equal("should be 1 HR per code review", markup.Text);
        var link = Assert.Single(markup.Links);
        Assert.Equal(FixturePdf.WallKey, link.ElementKey);
        Assert.Equal("linked", link.Relation);
        // Viewer top-left page space → PDF user space for MediaBox [-1512.12 -1080 1512.12 1080].
        Assert.Equal(-1412.12, markup.Rect.X0, 3);
        Assert.Equal(-1362.12, markup.Rect.X1, 3);
        Assert.Equal(780, markup.Rect.Y0, 3);
        Assert.Equal(880, markup.Rect.Y1, 3);
    }

    [Fact]
    public void Viewer_cloud_links_every_contained_element_with_author_and_time()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(new
            {
                id = "c1", page = 1, kind = "cloud",
                from = new { x = 0.0, y = 0.0 }, to = new { x = 50.0, y = 50.0 },
                text = "upgrade these to 1 HR",
                author = new { name = "J. Contractor" }, createdAt = "2026-11-12T10:00:00Z",
                contained = new object[] { new { key = FixturePdf.WallKey, fully = true }, new { key = FixturePdf.DoorKey, fully = false } },
            }),
        };

        var markup = Assert.Single(Read(fixture).Markups);
        Assert.Equal("cloud", markup.Kind);
        Assert.Equal("J. Contractor", markup.Author);
        Assert.Equal(DateTimeOffset.Parse("2026-11-12T10:00:00Z"), markup.Created);
        Assert.Equal([new MarkupLink(FixturePdf.WallKey, "linked"), new MarkupLink(FixturePdf.DoorKey, "overlapping")], markup.Links);
    }

    [Fact]
    public void Viewer_comment_on_a_multi_selection_links_every_element()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(new
            {
                id = "c3", page = 1, kind = "comment", from = new { x = 1.0, y = 1.0 }, to = new { x = 1.0, y = 1.0 },
                text = "both of these", elementKey = FixturePdf.WallKey, elementKeys = new[] { FixturePdf.WallKey, FixturePdf.DoorKey },
            }),
        };

        var markup = Assert.Single(Read(fixture).Markups);
        Assert.Equal([new MarkupLink(FixturePdf.WallKey, "linked"), new MarkupLink(FixturePdf.DoorKey, "linked")], markup.Links);
    }

    [Fact]
    public void Viewer_comment_replies_are_appended_to_the_text()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(new
            {
                id = "c2", page = 1, kind = "comment",
                from = new { x = 1.0, y = 1.0 }, to = new { x = 1.0, y = 1.0 },
                text = "door too narrow", elementKey = FixturePdf.DoorKey, author = new { name = "A" },
                replies = new object[] { new { id = "r1", author = new { name = "B" }, createdAt = "2026-11-13T09:00:00Z", text = "agreed, use 36in" } },
            }),
        };

        var markup = Assert.Single(Read(fixture).Markups);
        Assert.Equal("door too narrow\n— reply from B: agreed, use 36in", markup.Text);
    }

    [Fact]
    public void Untied_viewer_text_has_no_links()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(new
            {
                id = "v2", page = 1, kind = "text",
                from = new { x = 10.0, y = 10.0 }, to = new { x = 10.0, y = 10.0 },
                text = "check with structural",
            }),
        };

        var markup = Assert.Single(Read(fixture).Markups);
        Assert.Empty(markup.Links);
    }

    [Fact]
    public void Element_id_mentioned_in_text_becomes_referenced_link()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(new
            {
                id = "v3", page = 1, kind = "comment",
                from = new { x = 10.0, y = 10.0 }, to = new { x = 10.0, y = 10.0 },
                text = "wall 676281 and door 700108 both; ignore 12 and 99999999999",
                elementKey = FixturePdf.WallKey,
            }),
        };

        var markup = Assert.Single(Read(fixture).Markups);
        Assert.Equal(2, markup.Links.Count);
        Assert.Contains(markup.Links, l => l.ElementKey == FixturePdf.WallKey && l.Relation == "linked");
        Assert.Contains(markup.Links, l => l.ElementKey == FixturePdf.DoorKey && l.Relation == "referenced");
    }

    [Fact]
    public void Non_ascii_digits_in_text_are_ignored_not_fatal()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(new
            {
                id = "v6", page = 1, kind = "comment",
                from = new { x = 1.0, y = 1.0 }, to = new { x = 1.0, y = 1.0 },
                text = "١٢٣٤٥٦ ０１２３４５ and 676281",
            }),
        };

        var markup = Assert.Single(Read(fixture).Markups);
        Assert.Equal(FixturePdf.WallKey, Assert.Single(markup.Links).ElementKey);
    }

    [Fact]
    public void Tie_to_unknown_key_is_kept_with_missing_status()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(new
            {
                id = "v4", page = 1, kind = "rect",
                from = new { x = 0.0, y = 0.0 }, to = new { x = 5.0, y = 5.0 },
                text = "stale tie", elementKey = "model-key-1:999",
            }),
        };

        var (markups, _, tables) = Read(fixture);
        var link = Assert.Single(Assert.Single(markups).Links);
        Assert.Equal("model-key-1:999", link.ElementKey);
        Assert.False(tables.ElementsByKey.ContainsKey(link.ElementKey));
    }

    [Fact]
    public void Acrobat_tables_win_over_viewer_json()
    {
        var fixture = new FixturePdf
        {
            ViewerJson = FixturePdf.ViewerAnnotations(new
            {
                id = "v5", page = 1, kind = "rect",
                from = new { x = 0.0, y = 0.0 }, to = new { x = 5.0, y = 5.0 }, text = "viewer",
            }),
            AcrobatAnnotations =
            [
                new() { AnnotationId = "a1", DrawingId = FixturePdf.DrawingId, Page = 1, Kind = "Cloud", Text = "should be 1 HR", Author = "J. Contractor", CreatedUtc = "2026-11-12T10:00:00Z", SheetRect = [-1400, 700, -1300, 900] },
                new() { AnnotationId = "a2", DrawingId = FixturePdf.DrawingId, Page = 1, Kind = "Note", Text = "gone", Status = "Deleted", SheetRect = [0, 0, 1, 1] },
            ],
            AcrobatLinks = [new() { AnnotationId = "a1", ElementKey = FixturePdf.WallKey, ElementId = 676281, Relation = "linked" }],
        };

        var (markups, source, _) = Read(fixture);

        Assert.Equal("acrobat", source);
        var markup = Assert.Single(markups);
        Assert.Equal("a1", markup.Id);
        Assert.Equal("J. Contractor", markup.Author);
        Assert.Equal(new PdfRect(-1400, 700, -1300, 900), markup.Rect);
        Assert.Equal(FixturePdf.WallKey, Assert.Single(markup.Links).ElementKey);
    }

    [Fact]
    public void Tables_with_all_columns_nullable_are_read_like_required_ones()
    {
        // demo/snowdon-demo.pdf: rewritten by DuckDB, every column optional → "definition level" mismatch before.
        var fixture = new FixturePdf
        {
            AllNullable = true,
            AcrobatAnnotations = [new() { AnnotationId = "a1", DrawingId = FixturePdf.DrawingId, Page = 1, Kind = "Cloud", Text = "should be 1 HR", SheetRect = [-1400, 700, -1300, 900] }],
            AcrobatLinks = [new() { AnnotationId = "a1", ElementKey = FixturePdf.WallKey, ElementId = 676281, Relation = "linked" }],
        };

        var (markups, source, tables) = Read(fixture);

        Assert.Equal("acrobat", source);
        Assert.Equal(1, tables.Drawings.Single().Page);
        Assert.Equal(676281, tables.ElementsByKey[FixturePdf.WallKey].ElementId);
        var markup = Assert.Single(markups);
        Assert.Equal(1, markup.Page);
        Assert.Equal(new PdfRect(-1400, 700, -1300, 900), markup.Rect);
        Assert.Equal(FixturePdf.WallKey, Assert.Single(markup.Links).ElementKey);
    }

    [Fact]
    public void Falls_back_to_annots_when_no_markup_attachments()
    {
        var fixture = new FixturePdf();
        fixture.PageAnnots.Add(("door 700108 too narrow", new PdfSharp.Drawing.XRect(10, 20, 30, 40)));

        var (markups, source, _) = Read(fixture);

        Assert.Equal("annots", source);
        var markup = Assert.Single(markups);
        Assert.Equal("door 700108 too narrow", markup.Text);
        Assert.Equal("referenced", Assert.Single(markup.Links).Relation);
    }
}
