using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MarkupReview.Core;

namespace EnhancedPdfs.Review;

/// <summary>
/// Shows a proposal's element: opens the view the markup was drawn on (when the element is visible there), zooms to it
/// and selects it. Selection never enters the undo stack or the saved model.
/// </summary>
internal static class Preview
{
    public static void Show(UIApplication app, ReviewSession session, Proposal proposal)
    {
        var uidoc = app.ActiveUIDocument;
        if (uidoc is null || !session.Tables.ElementsByKey.TryGetValue(proposal.ElementKey, out var exported)) return;
        var element = uidoc.Document.GetElement(exported.UniqueId);
        if (element is null) return;

        var view = PreferredView(uidoc.Document, session, proposal, element);
        if (view is not null && view.Id != uidoc.ActiveView.Id) uidoc.ActiveView = view;
        var ids = new List<ElementId> { element.Id };
        uidoc.Selection.SetElementIds(ids);
        uidoc.ShowElements(ids);
    }

    public static void Clear(UIApplication app) => app.ActiveUIDocument?.Selection.SetElementIds([]);

    /// <summary>A placed view on the markup's sheet page that shows the element; otherwise stay in the active view.</summary>
    private static View? PreferredView(Document document, ReviewSession session, Proposal proposal, Element element)
    {
        var markup = session.FindMarkup(proposal.MarkupId);
        if (markup is null) return null;
        foreach (var drawing in session.Tables.Drawings.Where(d => d.Page == markup.Page && d.ParentDrawingId is not null))
        {
            if (document.GetElement(drawing.ViewUniqueId) is not View view || view.IsTemplate) continue;
            bool visible = new FilteredElementCollector(document, view.Id).WhereElementIsNotElementType()
                .Any(e => e.Id == element.Id);
            if (visible) return view;
        }
        return null;
    }
}
