import { groupParameters } from '../../lib/groups';
import { LOCATION_LABELS, type LocationStatus } from '../../lib/coverage';
import type { ElementInfo, EnhancedPdf, ParameterInfo } from '../../lib/types';
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

export function PropertiesPanel({ doc, element, hasShapes, location, onLocate }: { doc: EnhancedPdf; element: ElementInfo | undefined; hasShapes: boolean; location?: LocationStatus; onLocate?: (key: string) => void }) {
    if (!element) {
        return (
            <div className="panel-empty">
                {hasShapes
                    ? 'Hover over the drawing to preview an element. Click one to see all of its parameters.'
                    : 'Pick an element from the Elements tab to see its parameters.'}
            </div>
        );
    }
    const own = doc.parameters.get(element.key) ?? [];
    const type = (element.typeKey && doc.parameters.get(element.typeKey)) || [];
    const identity: ParameterInfo[] = [
        { name: 'Element ID', scope: 'Instance', value: element.elementIdText ?? String(element.elementId) },
        { name: 'Category', scope: 'Instance', value: element.category },
        ...(element.family ? [{ name: 'Family', scope: 'Type' as const, value: element.family }] : []),
        ...(element.type ? [{ name: 'Type', scope: 'Type' as const, value: element.type }] : []),
        ...(element.level ? [{ name: 'Level', scope: 'Instance' as const, value: element.level }] : []),
        ...(element.model ? [{ name: 'Model', scope: 'Instance' as const, value: element.model }] : []),
        ...(element.modelKey ? [{ name: 'Model key', scope: 'Instance' as const, value: element.modelKey }] : []),
        ...(element.linkInstanceId ? [{ name: 'Link instance', scope: 'Instance' as const, value: element.linkInstanceId }] : []),
        ...(element.fireRating ? [{ name: 'Fire Rating', scope: element.fireRatingSource === 'Type' ? 'Type' as const : 'Instance' as const, value: element.fireRating }] : []),
        ...(element.fireRatingSource ? [{ name: 'Fire Rating source', scope: element.fireRatingSource === 'Type' ? 'Type' as const : 'Instance' as const, value: element.fireRatingSource }] : []),
    ];
    const groups: [string, ParameterInfo[]][] = [['Identity Data', identity], ...groupParameters([...own, ...type])];
    return (
        <>
            {location && <div className={`location-status property-location location-${location}`}>{LOCATION_LABELS[location]}</div>}
            {onLocate && <div className="property-actions"><Button disabled={!location || !['ready', 'partial', 'legacy'].includes(location)} onClick={() => onLocate(element.key)}>Locate on drawing</Button></div>}
            {element.placeholder && <div className="notice">Placeholder data. Revit values will replace this.</div>}
            <div className="prop-head">
                <Wall />
                <div>
                    <div className="prop-title">{element.family ?? element.category}</div>
                    <div className="prop-sub">{element.type ?? element.name}</div>
                </div>
            </div>
            <div className="prop-count">{element.category} (1)</div>
            <p className="parameter-scope-note">Parameters retain their instance or type source.</p>
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

function Row({ p }: { p: ParameterInfo }) {
    return (
        <>
            <div className="k">{p.name} <span className="parameter-scope">{p.scope}</span></div>
            <div>{isBool(p.value) ? <span className={`check ${p.value === 'Yes' ? 'on' : ''}`}>{p.value === 'Yes' ? '✓' : ''}</span> : p.value || <span className="muted">—</span>}</div>
        </>
    );
}
