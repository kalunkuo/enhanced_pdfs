using System.Diagnostics;
using System.Reflection;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Forms = System.Windows.Forms;

namespace EnhancedPdfs;

public sealed class ExportApplication : IExternalApplication
{
    public Result OnStartup(UIControlledApplication application)
    {
        var panel = application.CreateRibbonPanel("Enhanced PDFs");
        var button = (PushButton)panel.AddItem(new PushButtonData(
            "EnhancedPdfs.Export", "Export Enhanced PDF", Assembly.GetExecutingAssembly().Location,
            typeof(ExportCommand).FullName));
        button.ToolTip = "Export the active Revit view or sheet with searchable BIM data and Parquet attachments.";
        (button.LargeImage, button.Image) = (RibbonIcons.Export(32), RibbonIcons.Export(16));
        var setButton = (PushButton)panel.AddItem(new PushButtonData(
            "EnhancedPdfs.ExportSet", "Export Sheet Set", Assembly.GetExecutingAssembly().Location,
            typeof(ExportSetCommand).FullName));
        setButton.ToolTip = "Choose project sheets or a saved Revit view/sheet set to export into one enhanced PDF.";
        (setButton.LargeImage, setButton.Image) = (RibbonIcons.ExportSet(32), RibbonIcons.ExportSet(16));

        var importButton = (PushButton)panel.AddItem(new PushButtonData(
            "EnhancedPdfs.ImportMarkups", "Import marked-up PDF", Assembly.GetExecutingAssembly().Location,
            typeof(Review.ImportCommand).FullName));
        importButton.ToolTip = "Have Claude turn a returned PDF's markups into proposed model changes, then approve or reject each one.";
        (importButton.LargeImage, importButton.Image) = (RibbonIcons.ImportMarkups(32), RibbonIcons.ImportMarkups(16));
        var review = Review.ReviewController.Instance;
        review.Initialize();
        application.RegisterDockablePane(Review.ReviewController.PaneId, "Markup review", new Review.ReviewPane(review));
        return Result.Succeeded;
    }

    public Result OnShutdown(UIControlledApplication application) => Result.Succeeded;
}

// Revit's export engines require the document context of a manual command.
[Transaction(TransactionMode.Manual)]
public sealed class ExportCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        var application = commandData.Application;
        var view = application.ActiveUIDocument?.ActiveView;
        if (view is null || view.Document.IsFamilyDocument || !CanExport(view))
        {
            TaskDialog.Show("Enhanced PDFs", "Open a printable view or sheet in a Revit project.");
            return Result.Cancelled;
        }

        return Export(application, [view], DrawingTitle(view), ref message);
    }

    internal static bool CanExport(View view) => view.CanBePrinted && !view.IsTemplate &&
        view is not ViewSheet { IsPlaceholder: true };

    internal static string DrawingTitle(View view) =>
        view is ViewSheet sheet ? $"{sheet.SheetNumber} - {sheet.Name}" : view.Name;

    internal static Result Export(UIApplication application, IReadOnlyList<View> views, string title, ref string message)
    {
        using var dialog = new Forms.SaveFileDialog
        {
            Title = "Export Enhanced PDF",
            FileName = string.Concat(title.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c)).Trim(),
            Filter = "PDF files (*.pdf)|*.pdf",
            DefaultExt = "pdf",
            AddExtension = true,
            OverwritePrompt = true,
        };
        if (dialog.ShowDialog(new RevitWindow(application.MainWindowHandle)) != Forms.DialogResult.OK)
            return Result.Cancelled;

        try
        {
            var result = DrawingExport.Export(views, dialog.FileName);
            ShowResult(dialog.FileName, views.Count, result);
            return Result.Succeeded;
        }
        catch (Exception error)
        {
            message = $"Enhanced PDF export failed.\n\n{error.Message}";
            application.Application.WriteJournalComment(
                $"Enhanced PDFs: {error.GetType().Name}\n{error.StackTrace}", false);
            return Result.Failed;
        }
    }

    private static void ShowResult(string path, int pages, DrawingData data)
    {
        var dialog = new TaskDialog("Enhanced PDFs")
        {
            MainInstruction = "Enhanced PDF exported",
            MainContent = $"{Path.GetFileName(path)}\n{pages:N0} {(pages == 1 ? "page" : "pages")} · {data.Elements.Count:N0} elements",
            CommonButtons = TaskDialogCommonButtons.Close,
        };
        if (data.Notes.Count > 0)
            dialog.ExpandedContent = string.Join("\n", data.Notes.Select(note => $"Page {note.Page}: {note.Text}"));
        dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Open PDF");
        if (dialog.Show() == TaskDialogResult.CommandLink1)
        {
            try
            {
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            }
            catch (System.ComponentModel.Win32Exception)
            {
                TaskDialog.Show("Open PDF", path);
            }
        }
    }

}

internal sealed record RevitWindow(IntPtr Handle) : Forms.IWin32Window;
