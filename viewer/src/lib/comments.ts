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

/** A stable background color for a name, so one person always looks the same. */
export function avatarColor(name: string): string {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
    return `hsl(${hash % 360} 65% 45%)`;
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
