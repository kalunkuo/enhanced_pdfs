import { elementLabel } from './elementLabel';
import type { ElementInfo } from './types';

/**
 * Objects to offer when tying a note: those matching every word typed, in a natural order ("Door 2" before
 * "Door 10", types grouped). A file can have thousands of objects, so only the first `limit` are returned.
 */
export function searchObjects(elements: Iterable<ElementInfo>, query: string, limit = 100): { items: ElementInfo[]; total: number } {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches: { e: ElementInfo; label: string }[] = [];
    for (const e of elements) {
        const label = elementLabel(e);
        if (terms.length) {
            const haystack = `${label} ${e.name} ${e.mark ?? ''} ${e.level ?? ''} ${e.family ?? ''} ${e.type ?? ''}`.toLowerCase();
            if (!terms.every((t) => haystack.includes(t))) continue;
        }
        matches.push({ e, label });
    }
    matches.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    return { items: matches.slice(0, limit).map((m) => m.e), total: matches.length };
}
