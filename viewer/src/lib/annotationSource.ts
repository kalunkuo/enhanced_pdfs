import type { ImportedAnnotationSource, Point } from './types';

const point = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
const text = (value: unknown, max = 300): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
const keys = (value: unknown): string[] | undefined => {
    const result = Array.isArray(value) ? [...new Set(value.slice(0, 5000).filter((key): key is string => !!text(key, 200)))] : [];
    return result.length ? result : undefined;
};

export function cleanSourceRef(value: unknown): { ref: string; name?: string; renderId?: string } | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    const ref = text(raw.ref);
    if (!ref || !/^(?:\d+R\d*|direct:\d+)$/.test(ref)) return undefined;
    const name = text(raw.name, 1000);
    const renderId = text(raw.renderId);
    return { ref, ...(name ? { name } : {}), ...(renderId ? { renderId } : {}) };
}

/** A PDF/IndexedDB record cannot introduce a made-up source location or link status. */
export function cleanImportedSource(value: unknown): ImportedAnnotationSource | undefined {
    const identity = cleanSourceRef(value);
    if (!identity) return undefined;
    const raw = value as Record<string, unknown>;
    if (!text(raw.subtype, 80) || !point(raw.anchor) || !Array.isArray(raw.bounds) || raw.bounds.length !== 4 ||
        !raw.bounds.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
        !['area', 'point', 'arrow'].includes(String(raw.shape)) ||
        !['pending', 'linked', 'unlinked', 'ambiguous', 'metadata-only'].includes(String(raw.linkState))) return undefined;
    const [x0, y0, x1, y1] = raw.bounds as number[];
    if (x0! > x1! || y0! > y1!) return undefined;
    const drawingId = text(raw.drawingId);
    const renderId = text(raw.renderId);
    const linkMethod = ['plugin', 'geometry', 'manual'].includes(String(raw.linkMethod)) ? raw.linkMethod as ImportedAnnotationSource['linkMethod'] : undefined;
    const candidateKeys = keys(raw.candidateKeys), referencedElementKeys = keys(raw.referencedElementKeys);
    return { ...identity, subtype: raw.subtype as string, bounds: [x0!, y0!, x1!, y1!], anchor: [raw.anchor[0], raw.anchor[1]],
        shape: raw.shape as ImportedAnnotationSource['shape'], linkState: raw.linkState as ImportedAnnotationSource['linkState'],
        ...(drawingId ? { drawingId } : {}), ...(linkMethod ? { linkMethod } : {}),
        ...(renderId ? { renderId } : {}),
        ...(candidateKeys ? { candidateKeys } : {}), ...(referencedElementKeys ? { referencedElementKeys } : {}) };
}
