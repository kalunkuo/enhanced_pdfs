import type { Annotation, Point } from './types';

/**
 * A text box can carry a leader line. `from` is the box's text origin and `to` is the leader's tip. The tip is
 * what ties the box to an object. A box with `from === to` has no leader (and ties by its own position).
 */

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

type TextBoxLike = Pick<Annotation, 'from' | 'to'> & { text?: string | undefined };

const CHAR_WIDTH = 6.6;
const PAD = 10;

/** The box around a text annotation, in page coordinates. Single line, 12pt. */
export function textBox(a: Pick<Annotation, 'from'> & { text?: string | undefined }): Box {
    return { x: a.from[0] - 4, y: a.from[1] - 14, w: Math.max(30, (a.text?.length ?? 0) * CHAR_WIDTH + PAD), h: 20 };
}

/** True when the leader tip is somewhere other than the box's own origin. */
export function hasLeader(a: Pick<Annotation, 'from' | 'to'>): boolean {
    return a.from[0] !== a.to[0] || a.from[1] !== a.to[1];
}

const inside = (b: Box, p: Point) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;

/** Where the leader leaves the box: the middle of whichever side faces the tip. */
export function leaderStart(box: Box, tip: Point): Point {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = tip[0] - cx;
    const dy = tip[1] - cy;
    if (dx === 0 && dy === 0) return [cx, cy];
    if (Math.abs(dx) / (box.w / 2) > Math.abs(dy) / (box.h / 2)) return [dx > 0 ? box.x + box.w : box.x, cy];
    return [cx, dy > 0 ? box.y + box.h : box.y];
}

/** The visible leader line, or undefined when there is none or the tip is inside the box. */
export function leaderSegment(a: TextBoxLike): [Point, Point] | undefined {
    if (!hasLeader(a)) return undefined;
    const box = textBox(a);
    if (inside(box, a.to)) return undefined;
    return [leaderStart(box, a.to), a.to];
}

/** The box and the leader tip together, for sizing a saved annotation's rectangle. */
export function calloutBounds(a: TextBoxLike): { x0: number; y0: number; x1: number; y1: number } {
    const b = textBox(a);
    return {
        x0: Math.min(b.x, a.to[0]), y0: Math.min(b.y, a.to[1]),
        x1: Math.max(b.x + b.w, a.to[0]), y1: Math.max(b.y + b.h, a.to[1]),
    };
}
