#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>

#include "check.h"
#include "duckdb.h"
#include "smartmarkup/tables.h"

using namespace sm;

namespace {

std::vector<uint8_t> LoadFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    return std::vector<uint8_t>(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

void Load(Attachments& a, const char* name, const char* fixture) {
    a[name] = LoadFile(check::FixturePath(fixture));
}

Attachments Exporter() {
    Attachments a;
    for (const char* n : {"elements", "parameters", "appearances", "drawings"}) {
        std::string f = std::string(n) + ".parquet";
        Load(a, f.c_str(), f.c_str());
    }
    return a;
}

std::vector<AnnotationRow> SampleAnnotations() {
    AnnotationRow a;
    a.annotationId = "nm-1";
    a.drawingId = "d1";
    a.page = 2;
    a.kind = "Fire door";
    a.subtype = "Square";
    a.text = "check \"this\" it's odd";
    a.author = "";
    a.status = "Open";
    a.createdUtc = "2026-11-14T10:00:00Z";
    a.modifiedUtc = "2026-11-14T11:00:00Z";
    a.sheetRect = {1.5, 2.5, 100.25, 200.75};
    AnnotationRow b;
    b.annotationId = "nm-2";
    b.drawingId = "d2";
    b.page = 1;
    b.kind = "Text";
    b.subtype = "";
    b.text = "";
    b.author = "Ann";
    b.status = "Deleted";
    b.sheetRect = {0, 0, 10, 10};
    return {a, b};
}

std::vector<LinkRow> SampleLinks() {
    return {{"nm-1", "key-a", 676281, "linked"}, {"nm-1", "key-b", 5, "referenced"}, {"nm-2", "", 0, "linked"}};
}

std::string Describe(const std::vector<uint8_t>& bytes) {
    std::string path = std::string(std::getenv("TEMP")) + "\\sm_describe_test.parquet";
    {
        std::ofstream out(path, std::ios::binary);
        out.write(reinterpret_cast<const char*>(bytes.data()), (std::streamsize)bytes.size());
    }
    std::string result;
    duckdb_database db;
    duckdb_connection con;
    duckdb_open(nullptr, &db);
    duckdb_connect(db, &con);
    duckdb_result r;
    std::string sql = "DESCRIBE SELECT * FROM read_parquet('" + path + "')";
    if (duckdb_query(con, sql.c_str(), &r) == DuckDBSuccess) {
        for (idx_t i = 0; i < duckdb_row_count(&r); ++i) {
            char* n = duckdb_value_varchar(&r, 0, i);
            char* t = duckdb_value_varchar(&r, 1, i);
            result += std::string(n) + ":" + t + ";";
            duckdb_free(n);
            duckdb_free(t);
        }
    } else {
        result = std::string("ERR ") + duckdb_result_error(&r);
    }
    duckdb_destroy_result(&r);
    duckdb_disconnect(&con);
    duckdb_close(&db);
    std::remove(path.c_str());
    return result;
}

}  // namespace

TEST(read_model_snowdon) {
    ModelData m = ReadModel(Exporter());
    CHECK(m.elements.size() == 1204);
    CHECK(m.parameters.size() == 30755);
    CHECK(m.drawings.size() == 3);
    bool wall = false;
    for (auto& e : m.elements)
        if (e.elementId == 676281) wall = e.category == "Walls";
    CHECK(wall);
    int roots = 0;
    for (auto& d : m.drawings)
        if (!d.parentDrawingId) {
            ++roots;
            CHECK(d.name == "First Floor Plan");
        }
    CHECK(roots == 1);
}

TEST(is_enhanced) {
    CHECK(IsEnhanced(Exporter()));
    CHECK(!IsEnhanced(Attachments{}));
}

TEST(read_poc_annotations_migrates) {
    Attachments a;
    Load(a, "annotations.parquet", "poc-annotations.parquet");
    Load(a, "annotation-links.parquet", "poc-annotation-links.parquet");
    AnnotationState s = ReadAnnotations(a);
    CHECK(s.annotations.size() == 1);
    CHECK(s.links.size() == 7);
    if (s.annotations.size() == 1) {
        CHECK(s.annotations[0].subtype.empty());
        CHECK(s.annotations[0].modifiedUtc.empty());
        CHECK(s.annotations[0].status == "Open");
        CHECK(s.annotations[0].schemaVersion == 1);
        CHECK(!s.annotations[0].annotationId.empty());
    }
}

TEST(read_annotations_absent_is_empty) {
    AnnotationState s = ReadAnnotations(Attachments{});
    CHECK(s.annotations.empty());
    CHECK(s.links.empty());
}

TEST(write_then_read_roundtrip) {
    auto anns = SampleAnnotations();
    auto links = SampleLinks();
    Attachments a;
    a["annotations.parquet"] = WriteAnnotationsParquet(anns);
    a["annotation-links.parquet"] = WriteLinksParquet(links);
    AnnotationState s = ReadAnnotations(a);
    CHECK(s.annotations.size() == anns.size());
    CHECK(s.links.size() == links.size());
    for (size_t i = 0; i < anns.size() && i < s.annotations.size(); ++i) {
        const auto &x = anns[i], &y = s.annotations[i];
        CHECK(x.annotationId == y.annotationId);
        CHECK(x.drawingId == y.drawingId);
        CHECK(x.page == y.page);
        CHECK(x.kind == y.kind);
        CHECK(x.subtype == y.subtype);
        CHECK(x.text == y.text);
        CHECK(x.author == y.author);
        CHECK(x.status == y.status);
        CHECK(x.createdUtc == y.createdUtc);
        CHECK(x.modifiedUtc == y.modifiedUtc);
        CHECK(x.sheetRect == y.sheetRect);
        CHECK(x.schemaVersion == y.schemaVersion);
    }
    for (size_t i = 0; i < links.size() && i < s.links.size(); ++i) {
        CHECK(links[i].annotationId == s.links[i].annotationId);
        CHECK(links[i].elementKey == s.links[i].elementKey);
        CHECK(links[i].elementId == s.links[i].elementId);
        CHECK(links[i].relation == s.links[i].relation);
    }
    if (std::getenv("SM_WRITE_SAMPLES")) {
        std::string dir = std::string(SM_FIXTURES_DIR) + "/../../build/tables-out";
        std::string cmd = "mkdir \"" + dir + "\" 2> NUL";
        std::system(cmd.c_str());
        for (auto& kv : a) {
            std::ofstream out(dir + "/" + kv.first, std::ios::binary);
            out.write(reinterpret_cast<const char*>(kv.second.data()), (std::streamsize)kv.second.size());
        }
    }
}

TEST(written_columns_match_spec) {
    CHECK(Describe(WriteAnnotationsParquet(SampleAnnotations())) ==
          "AnnotationId:VARCHAR;DrawingId:VARCHAR;Page:INTEGER;Kind:VARCHAR;Subtype:VARCHAR;Text:VARCHAR;"
          "Author:VARCHAR;Status:VARCHAR;CreatedUtc:VARCHAR;ModifiedUtc:VARCHAR;SheetRect:DOUBLE[];"
          "SchemaVersion:INTEGER;");
    CHECK(Describe(WriteLinksParquet(SampleLinks())) ==
          "AnnotationId:VARCHAR;ElementKey:VARCHAR;ElementId:BIGINT;Relation:VARCHAR;");
}

TEST(corrupt_input_throws) {
    Attachments a = Exporter();
    a["elements.parquet"] = {1, 2, 3};
    bool threw = false;
    try {
        ReadModel(a);
    } catch (const TableError&) {
        threw = true;
    }
    CHECK(threw);
}
