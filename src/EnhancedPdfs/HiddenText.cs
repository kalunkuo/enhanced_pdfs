using System.Globalization;
using System.Text;
using PdfSharp.Pdf;
using PdfSharp.Pdf.Advanced;

namespace EnhancedPdfs;

internal static class HiddenText
{
    private const int GlyphsPerFont = 255;
    private const int LineLength = 126;
    private const double GlyphWidth = 0.6;

    public static void Append(PdfDocument pdf, PdfPage page, IEnumerable<string> text)
    {
        var lines = text.SelectMany(Wrap).ToArray();
        var alphabet = lines.SelectMany(line => line.EnumerateRunes()).Distinct()
            .OrderBy(rune => rune.Value).ToArray();
        var fonts = page.Resources.Elements.GetDictionary("/Font");
        if (fonts is null)
        {
            fonts = new PdfDictionary(pdf);
            page.Resources.Elements["/Font"] = fonts;
        }

        var glyphs = new Dictionary<Rune, (string Font, byte Code)>();
        var blankGlyph = Stream(pdf, "600 0 d0\n");
        int fontIndex = 0;
        foreach (var chunk in alphabet.Chunk(GlyphsPerFont))
        {
            string resourceName;
            do
            {
                resourceName = $"/RevitBim{++fontIndex}";
            } while (fonts.Elements.ContainsKey(resourceName));

            fonts.Elements[resourceName] = CreateFont(pdf, chunk, blankGlyph, fontIndex);
            for (int i = 0; i < chunk.Length; i++)
                glyphs.Add(chunk[i], (resourceName, (byte)(i + 1)));
        }

        var crop = page.EffectiveCropBoxReadOnly;
        double width = crop.Width - 12;
        double height = crop.Height - 12;
        if (width <= 0 || height <= 0)
            throw new InvalidDataException("The Revit PDF page is too small for the text layer.");

        double maxLineWidth = lines.Max(line => line.EnumerateRunes().Count()) * GlyphWidth + 1.5;
        double fontSize = Math.Min(6, Math.Sqrt(width * height / (maxLineWidth * lines.Length * 1.4)));
        // Choose an integer column count first, then fit the lines in that grid.
        int columns = Math.Clamp((int)(width / (maxLineWidth * fontSize)), 1, lines.Length);
        int rows = (lines.Length + columns - 1) / columns;
        double columnWidth = width / columns;
        fontSize = Math.Min(fontSize, Math.Min(columnWidth / maxLineWidth, height / (rows * 1.4)));
        double leading = fontSize * 1.4;

        var content = new StringBuilder("q\nBT\n3 Tr\n");
        string? activeFont = null;
        for (int i = 0; i < lines.Length; i++)
        {
            double x = crop.X1 + 6 + (i / rows) * columnWidth;
            double y = crop.Y2 - 6 - fontSize - (i % rows) * leading;
            content.Append(CultureInfo.InvariantCulture, $"1 0 0 1 {x:0.####} {y:0.####} Tm\n");

            var run = new StringBuilder();
            foreach (var rune in lines[i].EnumerateRunes())
            {
                var glyph = glyphs[rune];
                if (glyph.Font != activeFont)
                {
                    FlushRun();
                    activeFont = glyph.Font;
                    content.Append(CultureInfo.InvariantCulture, $"{activeFont} {fontSize:0.####} Tf\n");
                }
                run.Append(CultureInfo.InvariantCulture, $"{glyph.Code:X2}");
            }
            FlushRun();

            void FlushRun()
            {
                if (run.Length == 0)
                    return;
                content.Append('<').Append(run).Append("> Tj\n");
                run.Clear();
            }
        }
        content.Append("ET\nQ\n");

        // Prepend a self-contained stream. Preserve the original content streams and their filters.
        var extra = Stream(pdf, content.ToString());
        var contents = new PdfArray(pdf, extra);
        if (page.Elements.GetArray("/Contents") is { } array)
        {
            foreach (var original in array.Elements)
                contents.Elements.Add(original);
        }
        else if (page.Elements["/Contents"] is { } original)
        {
            contents.Elements.Add(original);
        }
        page.Elements["/Contents"] = contents;
    }

