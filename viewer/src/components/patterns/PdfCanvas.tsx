import { AnnotationMode, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPagePresentation, type PagePresentation, type RenderCapture, type RenderCaptureFactory } from '../../lib/presentation';
import { visibleAnnotationOperations } from '../../lib/annotationVisibility';

export interface PdfCanvasProps {
    pdf: PDFDocumentProxy;
    pageNumber: number;
    zoom: number;
    /** Scale-1 page size; bounds the base raster before the page proxy loads. */
    pageWidth: number;
    pageHeight: number;
    /** Scrolling element whose viewport decides which part of the page is rendered sharply. */
    scrollContainer: RefObject<HTMLElement | null>;
    hiddenAnnotationIds?: ReadonlySet<string>;
    createCapture?: RenderCaptureFactory;
    onPresentation?: (presentation: PagePresentation) => void;
    onError?: (error: unknown) => void;
}

/** Full-page base raster: drives native capture, shown blurred under the detail tile when zoomed in. */
const BASE_PIXEL_BUDGET = 4_000_000;
/** Extra page rendered around the visible area, as a fraction of the visible width/height per side. */
const DETAIL_MARGIN = 0.1;
const DETAIL_PIXEL_BUDGET = 16_000_000;
/** Scroll/zoom must settle this long before a detail tile is rasterized. */
const DETAIL_DELAY_MS = 120;
const NO_HIDDEN_ANNOTATIONS: ReadonlySet<string> = new Set();

/** Scale-1 page units: [x0, y0, x1, y1], top-left origin. */
type PageRect = readonly [number, number, number, number];

/** Zoom of the base raster: the requested zoom, capped so the whole page stays within the pixel budget. */
export function baseRasterZoom(zoom: number, pageWidth: number, pageHeight: number, dpr: number, budget = BASE_PIXEL_BUDGET): number {
    const area = Math.max(1, pageWidth * pageHeight);
    return Math.min(zoom, Math.sqrt(budget / area) / dpr);
}

/** Visible page rect grown by `margin` of its size on each side, clamped to the page. */
export function expandRect(rect: PageRect, margin: number, pageWidth: number, pageHeight: number): PageRect {
    const mx = (rect[2] - rect[0]) * margin, my = (rect[3] - rect[1]) * margin;
    return [Math.max(0, rect[0] - mx), Math.max(0, rect[1] - my), Math.min(pageWidth, rect[2] + mx), Math.min(pageHeight, rect[3] + my)];
}

const contains = (outer: PageRect, inner: PageRect) =>
    inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

/**
 * Owns the base raster and render cancellation; contains no BIM or markup state.
 * The base raster is a bounded full-page render (and the capture render); above that resolution a
 * detail tile covers only the visible area plus a margin, so zooming in never rasterizes the whole sheet.
 */
