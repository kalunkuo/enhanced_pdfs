import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { parsePdfDate, readPdfComments, viewerComments } from '../src/lib/drawingComments';
import type { Annotation } from '../src/lib/types';

function pdfWith(annotations: unknown[]) {
    const getAnnotations = vi.fn(async () => annotations);
    const getPage = vi.fn(async () => ({ getAnnotations }));
    return { pdf: { numPages: 2, getPage } as unknown as Pick<PDFDocumentProxy, 'getPage' | 'numPages'>, getAnnotations, getPage };
}

describe('PDF comment dates', () => {
    it('converts declared positive and negative offsets into UTC', () => {
        expect(parsePdfDate("D:20261114150000-08'00'")).toBe('2026-11-14T23:00:00.000Z');
        expect(parsePdfDate("D:20261115010000+02'30'")).toBe('2026-11-14T22:30:00.000Z');
        expect(parsePdfDate('D:20261114230000Z')).toBe('2026-11-14T23:00:00.000Z');
        expect(parsePdfDate('20261114230000+00')).toBe('2026-11-14T23:00:00.000Z');
    });

    it('does not fabricate dates, missing date fields, or unknown time zones', () => {
        for (const date of [undefined, '', 'today', 'D:2026', 'D:20261114', 'D:20261114150000', 'D:20260230000000Z', 'D:20261301000000Z', 'D:20261114240000Z', "D:20261114230000+25'00'", 'D:20261114230000Zgarbage']) {
            expect(parsePdfDate(date)).toBeUndefined();
        }
        expect(parsePdfDate('D:20240229000000Z')).toBe('2024-02-29T00:00:00.000Z');
    });
});

describe('real PDF review comments', () => {
    it('reads text, author and actual dates without rendering or inventing metadata', async () => {
        const { pdf, getAnnotations, getPage } = pdfWith([
            { id: '1R', subtype: 'Text', contentsObj: { str: ' Check\r\nthe door.\u0000 ' }, titleObj: { str: 'Alex' }, creationDate: "D:20261114150000-08'00'" },
            { id: '2R', subtype: 'FreeText', contentsObj: { str: 'Coordinate wall rating.' }, modificationDate: 'D:20261114233000Z' },
            { id: '3R', subtype: 'Highlight', contentsObj: { str: 'Confirm this dimension.' } },
        ]);
        const comments = await readPdfComments(pdf, 2);
        expect(getPage).toHaveBeenCalledWith(2);
        expect(getAnnotations).toHaveBeenCalledWith({ intent: 'display' });
        expect(comments).toEqual([
            { id: 'pdf:2:1R', page: 2, text: 'Check\nthe door.', author: 'Alex', createdAt: '2026-11-14T23:00:00.000Z', source: 'pdf' },
            { id: 'pdf:2:2R', page: 2, text: 'Coordinate wall rating.', modifiedAt: '2026-11-14T23:30:00.000Z', source: 'pdf' },
            { id: 'pdf:2:3R', page: 2, text: 'Confirm this dimension.', source: 'pdf' },
        ]);
    });

    it('ignores widgets, links, popups, blanks, duplicate references and viewer exports', async () => {
        const { pdf } = pdfWith([
            { id: 'link', subtype: 'Link', contentsObj: { str: 'Visit page' } },
            { id: 'widget', subtype: 'Widget', contentsObj: { str: 'Name' } },
            { id: 'popup', subtype: 'Popup', contentsObj: { str: 'Repeated parent text' } },
            { id: 'empty', subtype: 'Ink', contentsObj: { str: ' ' } },
            { id: 'viewer-name', subtype: 'Text', annotationName: 'ep-a1', contentsObj: { str: 'Saved viewer note' } },
            { id: 'actual', subtype: 'Square', contentsObj: { str: 'Real review note' } },
            { id: 'actual', subtype: 'Square', contentsObj: { str: 'Real review note' } },
            null,
        ]);
        expect(await readPdfComments(pdf, 1)).toEqual([{ id: 'pdf:1:actual', page: 1, text: 'Real review note', source: 'pdf' }]);
    });

    it('excludes real /NM app exports with custom authors while keeping external comments by the same author', async () => {
        const source = await PDFDocument.create();
        const page = source.addPage();
        const appRef = source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Text', NM: PDFString.of('ep-a1'), Rect: [0, 0, 10, 10] }));
        const replyRef = source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Text', NM: PDFString.of('ep-a1-r-r1'), Rect: [0, 0, 10, 10] }));
        const externalRef = source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Text', NM: PDFString.of('external-note'), Rect: [0, 0, 10, 10] }));
        page.node.set(PDFName.of('Annots'), source.context.obj([appRef, replyRef, externalRef]));
        const referenceId = (ref: typeof appRef) => `${ref.objectNumber}R`;
        const { pdf } = pdfWith([
            { id: referenceId(appRef), subtype: 'Text', titleObj: { str: 'Reviewer' }, contentsObj: { str: 'Saved viewer note' } },
            { id: referenceId(replyRef), subtype: 'Text', titleObj: { str: 'Reviewer' }, contentsObj: { str: 'Saved viewer reply' } },
            { id: referenceId(externalRef), subtype: 'Text', titleObj: { str: 'Reviewer' }, contentsObj: { str: 'External note' } },
            { id: 'external-same-marker-author', subtype: 'Text', titleObj: { str: 'Enhanced PDF Viewer' }, contentsObj: { str: 'External note with matching author' } },
        ]);
        const getData = vi.fn(async () => source.save());
        const readable = { ...pdf, getData };
        const comments = await readPdfComments(readable, 1);
        expect(comments.map((comment) => comment.text)).toEqual(['External note', 'External note with matching author']);
        await readPdfComments(readable, 1);
        expect(getData).toHaveBeenCalledTimes(1);
        expect((await readPdfComments(pdf, 1, await source.save())).map((comment) => comment.text)).toEqual(comments.map((comment) => comment.text));
    });

    it('keeps comments without timestamps undated and supports plain rich text', async () => {
        const { pdf } = pdfWith([{ id: 'a', subtype: 'Text', richText: { str: '<This is plain text, not HTML>' }, creationDate: 'D:2026' }]);
        expect(await readPdfComments(pdf, 1)).toEqual([{ id: 'pdf:1:a', page: 1, text: '<This is plain text, not HTML>', source: 'pdf' }]);
    });

    it('avoids PDF reads for an invalid page and surfaces read failures to its caller', async () => {
        const { pdf, getPage } = pdfWith([]);
        for (const page of [0, 3, 1.5, NaN]) expect(await readPdfComments(pdf, page)).toEqual([]);
        expect(getPage).not.toHaveBeenCalled();
        getPage.mockRejectedValueOnce(new Error('Unreadable comments'));
        await expect(readPdfComments(pdf, 1)).rejects.toThrow('Unreadable comments');
    });
});

