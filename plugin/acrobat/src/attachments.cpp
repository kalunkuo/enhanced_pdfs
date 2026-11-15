#include "attachments.h"

#include <algorithm>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "log.h"
#include "sdk_call.h"

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
    std::set<std::pair<CosID, CosGeneration>> visited;  // indirect (id, generation) already seen
    size_t nodes = 0;
    bool truncated = false;  // a cap was hit or an entry could not be carried over: the result is incomplete
};

CosType TypeOf(CosObj obj) { return Sdk(CosObjGetType, obj); }

CosObj Get(CosObj dict, const char* key) { return Sdk(CosDictGetKeyString, dict, key); }

std::string StringBytes(CosObj obj) {
    ASTCount n = 0;
    const char* p = Sdk(CosStringValue, obj, &n);
    return (p && n > 0) ? std::string(p, static_cast<size_t>(n)) : std::string();
}

// Closes an ASStm on every path, including an AcroError thrown while it is open.
class StmCloser {
public:
    explicit StmCloser(ASStm stm) : stm_(stm) {}
    ~StmCloser() {
        if (stm_) SdkNoThrow(ASStmClose, stm_);
    }
    StmCloser(const StmCloser&) = delete;
    StmCloser& operator=(const StmCloser&) = delete;

private:
    ASStm stm_;
};

// Decodes a stream, refusing more than `limit` bytes (throws; the caller's operation fails).
std::vector<uint8_t> StreamBytes(CosObj stream, size_t limit) {
    std::vector<uint8_t> bytes;
    std::vector<char> buffer(64 * 1024);
    ASStm stm = Sdk(CosStreamOpenStm, stream, cosOpenFiltered);
    StmCloser closer(stm);
    for (;;) {
        ASTCount n = Sdk(ASStmRead, buffer.data(), static_cast<ASTArraySize>(1),
                         static_cast<ASTCount>(buffer.size()), stm);
        if (n <= 0) break;
        if (bytes.size() + static_cast<size_t>(n) > limit) throw std::runtime_error("attachment exceeds the decode limit");
        bytes.insert(bytes.end(), buffer.data(), buffer.data() + n);
    }
    return bytes;
}

// Embedded file stream of a filespec (/EF /F, else /EF /UF); CosNull if none.
CosObj EmbeddedStream(CosObj filespec) {
    if (TypeOf(filespec) != CosDict) return Sdk(CosNewNull);
    CosObj ef = Get(filespec, "EF");
    if (TypeOf(ef) != CosDict) return Sdk(CosNewNull);
    CosObj f = Get(ef, "F");
    if (TypeOf(f) != CosStream) f = Get(ef, "UF");
    return TypeOf(f) == CosStream ? f : Sdk(CosNewNull);
}

// Collects key -> filespec from a name-tree node (first occurrence of a key wins).
// Anything that cannot be carried over exactly marks the walk truncated, so WriteAttachments refuses to
// rebuild the tree from an incomplete list (it would silently drop entries). A failed Cos read throws
// AcroError, which fails the whole read/write the same way.
void CollectNames(CosObj node, int depth, std::map<std::string, CosObj>& out, TreeWalk& walk) {
    if (TypeOf(node) != CosDict) {
        walk.truncated = true;
        return;
    }
    if (depth > kMaxTreeDepth || ++walk.nodes > kMaxTreeNodes) {
        walk.truncated = true;
        return;
    }
    if (Sdk(CosObjIsIndirect, node) &&
        !walk.visited.emplace(Sdk(CosObjGetID, node), Sdk(CosObjGetGeneration, node)).second)
        return;  // shared or cyclic /Kids entry: visit each node once
    CosObj names = Get(node, "Names");
    if (TypeOf(names) == CosArray) {
        ASTArraySize n = Sdk(CosArrayLength, names);
        for (ASTArraySize i = 0; i + 1 < n; i += 2) {
            CosObj key = Sdk(CosArrayGet, names, i);
            if (TypeOf(key) != CosString) {
                walk.truncated = true;
                continue;
            }
            std::string k = StringBytes(key);
            if (out.count(k)) {
                walk.truncated = true;  // duplicate key: a flat rebuild would drop one of them
                continue;
            }
            out.emplace(std::move(k), Sdk(CosArrayGet, names, i + 1));
        }
    }
    CosObj kids = Get(node, "Kids");
    if (TypeOf(kids) == CosArray) {
        ASTArraySize n = Sdk(CosArrayLength, kids);
        for (ASTArraySize i = 0; i < n; ++i) CollectNames(Sdk(CosArrayGet, kids, i), depth + 1, out, walk);
    }
}

CosObj NamesDict(CosDoc cos, bool create) {
    CosObj root = Sdk(CosDocGetRoot, cos);
    CosObj names = Get(root, "Names");
    if (TypeOf(names) == CosDict || !create) return names;
    names = Sdk(CosNewDict, cos, static_cast<ASBool>(false), static_cast<ASTArraySize>(1));
    Sdk(CosDictPutKeyString, root, "Names", names);
    return names;
}

