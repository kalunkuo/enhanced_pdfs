using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;

namespace EnhancedPdfs;

internal sealed class DrawingCollector(View root)
{
    private readonly DrawingData _data = new();
    private readonly Dictionary<Document, string> _modelKeys = [];
    private readonly HashSet<string> _parameterOwners = [];
    private readonly string _exportedUtc = DateTimeOffset.UtcNow.ToString("O");
    private const string GeometrySource = "Revit drawing callbacks";
    private const string SheetSource = "Revit sheet-owned elements";
    private const string ScheduleSource = "Revit schedule";
    private const string ViewSource = "Revit view-owned elements";
    private const string PanelSource = "Revit panel schedule";

    public DrawingData Collect()
    {
        var document = root.Document;
        string? sheetNumber = null;
        string? revision = null;
        if (root is ViewSheet sheet)
        {
            sheetNumber = sheet.SheetNumber;
            var revisionId = sheet.GetCurrentRevision();
            if (revisionId != ElementId.InvalidElementId)
                revision = sheet.GetRevisionNumberOnSheet(revisionId);
        }

        string rootId = AddDrawing(root, null, root.UniqueId, sheetNumber, null, revision);
        if (root is ViewSheet sheetView)
        {
            foreach (var viewportId in sheetView.GetAllViewports().OrderBy(id => id.Value))
            {
                var viewport = (Viewport)document.GetElement(viewportId);
                var view = (View)document.GetElement(viewport.ViewId);
                AddDrawing(view, rootId, viewport.UniqueId, sheetNumber,
                    viewport.get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER)?.AsString(), revision);
            }

            foreach (var item in SheetItems<ScheduleSheetInstance>(sheetView))
            {
                if (item.IsTitleblockRevisionSchedule)
                    continue;
                var view = (ViewSchedule)document.GetElement(item.ScheduleId);
                AddDrawing(view, rootId, item.UniqueId, sheetNumber, null, revision, item.SegmentIndex);
            }

            foreach (var item in SheetItems<PanelScheduleSheetInstance>(sheetView))
            {
                var view = (PanelScheduleView)document.GetElement(item.ScheduleId);
                AddDrawing(view, rootId, item.UniqueId, sheetNumber, null, revision);
            }
        }

