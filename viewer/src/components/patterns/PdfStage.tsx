import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createShapePicker } from '../../lib/hit';
import { clampZoom, type ElementPicker, type PagePresentation, type RenderCaptureFactory, type Tool, type ZoomMode } from '../../lib/presentation';
import type { Annotation, ContainedElement, PageData, Point } from '../../lib/types';
import { CommentLayer, type CommentLayerProps } from './CommentLayer';
import { ElementOverlay } from './ElementOverlay';
import { MarkupLayer } from './MarkupLayer';
import { PdfCanvas } from './PdfCanvas';
import { NativeElementOverlay } from './NativeElementOverlay';
import { SelectionActions } from './SelectionActions';
import type { NativeGeometry } from '../../lib/nativeGeometry';
import { collectFocusBounds, fitBounds, getFocusScrollOffset, type FocusRequest } from '../../lib/navigation';

// Preserve toolbar imports while shared interfaces live outside the stage.
export { clampZoom, MAX_ZOOM, MIN_ZOOM, type Tool, type ZoomMode } from '../../lib/presentation';

interface Props {
    pdf: PDFDocumentProxy;
    page: PageData;
    zoomMode: ZoomMode;
    hiddenAnnotationIds?: ReadonlySet<string>;
    tool: Tool;
    hoverKey: string | null;
    /** More objects drawn in the hover state, e.g. a category hovered in Properties. */
    previewKeys?: ReadonlySet<string> | null;
    /** Elements drawn as selected: a clicked element, or every filter match. */
    selectedKeys: ReadonlySet<string> | null;
    onSelectElements?: (keys: readonly string[], mode: 'replace' | 'add' | 'toggle') => void;
    /** Elements whose bounds touch a page rectangle, wholly inside first. */
    regionOf?: (rect: readonly [number, number, number, number]) => readonly { key: string; fully: boolean }[];
    annotations: Annotation[];
    selectedAnnotationId: string | null;
    highlightColor: string;
    labelFor: (elementKey: string) => string;
    onZoom: (effective: number) => void;
    onHover: (key: string | null, at: { x: number; y: number }) => void;
    onSelectElement: (key: string | null) => void;
    onSelectAnnotation: (id: string | null) => void;
    onAddAnnotation: (a: Omit<Annotation, 'id' | 'elementKey' | 'elementKeys' | 'page'>) => void;
    /** Comment threads drawn over the page. `comments`, `page` and `zoom` come from the stage. */
    commentLayer: Omit<CommentLayerProps, 'page' | 'zoom' | 'comments' | 'pick'>;
    /** The comment tool was clicked at a page point. */
    onStartComment: (point: Point) => void;
    /** A text box was dropped after a drag; the app re-ties it to whatever its leader tip is over. */
    onMoveAnnotation: (id: string, patch: { from: Point; to: Point }) => void;
    /** The elements a revision cloud with these corners would cover. */
    coverOf: (a: Pick<Annotation, 'from' | 'to'>) => ContainedElement[];
    pickElement?: ElementPicker;
    createCapture?: RenderCaptureFactory;
    onPresentation?: (presentation: PagePresentation) => void;
    onRenderError?: (error: unknown) => void;
    geometry?: NativeGeometry | null;
    matchedKeys?: ReadonlySet<string> | null;
    elementColors?: ReadonlyMap<string, string> | null;
    drawingIds?: ReadonlySet<string> | null;
    focusRequest?: FocusRequest | null;
    onZoomMode?: (mode: ZoomMode) => void;
    onFocusComplete?: (request: FocusRequest, located: boolean) => void;
    onCancelFocus?: () => void;
    /** Contextual actions on the element selection, shown on its corner in the select tool. */
    selectionActions?: {
        onSelectSimilar: () => void;
        /** Start a comment linked to the whole selection, its pin at `at` (page coordinates). */
        onComment: (at: Point) => void;
    };
}

const PAD_X = 104;
const PAD_Y = 32;

