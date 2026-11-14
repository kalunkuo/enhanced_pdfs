import { AnnotationMode, type PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { hitTest } from '../../lib/hit';
import type { Annotation, AnnotationKind, PageData, Point, Shape } from '../../lib/types';

export type Tool = 'select' | 'pan' | AnnotationKind;

export type ZoomMode = { kind: 'fit-width' } | { kind: 'fit-page' } | { kind: 'value'; value: number };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

// Space kept clear around the page: 16 left, 88 right (the tool rail), 16 top and bottom.
const PAD_X = 104;
const PAD_Y = 32;

interface Props {
    pdf: PDFDocumentProxy;
    page: PageData;
    zoomMode: ZoomMode;
    /** True when the file carries its own copies of the annotations; the viewer draws them itself. */
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
}

const MIN_DRAG = 4;
/** The PDF page is always white, so annotation ink and bubbles stay fixed in both themes. */
const INK = '#18181b';

function polygonPoints(s: Shape): string {
    const pts = s.outline ?? [
        [s.bbox[0], s.bbox[1]],
        [s.bbox[2], s.bbox[1]],
        [s.bbox[2], s.bbox[3]],
        [s.bbox[0], s.bbox[3]],
    ];
    return pts.map((p) => p.join(',')).join(' ');
}

export function PdfStage(props: Props) {
    const { pdf, page, tool, annotations, zoomMode, onZoom } = props;
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const [size, setSize] = useState({ w: 800, h: 600 });
    const [panning, setPanning] = useState(false);
    const [draft, setDraft] = useState<{ from: Point; to: Point; points?: Point[] } | null>(null);
    const [editor, setEditor] = useState<{ at: Point; value: string } | null>(null);

    const zoom = useMemo(() => {
        const fitWidth = (size.w - PAD_X) / page.width;
        if (zoomMode.kind === 'fit-width') return clampZoom(fitWidth);
        if (zoomMode.kind === 'fit-page') return clampZoom(Math.min(fitWidth, (size.h - PAD_Y) / page.height));
        return clampZoom(zoomMode.value);
    }, [zoomMode, size, page.width, page.height]);

    useEffect(() => onZoom(zoom), [zoom, onZoom]);

    // A different page starts with nothing half-drawn.
    useEffect(() => {
        setDraft(null);
        setEditor(null);
    }, [page.number]);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        let cancelled = false;
        let task: { cancel: () => void; promise: Promise<unknown> } | undefined;
        void (async () => {
            const pdfPage = await pdf.getPage(page.number);
            const canvas = canvasRef.current;
            if (!canvas || cancelled) return;
            const dpr = window.devicePixelRatio || 1;
            const viewport = pdfPage.getViewport({ scale: zoom * dpr });
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            task = pdfPage.render({
                canvas,
                viewport,
                annotationMode: props.hideEmbeddedAnnotations ? AnnotationMode.DISABLE : AnnotationMode.ENABLE,
            });
            await task.promise.catch(() => undefined); // a cancelled render is expected on zoom or page change
        })();
        return () => {
            cancelled = true;
            task?.cancel();
        };
    }, [pdf, page.number, zoom, props.hideEmbeddedAnnotations]);

    const toPage = (e: { clientX: number; clientY: number }): Point => {
        const r = svgRef.current!.getBoundingClientRect();
        return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
    };
    const tolerance = 4 / zoom;
    const drawing = tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'highlight' || tool === 'pen';
    const noteTool = tool === 'text' || tool === 'comment' || tool === 'signature';

    const onMove = (e: ReactPointerEvent) => {
        const p = toPage(e);
        const pan = panRef.current;
        if (pan && wrapRef.current) {
            wrapRef.current.scrollLeft = pan.left - (e.clientX - pan.x);
            wrapRef.current.scrollTop = pan.top - (e.clientY - pan.y);
            return;
        }
        if (draft) {
            const last = draft.points?.at(-1);
            const moved = !last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1.5 / zoom;
            setDraft({ ...draft, to: p, ...(draft.points && moved ? { points: [...draft.points, p] } : {}) });
        }
        else if (tool === 'select') props.onHover(hitTest(page.shapes, p[0], p[1], tolerance)?.elementKey ?? null, { x: e.clientX, y: e.clientY });
    };
    const onDown = (e: ReactPointerEvent) => {
        if (e.button !== 0) return;
        const p = toPage(e);
        if (tool === 'pan' && wrapRef.current) {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            panRef.current = { x: e.clientX, y: e.clientY, left: wrapRef.current.scrollLeft, top: wrapRef.current.scrollTop };
            setPanning(true);
        } else if (drawing) {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setDraft({ from: p, to: p, ...(tool === 'pen' ? { points: [p] } : {}) });
        } else if (tool === 'select') {
            const hit = hitTest(page.shapes, p[0], p[1], tolerance);
            props.onSelectElement(hit?.elementKey ?? null);
            props.onSelectAnnotation(null);
        }
    };
    // Open the note editor on click, after the browser has finished moving focus. Opening it on
    // pointer-down lets the trailing mouse-down focus change blur the input and close it empty.
    const onClick = (e: ReactMouseEvent) => {
        if (noteTool) setEditor({ at: toPage(e), value: '' });
    };
    const onUp = () => {
        if (panRef.current) {
            panRef.current = null;
            setPanning(false);
        }
        if (!draft || !drawing) return;
        if (tool === 'pen') {
            const pts = draft.points ?? [];
            const length = pts.slice(1).reduce((n, q, i) => n + Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]), 0);
            if (pts.length > 2 && length >= MIN_DRAG) props.onAddAnnotation({ kind: 'pen', from: pts[0]!, to: pts.at(-1)!, points: pts });
        } else if (Math.hypot(draft.to[0] - draft.from[0], draft.to[1] - draft.from[1]) >= MIN_DRAG) {
            props.onAddAnnotation({ kind: tool as AnnotationKind, from: draft.from, to: draft.to });
        }
        setDraft(null);
    };
    const commitNote = () => {
        if (editor && editor.value.trim()) {
            props.onAddAnnotation({ kind: tool as AnnotationKind, from: editor.at, to: editor.at, text: editor.value.trim() });
        }
        setEditor(null);
    };

    const hovered = page.shapes.find((s) => s.elementKey === props.hoverKey);
    const selected = page.shapes.find((s) => s.elementKey === props.selectedKey);
    const toolClass = tool === 'pan' ? (panning ? 'tool-panning' : 'tool-pan') : tool === 'select' ? 'tool-select' : noteTool ? 'tool-text' : 'tool-draw';

    return (
        <div className="stage" ref={wrapRef}>
            <div
                className={`page ${toolClass} ${props.hoverKey && tool === 'select' ? 'hovering' : ''}`}
                style={{ width: page.width * zoom, height: page.height * zoom }}
            >
                <canvas ref={canvasRef} />
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${page.width} ${page.height}`}
                    onPointerMove={onMove}
                    onPointerDown={onDown}
                    onPointerUp={onUp}
                    onClick={onClick}
                    onPointerLeave={() => !draft && props.onHover(null, { x: 0, y: 0 })}
                >
                    {hovered && hovered !== selected && (
                        <polygon points={polygonPoints(hovered)} fill="var(--element-soft)" stroke="var(--element)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    )}
                    {selected && (
                        <polygon points={polygonPoints(selected)} fill="var(--element-strong)" stroke="var(--element)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    )}
                    {annotations.map((a) => (
                        <AnnotationShape
                            key={a.id}
                            a={a}
                            selected={a.id === props.selectedAnnotationId}
                            interactive={tool === 'select'}
                            label={a.elementKey ? props.labelFor(a.elementKey) : undefined}
                            onClick={() => {
                                props.onSelectAnnotation(a.id);
                                props.onSelectElement(a.elementKey ?? null);
                            }}
                        />
                    ))}
                    {draft && (
                        <AnnotationShape a={{ id: 'draft', page: page.number, kind: tool as AnnotationKind, from: draft.from, to: draft.to, ...(draft.points ? { points: draft.points } : {}), color: props.highlightColor }} selected={false} interactive={false} />
                    )}
                </svg>
                {editor && (
                    <input
                        className={`note-input ${tool}`}
                        autoFocus
                        placeholder={tool === 'comment' ? 'Add comment…' : tool === 'signature' ? 'Type your name…' : 'Type text…'}
                        style={{ left: editor.at[0] * zoom, top: editor.at[1] * zoom }}
                        value={editor.value}
                        onChange={(e) => setEditor({ ...editor, value: e.target.value })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitNote();
                            if (e.key === 'Escape') setEditor(null);
                        }}
                        onBlur={commitNote}
                    />
                )}
            </div>
        </div>
    );
}

function AnnotationShape({ a, selected, interactive, label, onClick }: { a: Annotation; selected: boolean; interactive: boolean; label?: string; onClick?: () => void }) {
    const tied = a.elementKey !== undefined;
    const color = a.id === 'draft' ? 'var(--tied)' : tied ? 'var(--tied)' : 'var(--untied)';
    const common = {
        stroke: color,
        strokeWidth: selected ? 3 : 2,
        strokeDasharray: tied || a.id === 'draft' ? undefined : '6 4',
        vectorEffect: 'non-scaling-stroke' as const,
        fill: 'none',
    };
    const [x0, y0] = a.from;
    const [x1, y1] = a.to;
    let body;
    let chipAt: Point = [(x0 + x1) / 2, Math.min(y0, y1) - 6];
    if (a.kind === 'line') {
        body = <line x1={x0} y1={y0} x2={x1} y2={y1} {...common} />;
    } else if (a.kind === 'rect') {
        body = <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} {...common} />;
    } else if (a.kind === 'ellipse') {
        body = <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={Math.abs(x1 - x0) / 2} ry={Math.abs(y1 - y0) / 2} {...common} />;
    } else if (a.kind === 'pen') {
        const pts = a.points ?? [];
        body = <polyline points={pts.map((q) => q.join(',')).join(' ')} {...common} strokeLinejoin="round" strokeLinecap="round" />;
        chipAt = [Math.min(...pts.map((q) => q[0]), x0), Math.min(...pts.map((q) => q[1]), y0) - 6];
    } else if (a.kind === 'highlight') {
        body = (
            <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)}
                fill={a.color ?? '#ffd43b'} fillOpacity={0.4} stroke={tied || a.id === 'draft' ? 'none' : 'var(--untied)'} strokeDasharray="6 4" strokeWidth={selected ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
        );
    } else if (a.kind === 'signature') {
        body = <text x={x0} y={y0} fontSize={24} fill={INK} fontFamily="'Snell Roundhand','Segoe Script','Brush Script MT',cursive" fontStyle="italic">{a.text}</text>;
        chipAt = [x0, y0 - 26];
    } else if (a.kind === 'text') {
        const w = Math.max(30, (a.text?.length ?? 0) * 6.6 + 10);
        body = (
            <g>
                <rect x={x0 - 4} y={y0 - 14} width={w} height={20} fill="none" stroke={color} strokeWidth={1} strokeDasharray={common.strokeDasharray} vectorEffect="non-scaling-stroke" />
                <text x={x0} y={y0} fontSize={12} fill={INK} fontWeight={500}>{a.text}</text>
            </g>
        );
        chipAt = [x0 - 4, y0 - 18];
    } else {
        const w = Math.max(40, (a.text?.length ?? 0) * 6.2 + 12);
        body = (
            <g>
                <circle cx={x0} cy={y0} r={5} fill={color} />
                <rect x={x0 + 8} y={y0 - 10} width={w} height={20} rx={4} fill="#fff" stroke={color} strokeWidth={1} strokeDasharray={common.strokeDasharray} vectorEffect="non-scaling-stroke" />
                <text x={x0 + 14} y={y0 + 4} fontSize={11} fill={INK}>{a.text}</text>
            </g>
        );
        chipAt = [x0, y0 - 12];
    }
    const chip = tied ? `↳ ${label ?? 'element'}` : 'untied';
    return (
        <g style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: 'pointer' }} onPointerDown={(e) => e.stopPropagation()} onClick={onClick}>
            {body}
            {a.id !== 'draft' && (
                <text x={chipAt[0]} y={chipAt[1]} fontSize={9} fill={color} fontStyle={tied ? undefined : 'italic'}>{chip}</text>
            )}
        </g>
    );
}
