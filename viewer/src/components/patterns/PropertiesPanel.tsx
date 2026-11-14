import { groupParameters } from '../../lib/groups';
import type { ElementInfo, EnhancedPdf, ParameterInfo } from '../../lib/types';

const isBool = (v: string) => v === 'Yes' || v === 'No';

function Wall() {
    // Generic section swatch, like the thumbnail at the top of Revit's Properties palette.
    return (
        <svg className="prop-swatch" viewBox="0 0 56 56" aria-hidden="true">
            <rect x="4" y="24" width="48" height="8" fill="var(--card)" stroke="var(--muted-foreground)" />
            <path d="M4 28h48" stroke="var(--muted-foreground)" strokeDasharray="3 2" />
        </svg>
    );
}

export function PropertiesPanel({ doc, element, hasShapes }: { doc: EnhancedPdf; element: ElementInfo | undefined; hasShapes: boolean }) {
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
        { name: 'Element ID', scope: 'Instance', value: String(element.elementId) },
        { name: 'Category', scope: 'Instance', value: element.category },
        ...(element.level ? [{ name: 'Level', scope: 'Instance' as const, value: element.level }] : []),
    ];
    const groups: [string, ParameterInfo[]][] = [['Identity Data', identity], ...groupParameters([...own, ...type])];
    return (
        <>
            {element.placeholder && <div className="notice">Placeholder data. Revit values will replace this.</div>}
            <div className="prop-head">
                <Wall />
                <div>
                    <div className="prop-title">{element.family ?? element.category}</div>
                    <div className="prop-sub">{element.type ?? element.name}</div>
                </div>
            </div>
            <div className="prop-count">{element.category} (1)</div>
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
            <div className="k">{p.name}</div>
            <div>{isBool(p.value) ? <span className={`check ${p.value === 'Yes' ? 'on' : ''}`}>{p.value === 'Yes' ? '✓' : ''}</span> : p.value || <span className="muted">—</span>}</div>
        </>
    );
}
