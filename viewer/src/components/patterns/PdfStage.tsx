import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createShapePicker } from '../../lib/hit';
import { clampZoom, type ElementPicker, type PagePresentation, type RenderCaptureFactory, type Tool, type ZoomMode } from '../../lib/presentation';
import type { Annotation, PageData } from '../../lib/types';
import { ElementOverlay } from './ElementOverlay';
import { MarkupLayer } from './MarkupLayer';
import { PdfCanvas } from './PdfCanvas';
import { NativeElementOverlay } from './NativeElementOverlay';
import type { NativeGeometry } from '../../lib/nativeGeometry';

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
    onZoomMode?: (mode: ZoomMode) => void;
    onHover: (key: string | null, at: { x: number; y: number }) => void;
    onSelectElement: (key: string | null) => void;
    onSelectAnnotation: (id: string | null) => void;
    onAddAnnotation: (a: Omit<Annotation, 'id' | 'elementKey' | 'page'>) => void;
    pickElement?: ElementPicker;
    createCapture?: RenderCaptureFactory;
    onPresentation?: (presentation: PagePresentation) => void;
    onRenderError?: (error: unknown) => void;
    geometry?: NativeGeometry | null;
    matchedKeys?: ReadonlySet<string> | null;
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
    const [pickNotice, setPickNotice] = useState<string | null>(null);
    const previousPick = useRef<{ x: number; y: number; keys: string; index: number; time: number } | null>(null);
    const pickElement = useMemo(() => props.pickElement ?? createShapePicker(page.shapes), [props.pickElement, page.shapes]);
    const zoom = useMemo(() => {
        const fitWidth = (size.w - PAD_X) / page.width;
        if (zoomMode.kind === 'fit-width') return clampZoom(fitWidth);
        if (zoomMode.kind === 'fit-page') return clampZoom(Math.min(fitWidth, (size.h - PAD_Y) / page.height));
        return clampZoom(zoomMode.value);
    }, [zoomMode, size, page.width, page.height]);

    useEffect(() => onZoom(zoom), [zoom, onZoom]);

    // Two-finger scroll (and pinch, which browsers report as ctrl+wheel) zooms around the cursor.
    const pageRef = useRef<HTMLDivElement>(null);
    const zoomRef = useRef(zoom);
    const anchorRef = useRef<{ clientX: number; clientY: number; fx: number; fy: number } | null>(null);
    const onZoomModeRef = useRef(props.onZoomMode);
    onZoomModeRef.current = props.onZoomMode;
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);
    useEffect(() => {
        const element = wrapRef.current;
        if (!element) return;
        const onWheel = (event: WheelEvent) => {
            const setMode = onZoomModeRef.current;
            const pageEl = pageRef.current;
            if (!setMode || !pageEl) return;
            event.preventDefault();
            const lineScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
            const delta = event.deltaY * lineScale;
            if (!delta) return;
            const sensitivity = event.ctrlKey ? 0.01 : 0.0025;
            const next = clampZoom(zoomRef.current * Math.exp(-delta * sensitivity));
            if (next === zoomRef.current) return;
            const rect = pageEl.getBoundingClientRect();
            anchorRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
                fx: rect.width ? (event.clientX - rect.left) / rect.width : 0.5,
                fy: rect.height ? (event.clientY - rect.top) / rect.height : 0.5,
            };
            zoomRef.current = next;
            setMode({ kind: 'value', value: next });
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, []);
    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const element = wrapRef.current;
        const pageEl = pageRef.current;
        if (!anchor || !element || !pageEl) return;
        anchorRef.current = null;
        const rect = pageEl.getBoundingClientRect();
        element.scrollLeft += rect.left + anchor.fx * rect.width - anchor.clientX;
        element.scrollTop += rect.top + anchor.fy * rect.height - anchor.clientY;
    }, [zoom]);
    useEffect(() => {
        panRef.current = null;
        setPanning(false);
        previousPick.current = null;
        setPickNotice(null);
    }, [page, tool]);
    useEffect(() => {
        const element = wrapRef.current;
        if (!element) return;
        const measure = () => setSize((current) => current.w === element.clientWidth && current.h === element.clientHeight
            ? current : { w: element.clientWidth, h: element.clientHeight });
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
                ref={pageRef}
                className={`page ${toolClass} ${props.hoverKey && tool === 'select' ? 'hovering' : ''}`}
                style={{ width: page.width * zoom, height: page.height * zoom }}
                onPointerDown={startPan}
                onPointerMove={movePan}
                onPointerUp={finishPan}
                onPointerCancel={finishPan}
            >
                <PdfCanvas pdf={pdf} pageNumber={page.number} zoom={zoom} hideEmbeddedAnnotations={props.hideEmbeddedAnnotations}
                    createCapture={props.createCapture} onPresentation={props.onPresentation} onError={props.onRenderError} />
                <NativeElementOverlay geometry={props.geometry ?? null} pageNumber={page.number} zoom={zoom} width={page.width} height={page.height}
                    hoverKey={props.hoverKey} selectedKey={props.selectedKey} matchedKeys={props.matchedKeys ?? null} />
                <MarkupLayer page={page} zoom={zoom} tool={tool} annotations={props.annotations}
                    selectedAnnotationId={props.selectedAnnotationId} highlightColor={props.highlightColor} labelFor={props.labelFor}
                    onSelectAnnotation={props.onSelectAnnotation} onSelectElement={props.onSelectElement} onAddAnnotation={props.onAddAnnotation}
                    onElementMove={(point, client) => props.onHover(pickElement(point, 4 / zoom)[0]?.elementKey ?? null, client)}
                    onElementSelect={(point) => {
                        const hits = [...new Map(pickElement(point, 4 / zoom).map((hit) => [hit.elementKey, hit])).values()];
                        const keys = hits.map((hit) => hit.elementKey).join('\n');
                        const previous = previousPick.current;
                        const now = performance.now();
                        const repeat = previous && previous.keys === keys && now - previous.time < 3000 && Math.hypot(previous.x - point[0], previous.y - point[1]) < 6 / zoom;
                        const index = repeat && hits.length ? (previous.index + 1) % hits.length : 0;
                        previousPick.current = { x: point[0], y: point[1], keys, index, time: now };
                        props.onSelectElement(hits[index]?.elementKey ?? null);
                        setPickNotice(hits.length > 1 ? `${index + 1} of ${hits.length} elements · click again to cycle` : null);
                        props.onSelectAnnotation(null);
                    }}
                    onElementLeave={() => props.onHover(null, { x: 0, y: 0 })}
                >
                    <ElementOverlay shapes={page.shapes} hoverKey={props.hoverKey} selectedKey={props.selectedKey} />
                </MarkupLayer>
                {pickNotice && <div className="pick-status" role="status">{pickNotice}</div>}
            </div>
        </div>
    );
}
