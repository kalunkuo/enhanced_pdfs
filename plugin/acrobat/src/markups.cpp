#include "markups.h"

#include <windows.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

const char* const kInScope[] = {"Square", "Circle", "Polygon", "PolyLine", "Line", "Ink", "FreeText", "Text"};
constexpr double kPointLike = 24.0;  // pt; rect smaller than this in both directions -> point-like

bool InScope(const char* subtype) {
    for (const char* s : kInScope)
        if (std::strcmp(s, subtype) == 0) return true;
    return false;
}

double Num(CosObj obj) {
    CosType t = CosObjGetType(obj);
    if (t == CosInteger) return static_cast<double>(CosIntegerValue(obj));
    if (t == CosReal) return CosDoubleValue(obj);
    return 0.0;
}

// Numbers of a Cos array (non-numbers read as 0); empty if not an array.
std::vector<double> Nums(CosObj array) {
    std::vector<double> out;
    if (CosObjGetType(array) != CosArray) return out;
    ASTArraySize n = CosArrayLength(array);
    for (ASTArraySize i = 0; i < n; ++i) out.push_back(Num(CosArrayGet(array, i)));
    return out;
}

std::string RawString(CosObj dict, const char* key) {
    CosObj obj = CosDictGetKeyString(dict, key);
    if (CosObjGetType(obj) != CosString) return std::string();
    ASTCount n = 0;
    const char* p = CosStringValue(obj, &n);
    return (p && n > 0) ? std::string(p, static_cast<size_t>(n)) : std::string();
}

std::string NameAt(CosObj array, ASTArraySize i) {
    if (CosObjGetType(array) != CosArray || i >= CosArrayLength(array)) return std::string();
    CosObj obj = CosArrayGet(array, i);
    if (CosObjGetType(obj) != CosName) return std::string();
    const char* s = ASAtomGetString(CosNameValue(obj));
    return s ? s : "";
}

void AppendUtf8(std::string& out, uint32_t cp) {
    if (cp < 0x80) {
        out += static_cast<char>(cp);
    } else if (cp < 0x800) {
        out += static_cast<char>(0xC0 | (cp >> 6));
        out += static_cast<char>(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
        out += static_cast<char>(0xE0 | (cp >> 12));
        out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
        out += static_cast<char>(0xF0 | (cp >> 18));
        out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (cp & 0x3F));
    }
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

sm::Markup ReadMarkup(CosObj dict, const std::string& subtype, int page) {
    sm::Markup m;
    m.page = page;
    m.subtype = subtype;
    m.id = PdfTextToUtf8(RawString(dict, "NM"));
    m.subject = PdfTextToUtf8(RawString(dict, "Subj"));
    m.text = PdfTextToUtf8(RawString(dict, "Contents"));
    m.author = PdfTextToUtf8(RawString(dict, "T"));
    m.createdUtc = PdfDateToUtc(RawString(dict, "CreationDate"));
    m.modifiedUtc = PdfDateToUtc(RawString(dict, "M"));

    std::vector<double> r = Nums(CosDictGetKeyString(dict, "Rect"));
    if (r.size() >= 4) m.rect = {std::min(r[0], r[2]), std::min(r[1], r[3]), std::max(r[0], r[2]), std::max(r[1], r[3])};

    double w = m.rect.x1 - m.rect.x0, h = m.rect.y1 - m.rect.y0;
    if (subtype == "Text") {  // sticky note: the icon's top-left corner is where it was placed
        m.shape = sm::Shape::Point;
        m.anchorX = m.rect.x0;
        m.anchorY = m.rect.y1;
    } else if (subtype == "Line") {
        m.shape = sm::Shape::Arrow;
        std::vector<double> l = Nums(CosDictGetKeyString(dict, "L"));
        if (l.size() < 4) l = {m.rect.x0, m.rect.y0, m.rect.x1, m.rect.y1};
        CosObj le = CosDictGetKeyString(dict, "LE");
        std::string start = NameAt(le, 0), end = NameAt(le, 1);
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

CollectedMarkups CollectMarkups(PDDoc doc) {
    CollectedMarkups out;
    ASInt32 pages = PDDocGetNumPages(doc);
    for (ASInt32 p = 0; p < pages; ++p) {
        PDPage page = PDDocAcquirePage(doc, p);
        ASInt32 count = PDPageGetNumAnnots(page);
        for (ASInt32 i = 0; i < count; ++i) {
            PDAnnot annot = PDPageGetAnnot(page, i);
            if (!PDAnnotIsValid(annot)) continue;
            const char* subtype = ASAtomGetString(PDAnnotGetSubtype(annot));
            if (!subtype || !InScope(subtype)) continue;
            CosObj dict = PDAnnotGetCosObj(annot);
            out.markups.push_back(ReadMarkup(dict, subtype, static_cast<int>(p) + 1));
            out.annots.push_back(dict);
        }
        PDPageRelease(page);
    }
    return out;
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

std::string PdfTextToUtf8(const std::string& bytes) {
    std::string out;
    if (bytes.size() >= 2 && static_cast<unsigned char>(bytes[0]) == 0xFE && static_cast<unsigned char>(bytes[1]) == 0xFF) {
        for (size_t i = 2; i + 1 < bytes.size(); i += 2) {
            uint32_t u = (static_cast<unsigned char>(bytes[i]) << 8) | static_cast<unsigned char>(bytes[i + 1]);
            if (u >= 0xD800 && u < 0xDC00 && i + 3 < bytes.size()) {
                uint32_t lo = (static_cast<unsigned char>(bytes[i + 2]) << 8) | static_cast<unsigned char>(bytes[i + 3]);
                if (lo >= 0xDC00 && lo < 0xE000) {
                    u = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00);
                    i += 2;
                }
            }
            AppendUtf8(out, u);
        }
        return out;
    }
    if (bytes.size() >= 3 && bytes.compare(0, 3, "\xEF\xBB\xBF") == 0) return bytes.substr(3);
    for (unsigned char c : bytes) AppendUtf8(out, c);  // PDFDocEncoding approximated as Latin-1
    return out;
}

std::string NowUtc() {
    SYSTEMTIME t;
    GetSystemTime(&t);
    char buf[32];
    snprintf(buf, sizeof buf, "%04u-%02u-%02uT%02u:%02u:%02uZ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute,
             t.wSecond);
    return buf;
}
