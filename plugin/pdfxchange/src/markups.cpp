#include "markups.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cwchar>
#include <stdexcept>

namespace {

const wchar_t* const kInScope[] = {L"Square", L"Circle", L"Polygon", L"PolyLine",
                                   L"Line",   L"Ink",    L"FreeText", L"Text"};
constexpr double kPointLike = 24.0;  // pt; rect smaller than this in both directions -> point-like

using Var = ComPtr<IPXS_PDFVariant>;

bool InScope(const wchar_t* subtype) {
    for (const wchar_t* s : kInScope)
        if (std::wcscmp(s, subtype) == 0) return true;
    return false;
}

// Takes ownership of a BSTR and returns it as UTF-8.
std::string Take(BSTR b) {
    std::string out = b ? Utf8(b) : std::string();
    SysFreeString(b);
    return out;
}

PXS_PDFVariantType TypeOf(IPXS_PDFVariant* v) {
    PXS_PDFVariantType t = PVT_INVALID;
    if (v) v->get_Type(&t);
    return t;
}

std::string DictString(IPXS_PDFVariant* dict, const wchar_t* key) {
    PXS_PDFVariantType t = PVT_INVALID;
    if (FAILED(dict->Dict_GetType(const_cast<LPWSTR>(key), &t)) || t != PVT_String) return std::string();
    BSTR b = nullptr;
    if (FAILED(dict->Dict_GetString(const_cast<LPWSTR>(key), nullptr, &b))) return std::string();
    return Take(b);
}

std::string DictName(IPXS_PDFVariant* dict, const wchar_t* key) {
    PXS_PDFVariantType t = PVT_INVALID;
    if (FAILED(dict->Dict_GetType(const_cast<LPWSTR>(key), &t)) || t != PVT_Name) return std::string();
    BSTR b = nullptr;
    if (FAILED(dict->Dict_GetName(const_cast<LPWSTR>(key), nullptr, &b))) return std::string();
    return Take(b);
}

Var DictArray(IPXS_PDFVariant* dict, const wchar_t* key) {
    Var v;
    if (FAILED(dict->Dict_Get(const_cast<LPWSTR>(key), v.Put())) || TypeOf(v.Get()) != PVT_Array) v.Reset();
    return v;
}

// The Editor holds annotation geometry as float32 and writes it with fewer digits, so the same rect reads
// back slightly differently after a save/reopen. Geometry is quantised to 0.01 pt so an unchanged markup
// gives an unchanged SheetRect (otherwise every reopen would look like a table change and dirty the file).
double Quantise(double v) { return std::round(v * 100.0) / 100.0; }

// Numbers of an array entry (non-numbers read as 0), quantised; empty if not an array.
std::vector<double> Nums(IPXS_PDFVariant* dict, const wchar_t* key) {
    std::vector<double> out;
    Var a = DictArray(dict, key);
    if (!a) return out;
    ULONG_T n = 0;
    a->get_Count(&n);
    for (ULONG_T i = 0; i < n; ++i) {
        PXS_PDFVariantType t = PVT_INVALID;
        double v = 0;
        if (SUCCEEDED(a->Arr_GetType(i, &t)) && (t == PVT_Integer || t == PVT_Double)) a->Arr_GetDouble(i, 0.0, &v);
        out.push_back(Quantise(v));
    }
    return out;
}

std::string NameAt(IPXS_PDFVariant* array, ULONG_T i) {
    if (!array) return std::string();
    ULONG_T n = 0;
    array->get_Count(&n);
    PXS_PDFVariantType t = PVT_INVALID;
    if (i >= n || FAILED(array->Arr_GetType(i, &t)) || t != PVT_Name) return std::string();
    BSTR b = nullptr;
    if (FAILED(array->Arr_GetName(i, nullptr, &b))) return std::string();
    return Take(b);
}

// Howard Hinnant's days_from_civil / civil_from_days.
int64_t DaysFromCivil(int64_t y, unsigned m, unsigned d) {
    y -= m <= 2;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<int64_t>(doe) - 719468;
}

void CivilFromDays(int64_t z, int64_t& y, unsigned& m, unsigned& d) {
    z += 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const unsigned doe = static_cast<unsigned>(z - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    d = doy - (153 * mp + 2) / 5 + 1;
    m = mp < 10 ? mp + 3 : mp - 9;
    y = static_cast<int64_t>(yoe) + era * 400 + (m <= 2);
}

std::string FormatUtc(int64_t seconds) {
    int64_t days = seconds >= 0 ? seconds / 86400 : (seconds - 86399) / 86400;
    int64_t rem = seconds - days * 86400;
    int64_t y;
    unsigned m, d;
    CivilFromDays(days, y, m, d);
    char buf[32];
    snprintf(buf, sizeof buf, "%04lld-%02u-%02uT%02d:%02d:%02dZ", static_cast<long long>(y), m, d,
             static_cast<int>(rem / 3600), static_cast<int>((rem / 60) % 60), static_cast<int>(rem % 60));
    return buf;
}

sm::Markup ReadMarkup(IPXS_PDFVariant* dict, const std::string& subtype, int page) {
    sm::Markup m;
    m.page = page;
    m.subtype = subtype;
    m.id = DictString(dict, L"NM");
    m.subject = DictString(dict, L"Subj");
    m.text = DictString(dict, L"Contents");
    m.author = DictString(dict, L"T");
    m.createdUtc = PdfDateToUtc(DictString(dict, L"CreationDate"));
    m.modifiedUtc = PdfDateToUtc(DictString(dict, L"M"));

    std::vector<double> r = Nums(dict, L"Rect");
    if (r.size() >= 4) m.rect = {std::min(r[0], r[2]), std::min(r[1], r[3]), std::max(r[0], r[2]), std::max(r[1], r[3])};

    double w = m.rect.x1 - m.rect.x0, h = m.rect.y1 - m.rect.y0;
    if (subtype == "Text") {  // sticky note: the icon's top-left corner is where it was placed
        m.shape = sm::Shape::Point;
        m.anchorX = m.rect.x0;
        m.anchorY = m.rect.y1;
    } else if (subtype == "Line") {
        m.shape = sm::Shape::Arrow;
        std::vector<double> l = Nums(dict, L"L");
        if (l.size() < 4) l = {m.rect.x0, m.rect.y0, m.rect.x1, m.rect.y1};
        Var le = DictArray(dict, L"LE");
        std::string start = NameAt(le.Get(), 0), end = NameAt(le.Get(), 1);
        bool startHead = !start.empty() && start != "None";
        bool endHead = !end.empty() && end != "None";
        bool useStart = startHead && !endHead;
        m.anchorX = useStart ? l[0] : l[2];
        m.anchorY = useStart ? l[1] : l[3];
    } else if (w < kPointLike && h < kPointLike) {
        m.shape = sm::Shape::Point;
        m.anchorX = (m.rect.x0 + m.rect.x1) / 2;
        m.anchorY = (m.rect.y0 + m.rect.y1) / 2;
    } else {
        m.shape = sm::Shape::Area;
    }
    return m;
}

}  // namespace

CollectedMarkups CollectMarkups(IPXC_Document* doc) {
    CollectedMarkups out;
    ComPtr<IPXC_Pages> pages;
    if (FAILED(doc->get_Pages(pages.Put())) || !pages) throw std::runtime_error("get_Pages failed");
    ULONG_T pageCount = 0;
    pages->get_Count(&pageCount);
    for (ULONG_T p = 0; p < pageCount; ++p) {
        ComPtr<IPXC_Page> page;
        if (FAILED(pages->get_Item(p, page.Put())) || !page) throw std::runtime_error("get page failed");
        ULONG_T count = 0;
        page->GetAnnotsCount(&count);
        for (ULONG_T i = 0; i < count; ++i) {
            ComPtr<IPXC_Annotation> annot;
            if (FAILED(page->GetAnnot(i, annot.Put())) || !annot) continue;
            Var dict;
            if (FAILED(annot->get_PDFObject(dict.Put())) || TypeOf(dict.Get()) != PVT_Dictionary) continue;
            BSTR subtype = nullptr;
            if (FAILED(dict->Dict_GetName(const_cast<LPWSTR>(L"Subtype"), nullptr, &subtype)) || !subtype) continue;
            bool inScope = InScope(subtype);
            std::string name = Take(subtype);
            if (!inScope) continue;
            if (DictString(dict.Get(), L"NM") == "smh-highlight") continue;  // our temporary inspect highlight
            Var inReplyTo;  // replies (comment threads) are not separate markups (spec)
            if (SUCCEEDED(dict->Dict_Get(const_cast<LPWSTR>(L"IRT"), inReplyTo.Put())) && inReplyTo) continue;
            out.markups.push_back(ReadMarkup(dict.Get(), name, static_cast<int>(p) + 1));
            out.annots.push_back(std::move(dict));
        }
    }
    return out;
}

void SetAnnotationId(IPXS_PDFVariant* annot, const std::string& id) {
    std::wstring w = Wide(id);
    HRESULT hr = annot->Dict_SetString(const_cast<LPWSTR>(L"NM"), const_cast<LPWSTR>(w.c_str()));
    if (FAILED(hr)) throw std::runtime_error("setting /NM failed");
}

std::string PdfDateToUtc(const std::string& pdfDate) {
    size_t i = pdfDate.compare(0, 2, "D:") == 0 ? 2 : 0;
    auto digits = [&](size_t count, int& value) {
        if (i + count > pdfDate.size()) return false;
        int v = 0;
        for (size_t k = 0; k < count; ++k) {
            unsigned char c = pdfDate[i + k];
            if (!std::isdigit(c)) return false;
            v = v * 10 + (c - '0');
        }
        value = v;
        i += count;
        return true;
    };
    int year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0;
    if (!digits(4, year) || !digits(2, month) || !digits(2, day)) return std::string();
    if (digits(2, hour) && digits(2, minute)) digits(2, second);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return std::string();

    int offset = 0;  // seconds east of UTC
    if (i < pdfDate.size() && (pdfDate[i] == '+' || pdfDate[i] == '-')) {
        int sign = pdfDate[i] == '+' ? 1 : -1;
        ++i;
        int oh = 0, om = 0;
        if (digits(2, oh)) {
            if (i < pdfDate.size() && pdfDate[i] == '\'') ++i;
            digits(2, om);
            offset = sign * (oh * 3600 + om * 60);
        }
    }
    int64_t seconds = DaysFromCivil(year, static_cast<unsigned>(month), static_cast<unsigned>(day)) * 86400 +
                      hour * 3600 + minute * 60 + second - offset;
    return FormatUtc(seconds);
}

std::string NowUtc() {
    SYSTEMTIME t;
    GetSystemTime(&t);
    char buf[32];
    snprintf(buf, sizeof buf, "%04u-%02u-%02uT%02u:%02u:%02uZ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute,
             t.wSecond);
    return buf;
}

std::string Utf8(const wchar_t* s) {
    if (!s || !*s) return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1) return std::string();
    std::string out(static_cast<size_t>(n - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, s, -1, out.data(), n, nullptr, nullptr);
    return out;
}

std::wstring Wide(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring out(static_cast<size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), out.data(), n);
    return out;
}