    private static PdfReference CreateFont(PdfDocument pdf, Rune[] alphabet, PdfReference blankGlyph, int index)
    {
        // Each code has normal text metrics and an explicit Unicode mapping. The type 3
        // glyph programs paint nothing, including in readers that ignore Tr for type 3.
        var font = new PdfDictionary(pdf);
        font.Elements.SetName("/Type", "/Font");
        font.Elements.SetName("/Subtype", "/Type3");
        font.Elements.SetInteger("/FirstChar", 1);
        font.Elements.SetInteger("/LastChar", alphabet.Length);
        font.Elements["/FontBBox"] = new PdfArray(pdf, new PdfInteger(0), new PdfInteger(-200),
            new PdfInteger(600), new PdfInteger(800));
        font.Elements["/FontMatrix"] = new PdfArray(pdf, new PdfReal(.001), new PdfInteger(0),
            new PdfInteger(0), new PdfReal(.001), new PdfInteger(0), new PdfInteger(0));

        var differences = new PdfArray(pdf, new PdfInteger(1));
        var widths = new PdfArray(pdf);
        var glyphPrograms = new PdfDictionary(pdf);
        for (int i = 1; i <= alphabet.Length; i++)
        {
            string glyphName = $"/g{i}";
            differences.Elements.Add(new PdfName(glyphName));
            widths.Elements.Add(new PdfInteger(600));
            glyphPrograms.Elements[glyphName] = blankGlyph;
        }
        var encoding = new PdfDictionary(pdf);
        encoding.Elements.SetName("/Type", "/Encoding");
        encoding.Elements["/Differences"] = differences;
        font.Elements["/Encoding"] = encoding;
        font.Elements["/Widths"] = widths;
        font.Elements["/CharProcs"] = glyphPrograms;

        var cmap = new StringBuilder($"""
            /CIDInit /ProcSet findresource begin
            12 dict begin
            begincmap
            /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
            /CMapName /RevitBimUcs{index} def
            /CMapType 2 def
            1 begincodespacerange
            <01> <FF>
            endcodespacerange

            """);
        int code = 1;
        foreach (var block in alphabet.Chunk(100))
        {
            cmap.Append(CultureInfo.InvariantCulture, $"{block.Length} beginbfchar\n");
            foreach (var rune in block)
            {
                string unicode = Convert.ToHexString(Encoding.BigEndianUnicode.GetBytes(rune.ToString()));
                cmap.Append(CultureInfo.InvariantCulture, $"<{code++:X2}> <{unicode}>\n");
            }
            cmap.Append("endbfchar\n");
        }
        cmap.Append("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
        font.Elements["/ToUnicode"] = Stream(pdf, cmap.ToString());

        pdf.Internals.AddObject(font);
        return font.ReferenceNotNull;
    }

    private static PdfReference Stream(PdfDocument pdf, string content)
    {
        var stream = new PdfDictionary(pdf);
        stream.CreateStream(Encoding.ASCII.GetBytes(content));
        stream.Stream.Zip();
        pdf.Internals.AddObject(stream);
        return stream.ReferenceNotNull;
    }

    private static IEnumerable<string> Wrap(string value)
    {
        var line = new StringBuilder();
        int count = 0;
        foreach (var word in value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            int length = word.EnumerateRunes().Count();
            if (count > 0 && count + 1 + length > LineLength)
            {
                yield return line.ToString();
                line.Clear();
                count = 0;
            }
            if (count > 0)
            {
                line.Append(' ');
                count++;
            }
            foreach (var rune in word.EnumerateRunes())
            {
                if (count == LineLength)
                {
                    yield return line.ToString();
                    line.Clear();
                    count = 0;
                }
                line.Append(rune.ToString());
                count++;
            }
        }
        if (count > 0)
            yield return line.ToString();
    }
}