/** Composes the renderer, semantic overlay, and review layer. Shared wiring has one owner. */
export function PdfStage(props: Props) {
    const { pdf, page, tool, zoomMode, onZoom } = props;
    const wrapRef = useRef<HTMLDivElement>(null);
    const pageRef = useRef<HTMLDivElement>(null);
    const appliedFocus = useRef<number | null>(null);
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

    useEffect(() => {
        onZoom(zoom);
    }, [zoom, onZoom]);

    // Two-finger scroll (and pinch, which browsers report as ctrl+wheel) zooms around the cursor.
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

    useEffect(() => {
        const request = props.focusRequest;
        const container = wrapRef.current;
        const paper = pageRef.current;
        if (!request || request.id === appliedFocus.current || request.pageNumber !== page.number || !container || !paper || !props.onZoomMode) return;
        if (page.geometrySource === 'native' && !props.geometry) return;
        const raw = collectFocusBounds(props.geometry?.parts ?? [], page.shapes, request.elementKeys, request.drawingIds);
        const bounds = raw && [Math.max(0, raw[0]), Math.max(0, raw[1]), Math.min(page.width, raw[2]), Math.min(page.height, raw[3])] as const;
        const available = { width: size.w - PAD_X, height: size.h - PAD_Y };
        const plan = bounds && fitBounds(bounds, available);
        if (!plan) {
            appliedFocus.current = request.id;
            props.onFocusComplete?.(request, false);
            return;
        }
        // The next effect runs after React has committed the requested zoom to the page box.
        if (Math.abs(zoom - plan.zoom) > 0.000001) {
            props.onZoomMode({ kind: 'value', value: plan.zoom });
            return;
        }
        const offset = getFocusScrollOffset(plan.center, zoom, available, { x: paper.offsetLeft - 16, y: paper.offsetTop - 16 });
        container.scrollLeft = offset.left;
        container.scrollTop = offset.top;
        appliedFocus.current = request.id;
        props.onFocusComplete?.(request, true);
    }, [props.focusRequest, props.geometry, props.onZoomMode, props.onFocusComplete, page, size, zoom]);

    // Page-space bounds of the selection on this page, for pinning the selection bar to its corner.
    const selectionBounds = useMemo(() => {
        if (!props.selectedKeys?.size) return undefined;
        const raw = collectFocusBounds(props.geometry?.parts ?? [], page.shapes, props.selectedKeys, props.drawingIds ?? null);
        return raw && [Math.max(0, raw[0]), Math.max(0, raw[1]), Math.min(page.width, raw[2]), Math.min(page.height, raw[3])] as const;
    }, [props.selectedKeys, props.geometry, props.drawingIds, page]);
    const showSelectionActions = !!props.selectionActions && !!selectionBounds && tool === 'select' && !props.commentLayer.composerAt;

    const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (tool !== 'pan' || event.button !== 0 || !wrapRef.current) return;
        props.onCancelFocus?.();
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
    // Every annotation tool shares one cursor, which shows whether an object is under it (see review.css).
    const toolClass = tool === 'pan' ? (panning ? 'tool-panning' : 'tool-pan') : tool === 'select' ? 'tool-select' : ['line', 'rect', 'ellipse', 'highlight', 'pen', 'cloud'].includes(tool) ? 'tool-draw' : 'tool-review';
    const hoverClass = !props.hoverKey || tool === 'pan' ? '' : tool === 'select' ? 'hovering' : 'over-object';
    const selectedSource = props.annotations.find((annotation) => annotation.id === props.selectedAnnotationId)?.source;

    return (
        <div className="stage" ref={wrapRef} onWheel={() => props.onCancelFocus?.()}>
            <div
                ref={pageRef}
                className={`page ${toolClass} ${hoverClass}`}
                style={{ width: page.width * zoom, height: page.height * zoom }}
                onPointerDown={startPan}
                onPointerMove={movePan}
                onPointerUp={finishPan}
                onPointerCancel={finishPan}
            >
                <PdfCanvas pdf={pdf} pageNumber={page.number} zoom={zoom} pageWidth={page.width} pageHeight={page.height} scrollContainer={wrapRef}
                    hiddenAnnotationIds={props.hiddenAnnotationIds}
                    createCapture={props.createCapture} onPresentation={props.onPresentation} onError={props.onRenderError} />
                <NativeElementOverlay geometry={props.geometry ?? null} pageNumber={page.number} zoom={zoom} width={page.width} height={page.height}
                    hoverKey={props.hoverKey} previewKeys={props.previewKeys ?? null} selectedKeys={props.selectedKeys} matchedKeys={props.matchedKeys ?? null} elementColors={props.elementColors} drawingIds={props.drawingIds} />
                <MarkupLayer page={page} zoom={zoom} tool={tool} annotations={props.annotations}
                    selectedAnnotationId={props.selectedAnnotationId} highlightColor={props.highlightColor} labelFor={props.labelFor}
                    onSelectAnnotation={props.onSelectAnnotation} onSelectElement={props.onSelectElement} onAddAnnotation={props.onAddAnnotation}
                    onElementMove={(point, client) => props.onHover(pickElement(point, 4 / zoom)[0]?.elementKey ?? null, client)}
                    onElementSelect={(point, additive) => {
                        const hits = [...new Map(pickElement(point, 4 / zoom).map((hit) => [hit.elementKey, hit])).values()];
                        const keys = hits.map((hit) => hit.elementKey).join('\n');
                        const previous = previousPick.current;
                        const now = performance.now();
                        const repeat = previous && previous.keys === keys && now - previous.time < 3000 && Math.hypot(previous.x - point[0], previous.y - point[1]) < 6 / zoom;
                        const index = repeat && hits.length ? (previous.index + 1) % hits.length : 0;
                        previousPick.current = { x: point[0], y: point[1], keys, index, time: now };
                        const picked = hits[index]?.elementKey ?? null;
                        if (additive && picked && props.onSelectElements) { props.onSelectElements([picked], 'toggle'); setPickNotice(null); props.onSelectAnnotation(null); return; }
                        props.onSelectElement(picked);
                        setPickNotice(hits.length > 1 ? `${index + 1} of ${hits.length} elements · click again to cycle` : null);
                        props.onSelectAnnotation(null);
                    }}
                    onSelectRegion={(rect, additive, crossing) => {
                        const hits = (props.regionOf?.(rect) ?? []).filter((hit) => crossing || hit.fully).map((hit) => hit.key);
                        props.onSelectAnnotation(null);
                        setPickNotice(hits.length ? `${hits.length} element${hits.length === 1 ? '' : 's'} selected` : null);
                        if (props.onSelectElements) props.onSelectElements(hits, additive ? 'add' : 'replace');
                    }}
                    onElementLeave={() => props.onHover(null, { x: 0, y: 0 })}
                    onStartComment={props.onStartComment}
                    pick={(point) => pickElement(point, 4 / zoom)[0]?.elementKey ?? null}
                    // Comment pins and text boxes highlight their drop target the same way.
                    onDragTarget={props.commentLayer.onDragTarget}
                    onMoveAnnotation={props.onMoveAnnotation}
                    coverOf={props.coverOf}
                >
                    <ElementOverlay shapes={page.shapes} hoverKey={props.hoverKey} previewKeys={props.previewKeys ?? null} selectedKeys={props.selectedKeys} matchedKeys={props.matchedKeys} elementColors={props.elementColors} drawingIds={props.drawingIds} />
                    {selectedSource && <rect x={selectedSource.bounds[0]} y={selectedSource.bounds[1]} width={selectedSource.bounds[2] - selectedSource.bounds[0]} height={selectedSource.bounds[3] - selectedSource.bounds[1]} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                </MarkupLayer>
                <CommentLayer page={page} zoom={zoom} comments={props.annotations.filter((a) => a.kind === 'comment')} pick={(point) => pickElement(point, 4 / zoom)[0]?.elementKey ?? null} {...props.commentLayer} />
                {showSelectionActions && selectionBounds && (
                    <SelectionActions bounds={selectionBounds} zoom={zoom} pageWidth={page.width} pageHeight={page.height} count={props.selectedKeys!.size}
                        onSelectSimilar={props.selectionActions!.onSelectSimilar}
                        onComment={() => props.selectionActions!.onComment([selectionBounds[2], selectionBounds[1]])} />
                )}
                {pickNotice && <div className="pick-status" role="status">{pickNotice}</div>}
            </div>
        </div>
    );
}
