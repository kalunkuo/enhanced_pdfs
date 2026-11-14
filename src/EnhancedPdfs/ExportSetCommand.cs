using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Forms = System.Windows.Forms;

namespace EnhancedPdfs;

[Transaction(TransactionMode.Manual)]
public sealed class ExportSetCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        var application = commandData.Application;
        var document = application.ActiveUIDocument?.Document;
        if (document is null || document.IsFamilyDocument)
        {
            TaskDialog.Show("Export Sheet Set", "Open a Revit project to export a sheet set.");
            return Result.Cancelled;
        }

        var sets = new List<ExportSet>();
        using var sheets = new FilteredElementCollector(document);
        var allSheets = sheets.OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
            .Where(ExportCommand.CanExport)
            .OrderBy(sheet => sheet.SheetNumber, StringComparer.OrdinalIgnoreCase)
            .ThenBy(sheet => sheet.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(sheet => sheet.Id.Value)
            .ToArray();
        if (allSheets.Length > 0)
            sets.Add(new("Project sheets", $"{document.Title} - Sheet Set", DescribePages(allSheets), Include3DByDefault: false));

        using var savedSets = new FilteredElementCollector(document);
        foreach (var set in savedSets.OfClass(typeof(ViewSheetSet)).Cast<ViewSheetSet>()
                     .OrderBy(set => set.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            var views = set.OrderedViewList;
            if (views.Count > 0)
                sets.Add(new($"Saved set: {set.Name}", $"{document.Title} - {set.Name}", DescribePages(views), Include3DByDefault: true));
        }

        if (sets.Count == 0)
        {
            TaskDialog.Show("Export Sheet Set", "This project contains no printable sheets or saved view/sheet sets.");
            return Result.Cancelled;
        }

        using var dialog = new ExportSetDialog(sets);
        if (dialog.ShowDialog(new RevitWindow(application.MainWindowHandle)) != Forms.DialogResult.OK)
            return Result.Cancelled;

        var viewsToExport = dialog.SelectedViews;
        if (viewsToExport.FirstOrDefault(view => !ExportCommand.CanExport(view)) is { } unprintable)
        {
            TaskDialog.Show("Export Sheet Set", $"'{ExportCommand.DrawingTitle(unprintable)}' cannot be printed. Update the saved set in Revit and try again.");
            return Result.Cancelled;
        }

        return ExportCommand.Export(application, viewsToExport, dialog.FileName, ref message);
    }

    private static ExportPage[] DescribePages(IEnumerable<View> views)
    {
        return views.Select(view => new ExportPage(view, view is View3D || view is ViewSheet sheet &&
            sheet.GetAllPlacedViews().Any(id => sheet.Document.GetElement(id) is View3D))).ToArray();
    }
}

internal sealed record ExportSet(string Label, string FileName, IReadOnlyList<ExportPage> Pages, bool Include3DByDefault);

internal sealed record ExportPage(View View, bool Has3DView)
{
    public string Label => ExportCommand.DrawingTitle(View) + (Has3DView ? " (3D view)" : "");
}
