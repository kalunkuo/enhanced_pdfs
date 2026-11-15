import { withLinks } from './links';
import type { ElementPicker } from './presentation';
import type { Annotation, ElementInfo, ImportedAnnotationSource, Point } from './types';

type Bounds = readonly [number, number, number, number];

export interface AnnotationUpgradeContext {
    pageNumber: number;
    elements: ReadonlyMap<string, ElementInfo>;
    picker: ElementPicker;
    /** Actual captured path bounds (or the optional legacy geometry table), in page space. */
    bounds: readonly { elementKey: string; drawingId?: string; bounds: Bounds }[];
    geometryReady: boolean;
    /** Includes metadata-only members, but not records belonging only to another page. */
    pageElementKeys: ReadonlySet<string>;
}

export interface AnnotationUpgradeResult {
    annotations: Annotation[];
    linked: number;
    suggested: number;
    ambiguous: number;
    /** Includes metadata-only notes, which have no located object to link. */
    unlinked: number;
    pending: number;
}

interface AppearanceBounds { elementKey: string; drawingId?: string; bounds: Bounds }
const validBounds = (bounds: Bounds) => bounds.every(Number.isFinite) && bounds[0] <= bounds[2] && bounds[1] <= bounds[3];
const area = (bounds: Bounds) => Math.max(0, bounds[2] - bounds[0]) * Math.max(0, bounds[3] - bounds[1]);
const contains = (bounds: Bounds, point: Point) => point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3];
const overlap = (a: Bounds, b: Bounds) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const unique = (keys: readonly string[]) => [...new Set(keys)];

function appearances(context: AnnotationUpgradeContext): AppearanceBounds[] {
    const result = new Map<string, AppearanceBounds>();
    for (const part of context.bounds) {
        if (!context.elements.has(part.elementKey) || !context.pageElementKeys.has(part.elementKey) || !validBounds(part.bounds)) continue;
        // Repeated views must not produce one huge union spanning separate drawing positions.
        const identity = JSON.stringify([part.elementKey, part.drawingId ?? null]);
        const current = result.get(identity);
        const bounds = current ? [
            Math.min(current.bounds[0], part.bounds[0]), Math.min(current.bounds[1], part.bounds[1]),
            Math.max(current.bounds[2], part.bounds[2]), Math.max(current.bounds[3], part.bounds[3]),
        ] as const : [...part.bounds] as unknown as Bounds;
        result.set(identity, { elementKey: part.elementKey, drawingId: part.drawingId, bounds });
    }
    return [...result.values()];
}

function numericIdentity(element: ElementInfo): string | undefined {
    // Never reconstruct an Int64 ID from its rounded JavaScript number.
    const value = element.elementIdText ?? (Number.isSafeInteger(element.elementId) && element.elementId >= 0 ? String(element.elementId) : '');
    return /^\d{1,20}$/.test(value) ? value.replace(/^0+(?=\d)/, '') : undefined;
}

