namespace MarkupReview.Core.Tests;

public sealed class ApiThreadDispatcherTests
{
    [Fact]
    public async Task Call_from_another_thread_while_a_job_runs_is_queued_not_run_inline()
    {
        // Revit's API is single-threaded: an MCP call on a pool thread must never run while the API thread is busy.
        var dispatcher = new ApiThreadDispatcher<string>(() => { });
        int apiThread = 0, callerThread = -1;
        var jobStarted = new ManualResetEventSlim();
        var releaseJob = new ManualResetEventSlim();

        var job = dispatcher.InvokeAsync(_ => { jobStarted.Set(); releaseJob.Wait(); return 0; });
        var api = new Thread(() => { apiThread = Environment.CurrentManagedThreadId; dispatcher.Execute("revit"); });
        api.Start();
        jobStarted.Wait();

        var fromPool = Task.Run(() => dispatcher.InvokeAsync(_ => { callerThread = Environment.CurrentManagedThreadId; return 1; }));
        await Task.Delay(200);
        Assert.Equal(-1, callerThread); // not run inline on the pool thread

        releaseJob.Set();
        api.Join();
        dispatcher.Execute("revit"); // next idle pump runs the queued call
        await fromPool;
        await job;
        Assert.NotEqual(-1, callerThread);
    }

    [Fact]
    public async Task Call_made_on_the_api_thread_inside_a_job_runs_inline()
    {
        var dispatcher = new ApiThreadDispatcher<string>(() => { });
        Task<int>? inner = null;
        var outer = dispatcher.InvokeAsync(_ => { inner = dispatcher.InvokeAsync(ctx => ctx.Length); return inner.IsCompleted ? 1 : 0; });
        dispatcher.Execute("revit");
        Assert.Equal(1, await outer);
        Assert.Equal(5, await inner!);
    }

    [Fact]
    public async Task Exception_in_a_job_faults_its_task_and_later_jobs_still_run()
    {
        var dispatcher = new ApiThreadDispatcher<string>(() => { });
        var bad = dispatcher.InvokeAsync<int>(_ => throw new InvalidOperationException("boom"));
        var good = dispatcher.InvokeAsync(_ => 7);
        dispatcher.Execute("revit");
        await Assert.ThrowsAsync<InvalidOperationException>(() => bad);
        Assert.Equal(7, await good);
    }
}
