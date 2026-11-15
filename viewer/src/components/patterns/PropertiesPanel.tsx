import { useMemo } from 'react';
import { groupParameters } from '../../lib/groups';
import { LOCATION_LABELS, type LocationStatus } from '../../lib/coverage';
import { categoryCounts, combineParameters, identityParameters, type CombinedParameter } from '../../lib/selection';
import type { ElementInfo, EnhancedPdf } from '../../lib/types';
import { Button } from '../ui/Button';

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
}

export function PropertiesPanel({ doc, elements, hasShapes, locations, onLocate, onFitSelection }: PropertiesPanelProps) {
    const groups = useMemo<[string, CombinedParameter[]][]>(() => {
        if (!elements.length) return [];
        const identity = combineParameters(elements.map(identityParameters));
        const exported = combineParameters(elements.map((element) => [
            ...(doc.parameters.get(element.key) ?? []),
            ...((element.typeKey && doc.parameters.get(element.typeKey)) || []),
        ]));
        return [['Identity Data', identity], ...groupParameters(exported)];
    }, [doc, elements]);
    const counts = useMemo(() => categoryCounts(elements), [elements]);
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
            <div className="prop-count">
                <span>{counts.map(([category, count]) => `${category} (${count})`).join(', ')}</span>
                {single
                    ? onLocate && <Button disabled={!locatable} onClick={() => onLocate(element.key)}>Locate on drawing</Button>
                    : onFitSelection && <Button disabled={!locatable} onClick={onFitSelection}>Fit selection</Button>}
            </div>
            <p className="parameter-scope-note">{single ? 'Parameters retain their instance or type source.' : 'Values shared by every selected element are shown; others vary.'}</p>
            {groups.map(([group, params]) => (
                <section className="group" key={group}>
                    <h3>{group}</h3>
                    <div className="rows">
                        {params.map((p, i) => (
                            <Row key={`${p.scope}-${p.name}-${i}`} p={p} />
                        ))}
                    </div>
                </section>
            ))}
        </>
    );
}

function Row({ p }: { p: CombinedParameter }) {
    return (
        <>
            <div className="k">{p.name} <span className="parameter-scope">{p.scope}</span></div>
            <div>{p.varies ? <span className="muted">Varies</span> : isBool(p.value) ? <span className={`check ${p.value === 'Yes' ? 'on' : ''}`}>{p.value === 'Yes' ? '✓' : ''}</span> : p.value || <span className="muted">—</span>}</div>
        </>
    );
}
