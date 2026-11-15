/** "just now", "5 min ago", "2 h ago", "3 d ago", then a date. */
export function formatTimeAgo(iso: string | undefined, now: number = Date.now()): string {
    const then = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(then)) return '';
    const seconds = Math.max(0, (now - then) / 1000);
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} d ago`;
    return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** One or two capital letters for an avatar: "yam chum" -> "YC", "yamchum" -> "Y". */
export function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const letters = parts.length === 1 ? parts[0]![0]! : parts[0]![0]! + parts.at(-1)![0]!;
    return letters.toUpperCase();
}

/** The accent colors a profile can default to: the design system's green, red, pink, blue and yellow. */
export const PROFILE_COLORS = ['green-500', 'red-500', 'pink-300', 'blue-500', 'yellow-500'] as const;

/** A stable default color for a name, so one person always looks the same. Initials on it are dark, not white. */
export function avatarColor(name: string): string {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
    return `var(--primitive-color-${PROFILE_COLORS[hash % PROFILE_COLORS.length]})`;
}

const SAFE_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 3_000_000;

/** Only raster data URLs are shown. A saved PDF is untrusted input: no SVG, no remote URLs. */
export function safeImage(value: unknown): string | undefined {
    return typeof value === 'string' && value.length <= MAX_IMAGE_CHARS && SAFE_IMAGE.test(value) ? value : undefined;
}

/** PDF date string (UTC), e.g. D:20261114153000Z. */
export function pdfDate(iso: string): string | undefined {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return undefined;
    const d = new Date(t);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** "Nov 14, 2026, 3:30 PM". Pass a locale to make output deterministic. */
export function formatExactDate(iso: string | undefined, locale?: string): string {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return '';
    return new Date(t).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Give a new markup its author and creation time, unless it already has them (comments do).
 * Without a profile name there is no author; the details card then says "Unknown author".
 */
export function withAuthorship<T extends { author?: { name: string; photo?: string } | undefined; createdAt?: string | undefined }>(
    annotation: T,
    profile: { name: string; photo?: string | undefined },
    nowIso: string,
): T & { createdAt: string } {
    const name = profile.name.trim();
    const author = annotation.author ?? (name ? { name, ...(profile.photo ? { photo: profile.photo } : {}) } : undefined);
    return { ...annotation, createdAt: annotation.createdAt ?? nowIso, ...(author ? { author } : {}) };
}
