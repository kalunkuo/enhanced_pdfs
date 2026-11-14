import { useEffect, useRef } from 'react';
import { formatTimeAgo } from '../../lib/comments';
import type { Profile } from '../../lib/profile';
import { useNow } from '../../lib/useNow';
import type { Annotation, ElementInfo } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { Byline } from '../ui/Byline';
import { TrashIcon } from '../ui/icons';
import { CommentThread } from './CommentThread';

const NAMES = { line: 'Line', rect: 'Rectangle', ellipse: 'Circle', pen: 'Drawing', highlight: 'Highlight', text: 'Text box', comment: 'Comment', signature: 'Signature', cloud: 'Revision cloud' } as const;
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
    /** Show an object's properties, from the tie chip. */
    onOpenElement: (elementKey: string) => void;
}

/** The objects a revision cloud covers, each opening that object's properties. */
function CloudContents({ cloud, elements, onOpen }: { cloud: Annotation; elements: Map<string, ElementInfo>; onOpen: (key: string) => void }) {
    const list = cloud.contained ?? [];
    const whole = list.filter((c) => c.fully).length;
    return (
        <div className="cloud-contents">
            <h4>Objects in this cloud ({list.length})</h4>
            {list.length === 0 ? (
                <p className="muted">No objects were found inside this cloud. Draw it over part of the drawing to list what it covers.</p>
            ) : (
                <>
                    <ul className="cloud-list">
                        {list.map((c) => {
                            const e = elements.get(c.key);
                            return (
                                <li key={c.key}>
                                    <button className="cloud-item" title="Show this object's properties" onClick={() => onOpen(c.key)}>
                                        <strong>{e ? (e.mark ?? e.name) : c.key}</strong>
                                        {e && <span className="muted"> {e.category} · ID {e.elementIdText ?? e.elementId}</span>}
                                        {!c.fully && <span className="chip untied">partly inside</span>}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="muted cloud-summary">{whole} fully inside, {list.length - whole} partly inside</p>
                </>
            )}
        </div>
    );
}

export function NotesList({ annotations, elements, selectedId, profile, onProfile, onSelect, onTie, onReply, onDelete, onOpenElement }: Props) {
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

    const tieChip = (a: Annotation) => {
        const e = a.elementKey ? elements.get(a.elementKey) : undefined;
        return a.elementKey ? (
            <button className="chip tied linklike" title="Show this object's properties" onClick={() => onOpenElement(a.elementKey!)}>
                ↳ {e ? `${e.mark ?? e.name} · ID ${e.elementId}` : a.elementKey}
            </button>
        ) : (
            <span className="chip untied">untied</span>
        );
    };

    return (
        <ul className="list">
            {annotations.map((a) => {
                const e = a.elementKey ? elements.get(a.elementKey) : undefined;
                const selected = a.id === selectedId;
                const covered = a.contained?.length ?? 0;
                const chip = a.kind === 'cloud'
                    ? (covered ? <span className="chip tied">covers {covered} object{covered === 1 ? '' : 's'}</span> : <span className="chip untied">no objects</span>)
                    : a.elementKey
                    ? <span className="chip tied">tied to {e ? `${e.mark ?? e.name} · ID ${e.elementId}` : a.elementKey}</span>
                    : <span className="chip untied">untied</span>;
                return (
                    <li key={a.id} ref={selected ? selectedRef : undefined}>
                        {selected && a.kind === 'comment' ? (
                            <CommentThread comment={a} profile={profile} onProfile={onProfile} now={now} onReply={onReply} onDelete={onDelete}>
                                <div className="tchips">{tieChip(a)}</div>
                                {tieSelect(a)}
                            </CommentThread>
                        ) : selected ? (
                            <section className="thread adetails" aria-label={`${NAMES[a.kind]} details`}>
                                <div className="adetails-head">
                                    <Byline author={a.author} createdAt={a.createdAt} now={now} />
                                    <button className="icon-btn tdel" aria-label={`Delete ${NAMES[a.kind].toLowerCase()}`} title={`Delete ${NAMES[a.kind].toLowerCase()}`} onClick={() => onDelete(a.id)}><TrashIcon /></button>
                                </div>
                                <div className="akind"><strong>{NAMES[a.kind]}</strong> <span className="muted">· page {a.page}</span></div>
                                {a.text && <p className="ttext">{a.text}</p>}
                                {a.kind === 'cloud' ? (
                                    <CloudContents cloud={a} elements={elements} onOpen={onOpenElement} />
                                ) : (
                                    <>
                                        <div className="tchips">{tieChip(a)}</div>
                                        {tieSelect(a)}
                                    </>
                                )}
                            </section>
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
                            </>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
