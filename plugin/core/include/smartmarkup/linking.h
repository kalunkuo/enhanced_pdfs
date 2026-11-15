// Linking rules: which model elements a markup points at or mentions.
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

#include "smartmarkup/model.h"

namespace sm {

// Sorted, unique ElementIds linked to the markup (area overlap, or anchor point for Point/Arrow).
std::vector<int64_t> LinkedElements(const ElementMap& elements, const Markup& markup);

// Sorted, unique known ElementIds mentioned as 4-9 digit numbers in text, excluding `linked`.
std::vector<int64_t> ReferencedElements(const std::string& text, const std::unordered_set<int64_t>& knownIds,
                                        const std::vector<int64_t>& linked);

// Element with the smallest-area box containing the point (edges inclusive).
std::optional<int64_t> ElementAt(const ElementMap& elements, double x, double y);

}  // namespace sm
