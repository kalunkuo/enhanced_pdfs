using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MarkupReview.Core;

namespace EnhancedPdfs.Review;

/// <summary>
/// Shows what a card is about: opens the view the markup was drawn on (when the elements are visible there), selects
/// the elements and zooms to them. Selection never enters the undo stack or the saved model.
/// </summary>
internal static class Preview
{
    /// <summary>A proposal: its element.</summary>
    public static string? Show(UIApplication app, ReviewSession session, Proposal proposal) =>
        ShowElements(app, session, proposal.MarkupId, [proposal.ElementKey]);

    /// <summary>A note (or any markup): every host-model element it is tied to — tags and annotations included.</summary>
    public static string? ShowMarkup(UIApplication app, ReviewSession session, Markup markup) =>
        markup.Links.Count == 0
            ? "This markup is not tied to any element, so there is nothing to zoom to."
            : ShowElements(app, session, markup.Id, markup.Links.Select(l => l.ElementKey));

    /// <returns>Null when shown, otherwise why not.</returns>
    private static string? ShowElements(UIApplication app, ReviewSession session, string markupId, IEnumerable<string> keys)
    {
        var uidoc = app.ActiveUIDocument;
        if (uidoc is null) return "No open document.";
        var document = uidoc.Document;
        var elements = keys
            .Select(k => session.Tables.ElementsByKey.TryGetValue(k, out var e) && e.LinkInstanceId is null ? document.GetElement(e.UniqueId) : null)
            .OfType<Element>()
            .ToList();
        if (elements.Count == 0) return "None of this markup's elements are in the open model (deleted, or in a linked model).";

        var view = PreferredView(document, session, markupId, elements);
        if (view is not null && view.Id != uidoc.ActiveView.Id) uidoc.ActiveView = view;
        var ids = elements.Select(e => e.Id).ToList();
        uidoc.Selection.SetElementIds(ids);
        uidoc.ShowElements(ids);
        return null;
    }

    public static void Clear(UIApplication app) => app.ActiveUIDocument?.Selection.SetElementIds([]);

    /// <summary>A placed view on the markup's sheet page that shows at least one of the elements; else stay put.</summary>
    private static View? PreferredView(Document document, ReviewSession session, string markupId, List<Element> elements)
    {
        var markup = session.FindMarkup(markupId);
        if (markup is null) return null;
        var wanted = elements.Select(e => e.Id).ToHashSet();
        foreach (var drawing in session.Tables.Drawings.Where(d => d.Page == markup.Page && d.ParentDrawingId is not null))
        {
            if (document.GetElement(drawing.ViewUniqueId) is not View view || view.IsTemplate) continue;
            if (!FilteredElementCollector.IsViewValidForElementIteration(document, view.Id)) continue;
            if (new FilteredElementCollector(document, view.Id).WhereElementIsNotElementType().Any(e => wanted.Contains(e.Id)))
                return view;
        }
        return null;
    }
}
