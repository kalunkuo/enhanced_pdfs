#include "smartmarkup/linking.h"

#include <algorithm>
#include <regex>

namespace sm {

namespace {

double Area(const Box& b) { return (b.x1 - b.x0) * (b.y1 - b.y0); }

double Overlap(const Box& a, const Box& b) {
    double w = std::min(a.x1, b.x1) - std::max(a.x0, b.x0);
    double h = std::min(a.y1, b.y1) - std::max(a.y0, b.y0);
    return (w > 0 && h > 0) ? w * h : 0.0;
}

std::vector<int64_t> SortedUnique(std::vector<int64_t> v) {
    std::sort(v.begin(), v.end());
    v.erase(std::unique(v.begin(), v.end()), v.end());
    return v;
}

}  // namespace

std::optional<int64_t> ElementAt(const ElementMap& elements, double x, double y) {
    std::optional<int64_t> best;
    double bestArea = 0;
    for (const auto& [id, b] : elements) {
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
        double a = Area(b);
        if (!best || a < bestArea || (a == bestArea && id < *best)) {
            best = id;
            bestArea = a;
        }
    }
    return best;
}

std::vector<int64_t> LinkedElements(const ElementMap& elements, const Markup& markup) {
    std::vector<int64_t> out;
    if (markup.shape == Shape::Area) {
        const double markupArea = Area(markup.rect);
        for (const auto& [id, b] : elements) {
            double a = Area(b);
            if (a <= 0) a = 1e-6;
            if (Overlap(b, markup.rect) / a >= 0.5 && a <= 4 * markupArea) out.push_back(id);
        }
    } else if (auto id = ElementAt(elements, markup.anchorX, markup.anchorY)) {
        out.push_back(*id);
    }
    return SortedUnique(std::move(out));
}

std::vector<int64_t> ReferencedElements(const std::string& text, const std::unordered_set<int64_t>& knownIds,
                                        const std::vector<int64_t>& linked) {
    static const std::regex kNumber(R"(\b\d{4,9}\b)");
    std::vector<int64_t> out;
    for (std::sregex_iterator it(text.begin(), text.end(), kNumber), end; it != end; ++it) {
        int64_t id = std::stoll(it->str());
        if (knownIds.count(id) && std::find(linked.begin(), linked.end(), id) == linked.end()) out.push_back(id);
    }
    return SortedUnique(std::move(out));
}

}  // namespace sm
