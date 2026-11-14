#include "attachments.h"

#include <algorithm>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "log.h"

namespace {

// PDFs come from outside: bound every walk and every decode so a crafted file cannot hang Acrobat.
constexpr int kMaxTreeDepth = 32;                         // /Kids nesting
constexpr size_t kMaxTreeNodes = 10000;                   // total name-tree nodes visited (shared /Kids)
constexpr size_t kMaxStreamBytes = 64u * 1024 * 1024;     // one decoded attachment
constexpr size_t kMaxTotalBytes = 256u * 1024 * 1024;     // all decoded attachments together

// Only these attachments are ever decoded; anything else in the PDF is left alone.
const std::set<std::string> kTables = {"elements.parquet",    "parameters.parquet",  "appearances.parquet",
                                       "drawings.parquet",    "annotations.parquet", "annotation-links.parquet"};

struct TreeWalk {
    std::set<std::pair<ASInt32, ASInt32>> visited;  // indirect (id, generation) already seen
    size_t nodes = 0;
    bool truncated = false;  // a cap was hit: the result is incomplete
};

std::string StringBytes(CosObj obj) {
    ASTCount n = 0;
    const char* p = CosStringValue(obj, &n);
    return (p && n > 0) ? std::string(p, static_cast<size_t>(n)) : std::string();
}

// Decodes a stream, refusing more than `limit` bytes (throws; caller makes the document inert).
std::vector<uint8_t> StreamBytes(CosObj stream, size_t limit) {
    std::vector<uint8_t> bytes;
    ASStm stm = CosStreamOpenStm(stream, cosOpenFiltered);
    char buffer[64 * 1024];
    bool tooBig = false;
    for (;;) {
        ASTCount n = ASStmRead(buffer, 1, sizeof buffer, stm);
        if (n <= 0) break;
        if (bytes.size() + static_cast<size_t>(n) > limit) {
            tooBig = true;
            break;
        }
        bytes.insert(bytes.end(), buffer, buffer + n);
    }
    ASStmClose(stm);
    if (tooBig) throw std::runtime_error("attachment exceeds the decode limit");
    return bytes;
}

// Embedded file stream of a filespec (/EF /F, else /EF /UF); CosNull if none.
CosObj EmbeddedStream(CosObj filespec) {
    if (CosObjGetType(filespec) != CosDict) return CosNewNull();
    CosObj ef = CosDictGetKeyString(filespec, "EF");
    if (CosObjGetType(ef) != CosDict) return CosNewNull();
    CosObj f = CosDictGetKeyString(ef, "F");
    if (CosObjGetType(f) != CosStream) f = CosDictGetKeyString(ef, "UF");
    return CosObjGetType(f) == CosStream ? f : CosNewNull();
}

// Collects key -> filespec from a name-tree node (first occurrence of a key wins).
void CollectNames(CosObj node, int depth, std::map<std::string, CosObj>& out, TreeWalk& walk) {
    if (CosObjGetType(node) != CosDict) return;
    if (depth > kMaxTreeDepth || ++walk.nodes > kMaxTreeNodes) {
        walk.truncated = true;
        return;
    }
    if (CosObjIsIndirect(node) && !walk.visited.emplace(CosObjGetID(node), CosObjGetGeneration(node)).second)
        return;  // shared or cyclic /Kids entry: visit each node once
    CosObj names = CosDictGetKeyString(node, "Names");
    if (CosObjGetType(names) == CosArray) {
        ASTArraySize n = CosArrayLength(names);
        for (ASTArraySize i = 0; i + 1 < n; i += 2) {
            CosObj key = CosArrayGet(names, i);
            if (CosObjGetType(key) != CosString) continue;
            out.emplace(StringBytes(key), CosArrayGet(names, i + 1));
        }
    }
    CosObj kids = CosDictGetKeyString(node, "Kids");
    if (CosObjGetType(kids) == CosArray) {
        ASTArraySize n = CosArrayLength(kids);
        for (ASTArraySize i = 0; i < n; ++i) CollectNames(CosArrayGet(kids, i), depth + 1, out, walk);
    }
}

CosObj NamesDict(CosDoc cos, bool create) {
    CosObj root = CosDocGetRoot(cos);
    CosObj names = CosDictGetKeyString(root, "Names");
    if (CosObjGetType(names) == CosDict || !create) return names;
    names = CosNewDict(cos, false, 1);
    CosDictPutKeyString(root, "Names", names);
    return names;
}

std::map<std::string, CosObj> ExistingFilespecs(CosDoc cos) {
    std::map<std::string, CosObj> specs;
    CosObj names = NamesDict(cos, false);
    TreeWalk walk;
    if (CosObjGetType(names) == CosDict) CollectNames(CosDictGetKeyString(names, "EmbeddedFiles"), 0, specs, walk);
    // An incomplete list must never be used: rebuilding the tree from it would drop attachments.
    if (walk.truncated) throw std::runtime_error("attachment name tree exceeds the walk limits");
    return specs;
}

CosObj NewFilespec(CosDoc cos, const std::string& name, const std::vector<uint8_t>& data) {
    auto size = static_cast<ASInt32>(data.size());
    CosObj attrs = CosNewDict(cos, false, 3);
    CosDictPutKeyString(attrs, "Length", CosNewInteger(cos, false, size));
    ASStm source = ASMemStmRdOpen(reinterpret_cast<const char*>(data.data()), static_cast<ASArraySize>(data.size()));
    CosObj stream = CosNewStream(cos, true, source, 0, false, attrs, CosNewNull(), size);
    ASStmClose(source);

    CosObj streamDict = CosStreamDict(stream);
    CosDictPutKeyString(streamDict, "Type", CosNewNameFromString(cos, false, "EmbeddedFile"));
    CosObj params = CosNewDict(cos, false, 1);
    CosDictPutKeyString(params, "Size", CosNewInteger(cos, false, size));
    CosDictPutKeyString(streamDict, "Params", params);

    CosObj ef = CosNewDict(cos, false, 1);
    CosDictPutKeyString(ef, "F", stream);
    CosObj spec = CosNewDict(cos, true, 4);
    CosDictPutKeyString(spec, "Type", CosNewNameFromString(cos, false, "Filespec"));
    auto len = static_cast<ASTArraySize>(name.size());
    CosDictPutKeyString(spec, "F", CosNewString(cos, false, name.data(), len));
    CosDictPutKeyString(spec, "UF", CosNewString(cos, false, name.data(), len));
    CosDictPutKeyString(spec, "EF", ef);
    return spec;
}

}  // namespace

