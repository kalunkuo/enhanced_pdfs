import { describe, expect, it, vi } from 'vitest';
import { linkedKeys } from '../src/lib/links';
import { upgradePageAnnotations, type AnnotationUpgradeContext } from '../src/lib/upgradeAnnotations';
import type { Annotation, ElementInfo, ImportedAnnotationSource } from '../src/lib/types';

const element = (key: string, id: number, extra: Partial<ElementInfo> = {}): ElementInfo => ({ key, elementId: id, elementIdText: String(id), category: 'Walls', name: key, ...extra });
const elements = new Map([element('wall-a', 676281), element('door-a', 745963), element('metadata', 999999)].map((entry) => [entry.key, entry]));
const source: ImportedAnnotationSource = { ref: '12R', subtype: 'Text', bounds: [2, 2, 8, 8], anchor: [5, 5], shape: 'point', linkState: 'pending' };
const note = (patch: Partial<Annotation> = {}, sourcePatch: Partial<ImportedAnnotationSource> = {}): Annotation => ({ id: 'pdf-1-12R', page: 1, kind: 'comment', from: [5, 5], to: [5, 5], text: 'Existing contractor comment', source: { ...source, ...sourcePatch }, ...patch });
function context(patch: Partial<AnnotationUpgradeContext> = {}): AnnotationUpgradeContext {
    return { pageNumber: 1, elements, picker: () => [{ elementKey: 'wall-a' }], bounds: [{ elementKey: 'wall-a', drawingId: 'plan', bounds: [0, 0, 10, 10] }, { elementKey: 'door-a', drawingId: 'plan', bounds: [20, 20, 30, 30] }], geometryReady: true, pageElementKeys: new Set(elements.keys()), ...patch };
}

