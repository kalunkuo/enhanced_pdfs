import { describe, expect, it } from 'vitest';
import { calloutBounds, hasLeader, leaderSegment, leaderStart, textBox } from '../src/lib/callout';
import { anchorOf, tieWithPicker } from '../src/lib/hit';
import type { Annotation, Point } from '../src/lib/types';

const text = (from: Point, to: Point, t = 'Check this'): Annotation => ({ id: 't', page: 1, kind: 'text', from, to, text: t });

describe('text box and leader', () => {
    it('sizes the box from the text and keeps a minimum width', () => {
        expect(textBox({ from: [100, 100], text: '' })).toEqual({ x: 96, y: 86, w: 30, h: 20 });
        expect(textBox({ from: [100, 100], text: 'x'.repeat(20) }).w).toBeCloseTo(142);
    });

    it('has a leader only when the tip is not the box origin', () => {
        expect(hasLeader(text([10, 10], [10, 10]))).toBe(false);
        expect(hasLeader(text([10, 10], [60, 10]))).toBe(true);
    });

    it('leaves the box from the middle of the side that faces the tip', () => {
        const box = { x: 100, y: 100, w: 80, h: 20 };
        expect(leaderStart(box, [300, 110])).toEqual([180, 110]); // right
        expect(leaderStart(box, [0, 110])).toEqual([100, 110]); // left
        expect(leaderStart(box, [140, 300])).toEqual([140, 120]); // below
        expect(leaderStart(box, [140, 0])).toEqual([140, 100]); // above
    });

    it('draws no leader for a plain box, or when the tip is inside the box', () => {
        expect(leaderSegment(text([10, 10], [10, 10]))).toBeUndefined();
        expect(leaderSegment(text([100, 100], [110, 105]))).toBeUndefined();
        const seg = leaderSegment(text([100, 100], [300, 105]))!;
        expect(seg[1]).toEqual([300, 105]);
    });

    it('bounds the box and the tip together', () => {
        const b = calloutBounds(text([100, 100], [20, 200], 'abc'));
        expect(b.x0).toBe(20);
        expect(b.y1).toBe(200);
        expect(b.y0).toBe(86);
    });
});

describe('tying a text box', () => {
    // An element sits at x 200..260; the box is on empty paper to its left.
    const picker = (p: Point) => (p[0] >= 200 && p[0] <= 260 ? [{ elementKey: 'wall' }] : []);

    it('ties by the leader tip, not by where the box sits', () => {
        const a = text([100, 100], [230, 100]);
        expect(anchorOf(a)).toEqual([230, 100]);
        expect(tieWithPicker(a, picker, 0).elementKey).toBe('wall');
    });

    it('is untied when the tip is on empty paper, even if the box overlaps an element', () => {
        expect(tieWithPicker(text([220, 100], [50, 100]), picker, 0).elementKey).toBeUndefined();
    });

    it('ties a box with no leader by its own position', () => {
        expect(tieWithPicker(text([230, 100], [230, 100]), picker, 0).elementKey).toBe('wall');
        expect(tieWithPicker({ ...text([100, 100], [100, 100]), elementKey: 'wall' }, picker, 0).elementKey).toBeUndefined();
    });
});
