#include "attachments.h"

#include <map>
#include <string>
#include <vector>

#include "log.h"

namespace {

constexpr int kMaxTreeDepth = 32;  // guards against cyclic or absurd /Kids chains

std::string StringBytes(CosObj obj) {
    ASTCount n = 0;
    const char* p = CosStringValue(obj, &n);
    return (p && n > 0) ? std::string(p, static_cast<size_t>(n)) : std::string();
}

std::vector<uint8_t> StreamBytes(CosObj stream) {
    std::vector<uint8_t> bytes;
    ASStm stm = CosStreamOpenStm(stream, cosOpenFiltered);
    char buffer[64 * 1024];
    for (;;) {
        ASTCount n = ASStmRead(buffer, 1, sizeof buffer, stm);
        if (n <= 0) break;
        bytes.insert(bytes.end(), buffer, buffer + n);
    }
    ASStmClose(stm);
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
void CollectNames(CosObj node, int depth, std::map<std::string, CosObj>& out) {
    if (depth > kMaxTreeDepth || CosObjGetType(node) != CosDict) return;
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
        for (ASTArraySize i = 0; i < n; ++i) CollectNames(CosArrayGet(kids, i), depth + 1, out);
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
    if (CosObjGetType(names) == CosDict) CollectNames(CosDictGetKeyString(names, "EmbeddedFiles"), 0, specs);
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
    for (const auto& [key, spec] : ExistingFilespecs(PDDocGetCosDoc(doc))) {
        CosObj stream = EmbeddedStream(spec);
        if (CosObjGetType(stream) == CosStream) files.emplace(key, StreamBytes(stream));
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
