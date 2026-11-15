import type { ElementInfo, ParameterInfo } from './types';

/** A parameter across a selection. `varies` is set when the selected elements disagree or some lack it. */
export interface CombinedParameter extends ParameterInfo {
    varies: boolean;
}

/** The fixed identity rows the Properties panel shows above an element's exported parameters. */
export function identityParameters(element: ElementInfo): ParameterInfo[] {
    const ratingScope = element.fireRatingSource === 'Type' ? 'Type' as const : 'Instance' as const;
    return [
        { name: 'Element ID', scope: 'Instance', value: element.elementIdText ?? String(element.elementId) },
        { name: 'Category', scope: 'Instance', value: element.category },
        ...(element.family ? [{ name: 'Family', scope: 'Type' as const, value: element.family }] : []),
        ...(element.type ? [{ name: 'Type', scope: 'Type' as const, value: element.type }] : []),
        ...(element.level ? [{ name: 'Level', scope: 'Instance' as const, value: element.level }] : []),
        ...(element.model ? [{ name: 'Model', scope: 'Instance' as const, value: element.model }] : []),
        ...(element.modelKey ? [{ name: 'Model key', scope: 'Instance' as const, value: element.modelKey }] : []),
        ...(element.linkInstanceId ? [{ name: 'Link instance', scope: 'Instance' as const, value: element.linkInstanceId }] : []),
        ...(element.fireRating ? [{ name: 'Fire Rating', scope: ratingScope, value: element.fireRating }] : []),
        ...(element.fireRatingSource ? [{ name: 'Fire Rating source', scope: ratingScope, value: element.fireRatingSource }] : []),
    ];
}

/**
 * Merges each selected element's parameters by name and scope, like Revit's Properties palette
 * with several elements selected: a shared value is shown once; anything else varies.
 * Instance and type parameters with the same name stay separate rows. Rows keep first-seen order.
 */
export function combineParameters(lists: readonly (readonly ParameterInfo[])[]): CombinedParameter[] {
    const rows = new Map<string, { param: ParameterInfo; count: number; varies: boolean }>();
    for (const list of lists) {
        const seen = new Set<string>();
        for (const param of list) {
            const id = `${param.scope}\u0000${param.name}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const row = rows.get(id);
            if (!row) rows.set(id, { param, count: 1, varies: false });
            else {
                row.count++;
                if (row.param.value !== param.value) row.varies = true;
            }
        }
    }
    return [...rows.values()].map(({ param, count, varies }) => {
        const differs = varies || count < lists.length;
        return differs ? { name: param.name, scope: param.scope, value: '', varies: true } : { ...param, varies: false };
    });
}

/** Selected elements per category, largest first, for the panel's count line. */
export function categoryCounts(elements: readonly ElementInfo[]): [category: string, count: number][] {
    const counts = new Map<string, number>();
    for (const element of elements) counts.set(element.category, (counts.get(element.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * What makes two elements "the same type" for Select similar: the exported type record when there is one,
 * otherwise category, family and type name together (so elements without a type record still group by category).
 */
export function typeIdentity(element: Pick<ElementInfo, 'category' | 'family' | 'type' | 'typeKey'>): string {
    return element.typeKey ? `key\u0000${element.typeKey}` : `name\u0000${element.category}\u0000${element.family ?? ''}\u0000${element.type ?? ''}`;
}

/**
 * Every candidate that shares a type with any selected element, in candidate order. The selection itself is
 * kept even when it is not among the candidates, so selecting similar never drops what was already selected.
 */
export function similarElementKeys(selected: readonly ElementInfo[], candidates: Iterable<ElementInfo>): string[] {
    const types = new Set(selected.map(typeIdentity));
    const keys = new Set<string>();
    for (const candidate of candidates) if (types.has(typeIdentity(candidate))) keys.add(candidate.key);
    for (const element of selected) keys.add(element.key);
    return [...keys];
}
