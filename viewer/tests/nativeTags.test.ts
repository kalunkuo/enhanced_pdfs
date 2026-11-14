import { describe, expect, it } from 'vitest';
import { createNativeTagIndexer, type NativeTagMetadata } from '../src/lib/nativeTags';
import type { NativeOperatorList } from '../src/lib/nativeTypes';
import { buildElements, buildParameters } from '../src/lib/tables';

const ops = { beginMarkedContent: 10, beginMarkedContentProps: 11, endMarkedContent: 12 };
const paint = 50;
const metadata: NativeTagMetadata = {
    elements: [{ ElementKey: 'model-a/host/wall', ElementId: 7 }, { ElementKey: 'model-b/link/wall', ElementId: 7 }, { ElementKey: 'model-a/host/door', ElementId: 8 }],
    drawings: [{ DrawingId: 'a', ViewId: 11, Page: 1 }, { DrawingId: 'b', ViewId: 22, Page: 1 }, { DrawingId: 'c', ViewId: 33, Page: 2 }],
    appearances: [{ DrawingId: 'a', ElementKey: 'model-a/host/wall' }, { DrawingId: 'a', ElementKey: 'model-a/host/door' },
        { DrawingId: 'b', ElementKey: 'model-b/link/wall' }, { DrawingId: 'c', ElementKey: 'model-b/link/wall' }],
};

function list(view: string, element: string, objectName = false): NativeOperatorList {
    return { fnArray: [11, 10, paint, 12, 12], argsArray: [[view, null], [objectName ? { name: element } : element], [], null, null] };
}

