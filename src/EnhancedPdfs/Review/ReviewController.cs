using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MarkupReview.Core;
using MarkupReview.Core.Claude;
using MarkupReview.Core.Mcp;

namespace EnhancedPdfs.Review;

/// <summary>
/// One markup review at a time: reads the returned PDF, runs headless Claude Code against the review MCP server,
/// and applies only the proposals the user approves.
/// </summary>
internal sealed class ReviewController
{
    public static readonly DockablePaneId PaneId = new(new Guid("6C3A1F0E-5B1D-4C57-9E1A-2F7D8B4C9A11"));
    public static ReviewController Instance { get; } = new();

    private readonly RevitDispatcher _dispatcher = new();
    private CancellationTokenSource? _cancel;
    private Process? _claude;
    private StreamWriter? _log;

    public ReviewSession? Session { get; private set; }
    public RevitModelGateway? Gateway { get; private set; }
    public string Status { get; private set; } = "Import a marked-up PDF to start a review.";
    public bool IsRunning => _claude is { HasExited: false };
    public string? Warning { get; private set; }
    public string? WorkDir { get; private set; }

    /// <summary>When Claude was launched; the pane shows elapsed time while <see cref="IsRunning"/>.</summary>
    public DateTimeOffset? StartedAt { get; private set; }
    /// <summary>Claude's latest short progress message ("Checking the door's available types…").</summary>
    public string? LastThought { get; private set; }
    /// <summary>How many element lookups Claude has made this run.</summary>
    public int ElementsChecked { get; private set; }
    /// <summary>True until Claude's first tool call arrives (process start-up and sign-in).</summary>
    public bool IsStarting => IsRunning && _toolCalls == 0;
    private int _toolCalls;

    /// <summary>Raised on any thread when proposals, notes or status change; the pane marshals to its dispatcher.</summary>
    public event Action? Changed;

