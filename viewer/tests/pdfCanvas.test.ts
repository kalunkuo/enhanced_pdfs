import { describe, expect, it } from 'vitest';
import { baseRasterZoom, expandRect } from '../src/components/patterns/PdfCanvas';

describe('baseRasterZoom', () => {
    it('keeps the requested zoom while the full page fits the pixel budget', () => {
        expect(baseRasterZoom(0.5, 1000, 1000, 1, 4_000_000)).toBe(0.5);
    });

    it('caps the base raster at the budget regardless of how far the user zooms in', () => {
        const capped = baseRasterZoom(4, 1000, 1000, 2, 4_000_000);
        expect(capped).toBeCloseTo(1);
        expect(baseRasterZoom(8, 1000, 1000, 2, 4_000_000)).toBe(capped);
    });
});

describe('expandRect', () => {
    it('adds the margin as a fraction of the visible size on every side', () => {
        expect(expandRect([100, 200, 300, 600], 0.1, 1000, 1000)).toEqual([80, 160, 320, 640]);
    });

    it('clamps the tile to the page', () => {
        expect(expandRect([0, 0, 1000, 500], 0.1, 1000, 520)).toEqual([0, 0, 1000, 520]);
    });
});
