import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { avatarColor, initials } from '../../lib/comments';
import { linkedKeys } from '../../lib/links';
import type { Profile } from '../../lib/profile';
import type { Annotation, PageData, Point } from '../../lib/types';

export interface CommentLayerProps {
    page: Pick<PageData, 'number' | 'width' | 'height'>;
    zoom: number;
    /** Comments on this page. */
    comments: readonly Annotation[];
    selectedId: string | null;
    /** Where a new comment is being written, if any. */
    composerAt: Point | null;
    /** What the new comment will be linked to, shown above its text ("On 3 objects"). */
    composerContext?: string | null;
    profile: Profile;
    onProfile: (profile: Profile) => void;
    labelFor: (elementKey: string) => string;
    linksLabel: (elementKeys: readonly string[]) => string;
    /** Hovering a pin previews the objects it is linked to on the canvas. */
    onPreview?: (keys: ReadonlySet<string> | null) => void;
    /** The element under a page point, or null for empty paper. Decides tied or untied while dragging. */
    pick: (point: Point) => string | null;
    onSelect: (id: string | null) => void;
    /** A pin was dropped at `at`; the caller re-ties it to whatever is there (a pin linked to several objects keeps them). */
    onMove: (id: string, at: Point) => void;
    /** The element a dragged pin is over, for highlighting. */
    onDragTarget: (key: string | null, client: { x: number; y: number }) => void;
    /** `name` is the author's name as of this click, so a first-time name is not lost to stale state. */
    onSend: (comment: { text: string; at: Point; name: string }) => void;
    onCancel: () => void;
}

const EMOJI = ['😀', '😂', '😊', '😍', '👍', '👎', '🙏', '🎉', '🔥', '✅', '❌', '⚠️', '❓', '👀', '💡', '🛠️'];
/** Pixels of pointer travel before a press on a pin becomes a drag instead of a click. */
const DRAG_THRESHOLD = 4;
/** Room the pill needs to the right of a pin before it flips to the left. */
const PILL_ROOM = 300;

const stop = (event: ReactPointerEvent) => event.stopPropagation();
const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));

interface Drag {
    id: string;
    at: Point;
    key: string | null;
}

/**
 * HTML overlay for comments. A pin is a teardrop whose tip (bottom-left) is the comment's anchor point, plus a
 * pill with the object and a message preview. Tied pins take the commenter's color; untied pins are gray.
 * Drag a pin to move it: dropping it on an object ties it, dropping it on empty paper unties it.
 */
