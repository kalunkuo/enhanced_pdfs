import type { ElementInfo, ParameterInfo, Point, Shape } from './types';

/**
 * PLACEHOLDER until the add-in exports a real `geometry` table: guess where walls are from the
 * drawing itself. A "wall" here is a filled, thin, long quadrilateral. Real outlines replace this.
 */

interface OpList {
    fnArray: ArrayLike<number>;
    argsArray: ArrayLike<unknown>;
}

type Matrix = readonly [number, number, number, number, number, number];
interface State { ctm: Matrix; white: boolean }

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const apply = (m: Matrix, x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** Apply `n` first, then `m`: how a `cm` operator composes with the current matrix. */
const compose = (m: Matrix, n: Matrix): Matrix => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

const MIN_THICKNESS = 1.5; // page points
const MAX_THICKNESS = 24;
const MIN_LENGTH = 24;
const MIN_ASPECT = 4;

/** Split pdf.js path data (DrawOPS codes: 0 move, 1 line, 2 curve, 3 quad, 4 close) into point lists. */
export function subpaths(data: ArrayLike<number>): Point[][] {
    const out: Point[][] = [];
    let cur: Point[] = [];
    const flush = () => {
        if (cur.length) out.push(cur);
        cur = [];
    };
    for (let i = 0; i < data.length; ) {
        const op = data[i++];
        if (op === 0) {
            flush();
            cur.push([data[i++]!, data[i++]!]);
        } else if (op === 1) {
            cur.push([data[i++]!, data[i++]!]);
        } else if (op === 2) {
            i += 4;
            cur.push([data[i++]!, data[i++]!]);
        } else if (op === 3) {
            i += 2;
            cur.push([data[i++]!, data[i++]!]);
        } // 4 = closePath: nothing to read
    }
    flush();
    return out;
}

/** A thin, long parallelogram, or undefined. Returns its four corners. */
export function wallQuad(points: readonly Point[]): Point[] | undefined {
    const pts = [...points];
    const first = pts[0];
    const last = pts.at(-1);
    if (first && last && pts.length === 5 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-3) pts.pop();
    if (pts.length !== 4) return undefined;
    const [p0, p1, p2, p3] = pts as [Point, Point, Point, Point];
    const a = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const b = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const skew = Math.hypot(p0[0] + p2[0] - p1[0] - p3[0], p0[1] + p2[1] - p1[1] - p3[1]);
    if (skew > 0.05 * Math.max(a, b)) return undefined; // not a parallelogram
    const thin = Math.min(a, b);
    const long = Math.max(a, b);
    if (thin < MIN_THICKNESS || thin > MAX_THICKNESS || long < MIN_LENGTH || long / thin < MIN_ASPECT) return undefined;
    return pts;
}

const bbox = (pts: readonly Point[]): Shape['bbox'] => [
    Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])),
];

function isWhite(args: unknown): boolean {
    if (typeof args === 'string') return /^#?f[ef]f[ef]f[ef]$/i.test(args);
    if (Array.isArray(args)) {
        const nums = (typeof args[0] === 'number' ? args : []) as number[];
        if (nums.length === 3) return nums.every((n) => n >= 240); // 0-255 RGB
        if (nums.length === 1) return nums[0]! >= 240; // 0-255 gray
        if (typeof args[0] === 'string') return isWhite(args[0]);
    }
    return false;
}

/**
 * Find wall-like shapes in an operator list. `ops` maps pdf.js operator names to their numbers
 * (pdfjs.OPS); `toPage` converts PDF user space to page coordinates (top-left origin).
 */
export function detectWallShapes(list: OpList, ops: Record<string, number>, toPage: (x: number, y: number) => Point, page = 1): Shape[] {
    const fills = new Set([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
    const stack: State[] = [];
    let state: State = { ctm: IDENTITY, white: false };
    const found: Point[][] = [];

    for (let i = 0; i < list.fnArray.length; i++) {
        const fn = list.fnArray[i];
        const args = list.argsArray[i] as unknown[] | null;
        if (fn === ops.save) stack.push(state);
        else if (fn === ops.restore) state = stack.pop() ?? state;
        else if (fn === ops.transform && args) state = { ...state, ctm: compose(state.ctm, args as unknown as Matrix) };
        else if (fn === ops.paintFormXObjectBegin && args) {
            stack.push(state);
            if (args[0]) state = { ...state, ctm: compose(state.ctm, args[0] as Matrix) };
        } else if (fn === ops.paintFormXObjectEnd) state = stack.pop() ?? state;
        else if (fn === ops.setFillRGBColor || fn === ops.setFillGray) state = { ...state, white: isWhite(args) };
        else if (fn === ops.constructPath && args && fills.has(args[0] as number) && !state.white) {
            const data = (args[1] as ArrayLike<number>[])[0];
            if (!data) continue;
            for (const sp of subpaths(data)) {
                const quad = wallQuad(sp.map(([x, y]) => toPage(...apply(state.ctm, x, y))));
                if (quad) found.push(quad);
            }
        }
    }

    // Reading order, so numbering is stable: top to bottom, then left to right.
    const shapes = found.map((outline) => ({ outline, bbox: bbox(outline) }));
    shapes.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
    return dedupe(shapes).map((s, i) => ({ elementKey: placeholderKey(i, page), bbox: s.bbox, outline: s.outline }));
}

function dedupe<T extends { bbox: Shape['bbox'] }>(items: T[]): T[] {
    const kept: T[] = [];
    for (const it of items) {
        const same = kept.some((k) => k.bbox.every((v, j) => Math.abs(v - it.bbox[j]!) < 0.5));
        if (!same) kept.push(it);
    }
    return kept;
}

export const placeholderKey = (index: number, page = 1) => `placeholder-p${page}-wall-${index + 1}`;

const pad2 = (n: number) => String(n).padStart(2, '0');

export function placeholderWall(index: number, page = 1): { element: ElementInfo; parameters: ParameterInfo[] } {
    const n = index + 1;
    const key = placeholderKey(index, page);
    const element: ElementInfo = {
        key,
        elementId: 900000 + (page - 1) * 1000 + n,
        category: 'Walls',
        name: `Wall ${pad2(n)}`,
        family: 'Basic Wall',
        type: 'Placeholder wall type',
        level: 'GROUND FLOOR',
        mark: `Wall ${pad2(n)}`,
        wallFunction: 'Interior',
        typeKey: 'placeholder-wall-type',
        placeholder: true,
    };
    const inst: [string, string][] = [
        ['Location Line', 'Wall Centerline'], ['Base Constraint', 'GROUND FLOOR'], ['Base Offset', `0' 0"`],
        ['Base is Attached', 'No'], ['Base Extension Distance', `0' 0"`], ['Top Constraint', 'Unconnected'],
        ['Unconnected Height', `10' 0"`], ['Top Offset', `0' 0"`], ['Top is Attached', 'No'],
        ['Top Extension Distance', `0' 0"`], ['Room Bounding', 'Yes'], ['Related to Mass', 'No'], ['Cross-Section', 'Vertical'],
    ];
    return {
        element,
        parameters: inst.map(([name, value]) => ({ name, scope: 'Instance' as const, value })),
    };
}

export const PLACEHOLDER_TYPE_PARAMETERS: ParameterInfo[] = [
    { name: 'Function', scope: 'Type', value: 'Interior' },
    { name: 'Fire Rating', scope: 'Type', value: '—' },
];
