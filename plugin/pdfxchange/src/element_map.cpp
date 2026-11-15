#include "element_map.h"

#include <algorithm>
#include <cstdlib>
#include <cwchar>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "com_ptr.h"
#include "log.h"

namespace {

std::map<std::pair<IPXC_Document*, int>, sm::ElementMap> gCache;

// L"Element619404" -> 619404; anything else -> -1.
int64_t ElementIdFromTag(BSTR tag) {
    if (!tag || std::wcsncmp(tag, L"Element", 7) != 0 || !tag[7]) return -1;
    for (const wchar_t* p = tag + 7; *p; ++p)
        if (*p < L'0' || *p > L'9') return -1;
    return std::wcstoll(tag + 7, nullptr, 10);
}

void Grow(sm::ElementMap& map, int64_t id, const PXC_Rect& r) {
    double x0 = std::min(r.left, r.right), x1 = std::max(r.left, r.right);
    double y0 = std::min(r.bottom, r.top), y1 = std::max(r.bottom, r.top);
    auto it = map.find(id);
    if (it == map.end()) {
        map.emplace(id, sm::Box{x0, y0, x1, y1});
        return;
    }
    sm::Box& b = it->second;
    b.x0 = std::min(b.x0, x0);
    b.y0 = std::min(b.y0, y0);
    b.x1 = std::max(b.x1, x1);
    b.y1 = std::max(b.y1, y1);
}

// `owner` is the innermost enclosing Element id (-1 outside any element).
void Walk(IPXC_ContentItems* items, int64_t owner, sm::ElementMap& map, int depth) {
    if (!items || depth > 64) return;
    const int64_t outer = owner;     // owner when entering this list
    std::vector<int64_t> owners;     // open Begin/End containers in this list
    ULONG_T count = 0;
    items->get_Count(&count);
    for (ULONG_T i = 0; i < count; ++i) {
        ComPtr<IPXC_ContentItem> item;
        if (FAILED(items->get_Item(i, item.Put())) || !item) continue;
        PXC_CIType type = CIT_Unknown;
        item->get_Type(&type);
        if (type == CIT_BeginContainer || type == CIT_Container) {
            int64_t id = -1;
            BSTR tag = nullptr;
            if (SUCCEEDED(item->get_MC_Tag(&tag))) {
                id = ElementIdFromTag(tag);
                SysFreeString(tag);
            }
            int64_t inner = id >= 0 ? id : owner;
            if (type == CIT_BeginContainer) {
                // Read-only content is flat: BMC/BDC..EMC arrive as Begin/End markers.
                owners.push_back(inner);
                owner = inner;
            } else {
                ComPtr<IPXC_ContentItems> children;  // nested form (other access modes)
                if (SUCCEEDED(item->get_MC_Items(children.Put()))) Walk(children.Get(), inner, map, depth + 1);
            }
        } else if (type == CIT_EndContainer) {
            if (!owners.empty()) owners.pop_back();
            owner = owners.empty() ? outer : owners.back();
        } else if (owner >= 0) {
            PXC_Rect bbox{};
            if (SUCCEEDED(item->get_BBox(&bbox))) Grow(map, owner, bbox);
        }
    }
}

sm::ElementMap Build(IPXC_Document* doc, int pageIndex) {
    sm::ElementMap map;
    DWORD started = GetTickCount();
    ComPtr<IPXS_Document> cos;
    bool locked = SUCCEEDED(doc->get_CosDocument(cos.Put())) && cos && SUCCEEDED(cos->LockDocument(VARIANT_TRUE));
    ComPtr<IPXC_Pages> pages;
    ComPtr<IPXC_Page> page;
    ComPtr<IPXC_Content> content;
    ComPtr<IPXC_ContentItems> items;
    if (SUCCEEDED(doc->get_Pages(pages.Put())) && SUCCEEDED(pages->get_Item(pageIndex, page.Put())) &&
        SUCCEEDED(page->GetContent(CAccessMode_Readonly, content.Put())) && SUCCEEDED(content->get_Items(items.Put())))
        Walk(items.Get(), -1, map, 0);
    else
        LogLine("elementmap: could not read content of page %d", pageIndex);
    if (locked) cos->UnlockDocument();
    LogLine("elementmap: page %d -> %zu elements in %lu ms (locked=%d)", pageIndex, map.size(),
            GetTickCount() - started, locked ? 1 : 0);
    return map;
}

}  // namespace

const sm::ElementMap& GetElementMap(IPXC_Document* doc, int pageIndex) {
    auto key = std::make_pair(doc, pageIndex);
    auto it = gCache.find(key);
    if (it == gCache.end()) it = gCache.emplace(key, Build(doc, pageIndex)).first;
    return it->second;
}

void ForgetElementMaps(IPXC_Document* doc) {
    for (auto it = gCache.begin(); it != gCache.end();)
        it = (it->first.first == doc) ? gCache.erase(it) : std::next(it);
}
