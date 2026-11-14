import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Tool } from '../../lib/presentation';
import type { Annotation, PageData, Point } from '../../lib/types';

type DrawingTool = 'line' | 'rect' | 'ellipse' | 'highlight' | 'pen';
type NoteTool = 'text' | 'signature';
type Draft = { kind: DrawingTool; from: Point; to: Point; points?: Point[] };
type Editor = { kind: NoteTool; at: Point; value: string };

export interface MarkupLayerProps {
    page: Pick<PageData, 'number' | 'width' | 'height'>;
    zoom: number;
    tool: Tool;
    annotations: readonly Annotation[];
    selectedAnnotationId: string | null;
    highlightColor: string;
    labelFor: (elementKey: string) => string;
    onSelectAnnotation: (id: string | null) => void;
    onSelectElement: (key: string | null) => void;
    onAddAnnotation: (annotation: Omit<Annotation, 'id' | 'elementKey' | 'page'>) => void;
    onElementMove: (point: Point, client: { x: number; y: number }) => void;
    onElementSelect: (point: Point) => void;
    onElementLeave: () => void;
    /** The comment tool was clicked at a page point; the comment layer opens its composer. */
    onStartComment: (point: Point) => void;
    /** Element highlights render below the markup content in the shared SVG. */
    children?: ReactNode;
}

const MIN_DRAG = 4;
/** The PDF page is always white, so annotation ink remains fixed in both themes. */
const INK = '#18181b';

function isDrawingTool(tool: Tool): tool is DrawingTool {
    return tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'highlight' || tool === 'pen';
}

function isNoteTool(tool: Tool): tool is NoteTool {
    return tool === 'text' || tool === 'signature';
}

/**
 * Owns annotation gestures and presentation. Element picking is supplied by the
 * semantic layer; panning remains the parent stage's responsibility.
 */
export function MarkupLayer(props: MarkupLayerProps) {
    const { page, zoom, tool, annotations } = props;
    const svgRef = useRef<SVGSVGElement>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const draftRef = useRef<Draft | null>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    const editorRef = useRef<Editor | null>(null);

    const updateDraft = (next: Draft | null) => {
        draftRef.current = next;
        setDraft(next);
    };
    const updateEditor = (next: Editor | null) => {
        editorRef.current = next;
        setEditor(next);
    };

    // A new document/page or tool cannot inherit a half-completed annotation.
    useEffect(() => {
        draftRef.current = null;
        editorRef.current = null;
        setDraft(null);
        setEditor(null);
    }, [page, tool]);

    const toPage = (event: { clientX: number; clientY: number }): Point => {
        const rect = svgRef.current!.getBoundingClientRect();
        // The DOM rect includes any temporary CSS scaling while the renderer
        // catches up. Persisted annotation coordinates stay in page space.
        const width = rect.width || page.width * zoom;
        const height = rect.height || page.height * zoom;
        return [(event.clientX - rect.left) * page.width / width, (event.clientY - rect.top) * page.height / height];
    };

    const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
        const point = toPage(event);
        const active = draftRef.current;
        if (active && active.kind === tool) {
            const last = active.points?.at(-1);
            const moved = !last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1.5 / zoom;
            updateDraft({ ...active, to: point, ...(active.points && moved ? { points: [...active.points, point] } : {}) });
        } else if (tool === 'select') {
            props.onElementMove(point, { x: event.clientX, y: event.clientY });
        }
    };

    const onDown = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (event.button !== 0) return;
        const point = toPage(event);
        if (isDrawingTool(tool)) {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            updateDraft({ kind: tool, from: point, to: point, ...(tool === 'pen' ? { points: [point] } : {}) });
        } else if (tool === 'select') {
            props.onElementSelect(point);
        }
    };

    // Opening on click avoids the trailing pointer-down focus change closing
    // the newly mounted text editor before the user can enter anything.
    const onClick = (event: ReactMouseEvent<SVGSVGElement>) => {
        if (tool === 'comment') props.onStartComment(toPage(event));
        else if (isNoteTool(tool)) updateEditor({ kind: tool, at: toPage(event), value: '' });
    };

    const onUp = () => {
        const active = draftRef.current;
        updateDraft(null);
        if (!active || active.kind !== tool) return;
        if (active.kind === 'pen') {
            const points = active.points ?? [];
            const length = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - points[index]![0], point[1] - points[index]![1]), 0);
            if (points.length > 2 && length >= MIN_DRAG) {
                props.onAddAnnotation({ kind: 'pen', from: points[0]!, to: points.at(-1)!, points });
            }
        } else if (Math.hypot(active.to[0] - active.from[0], active.to[1] - active.from[1]) >= MIN_DRAG) {
            props.onAddAnnotation({ kind: active.kind, from: active.from, to: active.to });
        }
    };

    const commitNote = () => {
        const active = editorRef.current;
        // Clear synchronously so Enter followed by blur commits only once.
        updateEditor(null);
        if (active && active.kind === tool && active.value.trim()) {
            props.onAddAnnotation({ kind: active.kind, from: active.at, to: active.at, text: active.value.trim() });
        }
    };

    return (
        <>
            <svg
                ref={svgRef}
                viewBox={`0 0 ${page.width} ${page.height}`}
                onPointerMove={onMove}
                onPointerDown={onDown}
                onPointerUp={onUp}
                onPointerCancel={() => { updateDraft(null); props.onElementLeave(); }}
                onClick={onClick}
                onPointerLeave={() => !draftRef.current && props.onElementLeave()}
            >
                {props.children}
                {annotations.filter((annotation) => annotation.kind !== 'comment').map((annotation) => (
                    <AnnotationShape
                        key={annotation.id}
                        annotation={annotation}
                        selected={annotation.id === props.selectedAnnotationId}
                        interactive={tool === 'select'}
                        label={annotation.elementKey ? props.labelFor(annotation.elementKey) : undefined}
                        onClick={() => {
                            // Object first, then the markup: the last selection decides which panel opens.
                            props.onSelectElement(annotation.elementKey ?? null);
                            props.onSelectAnnotation(annotation.id);
                        }}
                    />
                ))}
                {draft && (
                    <AnnotationShape
                        annotation={{ id: 'draft', page: page.number, kind: draft.kind, from: draft.from, to: draft.to, ...(draft.points ? { points: draft.points } : {}), color: props.highlightColor }}
                        selected={false}
                        interactive={false}
                    />
                )}
            </svg>
            {editor && (
                <input
                    className={`note-input ${editor.kind}`}
                    autoFocus
                    placeholder={editor.kind === 'signature' ? 'Type your name…' : 'Type text…'}
                    style={{ left: editor.at[0] * zoom, top: editor.at[1] * zoom }}
                    value={editor.value}
                    onChange={(event) => updateEditor({ ...editor, value: event.target.value })}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); commitNote(); }
                        if (event.key === 'Escape') updateEditor(null);
                    }}
                    onBlur={commitNote}
                />
            )}
        </>
    );
}

