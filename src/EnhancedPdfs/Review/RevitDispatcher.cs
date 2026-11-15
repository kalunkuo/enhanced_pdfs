using Autodesk.Revit.UI;
using MarkupReview.Core;

namespace EnhancedPdfs.Review;

/// <summary>
/// Runs work on Revit's API thread from any thread, via an ExternalEvent. The queueing and the "inline only on the
/// API thread" rule live in <see cref="ApiThreadDispatcher{TContext}"/> (tested in Core).
/// </summary>
internal sealed class RevitDispatcher : IExternalEventHandler
{
    private ExternalEvent? _event;
    private readonly ApiThreadDispatcher<UIApplication> _core;

    public RevitDispatcher() => _core = new ApiThreadDispatcher<UIApplication>(() => _event?.Raise());

    public void Initialize() => _event ??= ExternalEvent.Create(this);

    public Task<T> InvokeAsync<T>(Func<UIApplication, T> work) => _core.InvokeAsync(work);

    public Task InvokeAsync(Action<UIApplication> work) => _core.InvokeAsync(work);

    public void Execute(UIApplication app) => _core.Execute(app);

    public string GetName() => "Enhanced PDFs markup review";
}
