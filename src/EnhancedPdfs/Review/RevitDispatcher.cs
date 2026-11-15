using System.Collections.Concurrent;
using Autodesk.Revit.UI;

namespace EnhancedPdfs.Review;

/// <summary>
/// Runs work on Revit's API thread from any thread. Calls made while already inside the handler run inline,
/// so code on the API thread can use the same gateway without deadlocking.
/// </summary>
internal sealed class RevitDispatcher : IExternalEventHandler
{
    private readonly ConcurrentQueue<Action<UIApplication>> _queue = new();
    private ExternalEvent? _event;
    private UIApplication? _current;

    public void Initialize() => _event ??= ExternalEvent.Create(this);

    public Task<T> InvokeAsync<T>(Func<UIApplication, T> work)
    {
        if (_current is { } app) return Task.FromResult(work(app));
        var done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Enqueue(a =>
        {
            try { done.SetResult(work(a)); }
            catch (Exception e) { done.SetException(e); }
        });
        _event?.Raise();
        return done.Task;
    }

    public Task InvokeAsync(Action<UIApplication> work) => InvokeAsync(app => { work(app); return true; });

    public void Execute(UIApplication app)
    {
        _current = app;
        try
        {
            while (_queue.TryDequeue(out var work)) work(app);
        }
        finally { _current = null; }
    }

    public string GetName() => "Enhanced PDFs markup review";
}
