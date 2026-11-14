using Autodesk.Revit.DB;

namespace EnhancedPdfs;

internal static class DrawingExport
{
    public static DrawingData Export(IReadOnlyList<View> views, string outputPath)
    {
        var directory = Path.GetDirectoryName(outputPath)
            ?? throw new ArgumentException("Choose a PDF output folder.", nameof(outputPath));
        var buffer = Directory.CreateTempSubdirectory("enhanced-pdfs-");
        var stagingPath = Path.Combine(directory, $".enhanced-pdfs-{Guid.NewGuid():N}.tmp");
        try
        {
            string nativePath = ExportNative(views, buffer.FullName);
            var data = new DrawingCollector(views).Collect();
            // Run Parquet's async writer without capturing Revit's UI synchronization context.
            Task.Run(() => PdfEnrichment.Write(nativePath, stagingPath, data)).GetAwaiter().GetResult();
            File.Move(stagingPath, outputPath, overwrite: true);
            return data;
        }
        finally
        {
            File.Delete(stagingPath);
            buffer.Delete(recursive: true);
        }
    }

    private static string ExportNative(IReadOnlyList<View> views, string directory)
    {
        var document = views[0].Document;
        using var settings = ExportPDFSettings.GetActivePredefinedSettings(document);
        using var options = settings?.GetOptions() ?? new PDFExportOptions();
        options.Combine = true;
        options.FileName = "revit-native";
        options.StopOnError = true;
        options.SetExportInBackground(false);

        string path = Path.Combine(directory, options.FileName + ".pdf");
        if (!document.Export(directory, views.Select(view => view.Id).ToArray(), options) || !File.Exists(path))
            throw new IOException("Revit could not create the native PDF.");
        return path;
    }
}
