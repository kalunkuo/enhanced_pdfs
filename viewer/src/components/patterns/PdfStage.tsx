import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createShapePicker } from '../../lib/hit';
import { clampZoom, type ElementPicker, type PagePresentation, type RenderCaptureFactory, type Tool, type ZoomMode } from '../../lib/presentation';
import type { Annotation, PageData, Point } from '../../lib/types';
import { CommentLayer, type CommentLayerProps } from './CommentLayer';
import { ElementOverlay } from './ElementOverlay';
import { MarkupLayer } from './MarkupLayer';
import { PdfCanvas } from './PdfCanvas';

// Preserve toolbar imports while shared interfaces live outside the stage.
export { clampZoom, MAX_ZOOM, MIN_ZOOM, type Tool, type ZoomMode } from '../../lib/presentation';

interface Props {
    pdf: PDFDocumentProxy;
    page: PageData;
    zoomMode: ZoomMode;
    hideEmbeddedAnnotations: boolean;
    tool: Tool;
    hoverKey: string | null;
    selectedKey: string | null;
    annotations: Annotation[];
    selectedAnnotationId: string | null;
    highlightColor: string;
    labelFor: (elementKey: string) => string;
    onZoom: (effective: number) => void;
    onHover: (key: string | null, at: { x: number; y: number }) => void;
    onSelectElement: (key: string | null) => void;
    onSelectAnnotation: (id: string | null) => void;
    onAddAnnotation: (a: Omit<Annotation, 'id' | 'elementKey' | 'page'>) => void;
    /** Comment threads drawn over the page. `comments`, `page` and `zoom` come from the stage. */
    commentLayer: Omit<CommentLayerProps, 'page' | 'zoom' | 'comments' | 'pick'>;
    /** The comment tool was clicked at a page point. */
    onStartComment: (point: Point) => void;
    pickElement?: ElementPicker;
    createCapture?: RenderCaptureFactory;
    onPresentation?: (presentation: PagePresentation) => void;
    onRenderError?: (error: unknown) => void;
}

const PAD_X = 104;
const PAD_Y = 32;

/** Composes the renderer, semantic overlay, and review layer. Shared wiring has one owner. */
export function PdfStage(props: Props) {
    const { pdf, page, tool, zoomMode, onZoom } = props;
    const wrapRef = useRef<HTMLDivElement>(null);
    const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const [size, setSize] = useState({ w: 800, h: 600 });
    const [panning, setPanning] = useState(false);
    const pickElement = useMemo(() => props.pickElement ?? createShapePicker(page.shapes), [props.pickElement, page.shapes]);
    const zoom = useMemo(() => {
        const fitWidth = (size.w - PAD_X) / page.width;
        if (zoomMode.kind === 'fit-width') return clampZoom(fitWidth);
        if (zoomMode.kind === 'fit-page') return clampZoom(Math.min(fitWidth, (size.h - PAD_Y) / page.height));
        return clampZoom(zoomMode.value);
    }, [zoomMode, size, page.width, page.height]);

    useEffect(() => {
        onZoom(zoom);
    }, [zoom, onZoom]);
    useEffect(() => {
        panRef.current = null;
        setPanning(false);
    }, [page, tool]);
    useEffect(() => {
        const element = wrapRef.current;
        if (!element) return;
        const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (tool !== 'pan' || event.button !== 0 || !wrapRef.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = { x: event.clientX, y: event.clientY, left: wrapRef.current.scrollLeft, top: wrapRef.current.scrollTop };
        setPanning(true);
    };
    const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
        const pan = panRef.current;
        if (!pan || !wrapRef.current) return;
        wrapRef.current.scrollLeft = pan.left - (event.clientX - pan.x);
        wrapRef.current.scrollTop = pan.top - (event.clientY - pan.y);
    };
    const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!panRef.current) return;
        panRef.current = null;
        setPanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const noteTool = tool === 'text' || tool === 'comment' || tool === 'signature';
    const toolClass = tool === 'pan' ? (panning ? 'tool-panning' : 'tool-pan') : tool === 'select' ? 'tool-select' : noteTool ? 'tool-text' : 'tool-draw';

    return (
        <div className="stage" ref={wrapRef}>
            <div
                className={`page ${toolClass} ${props.hoverKey && tool === 'select' ? 'hovering' : ''}`}
                style={{ width: page.width * zoom, height: page.height * zoom }}
                onPointerDown={startPan}
                onPointerMove={movePan}
                onPointerUp={finishPan}
                onPointerCancel={finishPan}
            >
                <PdfCanvas pdf={pdf} pageNumber={page.number} zoom={zoom} hideEmbeddedAnnotations={props.hideEmbeddedAnnotations}
                    createCapture={props.createCapture} onPresentation={props.onPresentation} onError={props.onRenderError} />
                <MarkupLayer page={page} zoom={zoom} tool={tool} annotations={props.annotations}
                    selectedAnnotationId={props.selectedAnnotationId} highlightColor={props.highlightColor} labelFor={props.labelFor}
                    onSelectAnnotation={props.onSelectAnnotation} onSelectElement={props.onSelectElement} onAddAnnotation={props.onAddAnnotation}
                    onElementMove={(point, client) => props.onHover(pickElement(point, 4 / zoom)[0]?.elementKey ?? null, client)}
                    onElementSelect={(point) => {
                        props.onSelectElement(pickElement(point, 4 / zoom)[0]?.elementKey ?? null);
                        props.onSelectAnnotation(null);
                    }}
                    onElementLeave={() => props.onHover(null, { x: 0, y: 0 })}
                    onStartComment={props.onStartComment}
                >
                    <ElementOverlay shapes={page.shapes} hoverKey={props.hoverKey} selectedKey={props.selectedKey} />
                </MarkupLayer>
                <CommentLayer page={page} zoom={zoom} comments={props.annotations.filter((a) => a.kind === 'comment')} pick={(point) => pickElement(point, 4 / zoom)[0]?.elementKey ?? null} {...props.commentLayer} />
            </div>
        </div>
    );
}
