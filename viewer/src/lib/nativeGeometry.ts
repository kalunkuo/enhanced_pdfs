import Flatbush from 'flatbush';
import { OPS } from 'pdfjs-dist';
import type { NativeOccurrence, NativeTagIndex } from './nativeTypes';
import { inverseMatrix, transformPoint, type ElementHit, type ElementPicker, type Matrix, type PagePresentation, type RenderCaptureFactory } from './presentation';
import type { Point } from './types';

export type NativeBounds = readonly [number, number, number, number];

export interface NativeClip {
    path: Path2D;
    toPage: Matrix;
    fromPage: Matrix;
    rule: CanvasFillRule;
}

export interface NativeStrokeStyle {
    /** Effective width used for this render, including PDF.js minimum-pixel adjustment. */
    width: number;
    cap: CanvasLineCap;
    join: CanvasLineJoin;
    miterLimit: number;
    dash: readonly number[];
    dashOffset: number;
}

export interface NativePaintPart {
    elementKey: string;
    occurrenceId: string;
    appearanceId: string;
    drawingId?: string;
    path: Path2D;
    toPage: Matrix;
    fromPage: Matrix;
    bounds: NativeBounds;
    mode: 'stroke' | 'fill';
    rule: CanvasFillRule;
    stroke: NativeStrokeStyle;
    clips: readonly NativeClip[];
    paintOrder: number;
}

export interface NativeGeometry {
    /** Original page source; keeps stale document/page results out of the UI. */
    source: NativeTagIndex;
    presentation: PagePresentation;
    parts: readonly NativePaintPart[];
    elementKeys: ReadonlySet<string>;
    appearanceIds: ReadonlySet<string>;
    pick: ElementPicker;
    unsupportedElementKeys: ReadonlySet<string>;
    unsupportedPaints: number;
}

function matrixFromContext(context: CanvasRenderingContext2D): Matrix {
    const { a, b, c, d, e, f } = context.getTransform();
    return [a, b, c, d, e, f];
}

/** Backing pixels -> persisted scale-1 page coordinates, including arbitrary page origins. */
export function contextToPage(matrix: Matrix, presentation: Pick<PagePresentation, 'outputScale' | 'zoom'>): Matrix {
    const x = presentation.outputScale.x * presentation.zoom;
    const y = presentation.outputScale.y * presentation.zoom;
    return [matrix[0] / x, matrix[1] / y, matrix[2] / x, matrix[3] / y, matrix[4] / x, matrix[5] / y];
}

export function transformedBounds(bounds: NativeBounds, transform: Matrix, padding = 0): NativeBounds {
    const points = [
        transformPoint(transform, [bounds[0], bounds[1]]), transformPoint(transform, [bounds[2], bounds[1]]),
        transformPoint(transform, [bounds[2], bounds[3]]), transformPoint(transform, [bounds[0], bounds[3]]),
    ];
    return [
        Math.min(...points.map((point) => point[0])) - padding, Math.min(...points.map((point) => point[1])) - padding,
        Math.max(...points.map((point) => point[0])) + padding, Math.max(...points.map((point) => point[1])) + padding,
    ];
}

function maxScale(matrix: Matrix): number {
    // Largest singular value: uniform rotations keep a CSS tolerance unchanged.
    const [a, b, c, d] = matrix;
    const sum = a * a + b * b + c * c + d * d;
    const determinant = a * d - b * c;
    return Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant))) / 2);
}

function localTolerance(matrix: Matrix, tolerance: number): number {
    return tolerance * maxScale(matrix);
}

function setStrokeStyle(context: CanvasRenderingContext2D, style: NativeStrokeStyle, tolerance = 0) {
    context.lineWidth = style.width + 2 * tolerance;
    context.lineCap = tolerance ? 'round' : style.cap;
    context.lineJoin = tolerance ? 'round' : style.join;
    context.miterLimit = style.miterLimit;
    context.setLineDash([...style.dash]);
    context.lineDashOffset = style.dashOffset;
}