    public void Initialize()
    {
        _dispatcher.Initialize();
        // Last-resort records: a background-thread exception still ends Revit, but its stack trace reaches the log first.
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception ex && IsOurs(ex)) LogException("unhandled (process ending)", ex);
        };
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            if (!IsOurs(e.Exception)) return;
            LogException("unobserved task", e.Exception);
            e.SetObserved();
        };
    }

    /// <summary>True when our code is on the exception's stack, so Revit's and other add-ins' faults are left alone.</summary>
    public static bool IsOurs(Exception e) =>
        e.ToString().Contains("EnhancedPdfs.Review", StringComparison.Ordinal) || e.ToString().Contains("MarkupReview.", StringComparison.Ordinal);

    public void LogException(string context, Exception e)
    {
        Log($"EXCEPTION ({context}): {e}");
        // Before any import there is no review folder yet; keep a fallback so nothing is lost.
        if (_log is null)
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "EnhancedPdfs-review-errors.log"), $"{DateTime.Now:O} {context}: {e}\n"); }
            catch (IOException) { }
    }

    /// <summary>Runs on Revit's API thread (from the Import command). Returns an error message, or null when the review started.</summary>
    public string? Start(UIApplication app, string pdfPath)
    {
        if (IsRunning) return "A review is still running. Finish or cancel it first.";
        OpenLog();
        Log($"import {pdfPath}");
        try { return StartLogged(app, pdfPath); }
        catch (Exception e)
        {
            Log($"import failed: {e}");
            return $"The import failed: {e.GetBaseException().Message}\n\nDetails: {Path.Combine(WorkDir!, "review.log")}";
        }
    }

    private string? StartLogged(UIApplication app, string pdfPath)
    {
        var document = app.ActiveUIDocument?.Document;
        if (document is null || document.IsFamilyDocument) return "Open the Revit project the PDF was exported from.";

        ReturnedPdf pdf;
        ExportTables tables;
        IReadOnlyList<Markup> markups;
        string source;
        var clock = Stopwatch.StartNew();
        try
        {
            pdf = ReturnedPdf.Open(pdfPath);
            Log($"pdf opened: pages={pdf.PageCount} attachments={string.Join(",", pdf.Attachments.Keys)} ({clock.ElapsedMilliseconds} ms)");
            tables = ExportTables.Load(pdf);
            Log($"tables: model={tables.ModelName} key={tables.ModelKey} elements={tables.ElementsByKey.Count} ({clock.ElapsedMilliseconds} ms)");
            (markups, source) = MarkupSources.Read(pdf, tables);
            Log($"markups: {markups.Count} from {source} ({clock.ElapsedMilliseconds} ms)");
        }
        catch (Exception e) when (e is InvalidDataException or IOException or PdfSharp.PdfSharpException)
        {
            Log($"pdf unreadable: {e}");
            return $"This PDF could not be read: {e.Message}";
        }

        var gateway = new RevitModelGateway(_dispatcher, document);
        Log($"open model: title={document.Title} key={gateway.ModelKey}");
        if (!string.Equals(tables.ModelKey, gateway.ModelKey, StringComparison.Ordinal))
            return $"This PDF was exported from another model ('{tables.ModelName}'). Open that project and import again.";
        if (markups.Count == 0)
            return "This PDF has no markups to review.";

        string? claude = ClaudeLaunch.Find();
        Log($"claude: {claude ?? "not found"}");
        if (claude is null)
            return "Claude Code was not found. Install it (https://claude.com/claude-code) and run `claude auth login` once, then import again.";

        Warning = string.Equals(tables.ModelName, document.Title, StringComparison.OrdinalIgnoreCase)
            ? null
            : $"The PDF names the model '{tables.ModelName}', but the open project is '{document.Title}'.";
        Session = new ReviewSession(pdf, tables, markups, source);
        Gateway = gateway;
        Session.ProposalAdded += _ => Changed?.Invoke();
        Session.NoteAdded += _ => Changed?.Invoke();
        Session.Finished += summary => SetStatus($"Claude finished: {summary}");

        app.GetDockablePane(PaneId).Show();
        _claudePath = claude;
        Launch(claude, null);
        Log("claude launched");
        return null;
    }

    /// <summary>One folder per import, created first so even a failed import leaves a log. latest.txt points at it.</summary>
    private void OpenLog()
    {
        string root = Path.Combine(Path.GetTempPath(), "EnhancedPdfs-review");
        WorkDir = Path.Combine(root, DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")[..6]);
        Directory.CreateDirectory(WorkDir);
        lock (this) { _log?.Dispose(); _log = new StreamWriter(Path.Combine(WorkDir, "review.log")) { AutoFlush = true }; }
        File.WriteAllText(Path.Combine(root, "latest.txt"), WorkDir);
    }

    private void Launch(string claudePath, string? prompt)
    {

        string pipe = "enhancedpdfs-review-" + Guid.NewGuid().ToString("N");
        string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        string bridge = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!, "MarkupReview.Bridge.exe");
        _cancel = new CancellationTokenSource();
        var cancel = _cancel.Token;
        var tools = new ReviewTools(Session!, Gateway!, Revising?.Id);
        _ = PipeHost.RunAsync(pipe, token, stream => McpServer.RunAsync(stream, stream, tools, cancel), cancel, Log)
            .ContinueWith(t => Log($"pipe host ended: {t.Exception?.GetBaseException().Message ?? "ok"}"), TaskScheduler.Default);

        Log($"bridge: {bridge} exists={File.Exists(bridge)} pipe={pipe}");
        var info = ClaudeLaunch.Build(claudePath, bridge, pipe, token, WorkDir!, prompt);
        _claude = Process.Start(info) ?? throw new InvalidOperationException("Claude Code did not start.");
        _claude.StandardInput.Close();
        StartedAt = DateTimeOffset.Now;
        LastThought = null;
        ElementsChecked = 0;
        _toolCalls = 0;
        SetStatus(prompt is null ? "Starting Claude…" : $"Claude is revising {Revising?.Id}…");
        _ = Task.Run(() => PumpOutput(_claude, cancel));
        var stderr = _claude.StandardError.ReadToEndAsync();
        _stderr = stderr;
        _ = stderr.ContinueWith(t => Log("stderr: " + (t.IsCompletedSuccessfully ? t.Result : t.Exception?.GetBaseException().Message)), TaskScheduler.Default);
    }

    private async Task PumpOutput(Process process, CancellationToken cancel)
    {
        bool sawResult = false;
        try
        {
            string? line;
            while ((line = await process.StandardOutput.ReadLineAsync(cancel)) is not null)
            {
                Log(line);
                foreach (var e in StreamEvents.Parse(line))
                {
                    switch (e)
                    {
                        case ToolCall call:
                            _toolCalls++;
                            if (call.Name == "get_element") ElementsChecked++;
                            SetStatus(Describe(call.Name));
                            break;
                        case Thinking thought:
                            LastThought = thought.Text.Length > 160 ? thought.Text[..159] + "…" : thought.Text;
                            Changed?.Invoke();
                            break;
                        case MarkupReview.Core.Claude.Result result:
                            sawResult = true;
                            if (result.IsError) SetStatus(ClaudeStatus.Stopped(result, StderrTail()));
                            else if (Session?.IsFinished != true) SetStatus("Claude finished without a summary.");
                            break;
                    }
                }
            }
            await process.WaitForExitAsync(cancel);
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { Log($"pump: {e}"); }
        finally
        {
            if (!sawResult && Session?.IsFinished != true)
                SetStatus(cancel.IsCancellationRequested ? "Review cancelled. Proposals so far are kept." : ClaudeStatus.Stopped(null, StderrTail()));
            if (Revising is { } revised)
            {
                Revising = null;
                SetStatus(revised.Status == ProposalStatus.Revised
                    ? $"Claude revised {revised.Id} as {revised.RevisedBy}. Review the new card."
                    : $"Claude could not revise {revised.Id} (see its note); the original is still pending.");
            }
            _cancel?.Cancel();
            Changed?.Invoke();
        }
    }

    private Task<string>? _stderr;

    /// <summary>Claude Code's stderr once it has exited (start-up and sign-in failures land there); waits briefly.</summary>
    private string StderrTail()
    {
        try { return _stderr is { } t && t.Wait(2000) ? t.Result : ""; }
        catch (AggregateException) { return ""; }
    }

    public void Cancel()
    {
        _cancel?.Cancel();
        try { if (_claude is { HasExited: false }) _claude.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { }
    }

    /// <summary>Re-validates on Revit's thread, then applies in one named transaction.</summary>
    public async Task<string?> ApproveAsync(Proposal proposal)
    {
        var session = Session!;
        var gateway = Gateway!;
        Log($"approve {proposal.Id}: requested ({proposal.Change})");
        string? error;
        try
        {
            error = await _dispatcher.InvokeAsync(app =>
            {
                Log($"approve {proposal.Id}: on Revit thread, re-validating");
                var check = ProposalValidator.ValidateAsync(proposal, gateway, session.Tables).GetAwaiter().GetResult();
                if (!check.Ok) return check.Error;
                if (check.BlockReason is not null) return check.BlockReason;
                if (!string.Equals(check.OldValue, proposal.OldValue, StringComparison.Ordinal))
                    return $"The current value changed to '{check.OldValue}' since this was proposed. Reject it, or import again.";
                string? applied = ApplyChange.Apply(gateway.Document, session.Tables.ElementsByKey[proposal.ElementKey], proposal);
                if (applied is null) GhostPreview.Clear(app.ActiveUIDocument); // the change is real now
                return applied;
            });
        }
        catch (Exception e)
        {
            Log($"approve {proposal.Id}: failed {e}");
            error = $"Could not apply: {e.GetBaseException().Message}";
        }
        if (error is null) Decide(proposal, ProposalStatus.Approved, null);
        Log($"approve {proposal.Id}: {error ?? "applied"}");
        return error;
    }

    /// <summary>
    /// Ends the review without applying anything else: stops Claude, drops pending proposals, clears the preview
    /// selection and closes the panel. Changes already approved stay in the model (each is its own undo step).
    /// </summary>
    public async Task EndReviewAsync()
    {
        Log($"end review: {Session?.Proposals.Count(p => p.Status == ProposalStatus.Approved) ?? 0} approved kept, " +
            $"{Session?.Proposals.Count(p => p.Status == ProposalStatus.Pending) ?? 0} pending discarded");
        Cancel();
        Session = null;
        Gateway = null;
        Warning = null;
        StartedAt = null;
        LastThought = null;
        Status = "Import a marked-up PDF to start a review.";
        Changed?.Invoke();
        await _dispatcher.InvokeAsync(app =>
        {
            Preview.Clear(app);
            app.GetDockablePane(PaneId).Hide();
        });
    }

    private string? _claudePath;

    /// <summary>The proposal a follow-up run is revising ("Approve, but…"), while it runs.</summary>
    public Proposal? Revising { get; private set; }

    /// <summary>
    /// "Approve, but…": starts a short follow-up Claude run that replaces <paramref name="proposal"/> with a revised one.
    /// Returns an error message, or null when the run started. Runs on the UI thread; launches no Revit API calls itself.
    /// </summary>
    public string? Revise(Proposal proposal, string instruction)
    {
        if (Session is not { } session || _claudePath is null) return "No review is open.";
        if (IsRunning) return "Claude is still working on this review. Try again when it has finished.";
        if (proposal.Status is not (ProposalStatus.Pending or ProposalStatus.Blocked)) return "Only pending proposals can be revised.";
        if (string.IsNullOrWhiteSpace(instruction)) return "Write what Claude should change.";
        var markup = session.FindMarkup(proposal.MarkupId);
        if (markup is null) return "The proposal's markup is missing.";

        proposal.DecisionReason = $"Approve, but: {instruction.Trim()}";
        Revising = proposal;
        Log($"revise {proposal.Id}: {instruction.Trim()}");
        var related = proposal.RelatedMarkupIds.Select(session.FindMarkup).OfType<Markup>().ToList();
        try { Launch(_claudePath, ClaudeLaunch.RevisionPrompt(proposal, markup, related, instruction.Trim())); }
        catch (Exception e)
        {
            Revising = null;
            LogException("revise launch", e);
            return $"Claude could not be started: {e.Message}";
        }
        return null;
    }

    /// <summary>
    /// "Undo approval": applies the inverse change in its own transaction after checking the element still holds what
    /// was approved, then returns the proposal to pending. Null on success, otherwise why not.
    /// </summary>
    public async Task<string?> RevertAsync(Proposal proposal)
    {
        var session = Session!;
        var gateway = Gateway!;
        var inverse = Revert.Inverse(proposal);
        if (inverse is null) return "This approval cannot be undone automatically; use Ctrl+Z.";
        Log($"revert {proposal.Id}: requested ({inverse.Change})");
        string? error;
        try
        {
            error = await _dispatcher.InvokeAsync(_ =>
            {
                var exported = session.Tables.ElementsByKey[proposal.ElementKey];
                var current = gateway.FindAsync(exported.UniqueId).GetAwaiter().GetResult(); // inline: on the API thread
                if (current is null) return "Element no longer in model.";
                return Revert.ChangedSinceApproval(proposal, current)
                    ?? ApplyChange.Apply(gateway.Document, exported, inverse, revertOf: proposal);
            });
        }
        catch (Exception e)
        {
            Log($"revert {proposal.Id}: failed {e}");
            error = $"Could not undo: {e.GetBaseException().Message}";
        }
        if (error is null)
        {
            proposal.Status = ProposalStatus.Pending;
            proposal.DecidedUtc = null;
            proposal.DecisionReason = "Approval undone; decide again.";
            Changed?.Invoke();
        }
        Log($"revert {proposal.Id}: {error ?? "reverted"}");
        return error;
    }

    public void Reject(Proposal proposal, string? reason)
    {
        Decide(proposal, ProposalStatus.Rejected, string.IsNullOrWhiteSpace(reason) ? null : reason.Trim());
        Log($"reject {proposal.Id}: {reason}");
    }

    public Task<string> SaveReviewAsync() => _dispatcher.InvokeAsync(app =>
        DecisionsWriter.Write(Session!.Pdf, Session, app.Application.Username));

    /// <returns>Null when shown, otherwise why not (shown in the card).</returns>
    public Task<string?> FocusAsync(Proposal proposal) => _dispatcher.InvokeAsync(app => Preview.Show(app, Session!, proposal));
    public Task<string?> FocusMarkupAsync(Markup markup) => _dispatcher.InvokeAsync(app => Preview.ShowMarkup(app, Session!, markup));
    public Task ClearPreviewAsync() => _dispatcher.InvokeAsync(app => Preview.Clear(app));

    private void Decide(Proposal proposal, ProposalStatus status, string? reason)
    {
        proposal.Status = status;
        proposal.DecisionReason = reason;
        proposal.DecidedUtc = DateTimeOffset.UtcNow;
        Changed?.Invoke();
    }

    private void SetStatus(string status)
    {
        Status = status;
        Log($"status: {status}");
        Changed?.Invoke();
    }

    private void Log(string line)
    {
        try { lock (this) _log?.WriteLine(line); }
        catch (ObjectDisposedException) { }
    }

    private static string Describe(string tool) => tool switch
    {
        "list_markups" => "Claude is reading the markups…",
        "get_element" => "Claude is checking an element in the model…",
        "get_parameter_options" or "list_types" => "Claude is looking up valid values…",
        "propose_change" => "Claude is proposing a change…",
        "add_review_note" => "Claude is adding a note…",
        "finish_review" => "Claude is finishing the review…",
        _ => $"Claude: {tool}",
    };
}
