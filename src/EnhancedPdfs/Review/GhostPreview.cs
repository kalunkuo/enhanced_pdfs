using Autodesk.Revit.DB;
using Autodesk.Revit.DB.DirectContext3D;
using Autodesk.Revit.DB.ExternalService;
using Autodesk.Revit.UI;
using MarkupReview.Core;

namespace EnhancedPdfs.Review;

/// <summary>
/// Outline "ghost" of a proposal on the model: the element's current edges in orange and its edges after the change in
/// green. The "after" edges come from a what-if transaction that is always rolled back, so nothing reaches the model
/// or the undo list; they are drawn as temporary DirectContext3D graphics.
/// </summary>
internal sealed class GhostPreview : IDirectContext3DServer
{
    public static GhostPreview Instance { get; } = new();

    private const int MaxSegments = 30_000; // index buffers are 16-bit; plenty for one door or wall
    private static readonly ColorWithTransparency Before = new(232, 89, 12, 0);
    private static readonly ColorWithTransparency After = new(47, 158, 68, 0);

    private readonly object _gate = new();
    private Document? _document;
    private List<(XYZ A, XYZ B, ColorWithTransparency Color)> _segments = [];
    private Outline? _bounds;
    private bool _dirty;
    private VertexBuffer? _vertices;
    private IndexBuffer? _indices;
    private int _lineCount;

