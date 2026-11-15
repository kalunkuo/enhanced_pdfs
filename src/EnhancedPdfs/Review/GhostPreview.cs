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
                // Ribbons are sized and oriented for the view: rebuild when the view or its scale changes.
                var key = (view.Id, view.Scale, view.ViewDirection);
                if (_dirty || !key.Equals(_builtFor)) Rebuild(view);
                if (_vertices is null || _indices is null || _ribbonCount == 0) return;
                var format = new VertexFormat(VertexFormatBits.PositionColored);
                var effect = new EffectInstance(VertexFormatBits.PositionColored);
                DrawContext.FlushBuffer(_vertices, _ribbonCount * 4, _indices, _ribbonCount * 12, format, effect, PrimitiveType.TriangleList, 0, _ribbonCount * 4);
            }
        }
        catch (Exception e)
        {
            // Never let a drawing problem reach Revit's render loop; the panel still works without the ghost.
            ReviewController.Instance.LogException("ghost render", e);
            lock (_gate) { _segments = []; _ribbonCount = 0; }
        }
    }

    // DirectContext3D lines are always 1 px, so edges are drawn as flat ribbons (two triangles) with a paper width.
    private const double AfterPaperMm = 0.6, BeforePaperMm = 0.3;
    private const int MaxRibbons = 16_000; // 4 vertices each must stay under the 16-bit index limit
    private (ElementId, int, XYZ)? _builtFor;
    private int _ribbonCount;

    /// <summary>Must run inside RenderScene (needs Revit's graphics context).</summary>
    private void Rebuild(View view)
    {
        _dirty = false;
        _builtFor = (view.Id, view.Scale, view.ViewDirection);
        _vertices?.Dispose();
        _indices?.Dispose();
        _vertices = null;
        _indices = null;

        var toViewer = view.ViewDirection.Normalize();
        double feetPerPaperMm = Math.Max(view.Scale, 1) / 304.8;
        var lift = toViewer.Multiply(2 * feetPerPaperMm); // in front of the model's own lines, not hidden under them
        var ribbons = new List<(XYZ, XYZ, XYZ, XYZ, ColorWithTransparency)>();
        foreach (var (a, b, color) in _segments)
        {
            if (ribbons.Count >= MaxRibbons) break;
            var along = b - a;
            if (along.GetLength() < 1e-9) continue;
            var side = along.CrossProduct(toViewer);
            if (side.GetLength() < 1e-9) continue; // edge points straight at the viewer: nothing to see
            double halfWidth = (color.GetGreen() > color.GetRed() ? AfterPaperMm : BeforePaperMm) * feetPerPaperMm / 2;
            var offset = side.Normalize().Multiply(halfWidth);
            ribbons.Add((a + offset + lift, a - offset + lift, b + offset + lift, b - offset + lift, color));
        }
        _ribbonCount = ribbons.Count;
        if (_ribbonCount == 0) return;

        int vertexFloats = VertexPositionColored.GetSizeInFloats() * _ribbonCount * 4;
        _vertices = new VertexBuffer(vertexFloats);
        _vertices.Map(vertexFloats);
        var vertexStream = _vertices.GetVertexStreamPositionColored();
        foreach (var (p0, p1, p2, p3, color) in ribbons)
        {
            vertexStream.AddVertex(new VertexPositionColored(p0, color));
            vertexStream.AddVertex(new VertexPositionColored(p1, color));
            vertexStream.AddVertex(new VertexPositionColored(p2, color));
            vertexStream.AddVertex(new VertexPositionColored(p3, color));
        }
        _vertices.Unmap();

        // Both windings: whichever way an edge runs, its ribbon faces the viewer (no back-face culling surprises).
        int indexShorts = IndexTriangle.GetSizeInShortInts() * _ribbonCount * 4;
        _indices = new IndexBuffer(indexShorts);
        _indices.Map(indexShorts);
        var indexStream = _indices.GetIndexStreamTriangle();
        for (int i = 0; i < _ribbonCount; i++)
        {
            int v = i * 4;
            indexStream.AddTriangle(new IndexTriangle(v, v + 1, v + 2));
            indexStream.AddTriangle(new IndexTriangle(v + 1, v + 3, v + 2));
            indexStream.AddTriangle(new IndexTriangle(v, v + 2, v + 1));
            indexStream.AddTriangle(new IndexTriangle(v + 1, v + 2, v + 3));
        }
        _indices.Unmap();
    }
}
