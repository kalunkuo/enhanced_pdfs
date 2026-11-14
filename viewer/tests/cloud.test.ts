import { describe, expect, it } from 'vitest';
import { cloudArcs, cloudPolyline, cloudRect, cloudSvgPath, elementsInCloud, tieCloud, type BoundsSource } from '../src/lib/cloud';
import type { Annotation, Point } from '../src/lib/types';

const cloud = (from: Point, to: Point): Annotation => ({ id: 'c', page: 1, kind: 'cloud', from, to });

describe('cloud outline', () => {
    it('normalizes corners dragged in any direction', () => {
        expect(cloudRect(cloud([100, 80], [20, 10]))).toEqual([20, 10, 100, 80]);
    });

    it('makes bumps along every side, sized to fit each side exactly', () => {
        const arcs = cloudArcs([0, 0, 160, 80]);
        expect(arcs).toHaveLength(10 + 5 + 10 + 5);
        // The scallops chain end to end around the rectangle and close up.
        for (let i = 0; i < arcs.length; i++) {
            const next = arcs[(i + 1) % arcs.length]!;
            expect(arcs[i]!.to[0]).toBeCloseTo(next.from[0]);
            expect(arcs[i]!.to[1]).toBeCloseTo(next.from[1]);
        }
    });

    it('stays closed and keeps at least one bump per side on a tiny rectangle', () => {
        expect(cloudArcs([0, 0, 5, 5])).toHaveLength(4);
        const path = cloudSvgPath([0, 0, 5, 5]);
        expect(path.startsWith('M 0 0 A')).toBe(true);
        expect(path.endsWith('Z')).toBe(true);
    });

    it('has no outline for a rectangle with no size', () => {
        expect(cloudSvgPath([5, 5, 5, 5])).toBe('');
    });

    it('bulges outward on all four sides', () => {
        const rect = [100, 100, 260, 180] as const;
        const pts = cloudPolyline(rect);
        const outside = pts.filter((p) => p[0] < 100 - 1e-6 || p[0] > 260 + 1e-6 || p[1] < 100 - 1e-6 || p[1] > 180 + 1e-6);
        const inside = pts.filter((p) => p[0] > 100 + 1e-6 && p[0] < 260 - 1e-6 && p[1] > 100 + 1e-6 && p[1] < 180 - 1e-6);
        expect(inside).toHaveLength(0); // nothing dips into the rectangle
        expect(outside.length).toBeGreaterThan(pts.length / 2); // most samples sit outside the straight edges
        expect(Math.min(...pts.map((p) => p[1]))).toBeLessThan(100); // top bulges up
        expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(180); // bottom bulges down
        expect(Math.min(...pts.map((p) => p[0]))).toBeLessThan(100); // left bulges left
        expect(Math.max(...pts.map((p) => p[0]))).toBeGreaterThan(260); // right bulges right
    });
});

const wall = (key: string, bounds: [number, number, number, number]): BoundsSource => ({ elementKey: key, bounds });

describe('elements in a cloud', () => {
    const sources: BoundsSource[] = [
        wall('inside', [120, 120, 160, 130]),
        wall('partly', [200, 110, 400, 120]), // runs out of the cloud
        wall('outside', [500, 500, 600, 510]),
        wall('split', [110, 150, 130, 160]), // one piece in the cloud...
        wall('split', [700, 150, 720, 160]), // ...and one far away
    ];
    const a = cloud([100, 100], [260, 180]);

    it('finds what is inside or overlapping, and nothing else', () => {
        expect(elementsInCloud(a, sources).map((e) => e.key).sort()).toEqual(['inside', 'partly', 'split']);
    });

    it('says whether each element is wholly inside', () => {
        const byKey = Object.fromEntries(elementsInCloud(a, sources).map((e) => [e.key, e.fully]));
        expect(byKey).toEqual({ inside: true, partly: false, split: false }); // 'split' also extends outside
    });

    it('lists wholly inside elements first', () => {
        const list = elementsInCloud(a, sources);
        expect(list[0]).toEqual({ key: 'inside', fully: true });
        expect(list.every((e, i) => i === 0 || !e.fully)).toBe(true);
    });

    it('gives the same answer however the cloud was dragged', () => {
        expect(elementsInCloud(cloud([260, 180], [100, 100]), sources)).toEqual(elementsInCloud(a, sources));
    });

    it('finds nothing in empty space', () => {
        expect(elementsInCloud(cloud([0, 0], [50, 50]), sources)).toEqual([]);
    });
});

describe('tying a cloud', () => {
    const sources: BoundsSource[] = [wall('w1', [120, 120, 160, 130]), wall('w2', [200, 150, 230, 160])];

    it('records what it covers and ties to the first', () => {
        const tied = tieCloud(cloud([100, 100], [260, 180]), sources);
        expect(tied.contained?.map((e) => e.key).sort()).toEqual(['w1', 'w2']);
        expect(tied.elementKey).toBe(tied.contained![0]!.key);
    });

    it('is untied, with no list, when it covers nothing, even if it was tied before', () => {
        const before = { ...cloud([100, 100], [260, 180]), elementKey: 'w1', contained: [{ key: 'w1', fully: true }] };
        const after = tieCloud({ ...before, from: [0, 0], to: [20, 20] }, sources);
        expect(after.elementKey).toBeUndefined();
        expect(after.contained).toBeUndefined();
    });
});

import { clampShift } from '../src/lib/cloud';

describe('moving a cloud', () => {
    const corners: Point[] = [[100, 100], [260, 180]];
    it('passes a drag through when it stays on the page', () => {
        expect(clampShift(corners, 30, -20, 792, 612)).toEqual([30, -20]);
    });
    it('stops at each edge without changing the cloud size', () => {
        expect(clampShift(corners, -500, 0, 792, 612)).toEqual([-100, 0]); // left edge
        expect(clampShift(corners, 900, 0, 792, 612)).toEqual([792 - 260, 0]); // right edge
        expect(clampShift(corners, 0, -500, 792, 612)).toEqual([0, -100]); // top edge
        expect(clampShift(corners, 0, 900, 792, 612)).toEqual([0, 612 - 180]); // bottom edge
    });
    it('changes which objects it covers as it moves', () => {
        const sources = [{ elementKey: 'a', bounds: [120, 120, 160, 130] as const }, { elementKey: 'b', bounds: [400, 120, 440, 130] as const }];
        const at = (dx: number) => elementsInCloud({ from: [100 + dx, 100], to: [260 + dx, 180] }, sources).map((e) => e.key);
        expect(at(0)).toEqual(['a']);
        expect(at(300)).toEqual(['b']);
        expect(at(100)).toEqual([]); // x 200..360: between the two
    });
});
