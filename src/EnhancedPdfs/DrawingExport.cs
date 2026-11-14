using Autodesk.Revit.DB;

namespace EnhancedPdfs;

internal static class DrawingExport
{
    public static DrawingData Export(View view, string outputPath)
    {
        var directory = Path.GetDirectoryName(outputPath)
            ?? throw new ArgumentException("Choose a PDF output folder.", nameof(outputPath));
        var buffer = Directory.CreateTempSubdirectory("enhanced-pdfs-");
        var stagingPath = Path.Combine(directory, $".enhanced-pdfs-{Guid.NewGuid():N}.tmp");
        try
        {
            string nativePath = ExportNative(view, buffer.FullName);
            var data = new DrawingCollector(view).Collect();
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

    internal static string ExportNative(View view, string directory)
    {
        using var settings = ExportPDFSettings.GetActivePredefinedSettings(view.Document);
        using var options = settings?.GetOptions() ?? new PDFExportOptions();
        options.Combine = true;
        options.FileName = "revit-native";
        options.StopOnError = true;
        options.SetExportInBackground(false);

        string path = Path.Combine(directory, options.FileName + ".pdf");
        if (!view.Document.Export(directory, [view.Id], options) || !File.Exists(path))
            throw new IOException("Revit could not create the native PDF.");
        return path;
    }
}