function AnnotationShape({ annotation: a, selected, interactive, label, onClick }: { annotation: Annotation; selected: boolean; interactive: boolean; label?: string; onClick?: () => void }) {
    const tied = a.elementKey !== undefined;
    const color = a.id === 'draft' || tied ? 'var(--tied)' : 'var(--untied)';
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
        const points = a.points ?? [];
        body = <polyline points={points.map((point) => point.join(',')).join(' ')} {...common} strokeLinejoin="round" strokeLinecap="round" />;
        chipAt = [Math.min(...points.map((point) => point[0]), x0), Math.min(...points.map((point) => point[1]), y0) - 6];
    } else if (a.kind === 'highlight') {
        body = (
            <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)}
                fill={a.color ?? '#ffd43b'} fillOpacity={0.4} stroke={tied || a.id === 'draft' ? 'none' : 'var(--untied)'} strokeDasharray="6 4" strokeWidth={selected ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
        );
    } else if (a.kind === 'signature') {
        body = <text x={x0} y={y0} fontSize={24} fill={INK} fontFamily="'Snell Roundhand','Segoe Script','Brush Script MT',cursive" fontStyle="italic">{a.text}</text>;
        chipAt = [x0, y0 - 26];
    } else if (a.kind === 'text') {
        const width = Math.max(30, (a.text?.length ?? 0) * 6.6 + 10);
        body = (
            <g>
                <rect x={x0 - 4} y={y0 - 14} width={width} height={20} fill="none" stroke={color} strokeWidth={1} strokeDasharray={common.strokeDasharray} vectorEffect="non-scaling-stroke" />
                <text x={x0} y={y0} fontSize={12} fill={INK} fontWeight={500}>{a.text}</text>
            </g>
        );
        chipAt = [x0 - 4, y0 - 18];
    } else {
        return null; // comments are drawn by the comment layer
    }
    const chip = tied ? `↳ ${label ?? 'element'}` : 'untied';
    return (
        <g
            style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: 'pointer' }}
            onPointerDown={(event) => { if (interactive) event.stopPropagation(); }}
            onClick={onClick}
        >
            {body}
            {a.id !== 'draft' && (
                <text x={chipAt[0]} y={chipAt[1]} fontSize={9} fill={color} fontStyle={tied ? undefined : 'italic'}>{chip}</text>
            )}
        </g>
    );
}
