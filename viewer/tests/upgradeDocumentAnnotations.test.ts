import { describe, expect, it, vi } from 'vitest';
import { linkedKeys } from '../src/lib/links';
import { annotationUpgradeScale, upgradeDocumentAnnotations } from '../src/lib/upgradeDocumentAnnotations';
import type { Annotation, EnhancedPdf, PageData } from '../src/lib/types';

const note = (page: number, patch: Partial<Annotation['source']> = {}): Annotation => ({ id: `imported-${page}`, page, kind: 'comment', text: 'Existing markup', from: [5, 5], to: [5, 5],
    source: { ref: `${page}R`, subtype: 'Text', bounds: [4, 4, 6, 6], anchor: [5, 5], shape: 'point', linkState: 'pending', ...patch } });
function page(number: number): PageData {
    return { number, width: 100, height: 100, shapes: [{ elementKey: `wall-${number}`, drawingId: `plan-${number}`, bbox: [0, 0, 10, 10] }], geometrySource: 'legacy', elementKeys: new Set([`wall-${number}`]) };
}
function documentWith(load: (number: number) => Promise<PageData> = async (number) => page(number)) {
    const loadPage = vi.fn(load);
    const doc = { pageCount: 5, page: loadPage, elements: new Map([1, 2, 3, 4, 5].map((number) => [`wall-${number}`, { key: `wall-${number}`, elementId: number, name: `Wall ${number}`, category: 'Walls' }])) } as unknown as EnhancedPdf;
    return { doc, loadPage };
}

describe('document-wide existing markup upgrade', () => {
    it('processes only annotated pending pages in ascending order and carries previous page results forward', async () => {
        const { doc, loadPage } = documentWith();
        const annotations = [note(4), note(2), note(1, { linkState: 'linked', linkMethod: 'manual' }), { ...note(3), source: undefined }];
        const onPage = vi.fn(), onProgress = vi.fn();
        await upgradeDocumentAnnotations(doc, annotations, { signal: new AbortController().signal, onPage, onProgress });
        expect(loadPage.mock.calls.map(([number]) => number)).toEqual([2, 4]);
        expect(onPage.mock.calls.map(([, number]) => number)).toEqual([2, 4]);
        const final = onPage.mock.calls[1]![0].annotations as Annotation[];
        for (const number of [2, 4]) {
            const proposed = final.find((annotation) => annotation.page === number)!;
            expect(linkedKeys(proposed)).toEqual([]);
            expect(proposed.source).toMatchObject({ linkState: 'suggested', suggestedElementKeys: [`wall-${number}`] });
        }
        expect(onPage.mock.calls[1]![0]).toMatchObject({ linked: 0, suggested: 1 });
        expect(onProgress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
        expect(annotations[0]!.source!.linkState).toBe('pending');
    });

    it('does not touch resolved, manually cleared, invalid-page, or ordinary viewer notes', async () => {
        const { doc, loadPage } = documentWith();
        const onPage = vi.fn(), onProgress = vi.fn();
        await upgradeDocumentAnnotations(doc, [note(1, { linkState: 'unlinked', linkMethod: 'manual' }), note(2, { linkState: 'linked', linkMethod: 'plugin' }), note(100), { ...note(3), source: undefined }], { signal: new AbortController().signal, onPage, onProgress });
        expect(loadPage).not.toHaveBeenCalled();
        expect(onPage).not.toHaveBeenCalled();
        expect(onProgress.mock.calls).toEqual([[0, 0]]);
    });

    it('stops sequential loading if a later page fails and keeps already published work', async () => {
        const { doc, loadPage } = documentWith(async (number) => { if (number === 4) throw new Error('Worker failed'); return page(number); });
        const onPage = vi.fn(), onProgress = vi.fn();
        await expect(upgradeDocumentAnnotations(doc, [note(2), note(4), note(5)], { signal: new AbortController().signal, onPage, onProgress })).rejects.toThrow('page 4');
        expect(loadPage.mock.calls.map(([number]) => number)).toEqual([2, 4]);
        expect(onPage).toHaveBeenCalledTimes(1);
        expect(onProgress.mock.calls).toEqual([[0, 3], [1, 3]]);
    });

    it('does not read or publish anything after cancellation before the upgrade starts', async () => {
        const { doc, loadPage } = documentWith();
        const controller = new AbortController();
        controller.abort();
        const onPage = vi.fn(), onProgress = vi.fn();
        await expect(upgradeDocumentAnnotations(doc, [note(2)], { signal: controller.signal, onPage, onProgress })).rejects.toMatchObject({ name: 'AbortError' });
        expect(loadPage).not.toHaveBeenCalled();
        expect(onPage).not.toHaveBeenCalled();
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('discards a page load that completes after cancellation', async () => {
        let resolvePage!: (value: PageData) => void;
        const { doc, loadPage } = documentWith(() => new Promise((resolve) => { resolvePage = resolve; }));
        const controller = new AbortController();
        const onPage = vi.fn(), onProgress = vi.fn();
        const pending = upgradeDocumentAnnotations(doc, [note(2), note(4)], { signal: controller.signal, onPage, onProgress });
        expect(loadPage).toHaveBeenCalledWith(2);
        controller.abort();
        resolvePage(page(2));
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(onPage).not.toHaveBeenCalled();
        expect(loadPage).toHaveBeenCalledTimes(1);
        expect(onProgress.mock.calls).toEqual([[0, 2]]);
    });

    it('does not continue when the caller cancels from a completed page callback', async () => {
        const { doc, loadPage } = documentWith();
        const controller = new AbortController();
        const onPage = vi.fn(() => controller.abort());
        await expect(upgradeDocumentAnnotations(doc, [note(2), note(4)], { signal: controller.signal, onPage })).rejects.toMatchObject({ name: 'AbortError' });
        expect(onPage).toHaveBeenCalledTimes(1);
        expect(loadPage).toHaveBeenCalledTimes(1);
    });

    it('does not invent geometry when a page has only metadata', async () => {
        const { doc } = documentWith(async (number) => ({ ...page(number), geometrySource: 'none', shapes: [] }));
        const onPage = vi.fn();
        await upgradeDocumentAnnotations(doc, [note(2)], { signal: new AbortController().signal, onPage });
        expect(onPage.mock.calls[0]![0]).toMatchObject({ linked: 0, suggested: 0, unlinked: 1, pending: 0 });
        expect(linkedKeys(onPage.mock.calls[0]![0].annotations[0])).toEqual([]);
    });
});

describe('bounded upgrade raster allocation', () => {
    it('keeps small sheets at scale one and bounds large or extreme-aspect sheets', () => {
        expect(annotationUpgradeScale(1000, 1000)).toBe(1);
        const scale = annotationUpgradeScale(20_000, 10_000);
        expect(20_000 * 10_000 * scale * scale).toBeCloseTo(4_000_000);
        const wide = annotationUpgradeScale(1_000_000, 1);
        expect(1_000_000 * wide).toBeLessThanOrEqual(16_384);
        for (const dimensions of [[0, 10], [-1, 20], [Infinity, 10], [10, NaN], [Number.MAX_VALUE, Number.MAX_VALUE]]) expect(() => annotationUpgradeScale(dimensions[0]!, dimensions[1]!)).toThrow();
    });
});
