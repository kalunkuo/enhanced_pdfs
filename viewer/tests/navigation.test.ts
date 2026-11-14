import { describe, expect, it } from 'vitest';
import { UNSPECIFIED_VALUE } from '../src/lib/filters';
import { collectFocusBounds, fitBounds, getFocusScrollOffset, type Bounds } from '../src/lib/navigation';
import type { Shape } from '../src/lib/types';

const keys = (...values: string[]) => new Set(values);
const part = (elementKey: string, drawingId: string | undefined, bounds: Bounds) => ({ elementKey, drawingId, bounds });

describe('locate geometry bounds', () => {
    it('uses the already-normalized Snowdon page coordinates without flipping its negative PDF origin again', () => {
        const bounds: Bounds = [1388.4, 673.6, 1397.9, 736.3];
        expect(collectFocusBounds([part('wall', 'L1', bounds)], [], keys('wall'))).toEqual(bounds);
    });

    it('fits only selected drawings when the same element appears in several views', () => {
        const parts = [part('wall', 'plan', [10, 20, 30, 40]), part('wall', 'detail', [1000, 1200, 1100, 1400]), part('door', 'plan', [50, 60, 80, 90])];
        expect(collectFocusBounds(parts, [], keys('wall'), keys('plan'))).toEqual([10, 20, 30, 40]);
        expect(collectFocusBounds(parts, [], keys('wall'), keys('detail'))).toEqual([1000, 1200, 1100, 1400]);
        expect(collectFocusBounds(parts, [], keys('wall', 'door'), keys('plan'))).toEqual([10, 20, 80, 90]);
    });

    it('unions all valid matching ink parts and keeps disconnected strokes', () => {
        const parts = [part('wall', 'plan', [10, 20, 10, 40]), part('wall', 'plan', [20, 50, 40, 50]), part('other', 'plan', [-200, -200, 1000, 1000])];
        expect(collectFocusBounds(parts, [], keys('wall'))).toEqual([10, 20, 40, 50]);
    });

    it('does not substitute a legacy box over authoritative native parts for the same element', () => {
        expect(collectFocusBounds([part('wall', 'plan', [10, 20, 30, 40])], [
            { elementKey: 'wall', bbox: [0, 0, 1000, 1000] },
            { elementKey: 'legacy', bbox: [50, 60, 70, 80] },
        ], keys('wall', 'legacy'))).toEqual([10, 20, 70, 80]);
    });

    it('respects optional drawing scope on legacy geometry and unspecified identities', () => {
        const shapes: (Shape & { drawingId?: string })[] = [
            { elementKey: 'wall', drawingId: 'plan', bbox: [10, 20, 30, 40] },
            { elementKey: 'wall', drawingId: 'detail', bbox: [100, 200, 300, 400] },
            { elementKey: 'unknown', bbox: [1, 2, 3, 4] },
        ];
        expect(collectFocusBounds([], shapes, keys('wall'), keys('plan'))).toEqual([10, 20, 30, 40]);
        expect(collectFocusBounds([], shapes, keys('wall', 'unknown'), keys(UNSPECIFIED_VALUE))).toEqual([1, 2, 3, 4]);
    });

    it('returns no target for missing, nonfinite, inverted, or unmatched geometry', () => {
        expect(collectFocusBounds([], [], keys('metadata-only'))).toBeUndefined();
        expect(collectFocusBounds([part('wall', 'plan', [0, 0, Infinity, 100]), part('wall', 'plan', [20, 20, 10, 30])], [], keys('wall'))).toBeUndefined();
        expect(collectFocusBounds([part('wall', 'plan', [0, 0, 100, 100])], [], keys('other'))).toBeUndefined();
        expect(collectFocusBounds([part('wall', 'plan', [0, 0, 100, 100])], [], keys('wall'), keys())).toBeUndefined();
    });
});

describe('fit geometry into the visible stage', () => {
    it('reserves CSS padding and uses the limiting viewport dimension', () => {
        expect(fitBounds([0, 0, 1000, 500], { width: 900, height: 600 })).toEqual({ zoom: 0.82, center: [500, 250] });
    });

    it('retains context around a point or a thin stroke and caps close-up zoom', () => {
        expect(fitBounds([100, 200, 100, 200], { width: 800, height: 600 })).toEqual({ zoom: 2, center: [100, 200] });
        expect(fitBounds([100, 200, 100, 210], { width: 800, height: 600 }, { maxZoom: 20 })).toEqual({ zoom: 8, center: [100, 205] });
    });

    it('clamps to supported minimum zoom for geometry larger than the viewport', () => {
        expect(fitBounds([0, 0, 100000, 100000], { width: 500, height: 500 })?.zoom).toBe(0.1);
    });

    it('treats UserUnit-scaled viewport coordinates as final page space', () => {
        // A raw 100-by-200 PDF region has already been mapped to a 200-by-400
        // scale-1 viewport by the shared presentation adapter for UserUnit=2.
        expect(fitBounds([0, 0, 200, 400], { width: 480, height: 880 })).toEqual({ zoom: 2, center: [100, 200] });
    });

    it('rejects unavailable stages, invalid geometry, and invalid options', () => {
        const bounds: Bounds = [0, 0, 100, 100];
        expect(fitBounds(bounds, { width: 0, height: 600 })).toBeUndefined();
        expect(fitBounds(bounds, { width: 70, height: 600 })).toBeUndefined();
        expect(fitBounds(bounds, { width: NaN, height: 600 })).toBeUndefined();
        expect(fitBounds([20, 0, 10, 100], { width: 800, height: 600 })).toBeUndefined();
        expect(fitBounds([-Number.MAX_VALUE, 0, Number.MAX_VALUE, 100], { width: 800, height: 600 })).toBeUndefined();
        expect(fitBounds(bounds, { width: 800, height: 600 }, { padding: -1 })).toBeUndefined();
        expect(fitBounds(bounds, { width: 800, height: 600 }, { minExtent: 0 })).toBeUndefined();
        expect(fitBounds(bounds, { width: 800, height: 600 }, { maxZoom: Infinity })).toBeUndefined();
    });
});

describe('focus scroll placement', () => {
    it('centers page-space geometry using CSS page offsets and allows the browser to clamp the far edge', () => {
        expect(getFocusScrollOffset([500, 600], 2, { width: 800, height: 600 }, { x: 16, y: 16 })).toEqual({ left: 616, top: 916 });
    });

    it('does not scroll before the stage origin', () => {
        expect(getFocusScrollOffset([10, 20], 0.5, { width: 800, height: 600 }, { x: 16, y: 16 })).toEqual({ left: 0, top: 0 });
    });

    it('ignores canvas backing density and safely handles unavailable viewport values', () => {
        const cssViewport = { width: 800, height: 600, devicePixelRatio: 1 };
        const retinaViewport = { ...cssViewport, devicePixelRatio: 2 };
        expect(getFocusScrollOffset([500, 600], 2, cssViewport, { x: 16, y: 16 })).toEqual(getFocusScrollOffset([500, 600], 2, retinaViewport, { x: 16, y: 16 }));
        expect(getFocusScrollOffset([500, 600], NaN, cssViewport, { x: 16, y: 16 })).toEqual({ left: 0, top: 0 });
        expect(getFocusScrollOffset([500, 600], 2, { width: 0, height: 600 }, { x: 16, y: 16 })).toEqual({ left: 0, top: 0 });
    });
});
