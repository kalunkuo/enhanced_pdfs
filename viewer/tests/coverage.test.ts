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
});
