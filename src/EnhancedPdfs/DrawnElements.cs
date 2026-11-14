using Autodesk.Revit.DB;

namespace EnhancedPdfs;

internal sealed record DrawnElement(Document Document, ElementId Id, string? LinkPath, long? LinkInstanceId);

internal abstract class DrawingContext : IExportContextBase
{
    public HashSet<DrawnElement> Drawn { get; } = [];
    public bool Start() => true;
    public void Finish() { }
    public bool IsCanceled() => false;
    public RenderNodeAction OnViewBegin(ViewNode node) => RenderNodeAction.Proceed;
    public void OnViewEnd(ElementId id) { }

    protected abstract void RecordOutput();
    public virtual RenderNodeAction OnElementBegin(ElementId id) => RenderNodeAction.Proceed;
    public virtual void OnElementEnd(ElementId id) { }
    public virtual RenderNodeAction OnLinkBegin(LinkNode node) => RenderNodeAction.Proceed;
    public virtual void OnLinkEnd(LinkNode node) { }
    public RenderNodeAction OnInstanceBegin(InstanceNode node) => RenderNodeAction.Proceed;
    public void OnInstanceEnd(InstanceNode node) { }
    public RenderNodeAction OnFaceBegin(FaceNode node) => RenderNodeAction.Proceed;
    public void OnFaceEnd(FaceNode node) { }
    public void OnRPC(RPCNode node) => RecordOutput();
    public void OnLight(LightNode node) { }
    public void OnMaterial(MaterialNode node) { }
    public void OnPolymesh(PolymeshTopology mesh) => RecordOutput();
    public RenderNodeAction OnCurve(CurveNode node) => RenderNodeAction.Proceed;
    public RenderNodeAction OnPolyline(PolylineNode node) => RenderNodeAction.Proceed;
    public void OnLineSegment(LineSegment segment) => RecordOutput();
    public void OnPolylineSegments(PolylineSegments segments) => RecordOutput();
    public void OnText(TextNode node) => RecordOutput();
}

internal sealed class DrawingContext2D : DrawingContext, IExportContext2D
{
    private readonly Stack<DrawnElement> _elements = new();

    public RenderNodeAction OnElementBegin2D(ElementNode node)
    {
        long? linkId = node.LinkInstanceId == ElementId.InvalidElementId ? null : node.LinkInstanceId.Value;
        _elements.Push(new DrawnElement(node.Document, node.ElementId, linkId?.ToString(), linkId));
        return RenderNodeAction.Proceed;
    }

    public void OnElementEnd2D(ElementNode node) => _elements.Pop();
    public RenderNodeAction OnFaceEdge2D(FaceEdgeNode node) => RenderNodeAction.Proceed;
    public RenderNodeAction OnFaceSilhouette2D(FaceSilhouetteNode node) => RenderNodeAction.Proceed;

    protected override void RecordOutput()
    {
        if (_elements.TryPeek(out var element))
            Drawn.Add(element);
    }
}

internal sealed class DrawingContext3D(Document document) : DrawingContext, IModelExportContext
{
    private readonly Stack<DrawnElement> _elements = new();
    private readonly Stack<(Document Document, string? Path, long? InstanceId)> _links = new();

    public override RenderNodeAction OnElementBegin(ElementId id)
    {
        var context = _links.TryPeek(out var link) ? link : (Document: document, Path: null, InstanceId: null);
        _elements.Push(new DrawnElement(context.Document, id, context.Path, context.InstanceId));
        return RenderNodeAction.Proceed;
    }

    public override void OnElementEnd(ElementId id) => _elements.Pop();

    public override RenderNodeAction OnLinkBegin(LinkNode node)
    {
        var linkDocument = node.GetDocument();
        if (linkDocument is null)
            return RenderNodeAction.Skip;
        if (!_elements.TryPeek(out var instance))
            throw new InvalidOperationException("Could not identify a linked Revit instance in this 3D view.");

        var path = instance.LinkPath is null ? instance.Id.ToString() : $"{instance.LinkPath}/{instance.Id}";
        _links.Push((linkDocument, path, instance.Id.Value));
        return RenderNodeAction.Proceed;
    }

    public override void OnLinkEnd(LinkNode node) => _links.Pop();
    public RenderNodeAction OnPoint(PointNode node)
    {
        RecordOutput();
        return RenderNodeAction.Proceed;
    }

    protected override void RecordOutput()
    {
        if (_elements.TryPeek(out var element))
            Drawn.Add(element);
    }
}
