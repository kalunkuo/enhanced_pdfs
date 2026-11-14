import type { PDFPageProxy } from 'pdfjs-dist';
import type { AnnotationKind, Point, Shape } from './types';

export type Tool = 'select' | 'pan' | AnnotationKind;
export type ZoomMode = { kind: 'fit-width' } | { kind: 'fit-page' } | { kind: 'value'; value: number };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Canvas/PDF affine order: [a, b, c, d, e, f]. */
export type Matrix = readonly [number, number, number, number, number, number];

export function transformPoint(matrix: Matrix, point: Point): Point {
    const [a, b, c, d, e, f] = matrix;
    return [a * point[0] + c * point[1] + e, b * point[0] + d * point[1] + f];
}

export function inverseMatrix(matrix: Matrix): Matrix {
    const [a, b, c, d, e, f] = matrix;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || determinant === 0) throw new Error('The page transform is not invertible.');
    return [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, (b * e - a * f) / determinant];
}

/** Rendering and interaction share this snapshot; DPR only affects outputScale. */
export interface PagePresentation {
    pageNumber: number;
    generation: number;
    pageBox: readonly [number, number, number, number];
    rotation: number;
    userUnit: number;
    /** Existing annotations use PDF.js's scale-1 viewport: top-left, y down. */
    pageWidth: number;
    pageHeight: number;
    cssWidth: number;
    cssHeight: number;
    zoom: number;
    outputScale: Readonly<{ x: number; y: number }>;
    pdfToPage: Matrix;
    pageToPdf: Matrix;
    pdfToCss: Matrix;
    cssToPdf: Matrix;
    pageToCss: Matrix;
    cssToPage: Matrix;
}

type PresentedPage = Pick<PDFPageProxy, 'pageNumber' | 'view' | 'rotate' | 'userUnit' | 'getViewport'>;

export function createPagePresentation(page: PresentedPage, zoom: number, outputScale: Readonly<{ x: number; y: number }>, generation: number): PagePresentation {
    if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('The page zoom must be positive.');
    const viewport = page.getViewport({ scale: 1 });
    const values = viewport.transform as number[];
    if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) throw new Error('Invalid PDF page transform.');
    const pdfToPage = [...values] as unknown as Matrix;
    const pdfToCss = values.map((value) => value * zoom) as unknown as Matrix;
    const box = page.view as number[];
    return {
        pageNumber: page.pageNumber, generation,
        pageBox: [box[0]!, box[1]!, box[2]!, box[3]!],
        rotation: page.rotate, userUnit: page.userUnit,
        pageWidth: viewport.width, pageHeight: viewport.height,
        cssWidth: viewport.width * zoom, cssHeight: viewport.height * zoom,
        zoom, outputScale, pdfToPage, pageToPdf: inverseMatrix(pdfToPage),
        pdfToCss, cssToPdf: inverseMatrix(pdfToCss),
        pageToCss: [zoom, 0, 0, zoom, 0, 0],
        cssToPage: [1 / zoom, 0, 0, 1 / zoom, 0, 0],
    };
}

export interface ElementHit {
    elementKey: string;
    /** Present in the legacy adapter; native paint parts need not be polygons. */
    shape?: Shape;
    occurrenceId?: string;
}

/** Page-space point and tolerance. All candidates allow future overlap cycling. */
export type ElementPicker = (point: Point, tolerance: number) => readonly ElementHit[];

export interface RenderCaptureFrame {
    pdfPage: PDFPageProxy;
    presentation: PagePresentation;
    context: CanvasRenderingContext2D;
    /** Check before publishing asynchronous geometry after a page/zoom change. */
    signal: AbortSignal;
    /** The same annotation mode used by the render whose operation indices we observe. */
    annotationMode: number;
}

/** Hooks observe a complete render; consumers cannot skip PDF state operations. */
export interface RenderCapture {
    context?: CanvasRenderingContext2D;
    onOperation?: (index: number) => void;
    onComplete?: () => void | Promise<void>;
    dispose?: () => void;
}

export type RenderCaptureFactory = (frame: RenderCaptureFrame) => RenderCapture | undefined | Promise<RenderCapture | undefined>;
