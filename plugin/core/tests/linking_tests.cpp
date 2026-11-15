#include "check.h"
#include "smartmarkup/linking.h"

using namespace sm;

static Markup AreaMarkup(Box r) {
    Markup m;
    m.rect = r;
    m.shape = Shape::Area;
    return m;
}

TEST(link_area_basic) {
    ElementMap e{{1, {0, 0, 10, 60}}};
    CHECK((LinkedElements(e, AreaMarkup({0, 0, 10, 30})) == std::vector<int64_t>{1}));
    CHECK(LinkedElements(e, AreaMarkup({0, 0, 10, 29.4})).empty());
}

TEST(link_area_ignores_title_block) {
    ElementMap e{{1, {0, 0, 100, 100}}};
    CHECK(LinkedElements(e, AreaMarkup({10, 10, 50, 60})).empty());  // big element merely containing the markup
}

TEST(link_point_picks_smallest) {
    ElementMap e{{1, {0, 0, 100, 100}}, {2, {40, 40, 60, 60}}};
    Markup m;
    m.shape = Shape::Point;
    m.anchorX = 50;
    m.anchorY = 50;
    CHECK((LinkedElements(e, m) == std::vector<int64_t>{2}));
    CHECK(ElementAt(e, 500, 500) == std::nullopt);
    CHECK(ElementAt(e, 100, 100) == std::optional<int64_t>(1));  // inclusive edge
}

TEST(link_arrow_uses_anchor) {
    ElementMap e{{1, {0, 0, 10, 10}}, {2, {50, 50, 60, 60}}};
    Markup m;
    m.shape = Shape::Arrow;
    m.rect = {0, 0, 55, 55};
    m.anchorX = 55;
    m.anchorY = 55;
    CHECK((LinkedElements(e, m) == std::vector<int64_t>{2}));
}

TEST(referenced_excludes_linked_and_unknown) {
    auto r = ReferencedElements("see 676281 and 1234 and 99 and 887347", {676281, 887347}, {887347});
    CHECK((r == std::vector<int64_t>{676281}));
}
