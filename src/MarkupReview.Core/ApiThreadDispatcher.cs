using System.Collections.Concurrent;

namespace MarkupReview.Core;

/// <summary>
/// Runs work on a single-threaded API's thread (Revit's) from any thread. The host calls <see cref="Execute"/> on that
/// thread when signalled via <c>raise</c>. A call made on the API thread while a job is running there runs inline
/// (so API-thread code can reuse the same gateway without deadlocking); a call from any other thread is always
/// queued — never run inline just because some job happens to be executing.
/// </summary>
public sealed class ApiThreadDispatcher<TContext>(Action raise)
{
    private readonly ConcurrentQueue<Action<TContext>> _queue = new();
    private TContext? _current;
    private int _apiThreadId;

    public Task<T> InvokeAsync<T>(Func<TContext, T> work)
    {
        if (_current is { } context && Environment.CurrentManagedThreadId == Volatile.Read(ref _apiThreadId))
        {
            try { return Task.FromResult(work(context)); }
            catch (Exception e) { return Task.FromException<T>(e); }
        }
        var done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Enqueue(c =>
        {
            try { done.SetResult(work(c)); }
            catch (Exception e) { done.SetException(e); }
        });
        raise();
        return done.Task;
    }

    public Task InvokeAsync(Action<TContext> work) => InvokeAsync(c => { work(c); return true; });

    /// <summary>Call on the API thread: drains the queue with that thread marked as the API thread.</summary>
    public void Execute(TContext context)
    {
        Volatile.Write(ref _apiThreadId, Environment.CurrentManagedThreadId);
        _current = context;
        try
        {
            while (_queue.TryDequeue(out var work)) work(context);
        }
        finally
        {
            _current = default;
            Volatile.Write(ref _apiThreadId, 0);
        }
    }
}
