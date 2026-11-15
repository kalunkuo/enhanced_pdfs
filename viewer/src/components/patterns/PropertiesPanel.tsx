import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { categoryColor } from '../../lib/categoryColor';
import { elementLabel, singularCategory } from '../../lib/elementLabel';
import { groupParameters } from '../../lib/groups';
import { LOCATION_LABELS, type LocationStatus } from '../../lib/coverage';
import { categoryCounts, combineParameters, identityParameters, type CombinedParameter } from '../../lib/selection';
import type { ElementInfo, EnhancedPdf } from '../../lib/types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { MetadataRows } from '../ui/MetadataRows';

const isBool = (v: string) => v === 'Yes' || v === 'No';

function Wall() {
    // Generic section swatch, like the thumbnail at the top of Revit's Properties palette.
    return (
        <svg className="prop-swatch" viewBox="0 0 56 56" aria-hidden="true">
            <rect x="4" y="24" width="48" height="8" fill="var(--color-surface)" stroke="var(--color-text-muted)" />
            <path d="M4 28h48" stroke="var(--color-text-muted)" strokeDasharray="3 2" />
        </svg>
    );
}

const IDENTITY = 'Identity Data';
const TYPE_GROUP = 'Type Parameters';

const LOCATABLE: readonly (LocationStatus | undefined)[] = ['ready', 'partial', 'legacy'];

export interface PropertiesPanelProps {
    doc: EnhancedPdf;
    /** Every selected element: one clicked element, or all filter matches. */
    elements: readonly ElementInfo[];
    hasShapes: boolean;
    locations?: ReadonlyMap<string, LocationStatus>;
    onLocate?: (key: string) => void;
    /** Fits the view to the selected elements on the current page. */
    onFitSelection?: () => void;
    /** Hovering a category pill or object row previews those objects on the canvas. */
    onPreview?: (keys: ReadonlySet<string> | null) => void;
}

