import type { ParameterInfo } from './types';

/** Revit parameter groups are not exported yet, so group by name the way the Properties palette does. */
const GROUPS: readonly [group: string, pattern: RegExp][] = [
    ['Constraints', /constraint|offset|attached|extension|unconnected height|location line|room bounding|related to mass/i],
    ['Cross-Section Definition', /cross-section/i],
    ['Fire & Function', /fire|function|rating/i],
];

export function groupOf(p: ParameterInfo): string {
    if (p.scope === 'Type') return 'Type Parameters';
    return GROUPS.find(([, re]) => re.test(p.name))?.[0] ?? 'Other';
}

const ORDER = ['Constraints', 'Cross-Section Definition', 'Fire & Function', 'Other', 'Type Parameters'];

export function groupParameters<T extends ParameterInfo>(params: readonly T[]): [string, T[]][] {
    const map = new Map<string, T[]>();
    for (const p of params) {
        const g = groupOf(p);
        map.set(g, [...(map.get(g) ?? []), p]);
    }
    return [...map.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
}
