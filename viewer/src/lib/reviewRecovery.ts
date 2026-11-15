import { normalizeImportedSuggestion } from './annotationSource';
import type { Annotation } from './types';

/** Old sessions gain newly supported imports; intentional deletions in new sessions stay deleted. */
export function recoverReviewAnnotations(initial: readonly Annotation[], recovered?: readonly Annotation[], knownImportedIds?: readonly string[]): Annotation[] {
    if (!recovered) return initial.map(normalizeImportedSuggestion);
    const present = new Set(recovered.map((annotation) => annotation.id));
    const known = new Set(knownImportedIds ?? recovered.filter((annotation) => annotation.source).map((annotation) => annotation.id));
    return [...recovered, ...initial.filter((annotation) => annotation.source && !present.has(annotation.id) && !known.has(annotation.id))].map(normalizeImportedSuggestion);
}
