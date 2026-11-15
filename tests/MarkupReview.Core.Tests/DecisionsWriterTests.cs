using MarkupReview.Core.Tests.Fixtures;
using Parquet.Serialization;
using PdfSharp.Pdf;
using PdfSharp.Pdf.Advanced;
using PdfSharp.Pdf.IO;

namespace MarkupReview.Core.Tests;

public sealed class DecisionsWriterTests : IDisposable
{
    private readonly TempDir _dir = new();
    public void Dispose() => _dir.Dispose();

    private ReviewSession Session(string name = "A101-returned.pdf")
    {
        var pdf = ReturnedPdf.Open(new FixturePdf().Save(_dir.Path, name));
        var tables = ExportTables.Load(pdf);
        var session = new ReviewSession(pdf, tables, [], "viewer");
        session.Add(new Proposal
        {
            Id = "proposal-1", MarkupId = "m1", ElementKey = FixturePdf.WallKey, Reason = "markup says 1 HR",
            Change = new SetParameter("Fire Rating", ParamScope.Type, "1 HR"), OldValue = "2 HR", NewValue = "1 HR",
            Status = ProposalStatus.Approved, DecidedUtc = DateTimeOffset.Parse("2026-11-14T12:00:00Z"),
        });
        session.Add(new Proposal
        {
            Id = "proposal-2", MarkupId = "m2", ElementKey = FixturePdf.DoorKey, Reason = "use 36in",
            Change = new ChangeType("36\" x 84\""), OldValue = "32\" x 84\"", NewValue = "36\" x 84\"",
            Status = ProposalStatus.Rejected, DecisionReason = "door schedule is final",
        });
        session.AddNote("m3", "check with structural");
        return session;
    }

    private static List<DecisionRow> Decisions(string path)
    {
        var bytes = ReturnedPdf.Open(path).Attachments[DecisionsWriter.FileName];
        return [.. ParquetSerializer.DeserializeAsync<DecisionRow>(new MemoryStream(bytes)).GetAwaiter().GetResult().Data];
    }

    [Fact]
    public void Writes_reviewed_copy_with_identical_original_attachments()
    {
        var session = Session();
        string output = DecisionsWriter.Write(session.Pdf, session, "reviewer-1");

        Assert.Equal(Path.Combine(_dir.Path, "A101-returned-reviewed.pdf"), output);
        var copy = ReturnedPdf.Open(output);
        foreach (var name in new[] { "drawings.parquet", "elements.parquet", "appearances.parquet", "parameters.parquet" })
            Assert.Equal(session.Pdf.Attachments[name], copy.Attachments[name]);

        var rows = Decisions(output);
        Assert.Equal(3, rows.Count);
        var wall = rows.Single(r => r.ProposalId == "proposal-1");
        Assert.Equal(("set_parameter", "Fire Rating", "Type", "2 HR", "1 HR", "approved", "reviewer-1"),
            (wall.ChangeKind, wall.Parameter, wall.Scope, wall.OldValue, wall.NewValue, wall.Decision, wall.Reviewer));
        Assert.Equal("2026-11-14T12:00:00.0000000+00:00", wall.DecidedUtc);
        var door = rows.Single(r => r.ProposalId == "proposal-2");
        Assert.Equal(("change_type", "rejected", "door schedule is final"), (door.ChangeKind, door.Decision, door.DecisionReason));
        var note = rows.Single(r => r.ChangeKind == "note");
        Assert.Equal(("note", "check with structural", "m3"), (note.Decision, note.Reason, note.AnnotationId));
    }

    [Fact]
    public void Original_file_is_not_modified()
    {
        var session = Session();
        byte[] before = File.ReadAllBytes(session.Pdf.Path);
        DecisionsWriter.Write(session.Pdf, session, "r");
        Assert.Equal(before, File.ReadAllBytes(session.Pdf.Path));
    }

    [Fact]
    public void Replaces_existing_decisions_attachment()
    {
        var first = Session();
        string output = DecisionsWriter.Write(first.Pdf, first, "r");

        var reopened = ReturnedPdf.Open(output);
        var second = new ReviewSession(reopened, ExportTables.Load(reopened), [], "viewer");
        second.AddNote("m9", "only this");
        string again = DecisionsWriter.Write(reopened, second, "r");

        Assert.Equal(output, again); // no "-reviewed-reviewed"
        Assert.Equal("only this", Assert.Single(Decisions(again)).Reason);
        Assert.Equal(1, EmbeddedNames(again).Count(n => n == DecisionsWriter.FileName));
    }

    [Fact]
    public void Does_not_stack_reviewed_suffix()
    {
        Assert.Equal(@"C:\x\A101-reviewed.pdf", DecisionsWriter.OutputPath(@"C:\x\A101-reviewed.pdf"));
        Assert.Equal(@"C:\x\A101-reviewed.pdf", DecisionsWriter.OutputPath(@"C:\x\A101.pdf"));
    }

    [Fact]
    public void Embedded_files_name_tree_sorted()
    {
        var session = Session();
        var names = EmbeddedNames(DecisionsWriter.Write(session.Pdf, session, "r"));
        Assert.Equal(names.OrderBy(n => n, StringComparer.Ordinal), names);
        Assert.Contains(DecisionsWriter.FileName, names);
    }

    private static List<string> EmbeddedNames(string path)
    {
        using var pdf = PdfReader.Open(path, PdfDocumentOpenMode.Import);
        var tree = pdf.Internals.Catalog.Elements.GetDictionary("/Names")!.Elements.GetDictionary("/EmbeddedFiles")!;
        var array = tree.Elements.GetArray("/Names")!;
        return [.. array.Elements.Where((_, i) => i % 2 == 0).Select(e => ((PdfString)(e is PdfReference r ? r.Value : e)).Value)];
    }
}