export function CommentLayer(props: CommentLayerProps) {
    const { page, zoom } = props;
    const [drag, setDrag] = useState<Drag | null>(null);
    const press = useRef<{ id: string; x: number; y: number; start: Point; moved: boolean; linked: boolean } | null>(null);
    // The drop reads this ref, not `drag`: a quick flick can release before React re-renders the last move.
    const dragRef = useRef<Drag | null>(null);
    const updateDrag = (next: Drag | null) => {
        dragRef.current = next;
        setDrag(next);
    };

    // Escape puts a dragged pin back where it was.
    useEffect(() => {
        if (!drag) return;
        const esc = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            press.current = null;
            updateDrag(null);
            props.onDragTarget(null, { x: 0, y: 0 });
        };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [drag, props]);

    const begin = (event: ReactPointerEvent<HTMLDivElement>, comment: Annotation) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer ended already; the drag still works from move events */ }
        // A pin linked to several objects moves without re-tying, so it has no drop target.
        press.current = { id: comment.id, x: event.clientX, y: event.clientY, start: comment.from, moved: false, linked: linkedKeys(comment).length > 1 };
    };
    const move = (event: ReactPointerEvent<HTMLDivElement>) => {
        const p = press.current;
        if (!p) return;
        const dx = event.clientX - p.x;
        const dy = event.clientY - p.y;
        if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        p.moved = true;
        const at: Point = [clamp(p.start[0] + dx / zoom, page.width), clamp(p.start[1] + dy / zoom, page.height)];
        const key = p.linked ? null : props.pick(at);
        updateDrag({ id: p.id, at, key });
        if (!p.linked) props.onDragTarget(key, { x: event.clientX, y: event.clientY });
    };
    const end = (event: ReactPointerEvent<HTMLDivElement>) => {
        const p = press.current;
        press.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!p) return;
        const last = dragRef.current;
        if (p.moved && last) props.onMove(p.id, last.at);
        else props.onSelect(p.id);
        updateDrag(null);
        props.onDragTarget(null, { x: 0, y: 0 });
    };
    const cancel = (event: ReactPointerEvent<HTMLDivElement>) => {
        press.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        updateDrag(null);
        props.onDragTarget(null, { x: 0, y: 0 });
    };

    return (
        <div className="comment-layer">
            {props.comments.map((comment) => {
                const dragging = drag?.id === comment.id;
                const at = dragging ? drag.at : comment.from;
                const links = linkedKeys(comment);
                const key = dragging && links.length <= 1 ? drag.key : (links[0] ?? null);
                const label = links.length > 1 ? props.linksLabel(links) : key ? props.labelFor(key) : 'No object';
                const name = comment.author?.name ?? 'Unknown';
                const selected = comment.id === props.selectedId;
                const flip = at[0] * zoom + PILL_ROOM > page.width * zoom;
                return (
                    <div
                        key={comment.id}
                        className={`cpin ${key ? 'tied' : 'untied'} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${flip ? 'flip' : ''}`}
                        style={{ left: at[0] * zoom, top: at[1] * zoom, '--pin': avatarColor(name) } as CSSProperties}
                        role="button"
                        tabIndex={0}
                        aria-label={`Comment by ${name}${key ? `, on ${label}` : ', not tied to an object'}. Drag to move.`}
                        aria-pressed={selected}
                        onPointerEnter={() => links.length && props.onPreview?.(new Set(links))}
                        onPointerLeave={() => props.onPreview?.(null)}
                        onFocus={() => links.length && props.onPreview?.(new Set(links))}
                        onBlur={() => props.onPreview?.(null)}
                        onPointerDown={(e) => begin(e, comment)}
                        onPointerMove={move}
                        onPointerUp={end}
                        onPointerCancel={cancel}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSelect(comment.id); } }}
                    >
                        <span className="cdrop" aria-hidden="true">
                            {comment.author?.photo ? <img src={comment.author.photo} alt="" draggable={false} /> : initials(name)}
                        </span>
                        <span className="cpill" aria-hidden="true">
                            <strong>{label}</strong>
                            <span className="cpill-msg">{comment.text}</span>
                        </span>
                    </div>
                );
            })}
            {props.composerAt && <Composer key="composer" at={props.composerAt} flip={props.composerAt[0] * zoom + 368 > page.width * zoom} {...props} />}
        </div>
    );
}

function Composer({ at, flip, zoom, profile, onProfile, onSend, onCancel, composerContext }: { at: Point; flip: boolean } & CommentLayerProps) {
    const [text, setText] = useState('');
    const [name, setName] = useState(profile.name);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const area = useRef<HTMLTextAreaElement>(null);
    const needsName = profile.name.trim() === '';
    const canSend = text.trim() !== '' && (!needsName || name.trim() !== '');

    const insert = (snippet: string) => {
        const el = area.current;
        const start = el?.selectionStart ?? text.length;
        const end = el?.selectionEnd ?? text.length;
        setText(text.slice(0, start) + snippet + text.slice(end));
        requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(start + snippet.length, start + snippet.length);
        });
    };
    const send = () => {
        if (!canSend) return;
        const author = (needsName ? name : profile.name).trim();
        if (needsName) onProfile({ ...profile, name: author });
        onSend({ text: text.trim(), at, name: author });
    };
    const onKeyDown = (event: ReactKeyboardEvent) => {
        if (event.key === 'Escape') onCancel();
        else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send();
        }
    };

    return (
        <div className="ccomposer" style={{ left: at[0] * zoom, top: at[1] * zoom }} onPointerDown={stop}>
            <span className="cteardrop" aria-hidden="true" />
            <form className={`ccard ${flip ? 'left' : ''}`} onSubmit={(e) => { e.preventDefault(); send(); }} aria-label="New comment">
                {needsName && (
                    <input className="cname" placeholder="Your name" aria-label="Your name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={onKeyDown} />
                )}
                {composerContext && <p className="ccontext">{composerContext}</p>}
                <textarea ref={area} autoFocus rows={3} placeholder="Add a comment…" aria-label="Comment" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
                <div className="cbar">
                    <div className="cemoji-wrap">
                        <button type="button" className="icon-btn" aria-label="Add emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(!emojiOpen)}>☺</button>
                        {emojiOpen && (
                            <div className="cemoji" role="menu">
                                {EMOJI.map((e) => <button key={e} type="button" role="menuitem" onClick={() => { insert(e); setEmojiOpen(false); }}>{e}</button>)}
                            </div>
                        )}
                    </div>
                    <button type="button" className="icon-btn" aria-label="Mention" onClick={() => insert('@')}>@</button>
                    <span className="spacer" />
                    <button type="submit" className="csend" aria-label="Send comment" disabled={!canSend}>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
                    </button>
                </div>
            </form>
        </div>
    );
}
