#include "smartmarkup/tables.h"

#include <process.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <random>
#include <set>

#include "duckdb.h"

namespace sm {
namespace {

namespace fs = std::filesystem;

// Temp directory %TEMP%\SmartMarkup\<random>, removed on destruction (also on error).
class TempDir {
public:
    TempDir() {
        std::error_code ec;
        fs::path base = fs::temp_directory_path(ec);
        if (ec) throw TableError("no temp directory: " + ec.message());
        std::random_device rd;
        std::mt19937_64 gen((uint64_t(rd()) << 32) ^ rd() ^ uint64_t(_getpid()));
        char name[32];
        std::snprintf(name, sizeof name, "%016llx", static_cast<unsigned long long>(gen()));
        path_ = base / "SmartMarkup" / name;
        fs::create_directories(path_, ec);
        if (ec) throw TableError("cannot create temp directory: " + ec.message());
    }
    ~TempDir() {
        std::error_code ec;
        fs::remove_all(path_, ec);
    }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;
    fs::path File(const std::string& name) const { return path_ / name; }

private:
    fs::path path_;
};

// Path as a SQL string literal body (forward slashes, quotes doubled).
std::string SqlPath(const fs::path& p) {
    std::string s = p.generic_u8string();
    std::string out;
    for (char c : s) {
        if (c == '\'') out += '\'';
        out += c;
    }
    return out;
}

void WriteFile(const fs::path& p, const std::vector<uint8_t>& bytes) {
    std::ofstream out(p, std::ios::binary);
    out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    out.close();
    if (!out) throw TableError("cannot write temp file " + p.string());
}

std::vector<uint8_t> ReadFileBytes(const fs::path& p) {
    std::ifstream in(p, std::ios::binary);
    if (!in) throw TableError("cannot read temp file " + p.string());
    return std::vector<uint8_t>(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

class Result {
public:
    ~Result() { duckdb_destroy_result(&r_); }
    duckdb_result* get() { return &r_; }
    idx_t rows() { return duckdb_row_count(&r_); }
    std::string Str(idx_t col, idx_t row) {
        char* v = duckdb_value_varchar(&r_, col, row);
        if (!v) return {};
        std::string s(v);
        duckdb_free(v);
        return s;
    }
    int64_t Int(idx_t col, idx_t row) { return duckdb_value_int64(&r_, col, row); }
    double Dbl(idx_t col, idx_t row) { return duckdb_value_double(&r_, col, row); }
    bool Null(idx_t col, idx_t row) { return duckdb_value_is_null(&r_, col, row); }

private:
    duckdb_result r_{};
};

class Db {
public:
    Db() {
        if (duckdb_open(nullptr, &db_) != DuckDBSuccess) throw TableError("duckdb_open failed");
        if (duckdb_connect(db_, &con_) != DuckDBSuccess) {
            duckdb_close(&db_);
            throw TableError("duckdb_connect failed");
        }
    }
    ~Db() {
        duckdb_disconnect(&con_);
        duckdb_close(&db_);
    }
    Db(const Db&) = delete;
    Db& operator=(const Db&) = delete;
    duckdb_connection con() { return con_; }

    void Exec(const std::string& sql, Result& res) {
        if (duckdb_query(con_, sql.c_str(), res.get()) != DuckDBSuccess) {
            const char* e = duckdb_result_error(res.get());
            throw TableError(std::string("DuckDB: ") + (e ? e : "unknown error"));
        }
    }
    void Exec(const std::string& sql) {
        Result r;
        Exec(sql, r);
    }

private:
    duckdb_database db_{};
    duckdb_connection con_{};
};

// Writes the named attachment to the temp dir; returns the SQL path literal body.
std::string Stage(const TempDir& dir, const Attachments& a, const std::string& name) {
    auto it = a.find(name);
    if (it == a.end()) throw TableError("missing attachment " + name);
    fs::path p = dir.File(name);
    WriteFile(p, it->second);
    return SqlPath(p);
}

std::string Vc(const char* col) { return std::string("COALESCE(CAST(\"") + col + "\" AS VARCHAR),'')"; }

}  // namespace

bool IsEnhanced(const Attachments& attachments) { return attachments.count("elements.parquet") != 0; }

ModelData ReadModel(const Attachments& attachments) {
    try {
        TempDir dir;
        Db db;
        ModelData m;
        {
            std::string p = Stage(dir, attachments, "elements.parquet");
            Result r;
            db.Exec("SELECT " + Vc("ElementKey") + "," + "COALESCE(CAST(\"ElementId\" AS BIGINT),0)," + Vc("Category") +
                        "," + Vc("Name") + "," + Vc("Family") + "," + Vc("Type") + "," + Vc("TypeKey") +
                        " FROM read_parquet('" + p + "')",
                    r);
            m.elements.reserve(r.rows());
            for (idx_t i = 0; i < r.rows(); ++i)
                m.elements.push_back({r.Str(0, i), r.Int(1, i), r.Str(2, i), r.Str(3, i), r.Str(4, i), r.Str(5, i),
                                      r.Str(6, i)});
        }
        {
            std::string p = Stage(dir, attachments, "parameters.parquet");
            Result r;
            db.Exec("SELECT " + Vc("OwnerKey") + "," + Vc("Scope") + "," + Vc("Name") + "," + Vc("DisplayValue") +
                        " FROM read_parquet('" + p + "')",
                    r);
            m.parameters.reserve(r.rows());
            for (idx_t i = 0; i < r.rows(); ++i) m.parameters.push_back({r.Str(0, i), r.Str(1, i), r.Str(2, i), r.Str(3, i)});
        }
        {
            std::string p = Stage(dir, attachments, "appearances.parquet");
            Result r;
            db.Exec("SELECT " + Vc("DrawingId") + "," + Vc("ElementKey") + " FROM read_parquet('" + p + "')", r);
            m.appearances.reserve(r.rows());
            for (idx_t i = 0; i < r.rows(); ++i) m.appearances.push_back({r.Str(0, i), r.Str(1, i)});
        }
        {
            std::string p = Stage(dir, attachments, "drawings.parquet");
            Result r;
            db.Exec("SELECT " + Vc("DrawingId") + ",CAST(\"ParentDrawingId\" AS VARCHAR)," + Vc("Name") + "," +
                        Vc("Kind") + ",COALESCE(CAST(\"Page\" AS INTEGER),1) FROM read_parquet('" + p + "')",
                    r);
            for (idx_t i = 0; i < r.rows(); ++i) {
                DrawingRow d;
                d.drawingId = r.Str(0, i);
                if (!r.Null(1, i)) d.parentDrawingId = r.Str(1, i);
                d.name = r.Str(2, i);
                d.kind = r.Str(3, i);
                d.page = static_cast<int>(r.Int(4, i));
                m.drawings.push_back(std::move(d));
            }
        }
        return m;
    } catch (const TableError&) {
        throw;
    } catch (const std::exception& e) {
        throw TableError(std::string("ReadModel: ") + e.what());
    }
}

AnnotationState ReadAnnotations(const Attachments& attachments) {
    try {
        AnnotationState s;
        TempDir dir;
        Db db;
        if (attachments.count("annotations.parquet")) {
            std::string p = Stage(dir, attachments, "annotations.parquet");
            std::string src = "read_parquet('" + p + "')";
            std::set<std::string> cols;
            {
                Result d;
                db.Exec("DESCRIBE SELECT * FROM " + src, d);
                for (idx_t i = 0; i < d.rows(); ++i) cols.insert(d.Str(0, i));
            }
            auto str = [&](const char* c) { return cols.count(c) ? Vc(c) : std::string("''"); };
            auto num = [&](const char* c, const char* type, const char* dflt) {
                return cols.count(c) ? std::string("COALESCE(CAST(\"") + c + "\" AS " + type + ")," + dflt + ")"
                                     : std::string(dflt);
            };
            std::string rect[4];
            for (int k = 0; k < 4; ++k)
                rect[k] = cols.count("SheetRect")
                              ? "COALESCE(CAST(CAST(\"SheetRect\" AS DOUBLE[])[" + std::to_string(k + 1) + "] AS DOUBLE),0)"
                              : "0";
            Result r;
            db.Exec("SELECT " + str("AnnotationId") + "," + str("DrawingId") + "," + num("Page", "INTEGER", "1") + "," +
                        str("Kind") + "," + str("Subtype") + "," + str("Text") + "," + str("Author") + "," +
                        str("Status") + "," + str("CreatedUtc") + "," + str("ModifiedUtc") + "," + rect[0] + "," +
                        rect[1] + "," + rect[2] + "," + rect[3] + "," +
                        num("SchemaVersion", "INTEGER", std::to_string(kSchemaVersion).c_str()) + " FROM " + src,
                    r);
            for (idx_t i = 0; i < r.rows(); ++i) {
                AnnotationRow a;
                a.annotationId = r.Str(0, i);
                a.drawingId = r.Str(1, i);
                a.page = static_cast<int32_t>(r.Int(2, i));
                a.kind = r.Str(3, i);
                a.subtype = r.Str(4, i);
                a.text = r.Str(5, i);
                a.author = r.Str(6, i);
                a.status = r.Str(7, i);
                a.createdUtc = r.Str(8, i);
                a.modifiedUtc = r.Str(9, i);
                for (int k = 0; k < 4; ++k) a.sheetRect[k] = r.Dbl(10 + k, i);
                a.schemaVersion = static_cast<int32_t>(r.Int(14, i));
                s.annotations.push_back(std::move(a));
            }
        }
        if (attachments.count("annotation-links.parquet")) {
            std::string p = Stage(dir, attachments, "annotation-links.parquet");
            Result r;
            db.Exec("SELECT " + Vc("AnnotationId") + "," + Vc("ElementKey") + ",COALESCE(CAST(\"ElementId\" AS BIGINT),0)," +
                        Vc("Relation") + " FROM read_parquet('" + p + "')",
                    r);
            for (idx_t i = 0; i < r.rows(); ++i)
                s.links.push_back({r.Str(0, i), r.Str(1, i), r.Int(2, i), r.Str(3, i)});
        }
        return s;
    } catch (const TableError&) {
        throw;
    } catch (const std::exception& e) {
        throw TableError(std::string("ReadAnnotations: ") + e.what());
    }
}

namespace {

class Appender {
public:
    Appender(Db& db, const char* table) {
        if (duckdb_appender_create(db.con(), nullptr, table, &app_) != DuckDBSuccess) {
            std::string msg = Error();
            duckdb_appender_destroy(&app_);
            throw TableError("appender: " + msg);
        }
    }
    ~Appender() {
        if (app_) duckdb_appender_destroy(&app_);
    }
    Appender(const Appender&) = delete;
    Appender& operator=(const Appender&) = delete;

    void Begin() { Check(duckdb_appender_begin_row(app_)); }
    void End() { Check(duckdb_appender_end_row(app_)); }
    void Str(const std::string& s) { Check(duckdb_append_varchar_length(app_, s.data(), s.size())); }
    void I32(int32_t v) { Check(duckdb_append_int32(app_, v)); }
    void I64(int64_t v) { Check(duckdb_append_int64(app_, v)); }
    void Dbl(double v) { Check(duckdb_append_double(app_, v)); }
    void Close() {
        Check(duckdb_appender_close(app_));
    }

private:
    std::string Error() {
        const char* e = duckdb_appender_error(app_);
        return e ? e : "unknown error";
    }
    void Check(duckdb_state st) {
        if (st != DuckDBSuccess) throw TableError("appender: " + Error());
    }
    duckdb_appender app_ = nullptr;
};

std::vector<uint8_t> CopyOut(Db& db, const std::string& select) {
    TempDir dir;
    fs::path out = dir.File("out.parquet");
    db.Exec("COPY (" + select + ") TO '" + SqlPath(out) + "' (FORMAT PARQUET, COMPRESSION GZIP)");
    return ReadFileBytes(out);
}

}  // namespace

std::vector<uint8_t> WriteAnnotationsParquet(const std::vector<AnnotationRow>& rows) {
    try {
        Db db;
        db.Exec(
            "CREATE TABLE stage(idx BIGINT, AnnotationId VARCHAR, DrawingId VARCHAR, Page INTEGER, Kind VARCHAR,"
            " Subtype VARCHAR, Text VARCHAR, Author VARCHAR, Status VARCHAR, CreatedUtc VARCHAR, ModifiedUtc VARCHAR,"
            " r0 DOUBLE, r1 DOUBLE, r2 DOUBLE, r3 DOUBLE, SchemaVersion INTEGER)");
        {
            Appender ap(db, "stage");
            int64_t idx = 0;
            for (const auto& a : rows) {
                ap.Begin();
                ap.I64(idx++);
                ap.Str(a.annotationId);
                ap.Str(a.drawingId);
                ap.I32(a.page);
                ap.Str(a.kind);
                ap.Str(a.subtype);
                ap.Str(a.text);
                ap.Str(a.author);
                ap.Str(a.status);
                ap.Str(a.createdUtc);
                ap.Str(a.modifiedUtc);
                for (double d : a.sheetRect) ap.Dbl(d);
                ap.I32(a.schemaVersion);
                ap.End();
            }
            ap.Close();
        }
        auto n = [](const char* c) { return std::string("NULLIF(") + c + ",'') AS " + c; };
        return CopyOut(db, "SELECT " + n("AnnotationId") + "," + n("DrawingId") + ",Page," + n("Kind") + "," + n("Subtype") +
                               "," + n("Text") + "," + n("Author") + "," + n("Status") + "," + n("CreatedUtc") + "," +
                               n("ModifiedUtc") +
                               ",CAST([r0,r1,r2,r3] AS DOUBLE[]) AS SheetRect,SchemaVersion FROM stage ORDER BY idx");
    } catch (const TableError&) {
        throw;
    } catch (const std::exception& e) {
        throw TableError(std::string("WriteAnnotationsParquet: ") + e.what());
    }
}

std::vector<uint8_t> WriteLinksParquet(const std::vector<LinkRow>& rows) {
    try {
        Db db;
        db.Exec("CREATE TABLE stage(idx BIGINT, AnnotationId VARCHAR, ElementKey VARCHAR, ElementId BIGINT, Relation VARCHAR)");
        {
            Appender ap(db, "stage");
            int64_t idx = 0;
            for (const auto& l : rows) {
                ap.Begin();
                ap.I64(idx++);
                ap.Str(l.annotationId);
                ap.Str(l.elementKey);
                ap.I64(l.elementId);
                ap.Str(l.relation);
                ap.End();
            }
            ap.Close();
        }
        auto n = [](const char* c) { return std::string("NULLIF(") + c + ",'') AS " + c; };
        return CopyOut(db, "SELECT " + n("AnnotationId") + "," + n("ElementKey") + ",ElementId," + n("Relation") +
                               " FROM stage ORDER BY idx");
    } catch (const TableError&) {
        throw;
    } catch (const std::exception& e) {
        throw TableError(std::string("WriteLinksParquet: ") + e.what());
    }
}

}  // namespace sm
