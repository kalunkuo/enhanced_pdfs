import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { anchorHandle, defaultBoxOrigin, hasLeader, leaderSegment, textBox } from '../../lib/callout';
import type { Tool } from '../../lib/presentation';
import type { Annotation, PageData, Point } from '../../lib/types';

type DrawingTool = 'line' | 'rect' | 'ellipse' | 'highlight' | 'pen';
type NoteTool = 'text' | 'signature';
type Draft = { kind: DrawingTool; from: Point; to: Point; points?: Point[] };
/** `tip` is where a text box's leader points; without it the box has no leader. */
type Editor = { kind: NoteTool; at: Point; tip?: Point; value: string };
/** A text box being dragged: `box` moves its text, `tip` moves its leader, `both` moves a box that has no leader. */
type MovePart = 'box' | 'tip' | 'both';
type Moving = { id: string; from: Point; to: Point; key: string | null };

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
    /** The element under a page point, or null for empty paper. Decides tied or untied while a text box is dragged. */
    pick: (point: Point) => string | null;
    /** The element a dragged text box's tip is over, for highlighting. */
    onDragTarget: (key: string | null, client: { x: number; y: number }) => void;
    /** A text box was dropped; the caller re-ties it to whatever its tip is over. */
    onMoveAnnotation: (id: string, patch: { from: Point; to: Point }) => void;
    /** Element highlights render below the markup content in the shared SVG. */
    children?: ReactNode;
}

