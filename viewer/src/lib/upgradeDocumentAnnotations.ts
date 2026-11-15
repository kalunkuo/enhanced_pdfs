import { AnnotationMode, type RenderTask } from 'pdfjs-dist';
import { createShapePicker } from './hit';
import { createNativeGeometryCapture, type NativeGeometry } from './nativeGeometry';
import { createPagePresentation, type RenderCapture } from './presentation';
import { upgradePageAnnotations, type AnnotationUpgradeContext, type AnnotationUpgradeResult } from './upgradeAnnotations';
import type { Annotation, EnhancedPdf, PageData } from './types';

type LocatedPage = Pick<AnnotationUpgradeContext, 'picker' | 'bounds'>;
const PIXEL_BUDGET = 4_000_000;
const MAX_CANVAS_SIDE = 16_384;

/** Cap both total allocation and extreme-aspect-ratio canvas dimensions. DPR is unnecessary for indexing. */
export function annotationUpgradeScale(width: number, height: number): number {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid drawing page size.');
    const scale = Math.min(1, Math.sqrt(PIXEL_BUDGET / width / height), MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid drawing page size.');
    return scale;
}

function checkAbort(signal: AbortSignal): void {
    if (signal.aborted) throw signal.reason ?? new DOMException('Comment upgrade canceled.', 'AbortError');
}

async function locatePage(doc: EnhancedPdf, page: PageData, signal: AbortSignal): Promise<LocatedPage> {
    if (!page.nativeTags?.resolvedElementKeys.size) {
        if (page.geometrySource === 'native') throw new Error('Native drawing identities are unavailable.');
        return { picker: createShapePicker(page.shapes), bounds: page.shapes.map((shape) => ({ elementKey: shape.elementKey, drawingId: shape.drawingId, bounds: shape.bbox })) };
    }
    const pdfPage = await doc.pdf.getPage(page.number);
    checkAbort(signal);
    const scale = annotationUpgradeScale(page.width, page.height);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    let capture: RenderCapture | undefined;
    let task: RenderTask | undefined;
    let geometry: NativeGeometry | undefined;
    const onAbort = () => task?.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('A 2D canvas is required to read drawing geometry.');
        const outputScale = { x: canvas.width / viewport.width, y: canvas.height / viewport.height };
        const presentation = createPagePresentation(pdfPage, scale, outputScale, 1);
        capture = await createNativeGeometryCapture(page.nativeTags, (result) => { if (!signal.aborted) geometry = result; })({
            pdfPage, presentation, context, signal, annotationMode: AnnotationMode.ENABLE,
        });
        checkAbort(signal);
        if (!capture) throw new Error('Drawing geometry capture did not start.');
        const observe = capture.onOperation;
        task = pdfPage.render({
            canvas: null, canvasContext: capture.context ?? context, viewport,
            transform: [outputScale.x, 0, 0, outputScale.y, 0, 0], annotationMode: AnnotationMode.ENABLE,
            // Execute every operation: paint, transforms, state, paths, and clips all matter.
            operationsFilter: (index) => { observe?.(index); return true; },
        });
        if (signal.aborted) task.cancel();
        await task.promise;
        checkAbort(signal);
        await capture.onComplete?.();
        checkAbort(signal);
        if (!geometry) throw new Error('Drawing geometry capture did not complete.');
        return { picker: geometry.pick, bounds: geometry.parts };
    } finally {
        signal.removeEventListener('abort', onAbort);
        capture?.dispose?.();
        canvas.width = canvas.height = 0;
    }
}

/** Catch up every pending annotated page without requiring the user to visit or render it first. */
export async function upgradeDocumentAnnotations(doc: EnhancedPdf, annotations: readonly Annotation[], options: {
    signal: AbortSignal;
    onPage: (result: AnnotationUpgradeResult, pageNumber: number) => void;
    onProgress?: (completed: number, total: number) => void;
}): Promise<void> {
    const { signal } = options;
    checkAbort(signal);
    const pages = [...new Set(annotations.filter((annotation) => annotation.source?.linkState === 'pending' &&
        annotation.source.linkMethod !== 'manual' && annotation.source.linkMethod !== 'plugin' &&
        annotation.page >= 1 && annotation.page <= doc.pageCount).map((annotation) => annotation.page))].sort((a, b) => a - b);
    let current = annotations;
    options.onProgress?.(0, pages.length);
    for (let index = 0; index < pages.length; index++) {
        const number = pages[index]!;
        checkAbort(signal);
        try {
            const page = await doc.page(number);
            checkAbort(signal);
            const located = await locatePage(doc, page, signal);
            checkAbort(signal);
            const pageElementKeys = new Set([...(page.elementKeys ?? []), ...(page.nativeTags?.resolvedElementKeys ?? []), ...page.shapes.map((shape) => shape.elementKey)]);
            const result = upgradePageAnnotations(current, { pageNumber: number, elements: doc.elements, ...located, geometryReady: true, pageElementKeys });
            checkAbort(signal);
            current = result.annotations;
            options.onPage(result, number);
            checkAbort(signal);
            options.onProgress?.(index + 1, pages.length);
        } catch {
            checkAbort(signal);
            throw new Error(`Could not link existing markups on page ${number}. Their original PDF graphics are preserved. Try again.`);
        }
    }
}
