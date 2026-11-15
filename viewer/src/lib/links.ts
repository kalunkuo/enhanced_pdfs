import type { Annotation } from './types';

/**
 * The objects an annotation is linked to. One link is stored as `elementKey`; several also fill `elementKeys`,
 * whose first entry is always `elementKey`, so readers that only know a single tie still see the first object.
 * Revision clouds keep their own `contained` list instead.
 */
export function linkedKeys(a: Pick<Annotation, 'elementKey' | 'elementKeys'>): string[] {
    if (a.elementKeys?.length) return [...a.elementKeys];
    return a.elementKey ? [a.elementKey] : [];
}

/** Replace an annotation's links. Duplicates and empty keys are dropped; no keys leaves it untied. */
export function withLinks<T extends Annotation>(a: T, keys: readonly string[]): T {
    const { elementKey: _key, elementKeys: _keys, ...rest } = a;
    const unique = [...new Set(keys.filter((key) => key !== ''))];
    if (unique.length === 0) return rest as T;
    if (unique.length === 1) return { ...rest, elementKey: unique[0]! } as T;
    return { ...rest, elementKey: unique[0]!, elementKeys: unique } as T;
}

const MAX_LINKS = 5000;
const MAX_KEY_LENGTH = 200;

/** Links read from untrusted storage (a saved PDF or browser storage), normalized with `withLinks`. */
export function cleanLinks<T extends Annotation>(a: T, raw: { elementKey?: unknown; elementKeys?: unknown }): T {
    const valid = (key: unknown): key is string => typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH;
    const list = Array.isArray(raw.elementKeys) ? raw.elementKeys.slice(0, MAX_LINKS).filter(valid) : [];
    const first = valid(raw.elementKey) ? [raw.elementKey] : [];
    // elementKey goes first: it is the tie every reader shows.
    return withLinks(a, [...first, ...list]);
}
