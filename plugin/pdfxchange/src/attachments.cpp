#include "attachments.h"

#include <shlwapi.h>

#include <algorithm>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "com_ptr.h"
#include "log.h"

#pragma comment(lib, "shlwapi.lib")

namespace {

// PDFs come from outside: bound every walk and every decode so a crafted file cannot hang the Editor.
constexpr int kMaxTreeDepth = 32;                      // /Kids nesting
constexpr size_t kMaxTreeNodes = 10000;                // total name-tree nodes visited (shared /Kids)
constexpr size_t kMaxStreamBytes = 64u * 1024 * 1024;  // one decoded attachment
constexpr size_t kMaxTotalBytes = 256u * 1024 * 1024;  // all decoded attachments together

// Only these attachments are ever decoded; anything else in the PDF is left alone.
const std::set<std::string> kTables = {"elements.parquet",    "parameters.parquet",  "appearances.parquet",
                                       "drawings.parquet",    "annotations.parquet", "annotation-links.parquet"};

// IPXS_DecodeFilter::Decode returns this (with 0 bytes) once the stream is exhausted (observed, 10.8.4).
constexpr HRESULT kDecodeEndOfData = static_cast<HRESULT>(0x8214001B);

using Var = ComPtr<IPXS_PDFVariant>;

struct TreeWalk {
    std::set<std::pair<ULONG_T, ULONG_T>> visited;  // indirect (number, generation) already seen
    size_t nodes = 0;
    bool truncated = false;  // a cap was hit: the result is incomplete
};

void Check(HRESULT hr, const char* what) {
    if (FAILED(hr)) {
        char buf[160];
        snprintf(buf, sizeof buf, "%s failed (hr=0x%08lx)", what, static_cast<unsigned long>(hr));
        throw std::runtime_error(buf);
    }
}

PXS_PDFVariantType TypeOf(IPXS_PDFVariant* v) {
    PXS_PDFVariantType t = PVT_INVALID;
    if (v) v->get_Type(&t);
    return t;
}

// Dictionary entry, or empty if absent.
Var Get(IPXS_PDFVariant* dict, const wchar_t* key) {
    Var out;
    PXS_PDFVariantType t = TypeOf(dict);
    if (t == PVT_Dictionary || t == PVT_Stream)
        if (FAILED(dict->Dict_Get(const_cast<LPWSTR>(key), out.Put()))) out.Reset();
    return out;
}

std::string StringBytes(IPXS_PDFVariant* v) {
    ULONG_T n = 0;
    unsigned char* p = nullptr;
    if (TypeOf(v) != PVT_String || FAILED(v->GetString_Unsafe(&n, &p)) || !p || n == 0) return std::string();
    return std::string(reinterpret_cast<const char*>(p), n);
}

// Decodes a stream, refusing more than `limit` bytes.
std::vector<uint8_t> StreamBytes(IPXS_PDFVariant* stream, size_t limit) {
    ComPtr<IPXS_DecodeFilter> decoder;
    Check(stream->Stream_CreateDecoder(0, DecodeDepth_All, decoder.Put()), "Stream_CreateDecoder");
    std::vector<uint8_t> bytes;
    std::vector<unsigned char> buffer(64 * 1024);
    for (;;) {
        ULONG_T n = 0;
        HRESULT hr = decoder->Decode(buffer.data(), static_cast<ULONG_T>(buffer.size()), &n);
        if (hr == kDecodeEndOfData && n == 0) break;
        Check(hr, "Decode");
        if (n == 0) break;
        if (bytes.size() + n > limit) throw std::runtime_error("attachment exceeds the decode limit");
        bytes.insert(bytes.end(), buffer.data(), buffer.data() + n);
        if (hr == S_FALSE) break;
    }
    return bytes;
}

// Embedded file stream of a filespec (/EF /F, else /EF /UF); empty if none.
Var EmbeddedStream(IPXS_PDFVariant* filespec) {
    if (TypeOf(filespec) != PVT_Dictionary) return Var();
    Var ef = Get(filespec, L"EF");
    if (TypeOf(ef.Get()) != PVT_Dictionary) return Var();
    Var f = Get(ef.Get(), L"F");
    if (TypeOf(f.Get()) != PVT_Stream) f = Get(ef.Get(), L"UF");
    return TypeOf(f.Get()) == PVT_Stream ? std::move(f) : Var();
}

// Collects key -> filespec from a name-tree node (first occurrence of a key wins).
void CollectNames(IPXS_PDFVariant* node, int depth, std::map<std::string, Var>& out, TreeWalk& walk) {
    if (TypeOf(node) != PVT_Dictionary) return;
    if (depth > kMaxTreeDepth || ++walk.nodes > kMaxTreeNodes) {
        walk.truncated = true;
        return;
    }
    VARIANT_BOOL indirect = VARIANT_FALSE;
    node->get_IsIndirect(&indirect);
    if (indirect) {
        ULONG_T num = 0, gen = 0;
        node->get_ObjectNumber(&num);
        node->get_ObjectGeneration(&gen);
        if (!walk.visited.emplace(num, gen).second) return;  // shared or cyclic /Kids entry: visit once
    }
    Var names = Get(node, L"Names");
    if (TypeOf(names.Get()) == PVT_Array) {
        ULONG_T n = 0;
        names->get_Count(&n);
        for (ULONG_T i = 0; i + 1 < n; i += 2) {
            Var key, value;
            if (FAILED(names->get_Item(i, key.Put())) || TypeOf(key.Get()) != PVT_String) continue;
            if (FAILED(names->get_Item(i + 1, value.Put()))) continue;
            std::string k = StringBytes(key.Get());
            if (!out.count(k)) out.emplace(std::move(k), std::move(value));
        }
    }
    Var kids = Get(node, L"Kids");
    if (TypeOf(kids.Get()) == PVT_Array) {
        ULONG_T n = 0;
        kids->get_Count(&n);
        for (ULONG_T i = 0; i < n; ++i) {
            Var kid;
            if (SUCCEEDED(kids->get_Item(i, kid.Put()))) CollectNames(kid.Get(), depth + 1, out, walk);
        }
    }
}

std::map<std::string, Var> ExistingFilespecs(IPXS_Document* cos) {
    std::map<std::string, Var> specs;
    Var root;
    Check(cos->get_Root(root.Put()), "get_Root");
    Var names = Get(root.Get(), L"Names");
    TreeWalk walk;
    if (TypeOf(names.Get()) == PVT_Dictionary) {
        Var tree = Get(names.Get(), L"EmbeddedFiles");
        CollectNames(tree.Get(), 0, specs, walk);
    }
    // An incomplete list must never be used: rebuilding the tree from it would drop attachments.
    if (walk.truncated) throw std::runtime_error("attachment name tree exceeds the walk limits");
    return specs;
}

ComPtr<IPXS_Document> CosOf(IPXC_Document* doc) {
    ComPtr<IPXS_Document> cos;
    Check(doc->get_CosDocument(cos.Put()), "get_CosDocument");
    if (!cos) throw std::runtime_error("no cos document");
    return cos;
}

Var NewFilespec(IPXS_Inst* pxs, IPXS_Document* cos, const std::string& name, const std::vector<uint8_t>& data) {
    Var stream;
    Check(pxs->NewVar_Stream(cos, stream.Put()), "NewVar_Stream");
    IStream* raw = SHCreateMemStream(data.empty() ? nullptr : data.data(), static_cast<UINT>(data.size()));
    if (!raw) throw std::runtime_error("SHCreateMemStream failed");
    PXS_StreamInfo info{};
    info.nType = Stream_Generic;
    HRESULT hr = stream->Stream_SetData(raw, nullptr, &info, 0);
    raw->Release();
    Check(hr, "Stream_SetData");
    Check(stream->Dict_SetName(const_cast<LPWSTR>(L"Type"), const_cast<LPWSTR>(L"EmbeddedFile")), "set /Type");
    Var params;
    Check(pxs->NewVar_Dict(cos, VARIANT_FALSE, params.Put()), "NewVar_Dict");
    Check(params->Dict_SetInt(const_cast<LPWSTR>(L"Size"), static_cast<long>(data.size())), "set /Size");
    Check(stream->Dict_Set(const_cast<LPWSTR>(L"Params"), params.Get(), VARIANT_FALSE), "set /Params");

    Var ef;
    Check(pxs->NewVar_Dict(cos, VARIANT_FALSE, ef.Put()), "NewVar_Dict");
    Check(ef->Dict_Set(const_cast<LPWSTR>(L"F"), stream.Get(), VARIANT_FALSE), "set /EF /F");
    Var spec;
    Check(pxs->NewVar_Dict(cos, VARIANT_TRUE, spec.Put()), "NewVar_Dict");
    Check(spec->Dict_SetName(const_cast<LPWSTR>(L"Type"), const_cast<LPWSTR>(L"Filespec")), "set /Type");
    auto* bytes = reinterpret_cast<unsigned char*>(const_cast<char*>(name.data()));
    auto len = static_cast<ULONG_T>(name.size());
    Check(spec->Dict_SetStringR(reinterpret_cast<unsigned char*>(const_cast<char*>("F")), 1, bytes, len, 0), "set /F");
    Check(spec->Dict_SetStringR(reinterpret_cast<unsigned char*>(const_cast<char*>("UF")), 2, bytes, len, 0), "set /UF");
    Check(spec->Dict_Set(const_cast<LPWSTR>(L"EF"), ef.Get(), VARIANT_FALSE), "set /EF");
    return spec;
}

}  // namespace

