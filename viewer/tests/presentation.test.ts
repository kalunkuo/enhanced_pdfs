import { describe, expect, it } from 'vitest';
import { createShapePicker, tieWithPicker } from '../src/lib/hit';
import { createPagePresentation, inverseMatrix, transformPoint, type ElementPicker, type Matrix } from '../src/lib/presentation';
import type { Annotation, Point } from '../src/lib/types';

function page(transform: Matrix, width: number, height: number, rotation = 0, userUnit = 1) {
    return {
        pageNumber: 1, view: [100, 200, 700, 1000], rotate: rotation, userUnit,
        getViewport: () => ({ transform: [...transform], width, height }),
    } as unknown as Parameters<typeof createPagePresentation>[0];
}

function expectPoint(actual: Point, expected: Point) {
    expect(actual[0]).toBeCloseTo(expected[0], 8);
    expect(actual[1]).toBeCloseTo(expected[1], 8);
}

describe('shared page presentation', () => {
    it('locates native PDF geometry on the negative-origin Snowdon page', () => {
        const input = page([1, 0, 0, -1, 1512.12, 1080], 3024.24, 2160);
        const presentation = createPagePresentation(input, 0.5, { x: 2, y: 2 }, 7);
        expectPoint(transformPoint(presentation.pdfToPage, [-1512.12, 1080]), [0, 0]);
        expectPoint(transformPoint(presentation.pdfToCss, [0, 0]), [756.06, 540]);
        const wall: Point = [-123.71069, 396];
        expectPoint(transformPoint(presentation.cssToPdf, transformPoint(presentation.pdfToCss, wall)), wall);
        expect(presentation.generation).toBe(7);
    });

    it.each([
        { rotation: 0, transform: [1, 0, 0, -1, -100, 1000], width: 600, height: 800, corner: [100, 1000] },
        { rotation: 90, transform: [0, 1, 1, 0, -200, -100], width: 800, height: 600, corner: [100, 200] },
        { rotation: 180, transform: [-1, 0, 0, 1, 700, -200], width: 600, height: 800, corner: [700, 200] },
        { rotation: 270, transform: [0, -1, -1, 0, 1000, 700], width: 800, height: 600, corner: [700, 1000] },
    ] as const)('preserves the cropped-page markup space at $rotation degrees', ({ rotation, transform, width, height, corner }) => {
        const input = page(transform, width, height, rotation);
        for (const zoom of [0.5, 1, 4]) {
            const presentation = createPagePresentation(input, zoom, { x: 1, y: 1 }, 1);
            expectPoint(transformPoint(presentation.pdfToPage, corner), [0, 0]);
            const markup: Point = [25, 75];
            const native = transformPoint(presentation.pageToPdf, markup);
            expectPoint(transformPoint(presentation.pdfToPage, native), markup);
            expectPoint(transformPoint(presentation.pdfToCss, native), [25 * zoom, 75 * zoom]);
        }
    });

    it('keeps DPR out of persisted coordinates and applies PDF UserUnit once', () => {
        const input = page([2, 0, 0, -2, -200, 2000], 1200, 1600, 0, 2);
        const regular = createPagePresentation(input, 0.5, { x: 1, y: 1 }, 1);
        const retina = createPagePresentation(input, 0.5, { x: 2, y: 2 }, 2);
        expect(regular.pdfToPage).toEqual(retina.pdfToPage);
        expect(regular.pdfToCss).toEqual(retina.pdfToCss);
        expectPoint(transformPoint(retina.pdfToCss, [125, 925]), [25, 75]);
        expect(retina.cssWidth).toBe(600);
    });

    it('rejects a singular transform instead of producing unusable coordinates', () => {
        expect(() => inverseMatrix([0, 0, 0, 0, 0, 0])).toThrow('not invertible');
    });
});

describe('selection and markup share one picker', () => {
    it('ties through a supplied native-geometry picker without needing geometry.parquet shapes', () => {
        const annotation: Annotation = { id: 'a', page: 1, kind: 'line', from: [10, 10], to: [20, 20] };
        const picker: ElementPicker = (point, tolerance) => point[0] === 15 && tolerance === 4 ? [{ elementKey: 'real-wall', occurrenceId: 'view-1/part-2' }] : [];
        expect(tieWithPicker(annotation, picker, 4).elementKey).toBe(picker([15, 15], 4)[0]?.elementKey);
        expect(tieWithPicker({ ...annotation, elementKey: 'stale' }, () => [], 4).elementKey).toBeUndefined();
    });

    it('preserves the legacy smallest-shape priority while retaining overlap candidates', () => {
        const picker = createShapePicker([
            { elementKey: 'wall', bbox: [0, 0, 100, 20] },
            { elementKey: 'column', bbox: [10, 0, 20, 10] },
        ]);
        expect(picker([15, 5], 0).map((hit) => hit.elementKey)).toEqual(['column', 'wall']);
    });
});
