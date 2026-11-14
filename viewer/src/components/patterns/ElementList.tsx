import { useState } from 'react';
import type { ElementInfo } from '../../lib/types';

export function ElementList({ elements, selectedKey, onSelect }: { elements: ElementInfo[]; selectedKey: string | null; onSelect: (key: string) => void }) {
    const [q, setQ] = useState('');
    const f = q.trim().toLowerCase();
    const shown = f ? elements.filter((e) => `${e.mark} ${e.name} ${e.category} ${e.elementId}`.toLowerCase().includes(f)) : elements;
    return (
        <>
            <input className="search" type="search" placeholder="Search elements" aria-label="Search elements" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="list">
                {shown.map((e) => (
                    <li key={e.key}>
                        <button aria-current={e.key === selectedKey} onClick={() => onSelect(e.key)}>
                            <strong>{e.mark ?? e.name}</strong> <span className="muted">{e.category} · ID {e.elementId}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {shown.length === 0 && <div className="panel-empty">No elements match.</div>}
        </>
    );
}