    /// <summary>Registers with Revit's DirectContext3D service (once, at startup).</summary>
    public static void Register()
    {
        if (ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DirectContext3DService) is not MultiServerService service) return;
        service.AddServer(Instance);
        var active = service.GetActiveServerIds();
        active.Add(Instance.GetServerId());
        service.SetActiveServers(active);
    }

    /// <summary>On Revit's API thread, after the view is set: computes and shows the ghost. Returns why not, or null.</summary>
    public static string? Show(UIDocument uidoc, Element element, Proposal proposal)
    {
        Clear(uidoc);
        // Text values (Fire Rating, Mark…) don't change any shape: the card's old → new says it all.
        if (proposal.Change is SetParameter set &&
            RevitModelGateway.FindParameter(uidoc.Document, element, set.Name, set.Scope)?.StorageType == StorageType.String)
            return null;

        var view = uidoc.ActiveView;
        var before = Edges(element, view);
        List<(XYZ, XYZ)> after;
        using (var whatIf = new Transaction(uidoc.Document, "Markup preview (rolled back)"))
        {
            var options = whatIf.GetFailureHandlingOptions();
            options.SetFailuresPreprocessor(new SwallowWarnings());
            options.SetClearAfterRollback(true);
            whatIf.SetFailureHandlingOptions(options);
            whatIf.Start();
            try
            {
                string? error = ApplyChange.ApplyIn(uidoc.Document, element, proposal);
                if (error is not null) return null; // Approve will report it; the preview just stays plain
                uidoc.Document.Regenerate();
                after = Edges(element, view);
            }
            finally
            {
                if (whatIf.HasStarted() && !whatIf.HasEnded()) whatIf.RollBack();
            }
        }
        if (SameShape(before, after)) return null;

        lock (Instance._gate)
        {
            Instance._document = uidoc.Document;
            Instance._segments = [.. before.Select(s => (s.Item1, s.Item2, Before)), .. after.Select(s => (s.Item1, s.Item2, After))];
            Instance._bounds = BoundsOf(Instance._segments);
            Instance._dirty = true;
        }
        uidoc.RefreshActiveView();
        return null;
    }

    public static void Clear(UIDocument? uidoc)
    {
        lock (Instance._gate)
        {
            if (Instance._segments.Count == 0) return;
            Instance._segments = [];
            Instance._bounds = null;
            Instance._dirty = true;
        }
        uidoc?.RefreshActiveView();
    }

    // ---- geometry -------------------------------------------------------------------------------------------------

    /// <summary>Visible edges in the given view (plan symbols such as door swings included), in model coordinates.</summary>
    private static List<(XYZ, XYZ)> Edges(Element element, View view)
    {
        var segments = new List<(XYZ, XYZ)>();
        var geometry = element.get_Geometry(new Options { View = view, ComputeReferences = false });
        if (geometry is not null) Collect(geometry, segments);
        return segments;
    }

    private static void Collect(GeometryElement geometry, List<(XYZ, XYZ)> into)
    {
        foreach (var item in geometry)
        {
            if (into.Count >= MaxSegments) return;
            switch (item)
            {
                case Solid solid when solid.Edges.Size > 0:
                    foreach (Edge edge in solid.Edges) AddPolyline(edge.Tessellate(), into);
                    break;
                case Curve curve:
                    AddPolyline(curve.Tessellate(), into);
                    break;
                case PolyLine poly:
                    AddPolyline(poly.GetCoordinates(), into);
                    break;
                case GeometryInstance instance:
                    Collect(instance.GetInstanceGeometry(), into);
                    break;
            }
        }
    }

    private static void AddPolyline(IList<XYZ> points, List<(XYZ, XYZ)> into)
    {
        for (int i = 0; i + 1 < points.Count && into.Count < MaxSegments; i++)
            into.Add((points[i], points[i + 1]));
    }

    private static bool SameShape(List<(XYZ, XYZ)> a, List<(XYZ, XYZ)> b) =>
        a.Count == b.Count && a.Zip(b).All(p => p.First.Item1.IsAlmostEqualTo(p.Second.Item1) && p.First.Item2.IsAlmostEqualTo(p.Second.Item2));

    private static Outline? BoundsOf(List<(XYZ A, XYZ B, ColorWithTransparency Color)> segments)
    {
        if (segments.Count == 0) return null;
        var points = segments.SelectMany(s => new[] { s.A, s.B }).ToList();
        var min = new XYZ(points.Min(p => p.X), points.Min(p => p.Y), points.Min(p => p.Z));
        var max = new XYZ(points.Max(p => p.X), points.Max(p => p.Y), points.Max(p => p.Z));
        return new Outline(min - new XYZ(1, 1, 1), max + new XYZ(1, 1, 1));
    }

    private sealed class SwallowWarnings : IFailuresPreprocessor
    {
        public FailureProcessingResult PreprocessFailures(FailuresAccessor failures)
        {
            foreach (var message in failures.GetFailureMessages())
                if (message.GetSeverity() == FailureSeverity.Warning) failures.DeleteWarning(message);
            return FailureProcessingResult.Continue;
        }
    }

    // ---- IDirectContext3DServer -----------------------------------------------------------------------------------

    private static readonly Guid ServerId = new("B7E3A0C2-4D61-4F2B-9C3E-8A1D5F6E7B90");
    public Guid GetServerId() => ServerId;
    public ExternalServiceId GetServiceId() => ExternalServices.BuiltInExternalServices.DirectContext3DService;
    public string GetName() => "Enhanced PDFs markup preview";
    public string GetVendorId() => "EPDF";
    public string GetDescription() => "Outlines of a proposed change: current (orange) and proposed (green).";
    public string GetApplicationId() => "";
    public string GetSourceId() => "";
    public bool UsesHandles() => false;
    public bool UseInTransparentPass(View view) => false;

    public bool CanExecute(View view)
    {
        lock (_gate) return _segments.Count > 0 && _document is not null && view.Document.Equals(_document);
    }

    public Outline GetBoundingBox(View view)
    {
        lock (_gate) return _bounds ?? new Outline(XYZ.Zero, XYZ.Zero);
    }

    public void RenderScene(View view, DisplayStyle displayStyle)
    {
        try
        {
            lock (_gate)
            {
                if (_dirty) Rebuild();
                if (_vertices is null || _indices is null || _lineCount == 0) return;
                var format = new VertexFormat(VertexFormatBits.PositionColored);
                var effect = new EffectInstance(VertexFormatBits.PositionColored);
                DrawContext.FlushBuffer(_vertices, _lineCount * 2, _indices, _lineCount * 2, format, effect, PrimitiveType.LineList, 0, _lineCount);
            }
        }
        catch (Exception e)
        {
            // Never let a drawing problem reach Revit's render loop; the panel still works without the ghost.
            ReviewController.Instance.LogException("ghost render", e);
            lock (_gate) { _segments = []; _lineCount = 0; }
        }
    }

    /// <summary>Must run inside RenderScene (needs Revit's graphics context).</summary>
    private void Rebuild()
    {
        _dirty = false;
        _vertices?.Dispose();
        _indices?.Dispose();
        _vertices = null;
        _indices = null;
        _lineCount = _segments.Count;
        if (_lineCount == 0) return;

        int vertexFloats = VertexPositionColored.GetSizeInFloats() * _lineCount * 2;
        _vertices = new VertexBuffer(vertexFloats);
        _vertices.Map(vertexFloats);
        var vertexStream = _vertices.GetVertexStreamPositionColored();
        foreach (var (a, b, color) in _segments)
        {
            vertexStream.AddVertex(new VertexPositionColored(a, color));
            vertexStream.AddVertex(new VertexPositionColored(b, color));
        }
        _vertices.Unmap();

        int indexShorts = IndexLine.GetSizeInShortInts() * _lineCount;
        _indices = new IndexBuffer(indexShorts);
        _indices.Map(indexShorts);
        var indexStream = _indices.GetIndexStreamLine();
        for (int i = 0; i < _lineCount; i++) indexStream.AddLine(new IndexLine(i * 2, i * 2 + 1));
        _indices.Unmap();
    }
}
