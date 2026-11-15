using MarkupReview.Core.Tests.Fixtures;

namespace MarkupReview.Core.Tests;

/// <summary>
/// Revit calls the add-in on its UI thread, which has a SynchronizationContext that only runs posted work when the
/// thread is free. Blocking on async code there deadlocks; these tests reproduce that thread.
/// </summary>
public sealed class UiThreadTests : IDisposable
{
    private readonly TempDir _dir = new();
    public void Dispose() => _dir.Dispose();

    /// <summary>A context that queues posts and never runs them while the thread is blocked, like a busy UI thread.</summary>
    private sealed class BlockedUiContext : SynchronizationContext
    {
        public override void Post(SendOrPostCallback d, object? state) { /* queued until the UI thread is free: never, here */ }
    }

    private static bool CompletesOnUiThread(Action work, TimeSpan timeout)
    {
        Exception? error = null;
        var thread = new Thread(() =>
        {
            SynchronizationContext.SetSynchronizationContext(new BlockedUiContext());
            try { work(); } catch (Exception e) { error = e; }
        }) { IsBackground = true };
        thread.Start();
        bool finished = thread.Join(timeout);
        if (error is not null) throw new Exception("work failed", error);
        return finished;
    }

    [Fact]
    public void Export_tables_load_on_a_ui_thread_without_deadlock()
    {
        var pdf = ReturnedPdf.Open(new FixturePdf().Save(_dir.Path));
        Assert.True(CompletesOnUiThread(() => ExportTables.Load(pdf), TimeSpan.FromSeconds(10)), "ExportTables.Load deadlocked on a UI thread");
    }

    [Fact]
    public void Decisions_write_on_a_ui_thread_without_deadlock()
    {
        var pdf = ReturnedPdf.Open(new FixturePdf().Save(_dir.Path));
        var session = new ReviewSession(pdf, ExportTables.Load(pdf), [], "viewer");
        session.AddNote("m1", "note");
        Assert.True(CompletesOnUiThread(() => DecisionsWriter.Write(pdf, session, "r"), TimeSpan.FromSeconds(10)), "DecisionsWriter.Write deadlocked on a UI thread");
    }
}
