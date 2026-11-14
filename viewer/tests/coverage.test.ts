import { describe, expect, it } from 'vitest';
import { elementLocations } from '../src/lib/coverage';
import type { NativeGeometry } from '../src/lib/nativeGeometry';
import type { NativeTagIndex } from '../src/lib/nativeTypes';
import type { ElementInfo } from '../src/lib/types';

const elements: ElementInfo[] = ['ready', 'partial', 'unsupported', 'ambiguous', 'metadata', 'legacy'].map((key, elementId) => ({ key, elementId, name: key, category: 'Walls' }));
const source = {
    resolvedElementKeys: new Set(['ready', 'partial', 'unsupported']),
    occurrences: [{ status: 'ambiguous', candidateKeys: ['ambiguous'] }],
} as unknown as NativeTagIndex;
const geometry = { elementKeys: new Set(['ready', 'partial']), unsupportedElementKeys: new Set(['partial', 'unsupported']) } as unknown as NativeGeometry;

describe('metadata location coverage', () => {
    it('does not turn metadata membership or ambiguous identities into drawable geometry', () => {
        const locations = elementLocations(elements, source, geometry, [{ elementKey: 'legacy', bbox: [0, 0, 1, 1] }]);
        expect(Object.fromEntries(locations)).toEqual({ ready: 'ready', partial: 'partial', unsupported: 'unsupported', ambiguous: 'ambiguous', metadata: 'metadata-only', legacy: 'legacy' });
    });

    it('distinguishes a pending render from a completed unsupported appearance', () => {
        expect(elementLocations(elements, source, null, []).get('unsupported')).toBe('mapping');
        expect(elementLocations(elements, undefined, null, []).get('ready')).toBe('metadata-only');
    });

    it('does not locate schedule members using the same element ink from a different view', () => {
        const scopedSource = { resolvedElementKeys: new Set(['ready']), occurrences: [{ status: 'resolved', elementKey: 'ready', drawingId: 'plan', candidateKeys: ['ready'] }] } as unknown as NativeTagIndex;
        const scopedGeometry = { ...geometry, parts: [{ elementKey: 'ready', drawingId: 'plan' }] } as unknown as NativeGeometry;
        expect(elementLocations(elements, scopedSource, scopedGeometry, [], new Set(['plan'])).get('ready')).toBe('ready');
        expect(elementLocations(elements, scopedSource, scopedGeometry, [], new Set(['schedule'])).get('ready')).toBe('metadata-only');
    });

    it('keeps optional legacy attachment shapes scoped to their actual drawing', () => {
        const shapes = [{ elementKey: 'legacy', drawingId: 'sheet', bbox: [0, 0, 1, 1] as const }];
        expect(elementLocations(elements, undefined, null, shapes, new Set(['sheet'])).get('legacy')).toBe('legacy');
        expect(elementLocations(elements, undefined, null, shapes, new Set(['other'])).get('legacy')).toBe('metadata-only');
    });
});
