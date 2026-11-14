import type { Annotation, ContainedElement, Point } from './types';

/**
 * A revision cloud is a rectangle (`from` and `to` are opposite corners) drawn with a scalloped edge, so it is
 * closed by construction and stays closed when resized. The elements it covers are found by comparing their
 * page bounds with the rectangle.
 */

export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

/** Page bounds of something an element is drawn with. Several can share one element key. */
export interface BoundsSource {
    elementKey: string;
    bounds: Rect;
}

/** Target width of one scallop, in page points. */
export const DEFAULT_BUMP = 16;
/** Bumps are flatter than a semicircle: the radius is this multiple of the chord (0.5 would be a semicircle). */
const BUMP_RADIUS = 0.62;

export function cloudRect(a: Pick<Annotation, 'from' | 'to'>): Rect {
    return [Math.min(a.from[0], a.to[0]), Math.min(a.from[1], a.to[1]), Math.max(a.from[0], a.to[0]), Math.max(a.from[1], a.to[1])];
}

export interface CloudArc {
    from: Point;
    to: Point;
    radius: number;
}

/** The scallops, clockwise from the top-left corner. Each bulges outward. */
export function cloudArcs(rect: Rect, bump = DEFAULT_BUMP): CloudArc[] {
    const [x0, y0, x1, y1] = rect;
    const corners: Point[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const arcs: CloudArc[] = [];
    for (let i = 0; i < 4; i++) {
        const a = corners[i]!;
        const b = corners[(i + 1) % 4]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 1e-6) continue;
        const count = Math.max(1, Math.round(length / bump));
        const chord = length / count;
        for (let k = 0; k < count; k++) {
            const t0 = k / count;
            const t1 = (k + 1) / count;
            arcs.push({
                from: [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0],
                to: [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1],
                radius: chord * BUMP_RADIUS,
            });
        }
    }
    return arcs;
}

const n2 = (n: number) => Math.round(n * 100) / 100;

/** SVG path for the cloud. Every arc is clockwise on screen, which is outward for a clockwise outline. */
export function cloudSvgPath(rect: Rect, bump = DEFAULT_BUMP): string {
    const arcs = cloudArcs(rect, bump);
    if (!arcs.length) return '';
    const [start] = arcs;
    return `M ${n2(start!.from[0])} ${n2(start!.from[1])} ` + arcs.map((a) => `A ${n2(a.radius)} ${n2(a.radius)} 0 0 1 ${n2(a.to[0])} ${n2(a.to[1])}`).join(' ') + ' Z';
}

/** The same outline as straight segments, for the saved PDF. The ring is not repeated at the start. */
export function cloudPolyline(rect: Rect, bump = DEFAULT_BUMP, steps = 8): Point[] {
    const out: Point[] = [];
    for (const arc of cloudArcs(rect, bump)) {
        out.push(arc.from);
        const dx = arc.to[0] - arc.from[0];
        const dy = arc.to[1] - arc.from[1];
        const chord = Math.hypot(dx, dy);
        const half = chord / 2;
        const sweep = 2 * Math.asin(Math.min(1, half / arc.radius));
        const depth = Math.sqrt(Math.max(0, arc.radius * arc.radius - half * half));
        // The centre is on the inside: a quarter turn clockwise (on screen) from the direction of travel.
        const ux = dx / chord;
        const uy = dy / chord;
        const cx = arc.from[0] + dx / 2 - uy * depth;
        const cy = arc.from[1] + dy / 2 + ux * depth;
        const a0 = Math.atan2(arc.from[1] - cy, arc.from[0] - cx);
        for (let i = 1; i < steps; i++) {
            const a = a0 + (sweep * i) / steps;
            out.push([cx + arc.radius * Math.cos(a), cy + arc.radius * Math.sin(a)]);
        }
    }
    return out;
}

const overlaps = (a: Rect, b: Rect, slack: number) => a[0] <= b[2] + slack && a[2] >= b[0] - slack && a[1] <= b[3] + slack && a[3] >= b[1] - slack;
const within = (inner: Rect, outer: Rect, slack: number) => inner[0] >= outer[0] - slack && inner[1] >= outer[1] - slack && inner[2] <= outer[2] + slack && inner[3] <= outer[3] + slack;

/**
 * The elements a cloud covers: every element with some bounds inside the cloud's rectangle, those wholly inside
 * first, then by distance from the cloud's centre. Bounds are a rough fit for an element's real outline, so an
 * element drawn along a diagonal can count as covered when its path only passes near the cloud.
 */
export function elementsInCloud(a: Pick<Annotation, 'from' | 'to'>, sources: readonly BoundsSource[], slack = 0.5): ContainedElement[] {
    const cloud = cloudRect(a);
    const byElement = new Map<string, { hit: boolean; union: [number, number, number, number] }>();
    for (const source of sources) {
        const entry = byElement.get(source.elementKey) ?? { hit: false, union: [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number] };
        const b = source.bounds;
        entry.union = [Math.min(entry.union[0], b[0]), Math.min(entry.union[1], b[1]), Math.max(entry.union[2], b[2]), Math.max(entry.union[3], b[3])];
        if (overlaps(b, cloud, slack)) entry.hit = true;
        byElement.set(source.elementKey, entry);
    }
    const cx = (cloud[0] + cloud[2]) / 2;
    const cy = (cloud[1] + cloud[3]) / 2;
    return [...byElement.entries()]
        .filter(([, e]) => e.hit)
        .map(([key, e]) => ({ key, fully: within(e.union, cloud, slack), distance: Math.hypot((e.union[0] + e.union[2]) / 2 - cx, (e.union[1] + e.union[3]) / 2 - cy) }))
        .sort((p, q) => Number(q.fully) - Number(p.fully) || p.distance - q.distance || p.key.localeCompare(q.key))
        .map(({ key, fully }) => ({ key, fully }));
}

/** Record what a cloud covers, and tie it to the first covered element (or untie it when it covers nothing). */
export function tieCloud<T extends Annotation>(a: T, sources: readonly BoundsSource[]): T {
    const contained = elementsInCloud(a, sources);
    const { elementKey: _previous, contained: _old, ...rest } = a;
    return { ...rest, ...(contained.length ? { elementKey: contained[0]!.key, contained } : {}) } as T;
}

/**
 * Limit a drag so every corner stays on the page. The same shift applies to all of them, so a cloud keeps its
 * size and shape against a page edge instead of being squashed.
 */
export function clampShift(corners: readonly Point[], dx: number, dy: number, width: number, height: number): [number, number] {
    const minX = Math.min(...corners.map((p) => p[0]));
    const maxX = Math.max(...corners.map((p) => p[0]));
    const minY = Math.min(...corners.map((p) => p[1]));
    const maxY = Math.max(...corners.map((p) => p[1]));
    return [Math.min(width - maxX, Math.max(-minX, dx)), Math.min(height - maxY, Math.max(-minY, dy))];
}