std::map<std::string, CosObj> ExistingFilespecs(CosDoc cos) {
    std::map<std::string, CosObj> specs;
    CosObj names = NamesDict(cos, false);
    TreeWalk walk;
    if (TypeOf(names) == CosDict) {
        CosObj tree = Get(names, "EmbeddedFiles");
        if (TypeOf(tree) != CosNull) CollectNames(tree, 0, specs, walk);  // absent: no attachments
    }
    // An incomplete list must never be used: rebuilding the tree from it would drop attachments.
    if (walk.truncated) throw std::runtime_error("attachment name tree cannot be carried over exactly");
    return specs;
}

CosObj NewString(CosDoc cos, const std::string& s) {
    return Sdk(CosNewString, cos, static_cast<ASBool>(false), s.data(), static_cast<ASTArraySize>(s.size()));
}

CosObj NewName(CosDoc cos, const char* name) {
    return Sdk(CosNewNameFromString, cos, static_cast<ASBool>(false), name);
}

CosObj NewInteger(CosDoc cos, ASInt32 value) { return Sdk(CosNewInteger, cos, static_cast<ASBool>(false), value); }

CosObj NewFilespec(CosDoc cos, const std::string& name, const std::vector<uint8_t>& data) {
    auto size = static_cast<ASInt32>(data.size());
    CosObj attrs = Sdk(CosNewDict, cos, static_cast<ASBool>(false), static_cast<ASTArraySize>(3));
    Sdk(CosDictPutKeyString, attrs, "Length", NewInteger(cos, size));
    CosObj stream;
    {
        ASStm source = Sdk(ASMemStmRdOpen, reinterpret_cast<const char*>(data.data()),
                           static_cast<ASArraySize>(data.size()));
        StmCloser closer(source);
        stream = Sdk(CosNewStream, cos, static_cast<ASBool>(true), source, static_cast<CosStreamStartAndCode>(0),
                     static_cast<ASBool>(false), attrs, Sdk(CosNewNull), static_cast<CosByteMax>(size));
    }

    CosObj streamDict = Sdk(CosStreamDict, stream);
    Sdk(CosDictPutKeyString, streamDict, "Type", NewName(cos, "EmbeddedFile"));
    CosObj params = Sdk(CosNewDict, cos, static_cast<ASBool>(false), static_cast<ASTArraySize>(1));
    Sdk(CosDictPutKeyString, params, "Size", NewInteger(cos, size));
    Sdk(CosDictPutKeyString, streamDict, "Params", params);

    CosObj ef = Sdk(CosNewDict, cos, static_cast<ASBool>(false), static_cast<ASTArraySize>(1));
    Sdk(CosDictPutKeyString, ef, "F", stream);
    CosObj spec = Sdk(CosNewDict, cos, static_cast<ASBool>(true), static_cast<ASTArraySize>(4));
    Sdk(CosDictPutKeyString, spec, "Type", NewName(cos, "Filespec"));
    Sdk(CosDictPutKeyString, spec, "F", NewString(cos, name));
    Sdk(CosDictPutKeyString, spec, "UF", NewString(cos, name));
    Sdk(CosDictPutKeyString, spec, "EF", ef);
    return spec;
}

}  // namespace

sm::Attachments ReadAttachments(PDDoc doc) {
    sm::Attachments files;
    std::map<std::string, CosObj> specs = ExistingFilespecs(Sdk(PDDocGetCosDoc, doc));
    if (!specs.count("elements.parquet")) return files;  // not enhanced: decode nothing
    size_t total = 0;
    for (const auto& [key, spec] : specs) {
        if (!kTables.count(key)) continue;
        CosObj stream = EmbeddedStream(spec);
        if (TypeOf(stream) != CosStream) continue;
        std::vector<uint8_t> bytes = StreamBytes(stream, std::min(kMaxStreamBytes, kMaxTotalBytes - total));
        total += bytes.size();
        files.emplace(key, std::move(bytes));
    }
    return files;
}

void WriteAttachments(PDDoc doc, const sm::Attachments& replaceOrAdd) {
    CosDoc cos = Sdk(PDDocGetCosDoc, doc);
    std::map<std::string, CosObj> specs = ExistingFilespecs(cos);  // std::map: keys sorted byte-wise

    // Untouched direct filespecs belong to the old tree's arrays; copy the dict (not its indirect stream)
    // so it can live in the new array.
    for (auto& [key, spec] : specs)
        if (!replaceOrAdd.count(key) && !Sdk(CosObjIsIndirect, spec))
            spec = Sdk(CosObjCopy, spec, cos, static_cast<ASBool>(false));
    for (const auto& [key, data] : replaceOrAdd) specs[key] = NewFilespec(cos, key, data);

    CosObj array = Sdk(CosNewArray, cos, static_cast<ASBool>(false), static_cast<ASTArraySize>(specs.size() * 2));
    ASTArraySize i = 0;
    for (const auto& [key, spec] : specs) {
        Sdk(CosArrayPut, array, i++, NewString(cos, key));
        Sdk(CosArrayPut, array, i++, spec);
    }
    CosObj tree = Sdk(CosNewDict, cos, static_cast<ASBool>(true), static_cast<ASTArraySize>(1));
    Sdk(CosDictPutKeyString, tree, "Names", array);
    Sdk(CosDictPutKeyString, NamesDict(cos, true), "EmbeddedFiles", tree);
    LogLine("attachments: wrote name tree with %zu files (%zu replaced/added)", specs.size(), replaceOrAdd.size());
}