/** Exact filled/stroked paths decide hits; bounds are only the spatial broad phase. */
export function createNativePicker(parts: readonly NativePaintPart[], context: CanvasRenderingContext2D): ElementPicker {
    if (!parts.length) return () => [];
    const spatial = new Flatbush(parts.length);
    for (const part of parts) spatial.add(...part.bounds);
    spatial.finish();
    return (point, tolerance) => {
        const distance = Math.max(0, Number.isFinite(tolerance) ? tolerance : 0);
        const candidates = spatial.search(point[0] - distance, point[1] - distance, point[0] + distance, point[1] + distance)
            .sort((a, b) => parts[b]!.paintOrder - parts[a]!.paintOrder);
        const exact: NativePaintPart[] = [];
        const nearby: NativePaintPart[] = [];
        context.save();
        try {
            context.setTransform(1, 0, 0, 1, 0, 0);
            for (const index of candidates) {
                const part = parts[index]!;
                if (!part.clips.every((clip) => {
                    const local = transformPoint(clip.fromPage, point);
                    return context.isPointInPath(clip.path, local[0], local[1], clip.rule);
                })) continue;
                const local = transformPoint(part.fromPage, point);
                if (part.mode === 'fill') {
                    if (context.isPointInPath(part.path, local[0], local[1], part.rule)) exact.push(part);
                    continue;
                }
                setStrokeStyle(context, part.stroke);
                if (context.isPointInStroke(part.path, local[0], local[1])) exact.push(part);
                else if (distance) {
                    setStrokeStyle(context, part.stroke, localTolerance(part.fromPage, distance));
                    if (context.isPointInStroke(part.path, local[0], local[1])) nearby.push(part);
                }
            }
        } finally {
            context.restore();
        }
        const seen = new Set<string>();
        const hits: ElementHit[] = [];
        for (const part of [...exact, ...nearby]) {
            if (seen.has(part.appearanceId)) continue;
            seen.add(part.appearanceId);
            hits.push({ elementKey: part.elementKey, occurrenceId: part.appearanceId });
        }
        return hits;
    };
}

function boundsArgument(value: unknown): NativeBounds | undefined {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return undefined;
    const numbers = Array.from(value as ArrayLike<number>);
    if (numbers.length !== 4 || numbers.some((number) => !Number.isFinite(number))) return undefined;
    const [x0, y0, x1, y1] = numbers as [number, number, number, number];
    return x0 <= x1 && y0 <= y1 ? [x0, y0, x1, y1] : undefined;
}

function occurrenceKey(occurrence: NativeOccurrence): string {
    return JSON.stringify([occurrence.pageNumber, occurrence.drawingId ?? occurrence.viewId ?? null, occurrence.elementKey]);
}