export function PropertiesPanel({ doc, elements: selected, hasShapes, locations, onLocate, onFitSelection, onPreview }: PropertiesPanelProps) {
    // A big selection is explored by category: a pill narrows the panel to that category, and its list narrows it to one object.
    // The narrowing resets whenever the selection itself changes.
    const signature = useMemo(() => `${selected.length}:${selected.map((e) => e.key).join('|')}`, [selected]);
    // Never leave a preview behind when the panel goes away or the selection changes under the pointer.
    // (Keyed on the signature: `selected` is a new array on every render, which would clear the preview as it starts.)
    useEffect(() => () => onPreview?.(null), [onPreview, signature]);
    const [narrow, setNarrow] = useState<{ signature: string; category: string | null; key: string | null }>({ signature, category: null, key: null });
    const scope = narrow.signature === signature ? narrow : { signature, category: null, key: null };
    const pills = useMemo(() => categoryCounts(selected), [selected]);
    const elements = useMemo(
        () => scope.key ? selected.filter((e) => e.key === scope.key) : scope.category ? selected.filter((e) => e.category === scope.category) : selected,
        [selected, scope.key, scope.category],
    );
    const preview = (members: readonly ElementInfo[]) => {
        const keys = new Set(members.map((e) => e.key));
        return { onPointerEnter: () => onPreview?.(keys), onPointerLeave: () => onPreview?.(null), onFocus: () => onPreview?.(keys), onBlur: () => onPreview?.(null) };
    };
    const inCategory = scope.category ? selected.filter((e) => e.category === scope.category) : [];
    const groups = useMemo<[string, CombinedParameter[]][]>(() => {
        if (!elements.length) return [];
        const identity = combineParameters(elements.map(identityParameters));
        const exported = combineParameters(elements.map((element) => [
            ...(doc.parameters.get(element.key) ?? []),
            ...((element.typeKey && doc.parameters.get(element.typeKey)) || []),
        ]));
        return [[IDENTITY, identity], ...groupParameters(exported)];
    }, [doc, elements]);
    const counts = useMemo(() => categoryCounts(elements), [elements]);
    // Only identity data starts open; the rest stay one click away. Open state survives selection changes.
    const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set([IDENTITY]));
    const toggleGroup = (group: string) => setOpenGroups((open) => {
        const next = new Set(open);
        if (!next.delete(group)) next.add(group);
        return next;
    });
    const element = elements[0];
    if (!element) {
        return (
            <div className="panel-empty">
                {hasShapes
                    ? 'Hover over the drawing to preview an element. Click one, or filter in the Elements tab, to see parameters.'
                    : 'Pick an element from the Elements tab to see its parameters.'}
            </div>
        );
    }
    const single = elements.length === 1;
    const location = single ? locations?.get(element.key) : undefined;
    const locatable = single ? LOCATABLE.includes(location) : elements.some((e) => LOCATABLE.includes(locations?.get(e.key)));
    const shared = (pick: (e: ElementInfo) => string | undefined) => {
        const value = pick(element);
        return elements.every((e) => pick(e) === value) ? value : undefined;
    };
    const title = single ? element.family ?? element.category : shared((e) => e.family) ?? (counts.length === 1 ? element.category : 'Multiple categories');
    const subtitle = single ? element.type ?? element.name : shared((e) => e.type) ?? `${elements.length} elements selected`;
    return (
        <>
            {location && <div className={`location-status property-location location-${location}`}>{LOCATION_LABELS[location]}</div>}
            {elements.some((e) => e.placeholder) && <div className="notice">Placeholder data. Revit values will replace this.</div>}
            <div className="prop-head">
                <Wall />
                <div>
                    <div className="prop-title">{title}</div>
                    <div className="prop-sub">{subtitle}</div>
                </div>
            </div>
            {selected.length > 1 && (
                <section className="multi-select">
                    <div className="multi-items" role="tablist" aria-label="Selected categories">
                        <button role="tab" className="multi-item multi-all" aria-selected={!scope.category} {...preview(selected)} onClick={() => setNarrow({ signature, category: null, key: null })}>All ({selected.length})</button>
                        {pills.map(([category, count]) => (
                            <button key={category} role="tab" className="multi-item" aria-selected={scope.category === category} style={{ '--tag': categoryColor(category) } as CSSProperties} {...preview(selected.filter((e) => e.category === category))}
                                onClick={() => setNarrow({ signature, category, key: null })}>{singularCategory(category)} ({count})</button>
                        ))}
                    </div>
                    {scope.category && (
                        <ul className="multi-list" aria-label={`${singularCategory(scope.category)} objects`}>
                            {inCategory.map((e) => (
                                <li key={e.key}>
                                    <button aria-current={scope.key === e.key} {...preview([e])} onClick={() => setNarrow({ signature, category: scope.category, key: scope.key === e.key ? null : e.key })}>{elementLabel(e)}</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
            <div className="prop-count">
                <span>{single ? element.category : `${elements.length} selected`}</span>
                {single
                    ? onLocate && <Button disabled={!locatable} onClick={() => onLocate(element.key)}>Locate on drawing</Button>
                    : onFitSelection && <Button disabled={!locatable} onClick={onFitSelection}>Fit selection</Button>}
            </div>
            {groups.map(([group, params]) => (
                <ParameterSection key={group} group={group} params={params} open={openGroups.has(group)} onToggle={() => toggleGroup(group)} />
            ))}
        </>
    );
}

function ParameterSection({ group, params, open, onToggle }: { group: string; params: CombinedParameter[]; open: boolean; onToggle: () => void }) {
    const bodyId = useId();
    return (
        <section className="prop-section">
            <h3>
                <button type="button" className="prop-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
                    <span>{group}</span>
                    <span className="prop-section-count">{params.length}</span>
                    <Icon className="prop-section-chevron" name="chevronDown" />
                </button>
            </h3>
            <div id={bodyId} className={`prop-section-body ${open ? '' : 'is-collapsed'}`} aria-hidden={!open} inert={!open}>
                <div>
                    <MetadataRows items={params.map((p, i) => ({
                        key: `${p.scope}-${p.name}-${i}`,
                        // Type Parameters already names its scope; elsewhere only type-sourced rows are tagged.
                        label: p.scope === 'Type' && group !== TYPE_GROUP ? <>{p.name} <span className="parameter-scope">Type</span></> : p.name,
                        value: <Value p={p} />,
                    }))} />
                </div>
            </div>
        </section>
    );
}

function Value({ p }: { p: CombinedParameter }) {
    if (p.varies) return <span className="muted">Varies</span>;
    if (isBool(p.value)) return <span className={`check ${p.value === 'Yes' ? 'on' : ''}`} aria-label={p.value}>{p.value === 'Yes' ? '✓' : ''}</span>;
    return p.value ? <>{p.value}</> : <span className="muted">—</span>;
}
