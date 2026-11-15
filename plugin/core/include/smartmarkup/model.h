// Shared data contract for the smart-markup core and its hosts (Acrobat today, others later).
// Spec: docs/superpowers/specs/2026-11-14-acrobat-smart-markup-plugin-design.md
#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace sm {

constexpr int32_t kSchemaVersion = 1;

// Axis-aligned box in PDF user space (y up). Invariant: x0 <= x1, y0 <= y1.
struct Box {
    double x0 = 0, y0 = 0, x1 = 0, y1 = 0;
};

// Revit ElementId -> union bbox of everything drawn inside its /Element<id> marked content, one page.
using ElementMap = std::unordered_map<int64_t, Box>;

// How a markup selects elements: by area, by a single anchor point, or (arrows) by the arrowhead point.
enum class Shape { Area, Point, Arrow };

// One annotation as reported by the host.
struct Markup {
    std::string id;           // /NM; may be empty (core assigns one)
    int page = 1;             // 1-based
    std::string subtype;      // PDF subtype without '/', e.g. "Square", "Text", "Line"
    std::string subject;      // /Subj, may be empty
    std::string text;         // /Contents, may be empty
    std::string author;       // /T, may be empty
    std::string createdUtc;   // ISO-8601, may be empty
    std::string modifiedUtc;  // ISO-8601, may be empty
    Box rect;                 // /Rect in user space
    Shape shape = Shape::Area;
    double anchorX = 0, anchorY = 0;  // used for Shape::Point and Shape::Arrow
};

// Rows of the exporter's tables (only the columns the plug-in needs).
struct ElementRow {
    std::string elementKey;
    int64_t elementId = 0;
    std::string category, name, family, type, typeKey;
};

struct ParameterRow {
    std::string ownerKey, scope, name, displayValue;
};

struct AppearanceRow {
    std::string drawingId, elementKey;
};

struct DrawingRow {
    std::string drawingId;
    std::optional<std::string> parentDrawingId;  // nullopt for the sheet itself
    std::string name, kind;
    int page = 1;
};

// annotations.parquet row. Empty strings are written as NULL.
struct AnnotationRow {
    std::string annotationId, drawingId;
    int32_t page = 1;
    std::string kind, subtype, text, author;
    std::string status;  // "Open" | "Deleted"
    std::string createdUtc, modifiedUtc;
    std::array<double, 4> sheetRect{};  // x0, y0, x1, y1 (PDF user space)
    int32_t schemaVersion = kSchemaVersion;
};

// annotation-links.parquet row.
struct LinkRow {
    std::string annotationId, elementKey;
    int64_t elementId = 0;
    std::string relation;  // "linked" | "referenced"
};

struct ModelData {
    std::vector<ElementRow> elements;
    std::vector<ParameterRow> parameters;
    std::vector<AppearanceRow> appearances;
    std::vector<DrawingRow> drawings;
};

struct AnnotationState {
    std::vector<AnnotationRow> annotations;
    std::vector<LinkRow> links;
};

}  // namespace sm
