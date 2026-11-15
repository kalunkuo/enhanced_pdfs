using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Forms = System.Windows.Forms;

namespace EnhancedPdfs.Review;

/// <summary>Add-Ins → Enhanced PDFs → Import marked-up PDF.</summary>
[Transaction(TransactionMode.ReadOnly)]
public sealed class ImportCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        var controller = ReviewController.Instance;
        if (controller.IsRunning)
        {
            TaskDialog.Show("Markup review", "A review is still running. Finish or cancel it in the Markup review panel first.");
            return Result.Cancelled;
        }

        using var dialog = new Forms.OpenFileDialog
        {
            Title = "Import marked-up PDF",
            Filter = "PDF files (*.pdf)|*.pdf",
            CheckFileExists = true,
        };
        if (dialog.ShowDialog() != Forms.DialogResult.OK) return Result.Cancelled;

        string? error = controller.Start(commandData.Application, dialog.FileName);
        if (error is null) return Result.Succeeded;
        TaskDialog.Show("Markup review", error);
        return Result.Cancelled;
    }
}
