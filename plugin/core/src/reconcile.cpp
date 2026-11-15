#include "smartmarkup/reconcile.h"

#include <algorithm>
#include <cstdio>
#include <map>
#include <random>
#include <set>
#include <tuple>
#include <unordered_map>
#include <unordered_set>

#include "smartmarkup/linking.h"

namespace sm {

namespace {

std::string NewId() {
    static std::mt19937_64 rng{std::random_device{}()};
    uint64_t hi = rng(), lo = rng();
    hi = (hi & 0xFFFFFFFFFFFF0FFFULL) | 0x0000000000004000ULL;  // version 4
    lo = (lo & 0x3FFFFFFFFFFFFFFFULL) | 0x8000000000000000ULL;  // variant 10
    char buf[40];
    std::snprintf(buf, sizeof buf, "ep-%08x-%04x-%04x-%04x-%012llx", static_cast<unsigned>(hi >> 32),
                  static_cast<unsigned>((hi >> 16) & 0xFFFF), static_cast<unsigned>(hi & 0xFFFF),
                  static_cast<unsigned>(lo >> 48), static_cast<unsigned long long>(lo & 0xFFFFFFFFFFFFULL));
    return buf;
}

bool LinkLess(const LinkRow& a, const LinkRow& b) {
    return std::tie(a.annotationId, a.elementId, a.elementKey, a.relation) <
           std::tie(b.annotationId, b.elementId, b.elementKey, b.relation);
}

bool SameAnnotation(const AnnotationRow& a, const AnnotationRow& b) {
    return a.annotationId == b.annotationId && a.drawingId == b.drawingId && a.page == b.page && a.kind == b.kind &&
           a.subtype == b.subtype && a.text == b.text && a.author == b.author && a.status == b.status &&
           a.createdUtc == b.createdUtc && a.modifiedUtc == b.modifiedUtc && a.sheetRect == b.sheetRect &&
           a.schemaVersion == b.schemaVersion;
}

bool SameLink(const LinkRow& a, const LinkRow& b) {
    return a.annotationId == b.annotationId && a.elementKey == b.elementKey && a.elementId == b.elementId &&
           a.relation == b.relation;
}

void Sort(AnnotationState& s) {
    std::sort(s.annotations.begin(), s.annotations.end(),
              [](const AnnotationRow& a, const AnnotationRow& b) { return a.annotationId < b.annotationId; });
    std::sort(s.links.begin(), s.links.end(), LinkLess);
}

bool Equal(const AnnotationState& a, const AnnotationState& b) {
    if (a.annotations.size() != b.annotations.size() || a.links.size() != b.links.size()) return false;
    for (size_t i = 0; i < a.annotations.size(); ++i)
        if (!SameAnnotation(a.annotations[i], b.annotations[i])) return false;
    for (size_t i = 0; i < a.links.size(); ++i)
        if (!SameLink(a.links[i], b.links[i])) return false;
    return true;
}

}  // namespace

ReconcileResult Reconcile(const ReconcileInput& in) {
    ReconcileResult res;
    static const ModelData kEmptyModel;
    static const std::map<int, ElementMap> kNoPages;
    const ModelData& model = in.model ? *in.model : kEmptyModel;
    const auto& pages = in.pages ? *in.pages : kNoPages;

    std::unordered_map<int64_t, std::vector<const ElementRow*>> keysById;
    std::unordered_set<int64_t> knownIds;
    for (const auto& e : model.elements) {
        keysById[e.elementId].push_back(&e);
        knownIds.insert(e.elementId);
    }

    std::string sheetId;
    for (const auto& d : model.drawings)
        if (!d.parentDrawingId) {
            sheetId = d.drawingId;
            break;
        }

    std::unordered_map<std::string, const AnnotationRow*> existingById;
    for (const auto& r : in.existing.annotations) existingById[r.annotationId] = &r;

    std::set<std::string> seen;
    for (size_t i = 0; i < in.markups.size(); ++i) {
        const Markup& m = in.markups[i];
        std::string id = m.id;
        if (id.empty()) {
            id = NewId();
            res.assignedIds.emplace_back(i, id);
        }
        seen.insert(id);

        static const ElementMap kNoElements;
        auto pit = pages.find(m.page);
        const ElementMap& elements = pit != pages.end() ? pit->second : kNoElements;

        std::vector<int64_t> linked = LinkedElements(elements, m);
        std::vector<int64_t> referenced = ReferencedElements(m.text, knownIds, linked);

        std::set<std::string> linkKeys;
        auto addLinks = [&](const std::vector<int64_t>& ids, const char* relation) {
            for (int64_t eid : ids) {
                auto kit = keysById.find(eid);
                if (kit == keysById.end()) continue;
                for (const ElementRow* e : kit->second) {
                    res.state.links.push_back({id, e->elementKey, eid, relation});
                    linkKeys.insert(e->elementKey);
                }
            }
        };
        addLinks(linked, "linked");
        addLinks(referenced, "referenced");

        std::map<std::string, int> counts;
        for (const auto& a : model.appearances)
            if (a.drawingId != sheetId && linkKeys.count(a.elementKey)) ++counts[a.drawingId];
        std::string drawingId = sheetId;
        int best = 0;
        for (const auto& [d, c] : counts)  // map order: ties resolve to the smallest id
            if (c > best) {
                best = c;
                drawingId = d;
            }

        auto eit = existingById.find(id);
        const AnnotationRow* old = eit != existingById.end() ? eit->second : nullptr;

        AnnotationRow row;
        row.annotationId = id;
        row.drawingId = drawingId;
        row.page = m.page;
        row.kind = !m.subject.empty() ? m.subject : m.subtype;
        row.subtype = m.subtype;
        row.text = m.text;
        row.author = m.author;
        row.status = "Open";
        row.createdUtc = old ? old->createdUtc : (!m.createdUtc.empty() ? m.createdUtc : in.nowUtc);
        row.modifiedUtc = !m.modifiedUtc.empty() ? m.modifiedUtc : (old ? old->modifiedUtc : std::string());
        row.sheetRect = {m.rect.x0, m.rect.y0, m.rect.x1, m.rect.y1};
        res.state.annotations.push_back(std::move(row));
    }

    for (const auto& old : in.existing.annotations) {
        if (seen.count(old.annotationId)) continue;
        AnnotationRow row = old;
        row.status = "Deleted";
        res.state.annotations.push_back(std::move(row));
        for (const auto& l : in.existing.links)
            if (l.annotationId == old.annotationId) res.state.links.push_back(l);
    }

    Sort(res.state);
    AnnotationState prev = in.existing;
    Sort(prev);
    res.changed = !Equal(res.state, prev);
    return res;
}

}  // namespace sm
