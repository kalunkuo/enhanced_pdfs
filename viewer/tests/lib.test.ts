import { describe, expect, it } from 'vitest';
import { groupParameters } from '../src/lib/groups';
import { anchorOf, hitTest, pointInPolygon, tie } from '../src/lib/hit';
import { buildElements, buildParameters, buildShapes, readTables } from '../src/lib/tables';
import type { Annotation, Shape } from '../src/lib/types';

const wall: Shape = { elementKey: 'wall', bbox: [100, 100, 300, 108] };
const column: Shape = { elementKey: 'column', bbox: [200, 96, 212, 112] };

describe('hitTest', () => {
    it('finds the element under a point and misses outside', () => {
        expect(hitTest([wall], 150, 104)?.elementKey).toBe('wall');
        expect(hitTest([wall], 150, 120)).toBeUndefined();
    });

    it('prefers the smaller of overlapping shapes', () => {
        expect(hitTest([wall, column], 205, 104)?.elementKey).toBe('column');
        expect(hitTest([column, wall], 205, 104)?.elementKey).toBe('column');
    });

    it('widens thin shapes by the tolerance', () => {
        expect(hitTest([wall], 150, 111)).toBeUndefined();
        expect(hitTest([wall], 150, 111, 4)?.elementKey).toBe('wall');
    });

    it('uses the outline when present', () => {
        const tri: Shape = { elementKey: 'tri', bbox: [0, 0, 10, 10], outline: [[0, 0], [10, 0], [0, 10]] };
        expect(hitTest([tri], 2, 2)?.elementKey).toBe('tri');
        expect(hitTest([tri], 9, 9)).toBeUndefined();
        expect(pointInPolygon(2, 2, tri.outline!)).toBe(true);
    });
});

describe('tie', () => {
    const base: Annotation = { id: 'a', page: 1, kind: 'rect', from: [140, 90], to: [160, 118] };

    it('ties an annotation whose anchor is on an element', () => {
        expect(anchorOf(base)).toEqual([150, 104]);
        expect(tie(base, [wall]).elementKey).toBe('wall');
    });

    it('leaves it untied when the anchor is on empty paper, and clears a stale tie', () => {
        const off = { ...base, from: [140, 200] as const, to: [160, 220] as const };
        expect(tie(off, [wall]).elementKey).toBeUndefined();
        expect(tie({ ...off, elementKey: 'wall' }, [wall]).elementKey).toBeUndefined();
    });

    it('anchors a freehand stroke at the center of its bounds and a signature at its click point', () => {
        const pen: Annotation = { id: 'p', page: 1, kind: 'pen', from: [0, 0], to: [0, 0], points: [[140, 90], [160, 90], [160, 118]] };
        expect(anchorOf(pen)).toEqual([150, 104]);
        expect(tie(pen, [wall]).elementKey).toBe('wall');
        const sig: Annotation = { id: 's', page: 1, kind: 'signature', from: [150, 104], to: [150, 104], text: 'Y' };
        expect(tie(sig, [wall]).elementKey).toBe('wall');
    });

    it('anchors text and comments at their click point', () => {
        const note: Annotation = { id: 'n', page: 1, kind: 'comment', from: [150, 104], to: [150, 104], text: 'hi' };
        expect(tie(note, [wall]).elementKey).toBe('wall');
    });
});

describe('table builders', () => {
    it('flips geometry from PDF (bottom-left) to page (top-left) coordinates', () => {
        const [s] = buildShapes(
            [{ ElementKey: 'w', MinX: 10, MinY: 700, MaxX: 50, MaxY: 710, Outline: '[[10,700],[50,700],[50,710],[10,710]]' }],
            792,
        );
        expect(s!.bbox).toEqual([10, 82, 50, 92]);
        expect(s!.outline![0]).toEqual([10, 92]);
    });

    it('survives a malformed outline and converts bigint ids', () => {
        const [s] = buildShapes([{ ElementKey: 'w', MinX: 0, MinY: 0, MaxX: 1, MaxY: 1, Outline: 'nope' }], 10);
        expect(s!.outline).toBeUndefined();
        const el = buildElements([{ ElementKey: 'w', ElementId: 676281n, Category: 'Walls', Name: 'Basic Wall' }]);
        expect(el.get('w')!.elementId).toBe(676281);
    });

    it('keeps instance and type parameters separate by owner', () => {
        const p = buildParameters([
            { OwnerKey: 'w', Scope: 'Instance', Name: 'Base Offset', DisplayValue: `0' 0"` },
            { OwnerKey: 't', Scope: 'Type', Name: 'Fire Rating', DisplayValue: '2 HR' },
        ]);
        expect(p.get('w')![0]!.value).toBe(`0' 0"`);
        expect(p.get('t')![0]!.scope).toBe('Type');
    });
});

describe('groupParameters', () => {
    it('orders groups like the Properties palette', () => {
        const groups = groupParameters([
            { name: 'Fire Rating', scope: 'Type', value: '2 HR' },
            { name: 'Top Offset', scope: 'Instance', value: '0' },
            { name: 'Cross-Section', scope: 'Instance', value: 'Vertical' },
            { name: 'Comments', scope: 'Instance', value: '' },
        ]);
        expect(groups.map(([g]) => g)).toEqual(['Constraints', 'Cross-Section Definition', 'Other', 'Type Parameters']);
    });
});

describe('readTables', () => {
    it('only attempts .parquet attachments and reports unreadable ones by name', async () => {
        const junk = new Uint8Array([1, 2, 3]);
        const r = await readTables(new Map([['elements.parquet', junk], ['notes.txt', junk]]));
        expect(r.tables.size).toBe(0);
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings[0]).toContain('elements.parquet');
    });
});
