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

    it('requires acceptance of legacy geometry auto-links from both saved PDFs and browser recovery', () => {
        const automatic = { ...imported, elementKey: 'wall', elementKeys: ['wall', 'door'], source: { ...imported.source!, linkState: 'linked' as const, linkMethod: 'geometry' as const } };
        for (const recovered of [recoverReviewAnnotations([automatic]), recoverReviewAnnotations([imported], [automatic], [imported.id])]) {
            expect(recovered[0]).toMatchObject({ source: { linkState: 'suggested', linkMethod: 'geometry', suggestedElementKeys: ['wall', 'door'] } });
            expect(recovered[0]!.elementKey).toBeUndefined();
            expect(recovered[0]!.elementKeys).toBeUndefined();
        }
        expect(automatic.elementKey).toBe('wall');
    });

    it('keeps accepted plugin links and pending suggestions stable during recovery', () => {
        const plugin = { ...imported, elementKey: 'wall', source: { ...imported.source!, linkState: 'linked' as const, linkMethod: 'plugin' as const } };
        const proposed = { ...imported, id: 'suggested', source: { ...imported.source!, linkState: 'suggested' as const, linkMethod: 'geometry' as const, suggestedElementKeys: ['door'] } };
        expect(recoverReviewAnnotations([], [plugin, proposed])).toEqual([plugin, proposed]);
        expect(recoverReviewAnnotations([], [plugin, proposed])[0]).toBe(plugin);
        expect(recoverReviewAnnotations([], [plugin, proposed])[1]).toBe(proposed);
    });
});
