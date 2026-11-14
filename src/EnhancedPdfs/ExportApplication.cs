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
        if (view is null || view.Document.IsFamilyDocument || view.IsTemplate || !view.CanBePrinted)
        {
            TaskDialog.Show("Enhanced PDFs", "Open a printable view or sheet in a Revit project.");
            return Result.Cancelled;
        }

        string title = view is ViewSheet sheet ? $"{sheet.SheetNumber} - {view.Name}" : view.Name;
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
            var result = DrawingExport.Export(view, dialog.FileName);
            ShowResult(dialog.FileName, result);
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

    private static void ShowResult(string path, DrawingData data)
    {
        var dialog = new TaskDialog("Enhanced PDFs")
        {
            MainInstruction = "Enhanced PDF exported",
            MainContent = $"{Path.GetFileName(path)}\n{data.Elements.Count:N0} elements · {data.Drawings.Count:N0} views and sheets",
            CommonButtons = TaskDialogCommonButtons.Close,
        };
        if (data.Notes.Count > 0)
            dialog.ExpandedContent = string.Join("\n", data.Notes);
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

    private sealed record RevitWindow(IntPtr Handle) : Forms.IWin32Window;
}