const MIN_DRAG = 4;
/** An untied markup is plain gray, text included. */
const UNTIED_INK = '#71717a';
const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
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
    // A text-box gesture in progress: placing one (drag out a leader), or moving an existing one.
    const textPress = useRef<{ tip: Point; moved: boolean } | null>(null);
    const [leaderPreview, setLeaderPreview] = useState<{ from: Point; to: Point } | null>(null);
    const movePress = useRef<{ id: string; part: MovePart; x: number; y: number; from: Point; to: Point; moved: boolean } | null>(null);
    const [moving, setMoving] = useState<Moving | null>(null);
    // The drop reads this ref, not `moving`: a quick flick can release before React re-renders the last move.
    const movingRef = useRef<Moving | null>(null);
    const updateMoving = (next: Moving | null) => {
        movingRef.current = next;
        setMoving(next);
    };

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
        textPress.current = null;
        setLeaderPreview(null);
        movePress.current = null;
        updateMoving(null);
    }, [page, tool]);

    // Escape puts a dragged text box back where it was.
    useEffect(() => {
        if (!moving) return;
        const esc = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            movePress.current = null;
            updateMoving(null);
            props.onDragTarget(null, { x: 0, y: 0 });
        };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [moving, props]);

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
        const drag = movePress.current;
        if (drag) {
            if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < MIN_DRAG) return;
            drag.moved = true;
            const origin = toPage({ clientX: drag.x, clientY: drag.y });
            const dx = point[0] - origin[0];
            const dy = point[1] - origin[1];
            const shift = (p: Point): Point => [clamp(p[0] + dx, page.width), clamp(p[1] + dy, page.height)];
            const from = drag.part === 'tip' ? drag.from : shift(drag.from);
            const to = drag.part === 'box' ? drag.to : shift(drag.to);
            const key = props.pick(to);
            updateMoving({ id: drag.id, from, to, key });
            props.onDragTarget(key, { x: event.clientX, y: event.clientY });
            return;
        }
        const placing = textPress.current;
        if (placing && Math.hypot(point[0] - placing.tip[0], point[1] - placing.tip[1]) >= MIN_DRAG) {
            placing.moved = true;
            setLeaderPreview({ from: point, to: placing.tip });
            return;
        }
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
            try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* the pointer ended already */ }
            updateDraft({ kind: tool, from: point, to: point, ...(tool === 'pen' ? { points: [point] } : {}) });
        } else if (tool === 'text') {
            // Press on the object, drag out to where the text should sit. A plain click makes a box with no leader.
            try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* the pointer ended already */ }
            textPress.current = { tip: point, moved: false };
        } else if (tool === 'select') {
            props.onElementSelect(point);
        }
    };

    const beginMove = (event: ReactPointerEvent<SVGElement>, a: Annotation, part: 'box' | 'tip') => {
        if (event.button !== 0) return;
        event.stopPropagation();
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* the pointer ended already; the drag still works from move events */ }
        const leaderless = !hasLeader(a);
        movePress.current = { id: a.id, part: leaderless && part === 'box' ? 'both' : part, x: event.clientX, y: event.clientY, from: a.from, to: a.to, moved: false };
    };

    // Opening on click avoids the trailing pointer-down focus change closing
    // the newly mounted text editor before the user can enter anything.
    const onClick = (event: ReactMouseEvent<SVGSVGElement>) => {
        const press = textPress.current;
        textPress.current = null;
        setLeaderPreview(null);
        if (tool === 'comment') props.onStartComment(toPage(event));
        else if (tool === 'text') {
            // Dragged: the box sits where the pointer was released and the leader points back at the press.
            // Clicked: the anchor is the click and the box goes beside it, so a text box always has a leader to move.
            const clicked = toPage(event);
            updateEditor(press?.moved
                ? { kind: 'text', at: clicked, tip: press.tip, value: '' }
                : { kind: 'text', at: defaultBoxOrigin(clicked, page.width, page.height), tip: clicked, value: '' });
        } else if (isNoteTool(tool)) updateEditor({ kind: tool, at: toPage(event), value: '' });
    };

    const onUp = () => {
        const drag = movePress.current;
        if (drag) {
            movePress.current = null;
            const last = movingRef.current;
            if (drag.moved && last) props.onMoveAnnotation(drag.id, { from: last.from, to: last.to });
            updateMoving(null);
            props.onDragTarget(null, { x: 0, y: 0 });
            return;
        }
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
            props.onAddAnnotation({ kind: active.kind, from: active.at, to: active.tip ?? active.at, text: active.value.trim() });
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
                onPointerCancel={() => { updateDraft(null); textPress.current = null; setLeaderPreview(null); movePress.current = null; updateMoving(null); props.onDragTarget(null, { x: 0, y: 0 }); props.onElementLeave(); }}
                onClick={onClick}
                onPointerLeave={() => !draftRef.current && props.onElementLeave()}
            >
                {props.children}
                {annotations.filter((annotation) => annotation.kind !== 'comment').map((stored) => {
                    // While a text box is dragged it follows the pointer and shows the tie it would get.
                    const live = moving?.id === stored.id;
                    const annotation = live ? { ...stored, from: moving.from, to: moving.to } : stored;
                    const key = live ? moving.key : (stored.elementKey ?? null);
                    return (
                    <AnnotationShape
                        key={annotation.id}
                        annotation={annotation}
                        selected={annotation.id === props.selectedAnnotationId}
                        interactive={tool === 'select'}
                        tied={key !== null}
                        label={key ? props.labelFor(key) : undefined}
                        onPart={(event, part) => beginMove(event, stored, part)}
                        onClick={() => {
                            // Object first, then the markup: the last selection decides which panel opens.
                            props.onSelectElement(annotation.elementKey ?? null);
                            props.onSelectAnnotation(annotation.id);
                        }}
                    />
                    );
                })}
                {leaderPreview && (
                    <AnnotationShape annotation={{ id: 'draft', page: page.number, kind: 'text', from: leaderPreview.from, to: leaderPreview.to, text: '' }} selected={false} interactive={false} tied />
                )}
                {editor?.kind === 'text' && editor.tip && (
                    <AnnotationShape annotation={{ id: 'draft', page: page.number, kind: 'text', from: editor.at, to: editor.tip, text: editor.value }} selected={false} interactive={false} tied />
                )}
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

function AnnotationShape({ annotation: a, selected, interactive, tied: tiedProp, label, onClick, onPart }: {
    annotation: Annotation;
    selected: boolean;
    interactive: boolean;
    /** Overrides the stored tie, so a markup can show the tie it would get while being dragged. */
    tied?: boolean;
    label?: string;
    onClick?: () => void;
    /** A press on a draggable part of a text box. */
    onPart?: (event: ReactPointerEvent<SVGElement>, part: 'box' | 'tip') => void;
}) {
    const tied = tiedProp ?? a.elementKey !== undefined;
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
                fill={tied || a.id === 'draft' ? (a.color ?? '#ffd43b') : '#9ca3af'} fillOpacity={0.4} stroke={tied || a.id === 'draft' ? 'none' : 'var(--untied)'} strokeDasharray="6 4" strokeWidth={selected ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
        );
    } else if (a.kind === 'signature') {
        body = <text x={x0} y={y0} fontSize={24} fill={tied || a.id === 'draft' ? INK : UNTIED_INK} fontFamily="'Snell Roundhand','Segoe Script','Brush Script MT',cursive" fontStyle="italic">{a.text}</text>;
        chipAt = [x0, y0 - 26];
    } else if (a.kind === 'text') {
        const box = textBox(a);
        const leader = leaderSegment(a);
        const dash = tied || a.id === 'draft' ? undefined : '6 4';
        const grab = interactive ? { cursor: 'grab' } : undefined;
        body = (
            <g>
                {leader && <line x1={leader[0][0]} y1={leader[0][1]} x2={leader[1][0]} y2={leader[1][1]} stroke={color} strokeWidth={selected ? 2 : 1.5} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />}
                <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="transparent" stroke={color} strokeWidth={selected ? 2 : 1} strokeDasharray={dash} vectorEffect="non-scaling-stroke"
                    style={grab} onPointerDown={(event) => onPart?.(event, 'box')} />
                <text x={x0} y={y0} fontSize={12} fill={tied || a.id === 'draft' ? INK : UNTIED_INK} fontWeight={500} pointerEvents="none">{a.text}</text>
                {(() => {
                    // The anchor: the leader tip, or the box corner on an old box that has no leader yet. Drag it to move the tie.
                    const [ax, ay] = anchorHandle(a);
                    return (
                        <>
                            <circle cx={ax} cy={ay} r={selected ? 4.5 : 3.5} fill={color} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                            <circle cx={ax} cy={ay} r={10} fill="transparent" style={grab} onPointerDown={(event) => onPart?.(event, 'tip')} />
                        </>
                    );
                })()}
            </g>
        );
        chipAt = [box.x, box.y - 4];
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
                <>
                    {/* The label belongs to the text box, so pressing it drags the box too. */}
                    {a.kind === 'text' && interactive && (
                        <rect x={chipAt[0] - 3} y={chipAt[1] - 11} width={chip.length * 5.2 + 8} height={15} fill="transparent"
                            style={{ cursor: 'grab' }} onPointerDown={(event) => onPart?.(event, 'box')} />
                    )}
                    <text x={chipAt[0]} y={chipAt[1]} fontSize={9} fill={color} fontStyle={tied ? undefined : 'italic'} pointerEvents={a.kind === 'text' ? 'none' : undefined}>{chip}</text>
                </>
            )}
        </g>
    );
}
