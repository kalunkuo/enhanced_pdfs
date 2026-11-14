namespace MarkupReview.Core;

public enum ParamScope { Instance, Type }

public abstract record Change;
public sealed record SetParameter(string Name, ParamScope Scope, string Value) : Change;
public sealed record ChangeType(string TypeName) : Change;

public enum ProposalStatus { Pending, Approved, Rejected, Blocked }

public sealed record Proposal
{
    public required string Id { get; init; }
    public required string MarkupId { get; init; }
    public required string ElementKey { get; init; }
    public required Change Change { get; init; }
    public required string Reason { get; init; }
    public ProposalStatus Status { get; set; } = ProposalStatus.Pending;
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public int AffectsCount { get; set; } = 1;
    public string? BlockReason { get; set; }
    public string? DecisionReason { get; set; }
    public DateTimeOffset? DecidedUtc { get; set; }
}

public sealed record ReviewNote(string Id, string MarkupId, string Text);

/// <summary>
/// One import of one returned PDF. Thread-safe: MCP calls add from a background thread while the UI reads.
/// </summary>
public sealed class ReviewSession(ReturnedPdf pdf, ExportTables tables, IReadOnlyList<Markup> markups, string source)
{
    private readonly object _gate = new();
    private readonly List<Proposal> _proposals = [];
    private readonly List<ReviewNote> _notes = [];

    public ReturnedPdf Pdf { get; } = pdf;
    public ExportTables Tables { get; } = tables;
    public IReadOnlyList<Markup> Markups { get; } = markups;
    public string Source { get; } = source;
    public string? Summary { get; private set; }
    public bool IsFinished { get; private set; }

    public event Action<Proposal>? ProposalAdded;
    public event Action<ReviewNote>? NoteAdded;
    public event Action<string>? Finished;

    public IReadOnlyList<Proposal> Proposals { get { lock (_gate) return [.. _proposals]; } }
    public IReadOnlyList<ReviewNote> Notes { get { lock (_gate) return [.. _notes]; } }

    public Markup? FindMarkup(string id) => Markups.FirstOrDefault(m => m.Id == id);

    public Proposal Add(Proposal proposal)
    {
        lock (_gate) _proposals.Add(proposal);
        ProposalAdded?.Invoke(proposal);
        return proposal;
    }

    public ReviewNote AddNote(string markupId, string text)
    {
        ReviewNote note;
        lock (_gate) { note = new ReviewNote($"note-{_notes.Count + 1}", markupId, text); _notes.Add(note); }
        NoteAdded?.Invoke(note);
        return note;
    }

    public string NextProposalId() { lock (_gate) return $"proposal-{_proposals.Count + 1}"; }

    public void Finish(string summary)
    {
        lock (_gate) { Summary = summary; IsFinished = true; }
        Finished?.Invoke(summary);
    }
}
