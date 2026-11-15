import { categoryColor } from '../../lib/categoryColor';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { formatExactDate, formatTimeAgo } from '../../lib/comments';
import { elementLabel } from '../../lib/elementLabel';
import { linkedKeys, linksSummary } from '../../lib/links';
import type { Profile } from '../../lib/profile';
import { useNow } from '../../lib/useNow';
import type { Annotation, ElementInfo } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { Byline } from '../ui/Byline';
import { ChevronDownIcon, TrashIcon } from '../ui/icons';
import { CommentThread } from './CommentThread';
import { TieTag } from './TieTag';
import { ImportedAnnotationInfo } from './ImportedAnnotationInfo';

const NAMES = { line: 'Line', rect: 'Rectangle', ellipse: 'Circle', pen: 'Drawing', highlight: 'Highlight', text: 'Text box', comment: 'Comment', signature: 'Signature', cloud: 'Revision cloud' } as const;

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
    /** Hovering a note previews the objects it is linked to (or a cloud covers) on the canvas. */
    onPreview?: (keys: ReadonlySet<string> | null) => void;
    onEdit: (annotationId: string, text: string) => void;
    onEditReply: (annotationId: string, replyId: string, text: string) => void;
    onDelete: (annotationId: string) => void;
    /** Show an object's properties, from the tie chip. */
    onOpenElement: (elementKey: string) => void;
    onLinkImported: (annotationId: string, keys: readonly string[]) => void;
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
                                        <strong>{e ? elementLabel(e) : c.key}</strong>
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

/** The objects a note is linked to when there are several, each opening that object's properties. Collapsed by default. */
function LinkedObjects({ keys, elements, onOpen }: { keys: readonly string[]; elements: Map<string, ElementInfo>; onOpen: (key: string) => void }) {
    const [open, setOpen] = useState(false);
    const listId = useId();
    return (
        <div className="cloud-contents">
            <h4>
                <button type="button" className="linked-toggle" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((o) => !o)}>
                    Linked objects ({keys.length}) <ChevronDownIcon />
                </button>
            </h4>
            {open && <ul className="cloud-list linked-list" id={listId}>
                {keys.map((key, i) => {
                    const e = elements.get(key);
                    return (
                        <li key={key} style={{ '--menu-row-index': i } as CSSProperties}>
                            <button className="cloud-item" title="Show this object's properties" onClick={() => onOpen(key)}>
                                <strong>{e ? elementLabel(e) : key}</strong>
                            </button>
                        </li>
                    );
                })}
            </ul>}
        </div>
    );
}

export function NotesList({ annotations, elements, selectedId, profile, onProfile, onSelect, onTie, onReply, onEdit, onEditReply, onPreview, onDelete, onOpenElement, onLinkImported }: Props) {
    const now = useNow();
    const selectedRef = useRef<HTMLLIElement>(null);
    // Selecting a markup on the page brings its open note to the top of the panel (scroll-margin-top leaves a little room).
    // Braces matter: scrollIntoView can return a promise, and an effect must not return anything but a cleanup.
    useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: 'start' });
    }, [selectedId]);

    if (annotations.length === 0) return <div className="panel-empty">No annotations yet. Pick a tool and draw on the PDF.</div>;
    const previewHandlers = (a: Annotation) => {
        const keys = a.kind === 'cloud' ? (a.contained ?? []).map((c) => c.key) : linkedKeys(a);
        const show = () => { if (keys.length) onPreview?.(new Set(keys)); };
        return { onPointerEnter: show, onPointerLeave: () => onPreview?.(null), onFocus: show, onBlur: () => onPreview?.(null) };
    };
    return (
        <ul className="list notes-list">
            {annotations.map((a) => {
                const e = a.elementKey ? elements.get(a.elementKey) : undefined;
                const selected = a.id === selectedId;
                const covered = a.contained?.length ?? 0;
                const links = linkedKeys(a);
                const linkList = links.length > 1 && <LinkedObjects keys={links} elements={elements} onOpen={onOpenElement} />;
                const chip = a.kind === 'cloud'
                    ? (covered ? <span className="chip tied">covers {covered} object{covered === 1 ? '' : 's'}</span> : <span className="chip untied">no objects</span>)
                    : links.length > 1
                    ? <span className="chip tied">↳ {linksSummary(links, elements)}</span>
                    : a.elementKey
                    ? <span className="chip tied" style={e ? { color: categoryColor(e.category) } : undefined}>↳ {e ? elementLabel(e) : a.elementKey}</span>
                    : <span className="chip untied">untied</span>;
                return (
                    <li key={a.id} ref={selected ? selectedRef : undefined} className={selected ? 'note-open' : undefined} {...previewHandlers(a)}>
                        {selected && a.kind === 'comment' ? (
                            <CommentThread comment={a} profile={profile} onProfile={onProfile} now={now} onReply={onReply} onEdit={onEdit} onEditReply={onEditReply} onDelete={onDelete}>
                                <ImportedAnnotationInfo annotation={a} elements={elements} onLink={onLinkImported} onOpen={onOpenElement} />
                                <TieTag annotation={a} elements={elements} onTie={onTie} onOpenElement={onOpenElement} />
                                {linkList}
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
                                        <TieTag annotation={a} elements={elements} onTie={onTie} onOpenElement={onOpenElement} />
                                        {linkList}
                                    </>
                                )}
                            </section>
                        ) : (
                            <>
                                <button aria-current={selected} onClick={() => onSelect(a)}>
                                    <span className="note-head">
                                        <strong>{a.source ? `Imported ${a.source.subtype}` : NAMES[a.kind]}</strong>
                                        <span className="muted">p. {a.page}{a.source && a.source.linkState !== 'linked' ? ' · needs review' : ''}</span>
                                        {a.kind === 'comment' && (
                                            <span className="note-author"><Avatar name={a.author?.name ?? 'Unknown'} photo={a.author?.photo} size={18} /> {a.author?.name ?? 'Unknown'}</span>
                                        )}
                                        {a.kind === 'comment' && <time className="muted" dateTime={a.createdAt} title={formatTimeAgo(a.createdAt, now)}>{formatExactDate(a.createdAt)}</time>}
                                    </span>
                                    {(a.text || (a.kind === 'comment' && (a.replies?.length ?? 0) > 0)) && (
                                        <span className="note-body">
                                            {a.text && <>“{a.text}”</>}
                                            {a.kind === 'comment' && (a.replies?.length ?? 0) > 0 && <span className="muted">{a.text ? ' · ' : ''}{a.replies!.length} {a.replies!.length === 1 ? 'reply' : 'replies'}</span>}
                                        </span>
                                    )}
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