describe('native marked-content identity', () => {
    it('joins through page/view memberships instead of globally joining a numeric ID', () => {
        const index = createNativeTagIndexer(metadata, ops);
        const first = index(list('ViewRegion11-1', 'Element7', true), 1);
        const second = index(list('/ViewRegion22-0', '/Element7'), 1);
        expect(first.occurrences[0]).toMatchObject({ status: 'resolved', elementKey: 'model-a/host/wall', drawingId: 'a', start: 1, end: 3 });
        expect(second.occurrences[0]?.elementKey).toBe('model-b/link/wall');
        expect(first.active[2]).toBe(first.occurrences[0]);
        expect(first.active[4]).toBeUndefined();
    });

    it('does not fall back to another page or view when context mismatches', () => {
        const index = createNativeTagIndexer(metadata, ops);
        expect(index(list('ViewRegion33-0', 'Element7'), 1).occurrences[0]?.status).toBe('unmatched');
        expect(index(list('ViewRegion11-0', 'Element7'), 2).resolvedElementKeys.size).toBe(0);
        expect(index(list('ViewRegion33-0', 'Element7'), 2).occurrences[0]?.elementKey).toBe('model-b/link/wall');
    });

    it('rejects linked-model collisions in the same drawing', () => {
        const index = createNativeTagIndexer({ ...metadata, appearances: [...metadata.appearances, { DrawingId: 'a', ElementKey: 'model-b/link/wall' }] }, ops);
        const occurrence = index(list('ViewRegion11-0', 'Element7'), 1).occurrences[0]!;
        expect(occurrence.status).toBe('ambiguous');
        expect(occurrence.elementKey).toBeUndefined();
        expect(occurrence.candidateKeys).toEqual(['model-a/host/wall', 'model-b/link/wall']);
    });

    it('rejects multiple placements of one view even when element identity is the same', () => {
        const index = createNativeTagIndexer({ ...metadata,
            drawings: [...metadata.drawings, { DrawingId: 'a-second-placement', ViewId: 11, Page: 1 }],
            appearances: [...metadata.appearances, { DrawingId: 'a-second-placement', ElementKey: 'model-a/host/wall' }],
        }, ops);
        expect(index(list('ViewRegion11-0', 'Element7'), 1).occurrences[0]).toMatchObject({ status: 'ambiguous', candidateKeys: ['model-a/host/wall'] });
    });

    it('requires drawing memberships and never guesses from a unique global element ID', () => {
        const index = createNativeTagIndexer({ elements: metadata.elements, drawings: metadata.drawings, appearances: [] }, ops);
        expect(index(list('ViewRegion11-0', 'Element8'), 1).occurrences[0]?.status).toBe('unmatched');
    });

    it('keeps repeated ink fragments separate without duplicating distinct elements', () => {
        const operators: NativeOperatorList = { fnArray: [11, 10, paint, 12, 10, paint, 12, 12],
            argsArray: [['ViewRegion11-1', null], [{ name: 'Element7' }], [], null, ['Element7'], [], null, null] };
        const index = createNativeTagIndexer(metadata, ops)(operators, 1);
        expect(index.occurrences.map((occurrence) => [occurrence.start, occurrence.end])).toEqual([[1, 3], [4, 6]]);
        expect(new Set(index.occurrences.map((occurrence) => occurrence.id)).size).toBe(2);
        expect([...index.resolvedElementKeys]).toEqual(['model-a/host/wall']);
    });

    it('restores the outer element after nested marked content ends', () => {
        const operators: NativeOperatorList = { fnArray: [11, 10, paint, 10, paint, 12, paint, 12, 12],
            argsArray: [['ViewRegion11-1'], ['Element7'], [], ['Element8'], [], null, [], null, null] };
        const index = createNativeTagIndexer(metadata, ops)(operators, 1);
        expect(index.active[2]?.elementKey).toBe('model-a/host/wall');
        expect(index.active[4]?.elementKey).toBe('model-a/host/door');
        expect(index.active[6]?.elementKey).toBe('model-a/host/wall');
    });

    it('does not index ordinary or malformed text as native element geometry', () => {
        const index = createNativeTagIndexer(metadata, ops)({ fnArray: [12, 10, paint, 12, 11, 12], argsArray: [null, null, ['Element7'], null, [null], null] }, 1);
        expect(index.occurrences).toEqual([]);
        expect(index.active.every((occurrence) => occurrence === undefined)).toBe(true);
    });

    it('marks an unclosed group unresolved instead of claiming authoritative geometry', () => {
        const index = createNativeTagIndexer(metadata, ops)({ fnArray: [11, 10, paint], argsArray: [['ViewRegion11-1'], ['Element7'], []] }, 1);
        expect(index.occurrences[0]).toMatchObject({ status: 'unmatched', end: 2 });
        expect(index.resolvedElementKeys.size).toBe(0);
    });

    it('preserves exact Int64 identifiers', () => {
        const index = createNativeTagIndexer({
            elements: [{ ElementKey: 'large', ElementId: 9007199254740993n }],
            drawings: [{ DrawingId: 'a', ViewId: 11, Page: 1 }], appearances: [{ DrawingId: 'a', ElementKey: 'large' }],
        }, ops)(list('ViewRegion11-0', 'Element9007199254740993'), 1);
        expect(index.occurrences[0]?.elementKey).toBe('large');
    });

    it('re-indexes the exact rendering operator list after annotation mode changes', () => {
        const original = createNativeTagIndexer(metadata, ops)(list('ViewRegion11-0', 'Element7'), 1);
        const changed: NativeOperatorList = { fnArray: [paint, ...original.operators.fnArray], argsArray: [[], ...original.operators.argsArray] };
        const reindexed = original.forOperators(changed);
        expect(reindexed.occurrences[0]).toMatchObject({ start: 2, end: 4, elementKey: 'model-a/host/wall' });
        expect(original.occurrences[0]?.start).toBe(1);
        expect(original.forOperators(original.operators)).toBe(original);
    });
});

describe('source metadata provenance', () => {
    it('keeps real model/link/type and parameter identity fields', () => {
        const element = buildElements([{ ElementKey: 'key', ElementId: 7n, Model: 'Linked', ModelKey: 'model', LinkInstanceId: 'link', FireRatingSource: 'Type' }]).get('key');
        expect(element).toMatchObject({ elementIdText: '7', model: 'Linked', modelKey: 'model', linkInstanceId: 'link', fireRatingSource: 'Type' });
        const parameter = buildParameters([{ OwnerKey: 'key', Name: 'Count', Scope: 'Instance', ParameterId: 5n, SharedGuid: 'guid', SpecId: 'spec', UnitId: 'unit', IntegerValue: 0 }]).get('key')?.[0];
        expect(parameter).toMatchObject({ value: '0', parameterId: '5', sharedGuid: 'guid', specId: 'spec', unitId: 'unit' });
    });
});