sm::Attachments ReadAttachments(PDDoc doc) {
    sm::Attachments files;
    std::map<std::string, CosObj> specs = ExistingFilespecs(PDDocGetCosDoc(doc));
    if (!specs.count("elements.parquet")) return files;  // not enhanced: decode nothing
    size_t total = 0;
    for (const auto& [key, spec] : specs) {
        if (!kTables.count(key)) continue;
        CosObj stream = EmbeddedStream(spec);
        if (CosObjGetType(stream) != CosStream) continue;
        std::vector<uint8_t> bytes = StreamBytes(stream, std::min(kMaxStreamBytes, kMaxTotalBytes - total));
        total += bytes.size();
        files.emplace(key, std::move(bytes));
    }
    return files;
}

void WriteAttachments(PDDoc doc, const sm::Attachments& replaceOrAdd) {
    CosDoc cos = PDDocGetCosDoc(doc);
    std::map<std::string, CosObj> specs = ExistingFilespecs(cos);  // std::map: keys sorted byte-wise

    // Untouched direct filespecs belong to the old tree's arrays; copy the dict (not its indirect stream)
    // so it can live in the new array.
    for (auto& [key, spec] : specs)
        if (!replaceOrAdd.count(key) && !CosObjIsIndirect(spec)) spec = CosObjCopy(spec, cos, false);
    for (const auto& [key, data] : replaceOrAdd) specs[key] = NewFilespec(cos, key, data);

    CosObj array = CosNewArray(cos, false, static_cast<ASTArraySize>(specs.size() * 2));
    ASTArraySize i = 0;
    for (const auto& [key, spec] : specs) {
        CosArrayPut(array, i++, CosNewString(cos, false, key.data(), static_cast<ASTArraySize>(key.size())));
        CosArrayPut(array, i++, spec);
    }
    CosObj tree = CosNewDict(cos, true, 1);
    CosDictPutKeyString(tree, "Names", array);
    CosDictPutKeyString(NamesDict(cos, true), "EmbeddedFiles", tree);
    LogLine("attachments: wrote name tree with %zu files (%zu replaced/added)", specs.size(), replaceOrAdd.size());
}