sm::Attachments ReadAttachments(IPXC_Document* doc) {
    sm::Attachments files;
    ComPtr<IPXS_Document> cos = CosOf(doc);
    std::map<std::string, Var> specs = ExistingFilespecs(cos.Get());
    if (!specs.count("elements.parquet")) return files;  // not enhanced: decode nothing
    size_t total = 0;
    for (const auto& [key, spec] : specs) {
        if (!kTables.count(key)) continue;
        Var stream = EmbeddedStream(spec.Get());
        if (!stream) continue;
        std::vector<uint8_t> bytes = StreamBytes(stream.Get(), std::min(kMaxStreamBytes, kMaxTotalBytes - total));
        total += bytes.size();
        files.emplace(key, std::move(bytes));
    }
    return files;
}

void WriteAttachments(IPXC_Document* doc, IPXS_Inst* pxs, const sm::Attachments& replaceOrAdd) {
    if (!pxs) throw std::runtime_error("no PXS instance");
    ComPtr<IPXS_Document> cos = CosOf(doc);
    std::map<std::string, Var> specs = ExistingFilespecs(cos.Get());  // std::map: keys sorted byte-wise
    for (const auto& [key, data] : replaceOrAdd) specs[key] = NewFilespec(pxs, cos.Get(), key, data);

    Var array;
    Check(pxs->NewVar_Array(0, cos.Get(), VARIANT_FALSE, array.Put()), "NewVar_Array");
    ULONG_T i = 0;
    for (const auto& [key, spec] : specs) {
        auto* bytes = reinterpret_cast<unsigned char*>(const_cast<char*>(key.data()));
        Check(array->Arr_InsertStringR(bytes, static_cast<ULONG_T>(key.size()), i++), "Arr_InsertStringR");
        // Untouched direct filespecs belong to the old tree's arrays: clone the dict (its /EF stream is
        // indirect and stays shared, so the data is never re-encoded). Indirect ones are referenced.
        VARIANT_BOOL indirect = VARIANT_FALSE;
        spec->get_IsIndirect(&indirect);
        Check(array->Arr_Insert(spec.Get(), i++, indirect ? VARIANT_FALSE : VARIANT_TRUE), "Arr_Insert");
    }
    Var tree;
    Check(pxs->NewVar_Dict(cos.Get(), VARIANT_TRUE, tree.Put()), "NewVar_Dict");
    Check(tree->Dict_Set(const_cast<LPWSTR>(L"Names"), array.Get(), VARIANT_FALSE), "set /Names");

    Var root;
    Check(cos->get_Root(root.Put()), "get_Root");
    Var names = Get(root.Get(), L"Names");
    if (TypeOf(names.Get()) != PVT_Dictionary) {
        Var fresh;
        Check(pxs->NewVar_Dict(cos.Get(), VARIANT_FALSE, fresh.Put()), "NewVar_Dict");
        Check(root->Dict_Set(const_cast<LPWSTR>(L"Names"), fresh.Get(), VARIANT_FALSE), "set catalog /Names");
        names = Get(root.Get(), L"Names");
        if (TypeOf(names.Get()) != PVT_Dictionary) throw std::runtime_error("could not create catalog /Names");
    }
    Check(names->Dict_Set(const_cast<LPWSTR>(L"EmbeddedFiles"), tree.Get(), VARIANT_FALSE), "set /EmbeddedFiles");
    LogLine("attachments: wrote name tree with %zu files (%zu replaced/added)", specs.size(), replaceOrAdd.size());
}
