import { describe, expect, it } from 'vitest';
import { cleanImportedSource, normalizeImportedSuggestion } from '../src/lib/annotationSource';
import { linkedKeys } from '../src/lib/links';
import type { Annotation, ImportedAnnotationSource } from '../src/lib/types';

const source: ImportedAnnotationSource = { ref: '10R', subtype: 'Square', bounds: [0, 0, 10, 10], anchor: [5, 5], shape: 'area', linkState: 'suggested', linkMethod: 'geometry', suggestedElementKeys: ['wall'] };
const note = (patch: Partial<Annotation> = {}): Annotation => ({ id: 'imported', page: 1, kind: 'comment', from: [5, 5], to: [5, 5], source, ...patch });

describe('imported suggestion storage compatibility', () => {
    it('validates and deduplicates suggestions without merging review candidates or text references', () => {
        const cleaned = cleanImportedSource({ ...source, suggestedElementKeys: ['wall', 'wall', '', 5, 'x'.repeat(201)], candidateKeys: ['door'], referencedElementKeys: ['floor'] });
        expect(cleaned).toMatchObject({ linkState: 'suggested', suggestedElementKeys: ['wall'], candidateKeys: ['door'], referencedElementKeys: ['floor'] });
        expect(cleanImportedSource({ ...source, linkState: 'made-up' })).toBeUndefined();
    });

    it('moves legacy geometry links into unaccepted suggestions without mutating their source', () => {
        const original = note({ elementKey: 'wall', elementKeys: ['wall', 'door'], source: { ...source, linkState: 'linked', suggestedElementKeys: undefined, candidateKeys: ['column'], referencedElementKeys: ['floor'] } });
        const migrated = normalizeImportedSuggestion(original);
        expect(linkedKeys(migrated)).toEqual([]);
        expect(migrated.source).toMatchObject({ linkState: 'suggested', suggestedElementKeys: ['wall', 'door'], candidateKeys: ['column'], referencedElementKeys: ['floor'] });
        expect(linkedKeys(original)).toEqual(['wall', 'door']);
        expect(original.source!.linkState).toBe('linked');
    });

    it('keeps valid suggestions stable and removes accidental active ties from suggested records', () => {
        const proposed = note();
        expect(normalizeImportedSuggestion(proposed)).toBe(proposed);
        expect(linkedKeys(normalizeImportedSuggestion({ ...proposed, elementKey: 'door' }))).toEqual([]);
        expect(normalizeImportedSuggestion({ ...proposed, source: { ...source, suggestedElementKeys: [] } }).source!.linkState).toBe('unlinked');
    });

    it('leaves explicit manual and plugin links accepted', () => {
        for (const linkMethod of ['manual', 'plugin'] as const) {
            const accepted = note({ elementKey: 'wall', source: { ...source, suggestedElementKeys: undefined, linkState: 'linked', linkMethod } });
            expect(normalizeImportedSuggestion(accepted)).toBe(accepted);
            expect(linkedKeys(normalizeImportedSuggestion(accepted))).toEqual(['wall']);
        }
    });
});
