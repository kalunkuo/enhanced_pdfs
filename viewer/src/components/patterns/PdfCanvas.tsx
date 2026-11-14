import { AnnotationMode, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import { useEffect, useRef } from 'react';
import { createPagePresentation, type PagePresentation, type RenderCapture, type RenderCaptureFactory } from '../../lib/presentation';

export interface PdfCanvasProps {
    pdf: PDFDocumentProxy;
    pageNumber: number;
    zoom: number;
    hideEmbeddedAnnotations: boolean;
    createCapture?: RenderCaptureFactory;
    onPresentation?: (presentation: PagePresentation) => void;
    onError?: (error: unknown) => void;
}

/** Owns the base raster and render cancellation; contains no BIM or markup state. */
export function PdfCanvas({ pdf, pageNumber, zoom, hideEmbeddedAnnotations, createCapture, onPresentation, onError }: PdfCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tailRef = useRef<Promise<void>>(Promise.resolve());
    const generationRef = useRef(0);
    const callbacks = useRef({ onPresentation, onError });
    callbacks.current = { onPresentation, onError };

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        let task: RenderTask | undefined;
        const generation = ++generationRef.current;
        const previous = tailRef.current;
        const work = async () => {
            // A cancelled render must settle before its canvas is resized/reused.
            await previous;
            if (cancelled) return;
            const pdfPage = await pdf.getPage(pageNumber);
            const canvas = canvasRef.current;
            if (cancelled || !canvas) return;
            const viewport = pdfPage.getViewport({ scale: zoom });
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.max(1, Math.ceil(viewport.width * dpr));
            canvas.height = Math.max(1, Math.ceil(viewport.height * dpr));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('A 2D canvas is required to display the PDF.');
            const outputScale = { x: canvas.width / viewport.width, y: canvas.height / viewport.height };
            const presentation = createPagePresentation(pdfPage, zoom, outputScale, generation);
            let capture: RenderCapture | undefined;
            try {
                capture = await createCapture?.({ pdfPage, presentation, context, signal: controller.signal });
                if (cancelled) return;
                const onOperation = capture?.onOperation;
                task = pdfPage.render({
                    canvas: null,
                    canvasContext: capture?.context ?? context,
                    viewport,
                    transform: [outputScale.x, 0, 0, outputScale.y, 0, 0],
                    annotationMode: hideEmbeddedAnnotations ? AnnotationMode.DISABLE : AnnotationMode.ENABLE,
                    operationsFilter: onOperation ? (index) => {
                        onOperation(index);
                        return true;
                    } : undefined,
                });
                await task.promise;
                if (cancelled) return;
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
    }, [pdf, pageNumber, zoom, hideEmbeddedAnnotations, createCapture]);

    return <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />;
}
