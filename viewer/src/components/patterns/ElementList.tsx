import { useState } from 'react';
import { LOCATION_LABELS, type LocationStatus } from '../../lib/coverage';
import type { ElementInfo } from '../../lib/types';
import { Button } from '../ui/Button';

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
            {shown.length < elements.length && <Button variant="ghost" className="load-more" onClick={() => setLimit((value) => value + 100)}>Show 100 more</Button>}
            {shown.length === 0 && <div className="panel-empty">No elements match these filters.</div>}
        </>
    );
}
