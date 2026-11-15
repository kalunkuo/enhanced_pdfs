#include "check.h"
#include "smartmarkup/reconcile.h"

using namespace sm;

namespace {

ElementRow Elem(const std::string& key, int64_t id) {
    ElementRow r;
    r.elementKey = key;
    r.elementId = id;
    return r;
}

struct Fixture {
    std::map<int, ElementMap> pages{{1, {{1, {0, 0, 10, 10}}, {2, {100, 100, 110, 110}}, {5, {200, 200, 210, 210}}}}};
    ModelData model;
    Fixture() {
        model.elements = {Elem("k1", 1), Elem("k2", 2), Elem("k5a", 5), Elem("k5b", 5)};
        DrawingRow s;
        s.drawingId = "S";
        DrawingRow v;
        v.drawingId = "V";
        v.parentDrawingId = std::string("S");
        model.drawings = {s, v};
    }
    ReconcileInput In(std::vector<Markup> ms, AnnotationState ex = {}) const {
        ReconcileInput in;
        in.pages = &pages;
        in.model = &model;
        in.markups = std::move(ms);
        in.existing = std::move(ex);
        in.nowUtc = "2026-11-14T00:00:00Z";
        return in;
    }
};

Markup M(const std::string& id, Box r) {
    Markup m;
    m.id = id;
    m.subtype = "Square";
    m.rect = r;
    return m;
}

AnnotationState Existing(const std::string& id, const LinkRow& link) {
    AnnotationState ex;
    AnnotationRow row;
    row.annotationId = id;
    row.status = "Open";
    ex.annotations.push_back(row);
    ex.links.push_back(link);
    return ex;
}

bool SameLinks(const AnnotationState& a, const AnnotationState& b) {
    if (a.links.size() != b.links.size()) return false;
    for (size_t i = 0; i < a.links.size(); ++i)
        if (a.links[i].annotationId != b.links[i].annotationId || a.links[i].elementKey != b.links[i].elementKey ||
            a.links[i].relation != b.links[i].relation)
            return false;
    return true;
}

}  // namespace

TEST(reconcile_assigns_missing_id_once) {
    Fixture f;
    auto r = Reconcile(f.In({M("", {0, 0, 10, 10})}));
    CHECK(r.assignedIds.size() == 1);
    CHECK(r.assignedIds[0].first == 0);
    CHECK(r.assignedIds[0].second.rfind("ep-", 0) == 0);
    CHECK(r.assignedIds[0].second.size() == 3 + 36);
    CHECK(r.state.annotations.size() == 1);
    CHECK(r.state.annotations[0].annotationId == r.assignedIds[0].second);
    CHECK(r.changed);
    auto r2 = Reconcile(f.In({M(r.assignedIds[0].second, {0, 0, 10, 10})}, r.state));
    CHECK(r2.assignedIds.empty());
    CHECK(!r2.changed);
}

TEST(reconcile_marks_deleted) {
    Fixture f;
    auto r = Reconcile(f.In({}, Existing("a", {"a", "k1", 1, "linked"})));
    CHECK(r.state.annotations.size() == 1);
    CHECK(r.state.annotations[0].status == "Deleted");
    CHECK(r.state.links.size() == 1);
    CHECK(r.changed);
}

TEST(reconcile_relinks_moved_markup) {
    Fixture f;
    auto r = Reconcile(f.In({M("a", {100, 100, 110, 110})}, Existing("a", {"a", "k1", 1, "linked"})));
    CHECK(r.state.links.size() == 1);
    CHECK(r.state.links[0].elementId == 2);
    CHECK(r.state.links[0].elementKey == "k2");
    CHECK(r.state.links[0].relation == "linked");
    CHECK(r.changed);
}

TEST(reconcile_is_idempotent) {
    Fixture f;
    Markup m = M("a", {0, 0, 10, 10});
    m.text = "also 5";
    m.subject = "Note";
    m.createdUtc = "2026-01-01T00:00:00Z";
    auto r1 = Reconcile(f.In({m}));
    auto r2 = Reconcile(f.In({m}, r1.state));
    CHECK(!r2.changed);
    CHECK(SameLinks(r1.state, r2.state));
    CHECK(r1.state.annotations[0].kind == "Note");
    CHECK(r1.state.annotations[0].status == "Open");
    CHECK(r1.state.annotations[0].createdUtc == "2026-01-01T00:00:00Z");
}

TEST(reconcile_drawing_id_prefers_view) {
    Fixture f;
    f.model.appearances = {{"S", "k1"}, {"V", "k1"}};
    auto r = Reconcile(f.In({M("a", {0, 0, 10, 10}), M("b", {900, 900, 910, 910})}));
    CHECK(r.state.annotations.size() == 2);
    CHECK(r.state.annotations[0].annotationId == "a");
    CHECK(r.state.annotations[0].drawingId == "V");
    CHECK(r.state.annotations[1].drawingId == "S");
}

TEST(reconcile_multiple_element_keys) {
    Fixture f;
    auto r = Reconcile(f.In({M("a", {200, 200, 210, 210})}));
    CHECK(r.state.links.size() == 2);
    CHECK(r.state.links[0].elementKey == "k5a");
    CHECK(r.state.links[1].elementKey == "k5b");
}
