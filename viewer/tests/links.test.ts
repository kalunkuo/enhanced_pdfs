import { describe, expect, it } from 'vitest';
import { createShapePicker, tieWithPicker } from '../src/lib/hit';
import { cleanLinks, linkedKeys, withLinks } from '../src/lib/links';
import type { Annotation } from '../src/lib/types';

const comment: Annotation = { id: 'a1', page: 1, kind: 'comment', from: [10, 10], to: [10, 10], text: 'Check these' };

describe('annotation links', () => {
    it('stores one link as elementKey and several as elementKeys led by elementKey', () => {
        expect(withLinks(comment, [])).toEqual(comment);
        expect(withLinks(comment, ['w1'])).toEqual({ ...comment, elementKey: 'w1' });
        expect(withLinks(comment, ['w1', 'w2', 'w1'])).toEqual({ ...comment, elementKey: 'w1', elementKeys: ['w1', 'w2'] });
        expect(withLinks({ ...comment, elementKey: 'w1', elementKeys: ['w1', 'w2'] }, [])).toEqual(comment);
    });

    it('lists every linked object', () => {
        expect(linkedKeys(comment)).toEqual([]);
        expect(linkedKeys({ elementKey: 'w1' })).toEqual(['w1']);
        expect(linkedKeys({ elementKey: 'w1', elementKeys: ['w1', 'w2'] })).toEqual(['w1', 'w2']);
    });

    it('drops malformed keys from untrusted input', () => {
        expect(cleanLinks(comment, { elementKeys: ['w1', 3, '', 'x'.repeat(500), 'w2'] })).toEqual({ ...comment, elementKey: 'w1', elementKeys: ['w1', 'w2'] });
        expect(cleanLinks(comment, { elementKey: 5, elementKeys: 'w1' })).toEqual(comment);
    });

    it('replaces every link when re-tied by position', () => {
        const picker = createShapePicker([{ elementKey: 'w9', bbox: [0, 0, 20, 20] }]);
        expect(tieWithPicker({ ...comment, elementKey: 'w1', elementKeys: ['w1', 'w2'] }, picker)).toEqual({ ...comment, elementKey: 'w9' });
    });
});
