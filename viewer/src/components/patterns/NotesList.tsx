import type { Annotation, ElementInfo } from '../../lib/types';

const NAMES = { line: 'Line', rect: 'Rectangle', ellipse: 'Circle', pen: 'Drawing', highlight: 'Highlight', text: 'Text box', comment: 'Comment', signature: 'Signature' } as const;
const UNTIED = '';

interface Props {
    annotations: Annotation[];
    elements: Map<string, ElementInfo>;
    selectedId: string | null;
    onSelect: (a: Annotation) => void;
    /** Tie an annotation to an object, or pass null to untie it. */
    onTie: (annotationId: string, elementKey: string | null) => void;
}

export function NotesList({ annotations, elements, selectedId, onSelect, onTie }: Props) {
    if (annotations.length === 0) return <div className="panel-empty">No annotations yet. Pick a tool and draw on the PDF.</div>;
    const options = [...elements.values()];
    return (
        <ul className="list">
            {annotations.map((a) => {
                const e = a.elementKey ? elements.get(a.elementKey) : undefined;
                return (
                    <li key={a.id}>
                        <button aria-current={a.id === selectedId} onClick={() => onSelect(a)}>
                            <strong>{NAMES[a.kind]}</strong> <span className="muted">p. {a.page}</span> {a.text && <span>“{a.text}”</span>}
                            <div>
                                {a.elementKey ? (
                                    <span className="chip tied">tied to {e ? `${e.mark ?? e.name} · ID ${e.elementId}` : a.elementKey}</span>
                                ) : (
                                    <span className="chip untied">untied</span>
                                )}
                            </div>
                        </button>
                        {a.id === selectedId && (
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
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
