import { useEffect, useMemo, useRef, useState } from 'react';
import { elementLabel } from '../../lib/elementLabel';
import { linkedKeys } from '../../lib/links';
import { searchObjects } from '../../lib/objectSearch';
import type { Annotation, ElementInfo } from '../../lib/types';
import { CheckIcon, ChevronDownIcon } from '../ui/icons';

interface Props {
    annotation: Annotation;
    elements: Map<string, ElementInfo>;
    /** Tie the note to one object (replacing every link), or pass null to untie it. */
    onTie: (annotationId: string, elementKey: string | null) => void;
    /** Show an object's properties. */
    onOpenElement: (elementKey: string) => void;
}

/**
 * The tag that says what a note is tied to ("↳ Wall 676282"). Clicking it opens a searchable list of objects to
 * tie the note to instead, so there is no separate dropdown.
 */
export function TieTag({ annotation, elements, onTie, onOpenElement }: Props) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const root = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const current = annotation.elementKey ? elements.get(annotation.elementKey) : undefined;
    const tied = annotation.elementKey !== undefined;
    const links = linkedKeys(annotation);

    useEffect(() => {
        if (!open) return;
        search.current?.focus();
        const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
        window.addEventListener('pointerdown', close);
        return () => window.removeEventListener('pointerdown', close);
    }, [open]);

    const { items, total } = useMemo(() => (open ? searchObjects(elements.values(), query) : { items: [], total: 0 }), [open, elements, query]);

    const close = () => {
        setOpen(false);
        setQuery('');
    };
    const choose = (key: string | null) => {
        onTie(annotation.id, key);
        close();
    };

    return (
        <div className="tie-tag" ref={root}>
            <button className={`chip ${tied ? 'tied' : 'untied'} tie-button`} aria-haspopup="listbox" aria-expanded={open} title="Change what this note is tied to" onClick={() => setOpen(!open)}>
                {links.length > 1 ? `↳ ${links.length} objects` : tied ? `↳ ${current ? elementLabel(current) : annotation.elementKey}` : 'untied'}
                <ChevronDownIcon />
            </button>
            {open && (
                <div className="tie-menu" onKeyDown={(e) => e.key === 'Escape' && close()}>
                    <input
                        ref={search}
                        className="tie-search"
                        type="search"
                        placeholder="Search objects"
                        aria-label="Search objects to tie to"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && items[0]) choose(items[0].key);
                        }}
                    />
                    <div className="tie-actions">
                        {links.length > 1 && <p className="tie-hint">Choosing one object replaces all {links.length} links.</p>}
                        {tied && current && links.length === 1 && (
                            <button className="tie-action" onClick={() => { onOpenElement(current.key); close(); }}>Show properties of {elementLabel(current)}</button>
                        )}
                    </div>
                    <ul className="tie-options" role="listbox" aria-label="Objects">
                        <li role="option" aria-selected={!tied}>
                            <button className="tie-option" onClick={() => choose(null)}>
                                <span className="tie-check">{!tied && <CheckIcon />}</span>Untied
                            </button>
                        </li>
                        {items.map((o) => (
                            <li key={o.key} role="option" aria-selected={links.includes(o.key)}>
                                <button className="tie-option" onClick={() => choose(o.key)}>
                                    <span className="tie-check">{links.includes(o.key) && <CheckIcon />}</span>
                                    <span className="tie-name">{elementLabel(o)}</span>
                                    {(o.level || o.placeholder) && <span className="muted tie-meta">{o.placeholder ? 'placeholder' : o.level}</span>}
                                </button>
                            </li>
                        ))}
                    </ul>
                    {total === 0 && <p className="tie-hint">No objects match.</p>}
                    {total > items.length && <p className="tie-hint">Showing {items.length} of {total}. Type to narrow the list.</p>}
                </div>
            )}
        </div>
    );
}
