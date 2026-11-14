import { matchesDrawingScope } from './filters';
import type { NativePaintPart } from './nativeGeometry';
import { MAX_ZOOM, MIN_ZOOM } from './presentation';
import type { Point, Shape } from './types';

export type Bounds = readonly [minX: number, minY: number, maxX: number, maxY: number];

/** A requested focus is resolved only against geometry for this page. */
export interface FocusRequest {
    id: number;
    pageNumber: number;
    elementKeys: ReadonlySet<string>;
    drawingIds?: ReadonlySet<string> | null;
}

type BoundedPart = Pick<NativePaintPart, 'elementKey' | 'drawingId' | 'bounds'>;
type ScopedShape = Shape & { drawingId?: string };
interface ViewportSize { width: number; height: number }
export interface FitBoundsOptions { padding?: number; minExtent?: number; maxZoom?: number }
export interface FocusPlan { zoom: number; center: Point }

function validBounds(bounds: Bounds): boolean {
    return bounds.every(Number.isFinite) && bounds[0] <= bounds[2] && bounds[1] <= bounds[3];
}

/**
 * Union existing page-space bounds. Missing geometry has no focus target.
 * Valid native parts take precedence over legacy boxes for the same element
 * within the requested drawing scope.
 */
export function collectFocusBounds(
    nativeParts: readonly BoundedPart[],
    legacyShapes: readonly Shape[],
    elementKeys: ReadonlySet<string>,
    drawingIds: ReadonlySet<string> | null = null,
): Bounds | undefined {
    let result: Bounds | undefined;
    const nativeKeys = new Set<string>();
    const include = (bounds: Bounds) => {
        result = result ? [Math.min(result[0], bounds[0]), Math.min(result[1], bounds[1]), Math.max(result[2], bounds[2]), Math.max(result[3], bounds[3])] : [...bounds];
    };
    for (const part of nativeParts) {
        if (!elementKeys.has(part.elementKey) || !matchesDrawingScope(part.drawingId, drawingIds) || !validBounds(part.bounds)) continue;
        include(part.bounds);
        nativeKeys.add(part.elementKey);
    }
    for (const shape of legacyShapes as readonly ScopedShape[]) {
        if (!elementKeys.has(shape.elementKey) || nativeKeys.has(shape.elementKey) || !matchesDrawingScope(shape.drawingId, drawingIds) || !validBounds(shape.bbox)) continue;
        include(shape.bbox);
    }
    return result;
}

/** Fit page-space geometry into CSS pixels, retaining context around tiny marks. */
export function fitBounds(bounds: Bounds, available: ViewportSize, options: FitBoundsOptions = {}): FocusPlan | undefined {
    const { padding = 40, minExtent = 48, maxZoom = 2 } = options;
    if (!validBounds(bounds) || !Number.isFinite(available.width) || !Number.isFinite(available.height) || available.width <= 0 || available.height <= 0 ||
        !Number.isFinite(padding) || padding < 0 || !Number.isFinite(minExtent) || minExtent <= 0 || !Number.isFinite(maxZoom) || maxZoom <= 0) return undefined;
    const width = Math.max(minExtent, bounds[2] - bounds[0]);
    const height = Math.max(minExtent, bounds[3] - bounds[1]);
    const usableWidth = available.width - padding * 2;
    const usableHeight = available.height - padding * 2;
    if (!Number.isFinite(width) || !Number.isFinite(height) || usableWidth <= 0 || usableHeight <= 0) return undefined;
    const upperZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, maxZoom));
    const zoom = Math.max(MIN_ZOOM, Math.min(upperZoom, usableWidth / width, usableHeight / height));
    return { zoom, center: [bounds[0] + (bounds[2] - bounds[0]) / 2, bounds[1] + (bounds[3] - bounds[1]) / 2] };
}

/** DOM page offsets and viewport dimensions are CSS pixels; backing DPR is irrelevant. */
export function getFocusScrollOffset(center: Point, zoom: number, viewport: ViewportSize, pageOffset: { x: number; y: number }): { left: number; top: number } {
    if (![...center, zoom, viewport.width, viewport.height, pageOffset.x, pageOffset.y].every(Number.isFinite) || zoom <= 0 || viewport.width <= 0 || viewport.height <= 0) return { left: 0, top: 0 };
    const left = pageOffset.x + center[0] * zoom - viewport.width / 2;
    const top = pageOffset.y + center[1] * zoom - viewport.height / 2;
    return { left: Number.isFinite(left) ? Math.max(0, left) : 0, top: Number.isFinite(top) ? Math.max(0, top) : 0 };
}
