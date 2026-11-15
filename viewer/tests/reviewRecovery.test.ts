import { describe, expect, it } from 'vitest';
import { recoverReviewAnnotations } from '../src/lib/reviewRecovery';
import type { Annotation } from '../src/lib/types';

const note: Annotation = { id: 'a1', page: 1, kind: 'comment', from: [1, 1], to: [1, 1] };
const imported: Annotation = { ...note, id: 'import-1', source: { ref: '10R', subtype: 'Text', bounds: [0, 0, 2, 2], anchor: [1, 1], shape: 'point', linkState: 'pending' } };
describe('recovering reviews after imported markup support', () => {
    it('adds imported notes to a legacy session without resurrecting deleted viewer notes', () => {
        expect(recoverReviewAnnotations([note, imported], [])).toEqual([imported]);
    });
    it('respects imported note deletion once the session has an import inventory', () => {
        expect(recoverReviewAnnotations([note, imported], [note], [imported.id])).toEqual([note]);
    });
    it('preserves recovered manual links and never duplicates a present import', () => {
        const edited = { ...imported, elementKey: 'wall', source: { ...imported.source!, linkState: 'linked' as const, linkMethod: 'manual' as const } };
        expect(recoverReviewAnnotations([imported], [edited], [imported.id])).toEqual([edited]);
        expect(recoverReviewAnnotations([imported])).toEqual([imported]);
    });
});
