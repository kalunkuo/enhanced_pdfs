import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { formatTimeAgo } from '../../lib/comments';
import { imageToDataUrl, type Profile } from '../../lib/profile';
import type { Annotation, PageData, Point } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { TrashIcon } from '../ui/icons';

export interface CommentLayerProps {
    page: Pick<PageData, 'number' | 'width' | 'height'>;
    zoom: number;
    /** Comments on this page. */
    comments: readonly Annotation[];
    selectedId: string | null;
    /** Where a new comment is being written, if any. */
    composerAt: Point | null;
    profile: Profile;
    onProfile: (profile: Profile) => void;
    labelFor: (elementKey: string) => string;
    idFor: (elementKey: string) => number | undefined;
    onSelect: (id: string | null) => void;
    onSelectElement: (key: string | null) => void;
    /** `name` is the author's name as of this click, so a first-time name is not lost to stale state. */
    onSend: (comment: { text: string; image?: string; at: Point; name: string }) => void;
    onCancel: () => void;
    onDelete: (id: string) => void;
}

const EMOJI = ['😀', '😂', '😊', '😍', '👍', '👎', '🙏', '🎉', '🔥', '✅', '❌', '⚠️', '❓', '👀', '💡', '🛠️'];
const BUBBLE_WIDTH = 320;

/** One minute-resolution clock, so "just now" turns into "1 min ago" without a reload. */
function useNow(intervalMs = 30_000): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

const stop = (event: ReactPointerEvent) => event.stopPropagation();

/** HTML overlay for comments. Pins sit at page coordinates; cards are real DOM so text and images stay crisp at any zoom. */
export function CommentLayer(props: CommentLayerProps) {
    const { page, zoom } = props;
    const now = useNow();
    const [hoverId, setHoverId] = useState<string | null>(null);
    const flip = (x: number) => x * zoom + BUBBLE_WIDTH + 48 > page.width * zoom;

    return (
        <div className="comment-layer">
            {props.comments.map((comment) => {
                const open = comment.id === props.selectedId || comment.id === hoverId;
                const name = comment.author?.name ?? 'Unknown';
                return (
                    <div
                        key={comment.id}
                        className={`cpin ${open ? 'open' : ''}`}
                        style={{ left: comment.from[0] * zoom, top: comment.from[1] * zoom }}
                        onPointerDown={stop}
                        onMouseEnter={() => setHoverId(comment.id)}
                        onMouseLeave={() => setHoverId(null)}
                    >
                        <button className="cpin-btn" aria-label={`Comment by ${name}`} aria-expanded={open} onClick={() => props.onSelect(comment.id === props.selectedId ? null : comment.id)}>
                            <Avatar name={name} photo={comment.author?.photo} size={32} />
                        </button>
                        {open && <Bubble comment={comment} now={now} flip={flip(comment.from[0])} {...props} />}
                    </div>
                );
            })}
            {props.composerAt && <Composer key="composer" at={props.composerAt} flip={flip(props.composerAt[0])} {...props} />}
        </div>
    );
}

function Bubble({ comment, now, flip, labelFor, idFor, onSelectElement, onDelete }: { comment: Annotation; now: number; flip: boolean } & CommentLayerProps) {
    const name = comment.author?.name ?? 'Unknown';
    const tied = comment.elementKey;
    return (
        <div className={`cbubble ${flip ? 'left' : ''}`} role="dialog" aria-label={`Comment by ${name}`}>
            <div className="chead">
                <Avatar name={name} photo={comment.author?.photo} size={36} />
                <div className="cwho">
                    <strong>{name}</strong>
                    <span className="muted" title={comment.createdAt}>{formatTimeAgo(comment.createdAt, now)}</span>
                </div>
                <button className="icon-btn cdel" aria-label="Delete comment" title="Delete comment" onClick={() => onDelete(comment.id)}><TrashIcon /></button>
            </div>
            <p className="cmsg">{comment.text}</p>
            {comment.image && <img className="cimg" src={comment.image} alt="Attached to the comment" />}
            <div className="cfoot">
                {tied ? (
                    <button className="chip tied linklike" onClick={() => onSelectElement(tied)}>↳ {labelFor(tied)}{idFor(tied) !== undefined ? ` · ID ${idFor(tied)}` : ''}</button>
                ) : (
                    <span className="chip untied">untied</span>
                )}
            </div>
        </div>
    );
}

function Composer({ at, flip, zoom, profile, onProfile, onSend, onCancel }: { at: Point; flip: boolean } & CommentLayerProps) {
    const [text, setText] = useState('');
    const [name, setName] = useState(profile.name);
    const [image, setImage] = useState<string | undefined>();
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const area = useRef<HTMLTextAreaElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
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
        onSend({ text: text.trim(), ...(image ? { image } : {}), at, name: author });
    };
    const onKeyDown = (event: ReactKeyboardEvent) => {
        if (event.key === 'Escape') onCancel();
        else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send();
        }
    };
    const pick = async (file: File | undefined) => {
        if (!file) return;
        try {
            setProblem(null);
            setImage(await imageToDataUrl(file, 640));
        } catch {
            setProblem('That file could not be read as an image.');
        }
    };

    return (
        <div className="ccomposer" style={{ left: at[0] * zoom, top: at[1] * zoom }} onPointerDown={stop}>
            <span className="cteardrop" aria-hidden="true" />
            <form className={`ccard ${flip ? 'left' : ''}`} onSubmit={(e) => { e.preventDefault(); send(); }} aria-label="New comment">
                {needsName && (
                    <input className="cname" placeholder="Your name" aria-label="Your name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={onKeyDown} />
                )}
                <textarea ref={area} autoFocus rows={3} placeholder="Add a comment…" aria-label="Comment" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
                {image && (
                    <div className="cattach">
                        <img src={image} alt="Attachment preview" />
                        <button type="button" className="icon-btn" aria-label="Remove image" onClick={() => setImage(undefined)}>✕</button>
                    </div>
                )}
                {problem && <div className="cproblem" role="alert">{problem}</div>}
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
                    <button type="button" className="icon-btn" aria-label="Attach image" onClick={() => fileInput.current?.click()}>🖼</button>
                    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
                    <span className="spacer" />
                    <button type="submit" className="csend" aria-label="Send comment" disabled={!canSend}>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
                    </button>
                </div>
            </form>
        </div>
    );
}