        return _data;
    }

    private static IEnumerable<T> SheetItems<T>(ViewSheet sheet) where T : Element
    {
        using var collector = new FilteredElementCollector(sheet.Document);
        return collector.OwnedByView(sheet.Id).OfClass(typeof(T)).Cast<T>()
            .OrderBy(item => item.Id.Value).ToArray();
    }

    private string AddDrawing(View view, string? parentId, string drawingId,
        string? sheetNumber, string? detailNumber, string? revision, int scheduleSegment = -1)
    {
        bool supportsGeometry = view.ViewType is ViewType.FloorPlan or ViewType.EngineeringPlan
            or ViewType.CeilingPlan or ViewType.AreaPlan or ViewType.Elevation or ViewType.Section
            or ViewType.Detail or ViewType.ThreeD;
        string source = view switch
        {
            ViewSheet => SheetSource,
            ViewSchedule => ScheduleSource,
            PanelScheduleView => PanelSource,
            _ => supportsGeometry ? GeometrySource : ViewSource,
        };

        var document = view.Document;
        string? version = string.IsNullOrEmpty(document.PathName)
            ? null : Document.GetDocumentVersion(document).VersionGUID.ToString();
        _data.Drawings.Add(new DrawingRow(drawingId, parentId, view.UniqueId, view.Id.Value, 1, view.Name,
            view.ViewType.ToString(), supportsGeometry || view.ViewType is ViewType.DraftingView or ViewType.Legend
                ? view.Scale : null, sheetNumber, detailNumber, revision, document.Title, ModelKey(document),
            document.Application.VersionNumber, _exportedUtc, version, document.IsModified, source,
            DrawingData.SchemaVersion));

        if (view is ViewSchedule schedule)
        {
            CollectSchedule(schedule, drawingId, scheduleSegment);
        }
        else if (view is PanelScheduleView panel)
        {
            CollectPanelSchedule(panel, drawingId);
        }
        else if (supportsGeometry)
        {
            if (view.IsTemporaryHideIsolateActive())
                throw new InvalidOperationException($"Restore Temporary Hide/Isolate in '{view.Name}' before exporting.");
            CollectGeometry(view, drawingId);
        }
        else
        {
            if (view is not ViewSheet)
                _data.Notes.Add($"'{view.Name}' uses view-owned elements. Revit's drawing callbacks do not cover {view.ViewType} views.");

            if (FilteredElementCollector.IsViewValidForElementIteration(document, view.Id))
            {
                using var collector = new FilteredElementCollector(document, view.Id);
                foreach (var element in collector.OwnedByView(view.Id).WhereElementIsNotElementType())
                    AddElement(drawingId, element, null, null, source);
            }
            else
            {
                _data.Notes.Add($"Revit does not expose an element list for '{view.Name}'.");
            }
        }

        return drawingId;
    }

    private void CollectGeometry(View view, string drawingId)
    {
        var document = view.Document;
        DrawingContext context = view is View3D ? new DrawingContext3D(document) : new DrawingContext2D();
        using var exporter = new CustomExporter(document, context)
        {
            IncludeGeometricObjects = true,
            ShouldStopOnError = true,
        };
        if (context is DrawingContext2D)
        {
            exporter.Export2DIncludingAnnotationObjects = true;
            exporter.Export2DGeometricObjectsIncludingPatternLines = true;
        }
        exporter.Export(view);

        foreach (var item in context.Drawn.OrderBy(item => item.LinkPath).ThenBy(item => item.Id.Value))
        {
            if (item.Document.GetElement(item.Id) is { } element)
                AddElement(drawingId, element, item.LinkPath, item.LinkInstanceId, GeometrySource);
        }
    }

    private void CollectSchedule(ViewSchedule schedule, string drawingId, int segment)
    {
        if (segment >= 0 && schedule.GetSegmentCount() > 1)
        {
            _data.Notes.Add($"'{schedule.Name}' segment {segment + 1} is shown. Its data covers the full schedule.");
        }

        var table = schedule.GetTableData();
        AddScheduleCells(drawingId, table, [SectionType.Header, SectionType.Body], schedule.GetCellText);
        if (!FilteredElementCollector.IsViewValidForElementIteration(schedule.Document, schedule.Id))
            return;

        using var collector = new FilteredElementCollector(schedule.Document, schedule.Id);
        foreach (var element in collector.WhereElementIsNotElementType())
            AddElement(drawingId, element, null, null, ScheduleSource);

        if (schedule.Definition.IncludeLinkedFiles)
            _data.Notes.Add($"'{schedule.Name}' includes linked rows. Their cell text is included with the schedule.");
    }

    private void CollectPanelSchedule(PanelScheduleView schedule, string drawingId)
    {
        var table = schedule.GetTableData();
        AddScheduleCells(drawingId, table,
            [SectionType.Header, SectionType.Body, SectionType.Summary, SectionType.Footer], schedule.GetCellText);
        if (schedule.Document.GetElement(schedule.GetPanel()) is { } panel)
            AddElement(drawingId, panel, null, null, PanelSource);
    }

    private void AddScheduleCells(string drawingId, TableData table, SectionType[] sections,
        Func<SectionType, int, int, string> getText)
    {
        foreach (var section in sections)
        {
            using var cells = table.GetSectionData(section);
            if (cells is null || cells.NumberOfRows == 0 || cells.NumberOfColumns == 0)
                continue;
            for (int row = cells.FirstRowNumber; row <= cells.LastRowNumber; row++)
            {
                for (int column = cells.FirstColumnNumber; column <= cells.LastColumnNumber; column++)
                {
                    string text = getText(section, row, column);
                    if (!string.IsNullOrWhiteSpace(text))
                        _data.ScheduleCells.Add(new ScheduleCellRow(drawingId, section.ToString(), row, column, text));
                }
            }
        }
    }

    private void AddElement(string drawingId, Element element, string? linkPath, long? linkId, string source)
    {
        var document = element.Document;
        string modelKey = ModelKey(document);
        string key = $"{modelKey}/{linkPath ?? "host"}/{element.UniqueId}";
        _data.Appearances.Add(new AppearanceRow(drawingId, key, source));
        if (_data.Elements.ContainsKey(key))
            return;

        var type = document.GetElement(element.GetTypeId()) as ElementType;
        string? typeKey = type is null ? null : $"{modelKey}/{type.UniqueId}";
        string? rating = Read(element, BuiltInParameter.FIRE_RATING);
        string? ratingSource = rating is null ? null : "Instance";
        if (rating is null && type is not null)
        {
            rating = Read(type, BuiltInParameter.FIRE_RATING);
            if (rating is not null)
                ratingSource = "Type";
        }

        string? wallFunction = type is WallType wallType ? wallType.Function.ToString() : null;
        _data.Elements.Add(key, new ElementRow(key, modelKey, document.Title, linkId, element.UniqueId,
            element.Id.Value, element.Category?.Name ?? element.GetType().Name, element.Category?.Id.Value,
            element.Name, type?.FamilyName, type?.Name, typeKey, type?.Id.Value,
            document.GetElement(element.LevelId)?.Name, Read(element, BuiltInParameter.ALL_MODEL_MARK),
            wallFunction, rating, ratingSource, element.VersionGuid.ToString()));

        CollectParameters(key, "Instance", element);
        if (typeKey is not null && type is not null)
            CollectParameters(typeKey, "Type", type);
    }

    private void CollectParameters(string key, string scope, Element element)
    {
        if (!_parameterOwners.Add(key))
            return;
        foreach (Parameter parameter in element.Parameters)
        {
            if (!parameter.HasValue || parameter.StorageType == StorageType.None)
                continue;

            var definition = parameter.Definition;
            string? text = parameter.StorageType == StorageType.String ? parameter.AsString() : null;
            long? integer = parameter.StorageType == StorageType.Integer ? parameter.AsInteger() : null;
            double? number = parameter.StorageType == StorageType.Double ? parameter.AsDouble() : null;
            long? reference = parameter.StorageType == StorageType.ElementId ? parameter.AsElementId().Value : null;
            string? display = parameter.StorageType switch
            {
                StorageType.String => text,
                StorageType.ElementId => parameter.AsValueString() ?? element.Document.GetElement(new ElementId(reference!.Value))?.Name,
                _ => parameter.AsValueString(),
            };
            var spec = definition.GetDataType();
            var unit = UnitUtils.IsMeasurableSpec(spec) && parameter.StorageType == StorageType.Double
                ? parameter.GetUnitTypeId().TypeId : null;

            _data.Parameters.Add(new ParameterRow(key, scope, parameter.Id.Value,
                parameter.IsShared ? parameter.GUID.ToString() : null, definition.Name,
                parameter.StorageType.ToString(), spec.TypeId, unit, display, text, integer, number, reference));
        }
    }

    private static string? Read(Element element, BuiltInParameter id)
    {
        var parameter = element.get_Parameter(id);
        string? value = parameter?.StorageType == StorageType.String
            ? parameter.AsString() : parameter?.AsValueString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private string ModelKey(Document document)
    {
        if (!_modelKeys.TryGetValue(document, out var key))
        {
            key = document.ProjectInformation?.UniqueId ?? $"model-{_modelKeys.Count + 1}";
            _modelKeys.Add(document, key);
        }
        return key;
    }
}
