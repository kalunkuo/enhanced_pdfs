import { useState } from 'react';
import { LOCATION_LABELS, type LocationStatus } from '../../lib/coverage';
import type { ElementInfo } from '../../lib/types';
import { Button } from '../ui/Button';

/** Rows shown at a time under the filter; more load on request. */
const PAGE = 10;

export function ElementList({ elements, selectedKey, onSelect, locations, onLocate }: { elements: ElementInfo[]; selectedKey: string | null; onSelect: (key: string) => void; locations?: ReadonlyMap<string, LocationStatus>; onLocate?: (key: string) => void }) {
    const [limit, setLimit] = useState(PAGE);
    const shown = elements.slice(0, limit);
    return (
        <>
            <p className="result-count" aria-live="polite">{elements.length.toLocaleString()} matching elements</p>
            <ul className="list">
                {shown.map((e) => {
                    const location = locations?.get(e.key);
                    const locatable = ['ready', 'partial', 'legacy'].includes(location ?? '');
                    return (
                        <li key={e.key}>
                            <button className="element-entry" aria-current={e.key === selectedKey} onClick={() => { onSelect(e.key); if (locatable) onLocate?.(e.key); }}>
                                <span className="element-entry-title"><strong>{e.mark ?? e.name}</strong> <span className="muted">{e.category} · ID {e.elementIdText ?? e.elementId}</span></span>
                                {(e.model || location) && (
                                    <span className="element-entry-meta">
                                        <span className="element-context">{e.model}</span>
                                        {location && <span className={`location-status location-${location}`}>{LOCATION_LABELS[location]}</span>}
                                    </span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
            {shown.length < elements.length && <Button variant="ghost" className="load-more" onClick={() => setLimit((value) => value + PAGE)}>Show {Math.min(PAGE, elements.length - shown.length)} more</Button>}
            {shown.length === 0 && <div className="panel-empty">No elements match these filters.</div>}
        </>
    );
}