describe('viewer comment context', () => {
    const note: Annotation = { id: 'a1', page: 1, kind: 'comment', from: [1, 2], to: [1, 2], text: 'Check egress.', elementKey: 'door-1' };

    it('includes meaningful comment notes with element ties but no guessed author or date', () => {
        expect(viewerComments([note, { ...note, id: 'shape', kind: 'rect' }, { ...note, id: 'empty', text: ' ' }])).toEqual([
            { id: 'a1', page: 1, text: 'Check egress.', source: 'viewer', elementKey: 'door-1' },
        ]);
    });

    it('retains known timestamps and author while dropping malformed metadata', () => {
        const dated = { ...note, author: { name: 'Reviewer' }, createdAt: '2026-11-14T15:00:00.123-08:00', modifiedAt: '2026-02-30T00:00:00Z' };
        expect(viewerComments([dated])).toEqual([
            { id: 'a1', page: 1, text: 'Check egress.', source: 'viewer', elementKey: 'door-1', author: 'Reviewer', createdAt: '2026-11-14T23:00:00.123Z' },
        ]);
    });

    it('flattens dated replies with their real author and parent annotation navigation', () => {
        const thread = { ...note, text: '', author: { name: 'Alex' }, replies: [
            { id: 'r1', author: { name: 'Sam' }, createdAt: '2026-11-14T23:30:00Z', text: 'Door width confirmed.' },
            { id: 'r2', author: { name: 'Alex' }, createdAt: 'unknown', text: ' ' },
        ] };
        expect(viewerComments([thread])).toEqual([
            { id: 'a1:reply:r1', annotationId: 'a1', page: 1, text: 'Door width confirmed.', source: 'viewer', elementKey: 'door-1', author: 'Sam', createdAt: '2026-11-14T23:30:00.000Z' },
        ]);
    });
});
