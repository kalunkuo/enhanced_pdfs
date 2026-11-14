import { describe, expect, it } from 'vitest';
import { detectWallShapes, placeholderWall, subpaths, wallQuad } from '../src/lib/placeholderWalls';

const OPS = { save: 1, restore: 2, transform: 3, constructPath: 4, fill: 5, stroke: 6, eoFill: 7, fillStroke: 8, eoFillStroke: 9,
    closeFillStroke: 10, closeEOFillStroke: 11, setFillRGBColor: 12, setFillGray: 13, paintFormXObjectBegin: 14, paintFormXObjectEnd: 15 };

/** pdf.js path data for an axis-aligned rectangle, as moveTo, 3 lineTo, closePath. */
const rect = (x: number, y: number, w: number, h: number) => new Float32Array([0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4]);
const path = (paint: number, ...rects: Float32Array[]) => [OPS.constructPath, [paint, [Float32Array.from(rects.flatMap((r) => [...r]))], null]] as const;
const list = (...items: (readonly [number, unknown] | [number])[]) => ({ fnArray: items.map((i) => i[0]), argsArray: items.map((i) => i[1] ?? null) });
// Page is 100 tall; PDF y goes up, page y goes down.
const toPage = (x: number, y: number): [number, number] => [x, 100 - y];

describe('subpaths', () => {
    it('splits on moveTo and reads curve endpoints', () => {
        const d = new Float32Array([0, 0, 0, 1, 5, 0, 4, 0, 9, 9, 2, 1, 1, 2, 2, 9, 9]);
        expect(subpaths(d)).toEqual([[[0, 0], [5, 0]], [[9, 9], [9, 9]]]);
    });
});

describe('wallQuad', () => {
    const quad = (w: number, h: number) => [[0, 0], [w, 0], [w, h], [0, h]] as [number, number][];
    it('accepts a thin, long parallelogram, either orientation', () => {
        expect(wallQuad(quad(80, 6))).toBeDefined();
        expect(wallQuad(quad(6, 80))).toBeDefined();
        expect(wallQuad([...quad(80, 6), [0, 0]])).toHaveLength(4); // explicit closing point
    });
    it('rejects squares, huge slabs, hairlines and short stubs', () => {
        expect(wallQuad(quad(16, 16))).toBeUndefined();
        expect(wallQuad(quad(300, 200))).toBeUndefined();
        expect(wallQuad(quad(200, 0.5))).toBeUndefined();
        expect(wallQuad(quad(20, 4))).toBeUndefined();
    });
    it('rejects non-parallelograms', () => {
        expect(wallQuad([[0, 0], [80, 0], [80, 6], [40, 30]])).toBeUndefined();
    });
});

describe('detectWallShapes', () => {
    it('finds filled walls, flips to page space, and numbers them in reading order', () => {
        const shapes = detectWallShapes(
            list(path(OPS.fill, rect(10, 10, 80, 6)), path(OPS.fill, rect(10, 80, 80, 6)), path(OPS.fill, rect(50, 40, 16, 16))),
            OPS, toPage,
        );
        expect(shapes.map((s) => s.elementKey)).toEqual(['placeholder-p1-wall-1', 'placeholder-p1-wall-2']);
        expect(shapes[0]!.bbox).toEqual([10, 14, 90, 20]); // the y=80 wall is nearer the page top
    });

    it('ignores stroked-only paths, white fills and duplicates', () => {
        const shapes = detectWallShapes(
            list(
                path(OPS.stroke, rect(10, 10, 80, 6)),
                [OPS.setFillGray, [255]], path(OPS.fill, rect(10, 30, 80, 6)),
                [OPS.setFillGray, [90]], path(OPS.fill, rect(10, 50, 80, 6)), path(OPS.fill, rect(10, 50, 80, 6)),
            ),
            OPS, toPage,
        );
        expect(shapes).toHaveLength(1);
    });

    it('applies transforms and restores them', () => {
        const shapes = detectWallShapes(
            list([OPS.save], [OPS.transform, [2, 0, 0, 2, 0, 0]], path(OPS.fill, rect(5, 5, 40, 3)), [OPS.restore], path(OPS.fill, rect(10, 70, 30, 6))),
            OPS, toPage,
        );
        expect(shapes.map((s) => s.bbox[2] - s.bbox[0]).sort((a, b) => a - b)).toEqual([30, 80]);
    });
});

describe('placeholderWall', () => {
    it('makes clearly flagged, stable placeholder data', () => {
        const { element, parameters } = placeholderWall(2);
        expect(element).toMatchObject({ key: 'placeholder-p1-wall-3', mark: 'Wall 03', elementId: 900003, placeholder: true });
        // Keys and IDs stay unique across pages.
        expect(placeholderWall(2, 2).element).toMatchObject({ key: 'placeholder-p2-wall-3', elementId: 901003 });
        expect(parameters.some((p) => p.name === 'Unconnected Height')).toBe(true);
    });
});
