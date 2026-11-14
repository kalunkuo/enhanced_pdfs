import { useState } from 'react';
import { LOCATION_LABELS, type LocationStatus } from '../../lib/coverage';
import type { ElementInfo } from '../../lib/types';

export function ElementList({ elements, selectedKey, onSelect, locations }: { elements: ElementInfo[]; selectedKey: string | null; onSelect: (key: string) => void; locations?: ReadonlyMap<string, LocationStatus> }) {
    const [limit, setLimit] = useState(100);
    const shown = elements.slice(0, limit);
    return (
        <>
            <p className="result-count" aria-live="polite">{elements.length.toLocaleString()} matching elements</p>
            <ul className="list">
                {shown.map((e) => (
                    <li key={e.key}>
                        <button aria-current={e.key === selectedKey} onClick={() => onSelect(e.key)}>
                            <strong>{e.mark ?? e.name}</strong> <span className="muted">{e.category} · ID {e.elementIdText ?? e.elementId}</span>
                            {e.model && <span className="element-context">{e.model}</span>}
                            {locations?.get(e.key) && <span className={`location-status location-${locations.get(e.key)}`}>{LOCATION_LABELS[locations.get(e.key)!]}</span>}
                        </button>
                    </li>
                ))}
            </ul>
            {shown.length < elements.length && <button className="btn ghost load-more" onClick={() => setLimit((value) => value + 100)}>Show 100 more</button>}
            {shown.length === 0 && <div className="panel-empty">No elements match these filters.</div>}
        </>
    );
}
