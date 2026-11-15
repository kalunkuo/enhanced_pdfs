using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Autodesk.Revit.UI;
using MarkupReview.Core;
using WpfGrid = System.Windows.Controls.Grid;
using ToggleButton = System.Windows.Controls.Primitives.ToggleButton;
using TextBox = System.Windows.Controls.TextBox;

namespace EnhancedPdfs.Review;

/// <summary>Docked markup review panel: queue of proposals and notes, the contractor's markup crop, Approve / Reject.</summary>
internal sealed class ReviewPane : UserControl, IDockablePaneProvider
{
    private enum Filter { All, Pending, Notes, Done }

    private static readonly Brush Ink = Hex("#1D2733"), Muted = Hex("#6C7A89"), Line = Hex("#E3E8ED"), Accent = Hex("#E8590C"),
        SelectedBg = Hex("#FFF8F0"), Green = Hex("#2F9E44"), Red = Hex("#C92A2A"), QuoteBg = Hex("#F8F9FA");

    private readonly ReviewController _controller;
    private readonly TextBlock _title = new() { FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly TextBlock _progress = new() { Foreground = Muted, Margin = new Thickness(0, 2, 0, 0) };
    private readonly TextBlock _status = new() { Foreground = Muted, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) };
    private readonly TextBlock _warning = new() { Foreground = Red, TextWrapping = TextWrapping.Wrap, Visibility = Visibility.Collapsed };
    // Live activity while Claude works: moving bar, elapsed time, Claude's own progress line, counters.
    private readonly ProgressBar _busy = new() { IsIndeterminate = true, Height = 4, Margin = new Thickness(0, 6, 0, 0), Foreground = Accent, BorderThickness = new Thickness(0), Visibility = Visibility.Collapsed };
    private readonly TextBlock _activity = new() { Foreground = Ink, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0), Visibility = Visibility.Collapsed };
    private readonly TextBlock _thought = new() { Foreground = Muted, FontStyle = FontStyles.Italic, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0), Visibility = Visibility.Collapsed };
    private readonly System.Windows.Threading.DispatcherTimer _clock = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly Button _cancel = SmallButton("Stop Claude");
    private readonly Button _end = SmallButton("End review");
    private readonly Button _save = SmallButton("Save review");
    private readonly StackPanel _filters = new() { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 4) };
    private readonly StackPanel _cards = new();
    private readonly Dictionary<string, BitmapSource?> _crops = [];
    private Filter _filter = Filter.All;
    private string? _selected;
    private string? _rejecting;
    private bool _confirmingEnd;
    private readonly ContentControl _endHost = new();
    private string _rejectText = ""; // survives the list rebuilding when new proposals arrive mid-review
    private string? _lastError;
    private bool _refreshQueued;

    public ReviewPane(ReviewController controller)
    {
        _controller = controller;
        FontFamily = new FontFamily("Segoe UI");
        FontSize = 12;
        Foreground = Ink;
        Background = Brushes.White;

        _cancel.Click += (_, _) => _controller.Cancel();
        _save.Click += async (_, _) => await SaveAsync();
        _end.Click += (_, _) => { _confirmingEnd = true; Refresh(); };
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0), Children = { _cancel, _save, _end } };
        var header = new StackPanel { Margin = new Thickness(10, 8, 10, 4), Children = { _title, _progress, _warning, _status, _busy, _activity, _thought, buttons, _endHost, _filters } };
        _clock.Tick += (_, _) => UpdateActivity();

        var root = new DockPanel { LastChildFill = true };
        DockPanel.SetDock(header, Dock.Top);
        root.Children.Add(header);
        root.Children.Add(new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = _cards });
        Content = root;

        _controller.Changed += QueueRefresh;
        // The panel runs on Revit's UI thread: an exception from our handlers (including async void ones) would end
        // Revit. Catch only ours, log it with its stack and show it in the panel instead.
        Dispatcher.UnhandledException += (_, e) =>
        {
            if (!ReviewController.IsOurs(e.Exception)) return;
            e.Handled = true;
            _controller.LogException("panel", e.Exception);
            _status.Text = $"Something went wrong in the review panel ({e.Exception.GetBaseException().Message}). It was logged; the review is still open.";
        };
        Refresh();
    }

    public void SetupDockablePane(DockablePaneProviderData data)
    {
        data.FrameworkElement = this;
        data.InitialState = new DockablePaneState { DockPosition = DockPosition.Right, MinimumWidth = 320 };
    }

    private void QueueRefresh()
    {
        if (_refreshQueued) return;
        _refreshQueued = true;
        Dispatcher.InvokeAsync(() => { _refreshQueued = false; Refresh(); });
    }

    private void Refresh()
    {
        var session = _controller.Session;
        _title.Text = session is null ? "Markup review" : $"Markup review · {Path.GetFileName(session.Pdf.Path)}";
        _status.Text = _controller.Status;
        _warning.Text = _controller.Warning ?? "";
        _warning.Visibility = _controller.Warning is null ? Visibility.Collapsed : Visibility.Visible;
        _cancel.Visibility = _controller.IsRunning ? Visibility.Visible : Visibility.Collapsed;
        _end.Visibility = session is null || _confirmingEnd ? Visibility.Collapsed : Visibility.Visible;
        _endHost.Content = session is not null && _confirmingEnd ? EndConfirmation(session) : null;
        _save.IsEnabled = session is not null && !_controller.IsRunning;
        UpdateActivity();

        _cards.Children.Clear();
        _filters.Children.Clear();
        if (session is null) return;

        var proposals = session.Proposals;
        var notes = session.Notes;
        int done = proposals.Count(p => p.Status is ProposalStatus.Approved or ProposalStatus.Rejected);
        _progress.Text = $"{done} / {proposals.Count} decided · {notes.Count} note{(notes.Count == 1 ? "" : "s")}" +
            (session.Summary is { } s ? $"\n{s}" : "");

        AddFilter(Filter.All, $"All {proposals.Count + notes.Count}");
        AddFilter(Filter.Pending, $"Pending {proposals.Count(p => p.Status == ProposalStatus.Pending)}");
        AddFilter(Filter.Notes, $"Notes {notes.Count + proposals.Count(p => p.Status == ProposalStatus.Blocked)}");
        AddFilter(Filter.Done, $"Done {done}");

        foreach (var p in proposals.Where(Matches)) _cards.Children.Add(ProposalCard(session, p));
        if (_filter is Filter.All or Filter.Notes)
            foreach (var n in notes) _cards.Children.Add(NoteCard(session, n));
        if (_controller.IsRunning)
            _cards.Children.Add(Placeholder(proposals.Count + notes.Count == 0
                ? $"Analyzing {session.Markups.Count} markup{(session.Markups.Count == 1 ? "" : "s")}…"
                : "Looking for more changes…"));
        else if (_cards.Children.Count == 0)
            _cards.Children.Add(new TextBlock { Text = "Nothing here.", Foreground = Muted, Margin = new Thickness(10) });
    }

    /// <summary>Runs on every refresh and every second while Claude works, so the timer keeps moving between events.</summary>
    private void UpdateActivity()
    {
        bool running = _controller.IsRunning;
        var show = running ? Visibility.Visible : Visibility.Collapsed;
        _busy.Visibility = show;
        _activity.Visibility = show;
        if (running && !_clock.IsEnabled) _clock.Start();
        if (!running && _clock.IsEnabled) _clock.Stop();

        string? thought = running ? _controller.LastThought : null;
        _thought.Text = thought is null ? "" : $"“{thought}”";
        _thought.Visibility = thought is null ? Visibility.Collapsed : Visibility.Visible;
        if (!running) return;

        var elapsed = _controller.StartedAt is { } t ? DateTimeOffset.Now - t : TimeSpan.Zero;
        string time = $"{(int)elapsed.TotalMinutes}:{elapsed.Seconds:00}";
        var session = _controller.Session;
        _activity.Text = _controller.IsStarting
            ? $"{time} · starting Claude Code and signing in (usually 5–15 s)…"
            : $"{time} · {_controller.ElementsChecked} element{(_controller.ElementsChecked == 1 ? "" : "s")} checked · " +
              $"{session?.Proposals.Count ?? 0} proposal{(session?.Proposals.Count == 1 ? "" : "s")} · {session?.Notes.Count ?? 0} note{(session?.Notes.Count == 1 ? "" : "s")}";
    }

    /// <summary>A pulsing skeleton card where the next proposal will appear.</summary>
    private static UIElement Placeholder(string text)
    {
        static Border Bar(double width) => new() { Height = 8, Width = width, CornerRadius = new CornerRadius(4), Background = Hex("#E9ECEF"), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 6, 0, 0) };
        var body = new StackPanel { Children = { new TextBlock { Text = text, Foreground = Muted }, Bar(180), Bar(240), Bar(140) } };
        var card = new Border { Child = body, Padding = new Thickness(10, 10, 10, 12), BorderBrush = Line, BorderThickness = new Thickness(0, 0, 0, 1) };
        var pulse = new System.Windows.Media.Animation.DoubleAnimation(1.0, 0.35, TimeSpan.FromSeconds(0.9)) { AutoReverse = true, RepeatBehavior = System.Windows.Media.Animation.RepeatBehavior.Forever };
        card.BeginAnimation(OpacityProperty, pulse);
        return card;
    }

    private bool Matches(Proposal p) => _filter switch
    {
        Filter.Pending => p.Status == ProposalStatus.Pending,
        Filter.Notes => p.Status == ProposalStatus.Blocked,
        Filter.Done => p.Status is ProposalStatus.Approved or ProposalStatus.Rejected,
        _ => true,
    };

    private void AddFilter(Filter filter, string label)
    {
        var chip = new ToggleButton
        {
            Content = label, IsChecked = _filter == filter, Margin = new Thickness(0, 0, 4, 0), Padding = new Thickness(8, 2, 8, 2),
            Background = _filter == filter ? Ink : Hex("#F1F3F5"), Foreground = _filter == filter ? Brushes.White : Ink, BorderThickness = new Thickness(0),
        };
        chip.Click += (_, _) => { _filter = filter; Refresh(); };
        _filters.Children.Add(chip);
    }

    private UIElement ProposalCard(ReviewSession session, Proposal p)
    {
        bool selected = _selected == p.Id;
        var markup = session.FindMarkup(p.MarkupId);
        session.Tables.ElementsByKey.TryGetValue(p.ElementKey, out var element);
        string what = p.Change is SetParameter s ? s.Name : "Type";
        var body = new StackPanel();
        body.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Children = { Pill(p.Status), new TextBlock { Text = $"{element?.Category ?? "Element"} {element?.ElementId} · {what}", FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center } },
        });
        if (!selected)
        {
            body.Children.Add(new TextBlock { Text = $"{p.OldValue} → {p.NewValue}", Foreground = Muted, TextTrimming = TextTrimming.CharacterEllipsis });
            // Collapsed cards still say what gets bigger or smaller.
            if (p.SizeChanges.Count > 0)
                body.Children.Add(new TextBlock { Text = string.Join(" · ", p.SizeChanges.Select(s => $"{s.Name} {s.OldValue ?? "—"} → {s.NewValue ?? "—"}")), Foreground = Accent, TextTrimming = TextTrimming.CharacterEllipsis });
        }
        else
        {
            if (markup is not null) body.Children.Add(CropView(session, markup));
            if (markup is not null)
                body.Children.Add(new TextBlock { Text = Byline(markup), Foreground = Muted, Margin = new Thickness(0, 2, 0, 4) });
            if (!string.IsNullOrWhiteSpace(markup?.Text))
                body.Children.Add(Quote(markup!.Text!));
            body.Children.Add(Diff(what, p.OldValue, p.NewValue));
            foreach (var size in p.SizeChanges)
                body.Children.Add(Diff(size.Name, size.OldValue, size.NewValue));
            if (p.AffectsCount > 1)
                body.Children.Add(new TextBlock { Text = $"Type parameter: affects {p.AffectsCount} {element?.Category?.ToLowerInvariant() ?? "elements"}.", Foreground = Accent, Margin = new Thickness(0, 4, 0, 0), TextWrapping = TextWrapping.Wrap });
            body.Children.Add(new Border { Background = QuoteBg, CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 4, 6, 4), Margin = new Thickness(0, 6, 0, 0),
                Child = new TextBlock { Text = $"Claude: {p.Reason}", TextWrapping = TextWrapping.Wrap } });
            if (p.BlockReason is not null)
                body.Children.Add(new TextBlock { Text = $"Blocked: {p.BlockReason}", Foreground = Red, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });
            if (p.DecisionReason is not null && p.Status == ProposalStatus.Rejected)
                body.Children.Add(new TextBlock { Text = $"Rejected: {p.DecisionReason}", Foreground = Muted, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });
            if (_lastError is not null)
                body.Children.Add(new TextBlock { Text = _lastError, Foreground = Red, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });
            if (p.Status == ProposalStatus.Pending) body.Children.Add(Decisions(p));
        }
        return Card(body, selected, () => Select(p));
    }

    private UIElement NoteCard(ReviewSession session, ReviewNote note)
    {
        bool selected = _selected == note.Id;
        var markup = session.FindMarkup(note.MarkupId);
        var body = new StackPanel();
        body.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Children = { Pill(null), new TextBlock { Text = Shorten(markup?.Text ?? note.MarkupId, 48), FontWeight = FontWeights.SemiBold } } });
        if (selected && markup is not null)
        {
            body.Children.Add(CropView(session, markup));
            body.Children.Add(new TextBlock { Text = Byline(markup), Foreground = Muted, Margin = new Thickness(0, 2, 0, 4) });
        }
        body.Children.Add(new TextBlock { Text = note.Text, TextWrapping = TextWrapping.Wrap, Foreground = selected ? Ink : Muted });
        return Card(body, selected, () => { _selected = note.Id; _lastError = null; Refresh(); });
    }

    private UIElement Decisions(Proposal p)
    {
        if (_rejecting == p.Id)
        {
            var reason = new TextBox { Margin = new Thickness(0, 6, 0, 4), MinHeight = 22, Text = _rejectText };
            reason.TextChanged += (_, _) => _rejectText = reason.Text;
            reason.Loaded += (_, _) => { reason.Focus(); reason.CaretIndex = reason.Text.Length; };
            var confirm = SmallButton("Reject");
            confirm.Foreground = Red;
            confirm.Click += (_, _) => { _rejecting = null; _rejectText = ""; _controller.Reject(p, reason.Text); };
            var back = SmallButton("Back");
            back.Click += (_, _) => { _rejecting = null; Refresh(); };
            return new StackPanel { Children = { new TextBlock { Text = "Reason (optional):", Margin = new Thickness(0, 8, 0, 0) }, reason, new StackPanel { Orientation = Orientation.Horizontal, Children = { confirm, back } } } };
        }
        var approve = new Button { Content = "Approve", Background = Green, Foreground = Brushes.White, FontWeight = FontWeights.SemiBold, Padding = new Thickness(0, 5, 0, 5), BorderThickness = new Thickness(0) };
        var reject = new Button { Content = "Reject…", Background = Brushes.White, Foreground = Red, FontWeight = FontWeights.SemiBold, Padding = new Thickness(0, 5, 0, 5), BorderBrush = Hex("#E0A3A3") };
        approve.Click += async (_, _) =>
        {
            approve.IsEnabled = false;
            _lastError = await _controller.ApproveAsync(p);
            Refresh();
        };
        reject.Click += (_, _) => { _rejecting = p.Id; _rejectText = ""; Refresh(); };
        var grid = new WpfGrid { Margin = new Thickness(0, 8, 0, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(6) });
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        WpfGrid.SetColumn(reject, 2);
        grid.Children.Add(approve);
        grid.Children.Add(reject);
        return grid;
    }

    private async void Select(Proposal p)
    {
        _selected = p.Id;
        _lastError = null;
        _rejecting = null;
        Refresh();
        try { await _controller.FocusAsync(p); }
        catch (Exception e) { _lastError = $"Could not show the element: {e.Message}"; Refresh(); }
    }

    private UIElement CropView(ReviewSession session, Markup markup)
    {
        var image = new Image { Stretch = Stretch.Uniform, MaxHeight = 170 };
        var frame = new Border { BorderBrush = Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4), Margin = new Thickness(0, 6, 0, 0), MinHeight = 60, Child = image, Cursor = System.Windows.Input.Cursors.Hand, ToolTip = "Click to enlarge" };
        if (_crops.TryGetValue(markup.Id, out var cached)) image.Source = cached;
        else _ = LoadCrop(session, markup);
        frame.MouseLeftButtonUp += async (_, _) => await Enlarge(session, markup);
        return frame;
    }

    private async Task LoadCrop(ReviewSession session, Markup markup)
    {
        _crops[markup.Id] = null;
        try { _crops[markup.Id] = await MarkupCrop.RenderAsync(session.Pdf, markup, 600); }
        catch (Exception) { /* leave the frame empty; the rest of the card still works */ }
        Refresh();
    }

    private static async Task Enlarge(ReviewSession session, Markup markup)
    {
        BitmapSource? big;
        try { big = await MarkupCrop.RenderAsync(session.Pdf, markup, 1600); }
        catch (Exception) { return; }
        new Window
        {
            Title = $"Markup · {markup.Kind} · {markup.Author ?? "unknown author"}", Width = 900, Height = 650,
            Content = new Image { Source = big, Stretch = Stretch.Uniform }, WindowStartupLocation = WindowStartupLocation.CenterScreen,
        }.Show();
    }

    private async Task SaveAsync()
    {
        try
        {
            string path = await _controller.SaveReviewAsync();
            _status.Text = $"Saved decisions to {path}";
        }
        catch (Exception e) { _status.Text = $"Could not save the review: {e.Message}"; }
    }

    /// <summary>
    /// In-panel confirmation. (A WPF MessageBox needs an owner window; a Revit dockable pane has none, and
    /// Window.GetWindow(this) returned null — that threw, and before the safety net it ended Revit.)
    /// </summary>
    private UIElement EndConfirmation(ReviewSession session)
    {
        int approved = session.Proposals.Count(p => p.Status == ProposalStatus.Approved);
        int pending = session.Proposals.Count(p => p.Status == ProposalStatus.Pending);
        string message = (approved > 0
            ? $"{approved} approved change{(approved == 1 ? " stays" : "s stay")} in the model (Ctrl+Z reverts {(approved == 1 ? "it" : "them")})."
            : "Nothing has been applied to the model.")
            + (pending > 0 ? $" {pending} pending proposal{(pending == 1 ? " is" : "s are")} discarded." : "")
            + (_controller.IsRunning ? " Claude will be stopped." : "");
        var confirm = new Button { Content = "End review", Background = Red, Foreground = Brushes.White, FontWeight = FontWeights.SemiBold, Padding = new Thickness(10, 3, 10, 3), BorderThickness = new Thickness(0), Margin = new Thickness(0, 0, 6, 0) };
        var keep = SmallButton("Keep reviewing");
        confirm.Click += async (_, _) => await EndReviewAsync();
        keep.Click += (_, _) => { _confirmingEnd = false; Refresh(); };
        return new Border
        {
            Background = Hex("#FFF5F5"), BorderBrush = Hex("#E0A3A3"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8), Margin = new Thickness(0, 8, 0, 0),
            Child = new StackPanel
            {
                Children =
                {
                    new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 6) },
                    new StackPanel { Orientation = Orientation.Horizontal, Children = { confirm, keep } },
                },
            },
        };
    }

    private async Task EndReviewAsync()
    {
        if (_controller.Session is null) return;
        _confirmingEnd = false;
        _selected = null;
        _rejecting = null;
        _lastError = null;
        _crops.Clear();
        try { await _controller.EndReviewAsync(); }
        catch (Exception e) { _status.Text = $"Could not close the review: {e.Message}"; }
    }

    private static Border Card(UIElement body, bool selected, Action onClick)
    {
        var card = new Border
        {
            Child = body, Padding = new Thickness(selected ? 7 : 10, 8, 10, 8), BorderBrush = selected ? Accent : Line,
            BorderThickness = selected ? new Thickness(3, 0, 0, 1) : new Thickness(0, 0, 0, 1), Background = selected ? SelectedBg : Brushes.White,
            Cursor = selected ? null : System.Windows.Input.Cursors.Hand,
        };
        if (!selected) card.MouseLeftButtonUp += (_, _) => onClick();
        return card;
    }

    private static Border Pill(ProposalStatus? status)
    {
        var (text, bg, fg) = status switch
        {
            ProposalStatus.Approved => ("approved", "#D3F9D8", "#2B8A3E"),
            ProposalStatus.Rejected => ("rejected", "#FFE3E3", "#C92A2A"),
            ProposalStatus.Blocked => ("blocked", "#E9ECEF", "#495057"),
            ProposalStatus.Pending => ("pending", "#FFF3BF", "#8A6D00"),
            _ => ("note", "#E7F5FF", "#1864AB"),
        };
        return new Border
        {
            Background = Hex(bg), CornerRadius = new CornerRadius(8), Padding = new Thickness(6, 0, 6, 1), Margin = new Thickness(0, 0, 6, 0),
            VerticalAlignment = VerticalAlignment.Center, Child = new TextBlock { Text = text, FontSize = 10, Foreground = Hex(fg) },
        };
    }

    private static UIElement Quote(string text) => new Border
    {
        Background = Hex("#FFF0F6"), BorderBrush = Hex("#D6336C"), BorderThickness = new Thickness(3, 0, 0, 0), Padding = new Thickness(6, 4, 6, 4),
        Child = new TextBlock { Text = $"“{text}”", FontStyle = FontStyles.Italic, TextWrapping = TextWrapping.Wrap },
    };

    private static UIElement Diff(string what, string? oldValue, string? newValue)
    {
        var grid = new WpfGrid { Margin = new Thickness(0, 6, 0, 0) };
        foreach (var w in new[] { GridLength.Auto, new GridLength(1, GridUnitType.Star), new GridLength(1, GridUnitType.Star) })
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = w });
        var cells = new[]
        {
            new TextBlock { Text = what, Margin = new Thickness(0, 0, 10, 0), Foreground = Muted },
            new TextBlock { Text = string.IsNullOrEmpty(oldValue) ? "(empty)" : oldValue, Foreground = Red, TextDecorations = TextDecorations.Strikethrough, TextWrapping = TextWrapping.Wrap },
            new TextBlock { Text = newValue ?? "", Foreground = Green, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(6, 0, 0, 0) },
        };
        for (int i = 0; i < cells.Length; i++) { WpfGrid.SetColumn(cells[i], i); grid.Children.Add(cells[i]); }
        return grid;
    }

    private static string Byline(Markup m) =>
        string.Join(" · ", new[] { m.Author, m.Kind, m.Created?.LocalDateTime.ToString("yyyy-MM-dd") }.Where(s => !string.IsNullOrEmpty(s)));

    private static string Shorten(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";

    private static Button SmallButton(string text) =>
        new() { Content = text, Margin = new Thickness(0, 0, 6, 0), Padding = new Thickness(8, 2, 8, 2) };

    private static SolidColorBrush Hex(string hex)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        brush.Freeze();
        return brush;
    }
}