describe('existing PDF markup catch-up', () => {
    it('links a unique exact painted-path hit and leaves the original source geometry unchanged', () => {
        const original = note();
        const result = upgradePageAnnotations([original], context());
        expect(linkedKeys(result.annotations[0]!)).toEqual(['wall-a']);
        expect(result.annotations[0]!.source).toMatchObject({ ...source, linkState: 'linked', linkMethod: 'geometry' });
        expect(result).toMatchObject({ linked: 1, ambiguous: 0, unlinked: 0, pending: 0 });
        expect(original.source!.linkState).toBe('pending');
        expect(original.elementKey).toBeUndefined();
    });

    it('uses the imported arrowhead anchor, not the midpoint or rectangle center', () => {
        const picker = vi.fn(() => [{ elementKey: 'door-a' }]);
        const arrow = note({}, { shape: 'arrow', subtype: 'Line', bounds: [0, 0, 30, 30], anchor: [25, 25] });
        const result = upgradePageAnnotations([arrow], context({ picker }));
        expect(picker).toHaveBeenCalledWith([25, 25], 0);
        expect(linkedKeys(result.annotations[0]!)).toEqual(['door-a']);
    });

    it('leaves multiple precise candidates for review rather than choosing by array order', () => {
        const result = upgradePageAnnotations([note()], context({ picker: () => [{ elementKey: 'wall-a' }, { elementKey: 'door-a' }, { elementKey: 'wall-a' }] }));
        expect(linkedKeys(result.annotations[0]!)).toEqual([]);
        expect(result.annotations[0]!.source).toMatchObject({ linkState: 'ambiguous', candidateKeys: ['wall-a', 'door-a'] });
        expect(result.ambiguous).toBe(1);
    });

    it('offers a bbox-only point candidate without turning empty paint into a geometric hit', () => {
        const result = upgradePageAnnotations([note()], context({ picker: () => [] }));
        expect(linkedKeys(result.annotations[0]!)).toEqual([]);
        expect(result.annotations[0]!.source).toMatchObject({ linkState: 'ambiguous', candidateKeys: ['wall-a'] });
    });

    it('links every area member with at least half its drawn extent covered', () => {
        const areaNote = note({}, { shape: 'area', subtype: 'Square', bounds: [0, 0, 25, 30] });
        const result = upgradePageAnnotations([areaNote], context({ bounds: [
            ...context().bounds,
            { elementKey: 'metadata', drawingId: 'plan', bounds: [0, 0, 1000, 1000] },
        ] }));
        expect(linkedKeys(result.annotations[0]!)).toEqual(['door-a', 'wall-a']);
        expect(result.linked).toBe(1);
        expect(result.annotations[0]!.source!.candidateKeys).toBeUndefined();
    });

    it('unions disconnected path parts within one view before applying coverage', () => {
        const result = upgradePageAnnotations([note({}, { shape: 'area', bounds: [0, 0, 4, 10] })], context({ bounds: [
            { elementKey: 'wall-a', drawingId: 'plan', bounds: [0, 0, 2, 10] },
            { elementKey: 'wall-a', drawingId: 'plan', bounds: [8, 0, 10, 10] },
        ] }));
        expect(linkedKeys(result.annotations[0]!)).toEqual([]);
        expect(result.annotations[0]!.source).toMatchObject({ linkState: 'ambiguous', candidateKeys: ['wall-a'] });
    });

    it('does not union repeated appearances across views or borrow another drawing scope', () => {
        const bounds: AnnotationUpgradeContext['bounds'] = [
            { elementKey: 'wall-a', drawingId: 'plan', bounds: [0, 0, 10, 10] },
            { elementKey: 'wall-a', drawingId: 'detail', bounds: [100, 100, 120, 120] },
        ];
        expect(linkedKeys(upgradePageAnnotations([note({}, { shape: 'area', bounds: [0, 0, 10, 10] })], context({ bounds })).annotations[0]!)).toEqual(['wall-a']);
        const otherView = note({}, { shape: 'area', drawingId: 'detail', bounds: [0, 0, 10, 10] });
        expect(upgradePageAnnotations([otherView], context({ bounds })).annotations[0]!.source!.linkState).toBe('unlinked');
        const pointOtherView = note({}, { drawingId: 'detail' });
        expect(upgradePageAnnotations([pointOtherView], context({ bounds })).annotations[0]!.source!.linkState).toBe('unlinked');
    });

    it('separates text references from actual geometric links', () => {
        const result = upgradePageAnnotations([note({ text: 'Check this wall; see door 745963 and wall 676281.' })], context());
        expect(linkedKeys(result.annotations[0]!)).toEqual(['wall-a']);
        expect(result.annotations[0]!.source!.referencedElementKeys).toEqual(['door-a']);
    });

    it('keeps a text reference metadata-only when its ink belongs to another drawing', () => {
        const result = upgradePageAnnotations([note({ text: 'See door 745963.' }, { drawingId: 'schedule' })], context({ picker: () => [] }));
        expect(result.annotations[0]!.source).toMatchObject({ linkState: 'metadata-only', referencedElementKeys: ['door-a'] });
        expect(linkedKeys(result.annotations[0]!)).toEqual([]);
    });

    it('does not use ordinary dimensions as short element IDs', () => {
        const small = element('small-id', 36);
        const ctx = context({ elements: new Map([[small.key, small]]), pageElementKeys: new Set([small.key]), bounds: [], picker: () => [] });
        expect(upgradePageAnnotations([note({ text: 'Use 36 inches here.' })], ctx).annotations[0]!.source!.referencedElementKeys).toBeUndefined();
        expect(upgradePageAnnotations([note({ text: 'See element ID 36.' })], ctx).annotations[0]!.source!.referencedElementKeys).toEqual(['small-id']);
    });

    it('matches exact Int64 text IDs without using their rounded numeric representation', () => {
        const large = element('large', Number('9007199254740993'), { elementIdText: '9007199254740993' });
        const ctx = context({ elements: new Map([[large.key, large]]), pageElementKeys: new Set([large.key]), bounds: [], picker: () => [] });
        const exact = upgradePageAnnotations([note({ text: 'See wall 9007199254740993.' })], ctx).annotations[0]!;
        expect(exact.source!.referencedElementKeys).toEqual(['large']);
        expect(exact.source!.linkState).toBe('metadata-only');
        const rounded = upgradePageAnnotations([note({ text: 'See wall 9007199254740992.' })], ctx).annotations[0]!;
        expect(rounded.source!.referencedElementKeys).toBeUndefined();
        expect(rounded.source!.linkState).toBe('unlinked');
    });

    it('keeps duplicated model IDs as candidates rather than guessing a model', () => {
        const a = element('model-a-wall', 123456, { modelKey: 'a' });
        const b = element('model-b-wall', 123456, { modelKey: 'b' });
        const ctx = context({ elements: new Map([[a.key, a], [b.key, b]]), pageElementKeys: new Set([a.key, b.key]), bounds: [], picker: () => [] });
        const result = upgradePageAnnotations([note({ text: 'See wall 123456.' })], ctx);
        expect(linkedKeys(result.annotations[0]!)).toEqual([]);
        expect(result.annotations[0]!.source).toMatchObject({ linkState: 'ambiguous', candidateKeys: [a.key, b.key] });
        expect(result.annotations[0]!.source!.referencedElementKeys).toBeUndefined();
    });

    it('excludes unrelated page identities and malformed bounds from matching', () => {
        const result = upgradePageAnnotations([note({ text: 'See door 745963.' })], context({ pageElementKeys: new Set(['metadata']), picker: () => [{ elementKey: 'wall-a' }], bounds: [
            { elementKey: 'metadata', drawingId: 'plan', bounds: [NaN, 0, 10, 10] },
            { elementKey: 'wall-a', drawingId: 'plan', bounds: [0, 0, 10, 10] },
        ] }));
        expect(result.annotations[0]!.source!.linkState).toBe('unlinked');
        expect(result.annotations[0]!.source!.referencedElementKeys).toBeUndefined();
    });

    it('keeps unsupported or unmapped locations explicitly unlinked', () => {
        const result = upgradePageAnnotations([note()], context({ bounds: [], picker: () => [] }));
        expect(linkedKeys(result.annotations[0]!)).toEqual([]);
        expect(result.annotations[0]!.source!.linkState).toBe('unlinked');
        expect(result.unlinked).toBe(1);
    });

    it('waits for geometry and never upgrades another page', () => {
        const current = note(), other = note({ id: 'page2', page: 2 });
        const result = upgradePageAnnotations([current, other], context({ geometryReady: false }));
        expect(result.annotations).toEqual([current, other]);
        expect(result.annotations[0]).toBe(current);
        expect(result.pending).toBe(1);
        const originals = [current, other];
        expect(upgradePageAnnotations(originals, context({ geometryReady: false })).annotations).toBe(originals);
        const ready = upgradePageAnnotations([current, other], context());
        expect(ready.annotations[1]).toBe(other);
        expect(ready.linked).toBe(1);
        expect(ready.pending).toBe(0);
    });

    it('retains explicit plugin/manual links, manually cleared links, and ordinary viewer notes', () => {
        const plugin = note({ id: 'plugin', elementKey: 'door-a' }, { linkState: 'linked', linkMethod: 'plugin' });
        const manual = note({ id: 'manual', elementKey: 'door-a' }, { linkState: 'linked', linkMethod: 'manual' });
        const cleared = note({ id: 'cleared' }, { linkState: 'unlinked', linkMethod: 'manual' });
        const viewer = { ...note({ id: 'viewer' }), source: undefined };
        const result = upgradePageAnnotations([plugin, manual, cleared, viewer], context());
        expect(result.annotations).toEqual([plugin, manual, cleared, viewer]);
        expect(result).toMatchObject({ linked: 2, unlinked: 1, ambiguous: 0, pending: 0 });
        result.annotations.forEach((annotation, index) => expect(annotation).toBe([plugin, manual, cleared, viewer][index]));
    });

    it('is idempotent once the imported associations have been resolved', () => {
        const first = upgradePageAnnotations([note()], context());
        const second = upgradePageAnnotations(first.annotations, context({ picker: () => [{ elementKey: 'door-a' }] }));
        expect(second).toEqual(first);
        expect(second.annotations).toBe(first.annotations);
        expect(second.annotations[0]).toBe(first.annotations[0]);
    });
});