function mentionedIds(text: string): Set<string> {
    const ids = new Set<string>();
    // Longer exact IDs may occur on their own; short numbers need an explicit object/ID label
    // so a note such as "use 36 inches" does not become a reference to element 36.
    for (const match of text.matchAll(/\b\d{4,20}\b/g)) ids.add(match[0].replace(/^0+(?=\d)/, ''));
    for (const match of text.matchAll(/\b(?:element(?:\s+id)?|wall|door|id)\s*[:#]?\s*(\d{1,20})\b/gi)) ids.add(match[1]!.replace(/^0+(?=\d)/, ''));
    return ids;
}

function referenceIndex(elements: ReadonlyMap<string, ElementInfo>): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const element of elements.values()) {
        const id = numericIdentity(element);
        if (!id) continue;
        const keys = index.get(id) ?? [];
        keys.push(element.key);
        index.set(id, keys);
    }
    return index;
}

function textReferences(annotation: Annotation, context: AnnotationUpgradeContext, index: ReadonlyMap<string, readonly string[]>, linked: readonly string[]) {
    const linkedSet = new Set(linked);
    const references = new Set((annotation.source?.referencedElementKeys ?? []).filter((key) => context.elements.has(key) && context.pageElementKeys.has(key) && !linkedSet.has(key)));
    const ambiguous = new Set<string>();
    for (const id of mentionedIds(annotation.text ?? '')) {
        const keys = index.get(id) ?? [];
        const onPage = keys.filter((key) => context.pageElementKeys.has(key) && !linkedSet.has(key));
        // A numeric ID shared by models cannot choose a model on the author's behalf.
        if (keys.length > 1 && !keys.some((key) => linkedSet.has(key))) onPage.forEach((key) => ambiguous.add(key));
        else if (keys.length === 1) onPage.forEach((key) => references.add(key));
    }
    return { references: [...references].sort(), ambiguous: [...ambiguous].sort() };
}

/**
 * Catch up imported notes only after the real page geometry is ready. These are geometric
 * suggestions awaiting explicit acceptance, not a claim about the author's intent.
 * Ambiguous and bounds-only point matches remain separate review candidates.
 */
export function upgradePageAnnotations(annotations: readonly Annotation[], context: AnnotationUpgradeContext): AnnotationUpgradeResult {
    const located = appearances(context);
    const byId = referenceIndex(context.elements);
    let changed = false;
    const output = annotations.map((annotation) => {
        const source = annotation.source;
        if (!source || annotation.page !== context.pageNumber || source.linkState !== 'pending' ||
            source.linkMethod === 'manual' || source.linkMethod === 'plugin' || !context.geometryReady) return annotation;
        const scoped = source.drawingId ? located.filter((entry) => entry.drawingId === source.drawingId) : located;
        const scopedKeys = new Set(scoped.map((entry) => entry.elementKey));
        let linked: string[] = [];
        let candidates: string[] = [];
        if (source.shape === 'area') {
            const partial: string[] = [];
            for (const entry of scoped) {
                const covered = overlap(source.bounds, entry.bounds);
                const size = area(entry.bounds);
                if (size > 0 && covered / size >= 0.5) linked.push(entry.elementKey);
                else if (covered > 0) partial.push(entry.elementKey);
            }
            linked = unique(linked).sort();
            if (!linked.length) candidates = unique(partial).sort();
        } else {
            const precise = unique(context.picker(source.anchor, 0).map((hit) => hit.elementKey).filter((key) =>
                context.elements.has(key) && context.pageElementKeys.has(key) && scopedKeys.has(key) &&
                (!source.drawingId || scoped.some((entry) => entry.elementKey === key && contains(entry.bounds, source.anchor))),
            ));
            if (precise.length === 1) linked = precise;
            else if (precise.length > 1) candidates = precise;
            else candidates = unique([...scoped].filter((entry) => contains(entry.bounds, source.anchor))
                .sort((a, b) => area(a.bounds) - area(b.bounds) || a.elementKey.localeCompare(b.elementKey)).map((entry) => entry.elementKey));
        }
        const refs = textReferences(annotation, context, byId, linked);
        candidates = unique([...candidates, ...refs.ambiguous]).filter((key) => !linked.includes(key));
        const referencesOnly = refs.references.length > 0 && refs.references.every((key) => !scopedKeys.has(key));
        const linkState: ImportedAnnotationSource['linkState'] = linked.length ? 'suggested' : candidates.length ? 'ambiguous' : referencesOnly ? 'metadata-only' : 'unlinked';
        const { suggestedElementKeys: _oldSuggested, candidateKeys: _oldCandidates, referencedElementKeys: _oldReferences, ...rest } = source;
        changed = true;
        return withLinks({
            ...annotation,
            source: { ...rest, linkState, linkMethod: 'geometry' as const,
                ...(linked.length ? { suggestedElementKeys: linked } : {}),
                ...(candidates.length ? { candidateKeys: candidates } : {}),
                ...(refs.references.length ? { referencedElementKeys: refs.references } : {}) },
        }, []);
    });
    // React consumers can avoid another state update when a recapture has no pending work.
    const result: AnnotationUpgradeResult = { annotations: changed ? output : annotations as Annotation[], linked: 0, suggested: 0, ambiguous: 0, unlinked: 0, pending: 0 };
    for (const annotation of output) {
        if (!annotation.source || annotation.page !== context.pageNumber) continue;
        switch (annotation.source.linkState) {
            case 'linked': result.linked++; break;
            case 'suggested': result.suggested++; break;
            case 'ambiguous': result.ambiguous++; break;
            case 'pending': result.pending++; break;
            default: result.unlinked++;
        }
    }
    return result;
}
