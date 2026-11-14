import { useEffect, useRef } from 'react';
import { formatTimeAgo } from '../../lib/comments';
import type { Profile } from '../../lib/profile';
import { useNow } from '../../lib/useNow';
import type { Annotation, ElementInfo } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { CommentThread } from './CommentThread';

const NAMES = { line: 'Line', rect: 'Rectangle', ellipse: 'Circle', pen: 'Drawing', highlight: 'Highlight', text: 'Text box', comment: 'Comment', signature: 'Signature' } as const;
const UNTIED = '';

interface Props {
    annotations: Annotation[];
    elements: Map<string, ElementInfo>;
    selectedId: string | null;
    profile: Profile;
    onProfile: (profile: Profile) => void;
    onSelect: (a: Annotation) => void;
    /** Tie an annotation to an object, or pass null to untie it. */
    onTie: (annotationId: string, elementKey: string | null) => void;
    onReply: (annotationId: string, reply: { text: string; name: string }) => void;
    onDelete: (annotationId: string) => void;
}

export function NotesList({ annotations, elements, selectedId, profile, onProfile, onSelect, onTie, onReply, onDelete }: Props) {
    const now = useNow();
    const selectedRef = useRef<HTMLLIElement>(null);
    // Selecting a pin on the page brings its note into view.
    // Braces matter: scrollIntoView can return a promise, and an effect must not return anything but a cleanup.
    useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: 'nearest' });
    }, [selectedId]);

    if (annotations.length === 0) return <div className="panel-empty">No annotations yet. Pick a tool and draw on the PDF.</div>;
    const options = [...elements.values()];

    const tieSelect = (a: Annotation) => (
        <label className="tie-row">
            <span className="muted">Object ID</span>
            <select className="select" value={a.elementKey ?? UNTIED} onChange={(ev) => onTie(a.id, ev.target.value || null)}>
                <option value={UNTIED}>Untied</option>
                {options.map((o) => (
                    <option key={o.key} value={o.key}>
                        {(o.mark ?? o.name)} · ID {o.elementId}{o.placeholder ? ' (placeholder)' : ''}
                    </option>
                ))}
            </select>
        </label>
    );

    return (
        <ul className="list">
            {annotations.map((a) => {
                const e = a.elementKey ? elements.get(a.elementKey) : undefined;
                const selected = a.id === selectedId;
                const chip = a.elementKey
                    ? <span className="chip tied">tied to {e ? `${e.mark ?? e.name} · ID ${e.elementId}` : a.elementKey}</span>
                    : <span className="chip untied">untied</span>;
                return (
                    <li key={a.id} ref={selected ? selectedRef : undefined}>
                        {selected && a.kind === 'comment' ? (
                            <CommentThread comment={a} profile={profile} onProfile={onProfile} now={now} onReply={onReply} onDelete={onDelete}>
                                <div className="tchips">{chip}</div>
                                {tieSelect(a)}
                            </CommentThread>
                        ) : (
                            <>
                                <button aria-current={selected} onClick={() => onSelect(a)}>
                                    <strong>{NAMES[a.kind]}</strong> <span className="muted">p. {a.page}</span>
                                    {a.kind === 'comment' && (
                                        <span className="note-author"><Avatar name={a.author?.name ?? 'Unknown'} photo={a.author?.photo} size={18} /> {a.author?.name ?? 'Unknown'} <span className="muted">{formatTimeAgo(a.createdAt, now)}</span></span>
                                    )}
                                    {a.text && <span> “{a.text}”</span>}
                                    {a.kind === 'comment' && (a.replies?.length ?? 0) > 0 && <span className="muted"> · {a.replies!.length} {a.replies!.length === 1 ? 'reply' : 'replies'}</span>}
                                    <div>{chip}</div>
                                </button>
                                {selected && tieSelect(a)}
                            </>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
