import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatExactDate, formatTimeAgo, isAuthor } from '../../lib/comments';
import type { Profile } from '../../lib/profile';
import type { Annotation } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { PencilIcon, TrashIcon } from '../ui/icons';

interface Person { name: string; photo?: string | undefined }

function Message({ author, createdAt, text, now, action, onEdit }: { author: Person | undefined; createdAt: string | undefined; text: string; now: number; action?: React.ReactNode; onEdit?: (text: string) => void }) {
    const name = author?.name ?? 'Unknown';
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(text);
    const save = () => {
        if (draft.trim() === '') return;
        if (draft.trim() !== text) onEdit?.(draft.trim());
        setEditing(false);
    };
    const cancel = () => { setDraft(text); setEditing(false); };
    return (
        <div className="tmsg">
            <div className="thead">
                <Avatar name={name} photo={author?.photo} size={32} />
                <div className="twho">
                    <strong>{name}</strong>
                    <time className="muted" dateTime={createdAt} title={formatTimeAgo(createdAt, now)}>{formatExactDate(createdAt) || 'No date recorded'}</time>
                </div>
                {onEdit && !editing && <button className="icon-btn tdel" aria-label="Edit message" title="Edit message" onClick={() => { setDraft(text); setEditing(true); }}><PencilIcon /></button>}
                {action}
            </div>
            {editing ? (
                <form className="tedit" onSubmit={(e) => { e.preventDefault(); save(); }}>
                    <textarea rows={3} aria-label="Edit message" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') cancel();
                            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
                        }} />
                    <div className="tedit-actions">
                        <button type="button" className="btn" onClick={cancel}>Cancel</button>
                        <button type="submit" className="btn primary" disabled={draft.trim() === ''}>Save</button>
                    </div>
                </form>
            ) : <p className="ttext">{text}</p>}
        </div>
    );
}

/** One comment with its replies and a reply box. Shown in the Notes panel when a pin is selected. */
export function CommentThread({ comment, profile, onProfile, now, onReply, onDelete, onEdit, onEditReply, children }: {
    comment: Annotation;
    profile: Profile;
    onProfile: (p: Profile) => void;
    now: number;
    /** `name` is the author's name as of this click, so a first-time name is not lost to stale state. */
    onReply: (id: string, reply: { text: string; name: string }) => void;
    onDelete: (id: string) => void;
    /** Rewrite a browser message by the current profile; native PDF appearances remain untouched. */
    onEdit?: (id: string, text: string) => void;
    onEditReply?: (id: string, replyId: string, text: string) => void;
    /** Extra controls under the message, such as the object tie. */
    children?: React.ReactNode;
}) {
    const [text, setText] = useState('');
    const [name, setName] = useState(profile.name);
    const needsName = profile.name.trim() === '';
    const canSend = text.trim() !== '' && (!needsName || name.trim() !== '');
    const replies = comment.replies ?? [];

    const send = () => {
        if (!canSend) return;
        const author = (needsName ? name : profile.name).trim();
        if (needsName) onProfile({ ...profile, name: author });
        onReply(comment.id, { text: text.trim(), name: author });
        setText('');
    };
    const onKeyDown = (e: ReactKeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };

    return (
        <section className="thread" aria-label={`Comment thread by ${comment.author?.name ?? 'Unknown'}`}>
            <Message
                author={comment.author} createdAt={comment.createdAt} text={comment.text ?? ''} now={now}
                {...(onEdit && !comment.source && isAuthor(comment.author, profile) ? { onEdit: (text: string) => onEdit(comment.id, text) } : {})}
                action={<button className="icon-btn tdel" aria-label="Delete comment and its replies" title="Delete comment and its replies" onClick={() => onDelete(comment.id)}><TrashIcon /></button>}
            />
            {children}
            {replies.length > 0 && (
                <ul className="treplies" aria-label={`${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}>
                    {replies.map((r) => (
                        <li key={r.id}><Message author={r.author} createdAt={r.createdAt} text={r.text} now={now} {...(onEditReply && !r.source && isAuthor(r.author, profile) ? { onEdit: (text: string) => onEditReply(comment.id, r.id, text) } : {})} /></li>
                    ))}
                </ul>
            )}
            <form className="treply" onSubmit={(e) => { e.preventDefault(); send(); }}>
                {needsName && <input className="search tname" placeholder="Your name" aria-label="Your name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKeyDown} />}
                <textarea rows={2} placeholder="Reply…" aria-label="Reply" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
                <button type="submit" className="btn primary tsend" disabled={!canSend}>Reply</button>
            </form>
        </section>
    );
}