export function PdfCanvas({ pdf, pageNumber, zoom, pageWidth, pageHeight, scrollContainer, hiddenAnnotationIds = NO_HIDDEN_ANNOTATIONS, createCapture, onPresentation, onError }: PdfCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tailRef = useRef<Promise<void>>(Promise.resolve());
    const generationRef = useRef(0);
    const callbacks = useRef({ onPresentation, onError });
    callbacks.current = { onPresentation, onError };
    const dpr = window.devicePixelRatio || 1;
    // Constant once zoom exceeds the budget, so zooming further in does not repeat the full render or capture.
    const baseZoom = baseRasterZoom(zoom, pageWidth, pageHeight, dpr);
    const annotationMode = AnnotationMode.ENABLE;

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        let task: RenderTask | undefined;
        const generation = ++generationRef.current;
        const previous = tailRef.current;
        const work = async () => {
            // A cancelled render must settle before a new one starts.
            await previous;
            if (cancelled) return;
            const pdfPage = await pdf.getPage(pageNumber);
            if (cancelled || !canvasRef.current) return;
            const visible = hiddenAnnotationIds.size ? visibleAnnotationOperations(await pdfPage.getOperatorList({ annotationMode }), hiddenAnnotationIds) : undefined;
            if (cancelled) return;
            // Render off-screen and copy on completion so the page never flashes blank.
            const target = document.createElement('canvas');
            const viewport = pdfPage.getViewport({ scale: baseZoom });
            target.width = Math.max(1, Math.ceil(viewport.width * dpr));
            target.height = Math.max(1, Math.ceil(viewport.height * dpr));
            const context = target.getContext('2d');
            if (!context) throw new Error('A 2D canvas is required to display the PDF.');
            const outputScale = { x: target.width / viewport.width, y: target.height / viewport.height };
            // Describes the base raster that capture observes; interaction uses the stage zoom.
            const presentation = createPagePresentation(pdfPage, baseZoom, outputScale, generation);
            let capture: RenderCapture | undefined;
            try {
                capture = await createCapture?.({ pdfPage, presentation, context, signal: controller.signal, annotationMode });
                if (cancelled) return;
                const onOperation = capture?.onOperation;
                task = pdfPage.render({
                    canvas: null,
                    canvasContext: capture?.context ?? context,
                    viewport,
                    transform: [outputScale.x, 0, 0, outputScale.y, 0, 0],
                    annotationMode,
                    operationsFilter: onOperation || visible ? (index) => {
                        onOperation?.(index);
                        return visible?.(index) ?? true;
                    } : undefined,
                });
                await task.promise;
                if (cancelled) return;
                const canvas = canvasRef.current;
                if (!canvas) return;
                canvas.width = target.width;
                canvas.height = target.height;
                canvas.getContext('2d')?.drawImage(target, 0, 0);
                await capture?.onComplete?.();
                if (!cancelled) callbacks.current.onPresentation?.(presentation);
            } finally {
                capture?.dispose?.();
            }
        };
        tailRef.current = work().catch((error: unknown) => {
            if (!cancelled) callbacks.current.onError?.(error);
        });
        return () => {
            cancelled = true;
            controller.abort();
            task?.cancel();
        };
    }, [pdf, pageNumber, baseZoom, dpr, annotationMode, hiddenAnnotationIds, createCapture]);

    return <>
        <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />
        <PdfDetailTile pdf={pdf} pageNumber={pageNumber} zoom={zoom} dpr={dpr} annotationMode={annotationMode} hiddenAnnotationIds={hiddenAnnotationIds}
            active={zoom > baseZoom * 1.001} pageWidth={pageWidth} pageHeight={pageHeight}
            scrollContainer={scrollContainer} onError={(error) => callbacks.current.onError?.(error)} />
    </>;
}

interface Tile {
    pdf: PDFDocumentProxy;
    pageNumber: number;
    annotationMode: number;
    hiddenAnnotationIds: ReadonlySet<string>;
    rect: PageRect;
    zoom: number;
}

interface PdfDetailTileProps {
    pdf: PDFDocumentProxy;
    pageNumber: number;
    zoom: number;
    dpr: number;
    annotationMode: number;
    hiddenAnnotationIds: ReadonlySet<string>;
    active: boolean;
    pageWidth: number;
    pageHeight: number;
    scrollContainer: RefObject<HTMLElement | null>;
    onError: (error: unknown) => void;
}