/** Capture painted native paths while PDF.js executes every original operation. */
export function createNativeGeometryCapture(source: NativeTagIndex, publish: (geometry: NativeGeometry) => void): RenderCaptureFactory {
    return async (frame) => {
        const operators = await frame.pdfPage.getOperatorList({ annotationMode: frame.annotationMode });
        if (frame.signal.aborted) return undefined;
        const tags = source.forOperators(operators);
        const parts: NativePaintPart[] = [];
        const unsupportedElementKeys = new Set<string>();
        const unsupportedOperations = new Set<number>();
        let currentIndex = -1;
        let currentOccurrence: NativeOccurrence | undefined;
        let operationBounds: NativeBounds | undefined;
        let clips: readonly NativeClip[] = [];
        let unknownClip = false;
        const stack: { clips: readonly NativeClip[]; unknown: boolean }[] = [];
        const methods = new Map<PropertyKey, unknown>();
        const context = frame.context;

        const unsupported = () => {
            if (currentOccurrence?.status !== 'resolved' || !currentOccurrence.elementKey) return;
            unsupportedElementKeys.add(currentOccurrence.elementKey);
            unsupportedOperations.add(currentIndex);
        };
        const record = (mode: 'stroke' | 'fill', args: unknown[]) => {
            if (currentOccurrence?.status !== 'resolved' || !currentOccurrence.elementKey || context.globalAlpha <= 0) return;
            const path = args[0];
            const style = mode === 'stroke' ? context.strokeStyle : context.fillStyle;
            if (!(path instanceof Path2D) || !operationBounds || unknownClip || typeof style !== 'string' || context.globalCompositeOperation !== 'source-over') {
                unsupported();
                return;
            }
            const toPage = contextToPage(matrixFromContext(context), frame.presentation);
            let fromPage: Matrix;
            try { fromPage = inverseMatrix(toPage); } catch { unsupported(); return; }
            const stroke: NativeStrokeStyle = {
                width: context.lineWidth, cap: context.lineCap, join: context.lineJoin,
                miterLimit: context.miterLimit, dash: context.getLineDash(), dashOffset: context.lineDashOffset,
            };
            // The operation box was transformed before PDF.js's optional stroke rescaling.
            const padding = mode === 'stroke' ? maxScale(toPage) * stroke.width / 2 * (stroke.join === 'miter' ? Math.max(1, stroke.miterLimit) : 2) : 0;
            const bounds: NativeBounds = [operationBounds[0] - padding, operationBounds[1] - padding, operationBounds[2] + padding, operationBounds[3] + padding];
            if (bounds.some((value) => !Number.isFinite(value))) { unsupported(); return; }
            parts.push({
                elementKey: currentOccurrence.elementKey, occurrenceId: currentOccurrence.id,
                appearanceId: occurrenceKey(currentOccurrence), drawingId: currentOccurrence.drawingId,
                path: new Path2D(path), toPage, fromPage, bounds, mode,
                rule: args[1] === 'evenodd' ? 'evenodd' : 'nonzero', stroke, clips,
                paintOrder: parts.length,
            });
        };

        const wrapped = new Proxy(context, {
            get(target, property) {
                if (methods.has(property)) return methods.get(property);
                const value = Reflect.get(target, property, target) as unknown;
                if (typeof value !== 'function') return value;
                let method: (...args: unknown[]) => unknown;
                if (property === 'save') method = (...args) => {
                    stack.push({ clips, unknown: unknownClip });
                    return Reflect.apply(value, target, args);
                };
                else if (property === 'restore') method = (...args) => {
                    const state = stack.pop();
                    if (state) { clips = state.clips; unknownClip = state.unknown; }
                    return Reflect.apply(value, target, args);
                };
                else if (property === 'clip') method = (...args) => {
                    if (args[0] instanceof Path2D) {
                        const toPage = contextToPage(matrixFromContext(target), frame.presentation);
                        try {
                            clips = [...clips, { path: new Path2D(args[0]), toPage, fromPage: inverseMatrix(toPage), rule: args[1] === 'evenodd' ? 'evenodd' : 'nonzero' }];
                        } catch { unknownClip = true; }
                    } else unknownClip = true;
                    return Reflect.apply(value, target, args);
                };
                else if (property === 'stroke' || property === 'fill') method = (...args) => {
                    record(property, args);
                    return Reflect.apply(value, target, args);
                };
                else if (property === 'drawImage' || property === 'fillText' || property === 'strokeText' || property === 'fillRect' || property === 'strokeRect') method = (...args) => {
                    unsupported();
                    return Reflect.apply(value, target, args);
                };
                else method = (...args) => Reflect.apply(value, target, args);
                methods.set(property, method);
                return method;
            },
            set(target, property, value) { return Reflect.set(target, property, value, target); },
        });

        return {
            context: wrapped,
            onOperation(index) {
                currentIndex = index;
                currentOccurrence = tags.active[index];
                operationBounds = undefined;
                if (operators.fnArray[index] === OPS.constructPath) {
                    const args = operators.argsArray[index] as unknown[] | undefined;
                    const bounds = boundsArgument(args?.[2]);
                    if (bounds) operationBounds = transformedBounds(bounds, contextToPage(matrixFromContext(context), frame.presentation));
                }
            },
            onComplete() {
                if (frame.signal.aborted) return;
                const elementKeys = new Set(parts.map((part) => part.elementKey));
                for (const key of tags.resolvedElementKeys) if (!elementKeys.has(key)) unsupportedElementKeys.add(key);
                // A dedicated hit context avoids changing an in-progress base render's state.
                const ownerDocument = context.canvas?.ownerDocument;
                const pickContext = ownerDocument?.createElement('canvas').getContext('2d') ?? context;
                publish({
                    source, presentation: frame.presentation, parts, elementKeys,
                    appearanceIds: new Set(parts.map((part) => part.appearanceId)),
                    pick: createNativePicker(parts, pickContext), unsupportedElementKeys,
                    unsupportedPaints: unsupportedOperations.size,
                });
            },
            dispose() { methods.clear(); },
        };
    };
}
