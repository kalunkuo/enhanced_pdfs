import type { Annotation, Point, Shape } from './types';
import type { ElementPicker } from './presentation';
import { withLinks } from './links';

export function pointInPolygon(x: number, y: number, polygon: readonly Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i]!;
        const [xj, yj] = polygon[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function bboxArea(s: Shape): number {
    return (s.bbox[2] - s.bbox[0]) * (s.bbox[3] - s.bbox[1]);
}

/**
 * The element under a point. `tolerance` widens thin shapes (a wall drawn 1pt wide is still hoverable).
 * When shapes overlap (a column inside a wall's bounds) the smallest wins.
 */
export function hitTest(shapes: readonly Shape[], x: number, y: number, tolerance = 0): Shape | undefined {
    return hitTestAll(shapes, x, y, tolerance)[0];
}

/** Legacy polygon adapter. Native path picking can implement ElementPicker directly. */
export function hitTestAll(shapes: readonly Shape[], x: number, y: number, tolerance = 0): Shape[] {
    const hits: Shape[] = [];
    for (const s of shapes) {
        const [x0, y0, x1, y1] = s.bbox;
        if (x < x0 - tolerance || x > x1 + tolerance || y < y0 - tolerance || y > y1 + tolerance) continue;
        if (s.outline && !pointInPolygon(x, y, s.outline) && !nearPolygon(x, y, s.outline, tolerance)) continue;
        hits.push(s);
    }
    return hits.sort((a, b) => bboxArea(a) - bboxArea(b));
}

export function createShapePicker(shapes: readonly Shape[]): ElementPicker {
    return (point, tolerance) => hitTestAll(shapes, point[0], point[1], tolerance).map((shape) => ({ elementKey: shape.elementKey, shape }));
}

function nearPolygon(x: number, y: number, polygon: readonly Point[], tolerance: number): boolean {
    if (tolerance <= 0) return false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        if (distanceToSegment(x, y, polygon[j]!, polygon[i]!) <= tolerance) return true;
    }
    return false;
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** The point that decides which element an annotation belongs to. */
export function anchorOf(a: Pick<Annotation, 'kind' | 'from' | 'to' | 'points'>): Point {
    // A text box ties by its leader tip (`to`, which equals `from` when there is no leader).
    if (a.kind === 'text') return a.to;
    if (a.kind === 'comment' || a.kind === 'signature') return a.from;
    if (a.kind === 'pen' && a.points?.length) {
        const xs = a.points.map((p) => p[0]);
        const ys = a.points.map((p) => p[1]);
        return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    }
    return [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2];
}

/** Tie an annotation to the element under its anchor, or leave it untied. */
export function tie<T extends Annotation>(a: T, shapes: readonly Shape[], tolerance = 0): T {
    return tieWithPicker(a, createShapePicker(shapes), tolerance);
}

/** Annotation ties and drawing selection use the same picker and page coordinates. */
export function tieWithPicker<T extends Annotation>(a: T, picker: ElementPicker, tolerance = 0): T {
    const hit = picker(anchorOf(a), tolerance)[0];
    return withLinks(a, hit ? [hit.elementKey] : []);
}