/** Full-resolution raster of the visible page area plus a margin, re-rendered after scroll/zoom settles. */
function PdfDetailTile({ pdf, pageNumber, zoom, dpr, annotationMode, hiddenAnnotationIds, active, pageWidth, pageHeight, scrollContainer, onError }: PdfDetailTileProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [tile, setTile] = useState<Tile | null>(null);
    const tileRef = useRef<Tile | null>(null);
    tileRef.current = tile;
    const errorRef = useRef(onError);
    errorRef.current = onError;

    useEffect(() => {
        const container = scrollContainer.current;
        const canvas = canvasRef.current;
        const paper = canvas?.parentElement;
        if (!active || !container || !canvas || !paper) return;
        let disposed = false;
        let rendering = false;
        let pending = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let task: RenderTask | undefined;

        const visibleRect = (): PageRect | null => {
            const view = container.getBoundingClientRect();
            const page = paper.getBoundingClientRect();
            const x0 = Math.max(view.left, page.left) - page.left, x1 = Math.min(view.right, page.right) - page.left;
            const y0 = Math.max(view.top, page.top) - page.top, y1 = Math.min(view.bottom, page.bottom) - page.top;
            if (x1 <= x0 || y1 <= y0) return null;
            return [x0 / zoom, y0 / zoom, x1 / zoom, y1 / zoom];
        };
        const isCurrent = (current: Tile | null): current is Tile => !!current && current.pdf === pdf && current.pageNumber === pageNumber
            && current.annotationMode === annotationMode && current.hiddenAnnotationIds === hiddenAnnotationIds && current.zoom === zoom;

        const render = async () => {
            const visible = visibleRect();
            const current = tileRef.current;
            if (!visible || (isCurrent(current) && contains(current.rect, visible))) return;
            const rect = expandRect(visible, DETAIL_MARGIN, pageWidth, pageHeight);
            const cssWidth = (rect[2] - rect[0]) * zoom, cssHeight = (rect[3] - rect[1]) * zoom;
            const scale = dpr * Math.min(1, Math.sqrt(DETAIL_PIXEL_BUDGET / Math.max(1, cssWidth * cssHeight * dpr * dpr)));
            const target = document.createElement('canvas');
            target.width = Math.max(1, Math.ceil(cssWidth * scale));
            target.height = Math.max(1, Math.ceil(cssHeight * scale));
            const context = target.getContext('2d');
            if (!context) return;
            rendering = true;
            try {
                const pdfPage = await pdf.getPage(pageNumber);
                if (disposed) return;
                const visible = hiddenAnnotationIds.size ? visibleAnnotationOperations(await pdfPage.getOperatorList({ annotationMode }), hiddenAnnotationIds) : undefined;
                if (disposed) return;
                const sx = target.width / cssWidth, sy = target.height / cssHeight;
                task = pdfPage.render({
                    canvas: null,
                    canvasContext: context,
                    viewport: pdfPage.getViewport({ scale: zoom }),
                    // Shift the page so the tile's top-left corner lands at the canvas origin.
                    transform: [sx, 0, 0, sy, -rect[0] * zoom * sx, -rect[1] * zoom * sy],
                    annotationMode,
                    operationsFilter: visible,
                });
                await task.promise;
                if (disposed) return;
                canvas.width = target.width;
                canvas.height = target.height;
                canvas.getContext('2d')?.drawImage(target, 0, 0);
                const next = { pdf, pageNumber, annotationMode, hiddenAnnotationIds, rect, zoom };
                tileRef.current = next;
                setTile(next);
            } catch (error) {
                if (!disposed) errorRef.current(error);
            } finally {
                rendering = false;
                task = undefined;
            }
            // Scrolling continued during the render; catch up without cancelling finished work.
            if (pending && !disposed) {
                pending = false;
                schedule();
            }
        };
        const schedule = () => {
            if (rendering) { pending = true; return; }
            clearTimeout(timer);
            timer = setTimeout(() => { void render(); }, DETAIL_DELAY_MS);
        };

        schedule();
        container.addEventListener('scroll', schedule, { passive: true });
        const observer = new ResizeObserver(schedule);
        observer.observe(container);
        return () => {
            disposed = true;
            clearTimeout(timer);
            task?.cancel();
            container.removeEventListener('scroll', schedule);
            observer.disconnect();
        };
    }, [active, pdf, pageNumber, zoom, dpr, annotationMode, hiddenAnnotationIds, pageWidth, pageHeight, scrollContainer]);

    // A tile from another page/document/mode is never shown; a stale-zoom tile is stretched until replaced.
    const shown = active && tile && tile.pdf === pdf && tile.pageNumber === pageNumber && tile.annotationMode === annotationMode && tile.hiddenAnnotationIds === hiddenAnnotationIds ? tile : null;
    return <canvas ref={canvasRef} className="pdf-detail" aria-hidden="true" style={shown ? {
        left: shown.rect[0] * zoom, top: shown.rect[1] * zoom,
        width: (shown.rect[2] - shown.rect[0]) * zoom, height: (shown.rect[3] - shown.rect[1]) * zoom,
    } : { display: 'none' }} />;
}
