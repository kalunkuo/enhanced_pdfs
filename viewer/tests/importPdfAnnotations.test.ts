import { describe, expect, it, vi } from 'vitest';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { importPdfAnnotations } from '../src/lib/importPdfAnnotations';
import { withLinks } from '../src/lib/links';
import type { Row } from '../src/lib/tables';
import type { Annotation, ElementInfo } from '../src/lib/types';

type Pdf = Parameters<typeof importPdfAnnotations>[0];
type Matrix = readonly [number, number, number, number, number, number];
const DEFAULT: Matrix = [1, 0, 0, -1, 0, 200];
const elements = new Map<string, ElementInfo>([
    ['wall-a', { key: 'wall-a', category: 'Walls', name: 'Wall', elementId: 676281, elementIdText: '676281' }],
    ['door-a', { key: 'door-a', category: 'Doors', name: 'Door', elementId: 745963, elementIdText: '745963' }],
]);
const tables = (entries: [string, Row[]][] = []) => new Map(entries);

function pdfProxy(transforms: readonly Matrix[] = [DEFAULT], rendered: readonly unknown[][] = []) {
    const getPage = vi.fn(async (page: number) => ({
        getViewport: () => ({ convertToViewportPoint: (x: number, y: number) => {
            const [a, b, c, d, e, f] = transforms[page - 1] ?? DEFAULT;
            return [a * x + c * y + e, b * x + d * y + f];
        } }),
        getAnnotations: async () => rendered[page - 1] ?? [],
    }));
    return { pdf: { numPages: transforms.length, getPage } as unknown as Pdf, getPage };
}
async function fixture(pages = 1) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
    return doc;
}
function markup(doc: PDFDocument, values: Record<string, unknown> = {}, page = 1) {
    const dict = doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 20, 50, 80], Contents: PDFHexString.fromText('Review the wall'), ...values } as never) as unknown as PDFDict;
    const ref = doc.context.register(dict);
    doc.getPage(page - 1).node.addAnnot(ref);
    return { dict, ref, id: `${ref.objectNumber}R${ref.generationNumber || ''}` };
}
async function read(doc: PDFDocument, existing: readonly Annotation[] = [], model = elements, data = tables(), proxy = pdfProxy().pdf) {
    return importPdfAnnotations(proxy, await doc.save(), existing, data, model);
}

describe('existing PDF markup import', () => {
    it('imports review graphics as source-backed notes without replacing the source PDF', async () => {
        const doc = await fixture();
        const names = ['Text', 'FreeText', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Line', 'Ink', 'Highlight', 'Underline', 'StrikeOut', 'Stamp'];
        for (const subtype of names) markup(doc, { Subtype: subtype, NM: PDFString.of(`source-${subtype}`) });
        markup(doc, { Subtype: 'Link' });
        markup(doc, { Subtype: 'Widget' });
        markup(doc, { Subtype: 'Popup' });
        const bytes = await doc.save(), original = bytes.slice();
        const result = await importPdfAnnotations(pdfProxy().pdf, bytes, [], tables(), elements);
        expect(result.importedCount).toBe(names.length);
        expect(result.annotations.every((a) => a.kind === 'comment' && a.source?.linkState === 'pending')).toBe(true);
        expect(result.annotations.map((a) => a.source?.subtype)).toEqual(names);
        expect(result.annotations[0]!.source).toMatchObject({ name: 'source-Text', renderId: expect.stringMatching(/^\d+R/), bounds: [10, 120, 50, 180] });
        expect(bytes).toEqual(original);
        expect(result.warnings).toEqual([]);
    });

    it('retains authors and full recorded dates, leaving unknown dates undated', async () => {
        const doc = await fixture();
        markup(doc, { T: PDFHexString.fromText('Reviewer'), CreationDate: PDFString.of("D:20261114150000-08'00'"), M: PDFString.of('D:20261114234500Z') });
        markup(doc, { CreationDate: PDFString.of('D:2026') });
        const { annotations } = await read(doc);
        expect(annotations[0]).toMatchObject({ author: { name: 'Reviewer' }, createdAt: '2026-11-14T23:00:00.000Z', modifiedAt: '2026-11-14T23:45:00.000Z' });
        expect(annotations[1]!.createdAt).toBeUndefined();
        expect(annotations[1]!.author).toBeUndefined();
    });

    it('imports blank-content shapes and keeps malformed or unsupported source graphics untouched', async () => {
        const doc = await fixture();
        markup(doc, { Contents: PDFString.of('') });
        markup(doc, { Rect: [10, 20] });
        markup(doc, { Subtype: 'Movie' });
        const result = await read(doc);
        expect(result.annotations).toHaveLength(1);
        expect(result.annotations[0]!.text).toBe('');
        expect(result.warnings.join(' ')).toContain('no usable location');
        expect(doc.getPage(0).node.Annots()?.size()).toBe(3);
    });

    it('leaves ordinary PDFs as metadata-only notes without inventing model ties', async () => {
        const doc = await fixture();
        markup(doc, { Subtype: 'Text' });
        const { annotations } = await read(doc, [], new Map());
        expect(annotations[0]).toMatchObject({ kind: 'comment', source: { linkState: 'metadata-only' } });
        expect(annotations[0]!.elementKey).toBeUndefined();
    });

    it.each([
        { label: 'negative crop', transform: [1, 0, 0, -1, 100, 200], bounds: [10, 50, 50, 100], anchor: [10, 50] },
        { label: '90 degree crop', transform: [0, 1, 1, 0, -100, 90], bounds: [0, 0, 50, 40], anchor: [50, 0] },
        { label: '180 degree crop', transform: [-1, 0, 0, 1, -50, -100], bounds: [0, 0, 40, 50], anchor: [40, 50] },
        { label: '270 degree crop', transform: [0, -1, -1, 0, 150, -50], bounds: [0, 0, 50, 40], anchor: [0, 40] },
        { label: 'PDF UserUnit 2', transform: [2, 0, 0, -2, 200, 400], bounds: [20, 100, 100, 200], anchor: [20, 100] },
    ])('uses the shared viewport transform for $label', async ({ transform, bounds, anchor }) => {
        const doc = await fixture();
        markup(doc, { Subtype: 'Text', Rect: [-90, 100, -50, 150] });
        const result = await read(doc, [], elements, tables(), pdfProxy([transform as unknown as Matrix]).pdf);
        expect(result.annotations[0]!.source).toMatchObject({ bounds, anchor, shape: 'point' });
        expect(result.annotations[0]!.from).toEqual(anchor);
    });

    it('uses actual arrowhead and callout tips, including reversed arrows', async () => {
        const doc = await fixture();
        markup(doc, { Subtype: 'Line', L: [15, 25, 45, 75], LE: ['None', 'OpenArrow'] });
        markup(doc, { Subtype: 'Line', L: [15, 25, 45, 75], LE: ['ClosedArrow', 'None'] });
        markup(doc, { Subtype: 'FreeText', CL: [65, 95, 10, 20, 30, 40] });
        const { annotations } = await read(doc);
        expect(annotations.map((a) => a.source?.anchor)).toEqual([[45, 125], [15, 175], [65, 105]]);
        expect(annotations.every((a) => a.source?.shape === 'arrow')).toBe(true);
    });

    it('does not confuse native plugin ep-* names or stripped viewer markers with viewer ownership', async () => {
        const doc = await fixture();
        markup(doc, { NM: PDFString.of('ep-01234567-89ab-4def-8123-456789abcdef') });
        markup(doc, { NM: PDFString.of('epv-foreign'), EP_ViewerManaged: true });
        const result = await read(doc);
        expect(result.importedCount).toBe(2);
    });

    it('skips only the viewer exports established by its manifest, including its replies', async () => {
        const doc = await fixture();
        const root = markup(doc, { NM: PDFString.of('ep-a1') });
        markup(doc, { Subtype: 'Text', IRT: root.ref, NM: PDFString.of('ep-a1-r-r1') });
        markup(doc, { NM: PDFString.of('ep-native-plugin-note') });
        const own: Annotation = { id: 'a1', page: 1, kind: 'comment', from: [5, 5], to: [5, 5], text: 'Viewer note', replies: [{ id: 'r1', author: { name: 'Reviewer' }, text: 'Viewer reply', createdAt: '2026-11-14T23:00:00Z' }] };
        await doc.attach(new TextEncoder().encode(JSON.stringify({ app: 'enhanced-pdf-viewer', version: 1, annotations: [own] })), 'annotations.json');
        const result = await read(doc, [own]);
        expect(result.importedCount).toBe(1);
        expect(result.annotations).toHaveLength(2);
        expect(result.annotations[0]).toEqual(own);
        expect(result.annotations[1]!.source?.name).toBe('ep-native-plugin-note');
    });

    it('keeps duplicate annotation names distinct and does not apply ambiguous plugin identities', async () => {
        const doc = await fixture();
        markup(doc, { NM: PDFString.of('same-name') });
        markup(doc, { NM: PDFString.of('same-name'), Contents: PDFString.of('Another markup') });
        const data = tables([
            ['annotations', [{ AnnotationId: 'same-name', Page: 1, SchemaVersion: 1, Status: 'Open' }]],
            ['annotation-links', [{ AnnotationId: 'same-name', ElementKey: 'wall-a', ElementId: 676281, Relation: 'linked' }]],
        ]);
        const result = await read(doc, [], elements, data);
        expect(result.importedCount).toBe(2);
        expect(new Set(result.annotations.map((a) => a.id)).size).toBe(2);
        expect(result.annotations.every((a) => !a.elementKey)).toBe(true);
        expect(result.warnings.join(' ')).toContain('share an annotation name');
        expect((await read(doc, result.annotations, elements, data)).annotations.map((a) => a.id)).toEqual(result.annotations.map((a) => a.id));
    });

    it.each(['ep-', 'epv-'])('recovers colliding %s names without losing the viewer JSON record', async (prefix) => {
        const doc = await fixture(2);
        markup(doc, { NM: PDFString.of(`${prefix}a1`), Contents: PDFString.of('Viewer appearance') });
        markup(doc, { NM: PDFString.of(`${prefix}a1`), Contents: PDFString.of('Foreign markup with the same name') }, 2);
        const own: Annotation = { id: 'a1', page: 1, kind: 'comment', from: [5, 5], to: [5, 5], text: 'Viewer note' };
        await doc.attach(new TextEncoder().encode(JSON.stringify({ app: 'enhanced-pdf-viewer', version: 1, annotations: [own] })), 'annotations.json');
        const proxy = pdfProxy([DEFAULT, DEFAULT]).pdf;
        const result = await read(doc, [own], elements, tables(), proxy);
        expect(result.importedCount).toBe(2);
        expect(result.annotations[0]).toEqual(own);
        expect(result.annotations.slice(1).map((a) => [a.page, a.source?.name, a.text])).toEqual([
            [1, `${prefix}a1`, 'Viewer appearance'], [2, `${prefix}a1`, 'Foreign markup with the same name'],
        ]);
        expect((await read(doc, result.annotations, elements, tables(), proxy)).annotations).toEqual(result.annotations);
    });

    it('restores validated plugin links while keeping textual references separate', async () => {
        const doc = await fixture();
        markup(doc, { NM: PDFString.of('ep-native') });
        const data = tables([
            ['drawings', [{ DrawingId: 'plan', Page: 1 }]],
            ['annotations', [{ AnnotationId: 'ep-native', DrawingId: 'plan', Page: 1, Status: 'Open', SchemaVersion: 1 }]],
            ['annotation-links', [
                { AnnotationId: 'ep-native', ElementKey: 'wall-a', ElementId: 676281n, Relation: 'linked' },
                { AnnotationId: 'ep-native', ElementKey: 'door-a', ElementId: 745963n, Relation: 'referenced' },
                { AnnotationId: 'ep-native', ElementKey: 'made-up', ElementId: 676281n, Relation: 'linked' },
                { AnnotationId: 'ep-native', ElementKey: 'door-a', ElementId: 676281n, Relation: 'linked' },
            ]],
        ]);
        const result = await read(doc, [], elements, data);
        expect(result.annotations[0]).toMatchObject({ elementKey: 'wall-a', source: { drawingId: 'plan', linkState: 'linked', linkMethod: 'plugin', referencedElementKeys: ['door-a'] } });
        expect(result.annotations[0]!.elementKeys).toBeUndefined();
        expect(result.warnings.join(' ')).toContain('embedded model identities');
    });

    it('checks exact Int64 identities and does not inherit links from another page or deleted row', async () => {
        const doc = await fixture();
        markup(doc, { NM: PDFString.of('large') });
        markup(doc, { NM: PDFString.of('other-page') });
        markup(doc, { NM: PDFString.of('deleted') });
        const model = new Map(elements).set('large', { key: 'large', name: 'Wall', category: 'Walls', elementId: Number('9007199254740993'), elementIdText: '9007199254740993' });
        const data = tables([
            ['annotations', [
                { AnnotationId: 'large', Page: 1, SchemaVersion: 1, Status: 'Open', DrawingId: 'wrong-page' },
                { AnnotationId: 'other-page', Page: 2, SchemaVersion: 1, Status: 'Open' },
                { AnnotationId: 'deleted', Page: 1, SchemaVersion: 1, Status: 'Deleted' },
            ]],
            ['drawings', [{ DrawingId: 'wrong-page', Page: 2 }]],
            ['annotation-links', [
                { AnnotationId: 'large', ElementKey: 'large', ElementId: 9007199254740993n, Relation: 'linked' },
                { AnnotationId: 'other-page', ElementKey: 'wall-a', ElementId: 676281n, Relation: 'linked' },
                { AnnotationId: 'deleted', ElementKey: 'wall-a', ElementId: 676281n, Relation: 'linked' },
            ]],
        ]);
        const result = await read(doc, [], model, data);
        expect(result.annotations[0]!.elementKey).toBe('large');
        expect(result.annotations[0]!.source?.drawingId).toBeUndefined();
        expect(result.annotations[1]!.elementKey).toBeUndefined();
        expect(result.annotations[2]!.elementKey).toBeUndefined();
        expect(result.importedCount).toBe(3);
        expect(result.warnings.join(' ')).toContain('marked deleted');
    });

    it('preserves manual corrections across reopen while using current source text and geometry', async () => {
        const doc = await fixture();
        const note = markup(doc, { NM: PDFString.of('source-note') });
        const first = await read(doc);
        const old = withLinks(first.annotations[0]!, ['door-a']);
        old.source = { ...old.source!, linkState: 'linked', linkMethod: 'manual' };
        note.dict.set(PDFName.of('Contents'), PDFString.of('Changed in another PDF editor'));
        note.dict.set(PDFName.of('Rect'), doc.context.obj([50, 60, 90, 100]));
        const second = await read(doc, [old]);
        expect(second.annotations).toHaveLength(1);
        expect(second.annotations[0]).toMatchObject({ id: old.id, text: 'Changed in another PDF editor', elementKey: 'door-a', source: { linkState: 'linked', linkMethod: 'manual', bounds: [50, 100, 90, 140] } });
    });

    it('does not transfer source links to a different named markup that reuses a PDF object reference', async () => {
        const doc = await fixture();
        const note = markup(doc, { NM: PDFString.of('old-source') });
        const first = await read(doc);
        const old = withLinks(first.annotations[0]!, ['door-a']);
        old.source = { ...old.source!, linkState: 'linked', linkMethod: 'manual' };
        note.dict.set(PDFName.of('NM'), PDFString.of('different-source'));
        const second = await read(doc, [old]);
        expect(second.annotations[0]!.elementKey).toBeUndefined();
        expect(second.annotations[0]!.source?.name).toBe('different-source');
        expect(second.warnings.join(' ')).toContain('stale review record');
    });

    it('folds native replies and nested replies once, retaining unknown dates and duplicate reply names', async () => {
        const doc = await fixture();
        const root = markup(doc, { NM: PDFString.of('native-root') });
        const reply = markup(doc, { Subtype: 'Text', NM: PDFString.of('duplicate-reply-name'), IRT: root.ref, Contents: PDFString.of('Later reply'), T: PDFString.of('Sam'), CreationDate: PDFString.of('D:20261114233000Z') });
        markup(doc, { Subtype: 'Text', NM: PDFString.of('duplicate-reply-name'), IRT: reply.ref, Contents: PDFString.of('Earlier nested reply'), CreationDate: PDFString.of('D:20261114230000Z') });
        markup(doc, { Subtype: 'Text', IRT: root.ref, Contents: PDFString.of('Undated reply') });
        const first = await read(doc);
        expect(first.importedCount).toBe(1);
        expect(first.annotations[0]!.replies?.map((r) => r.text)).toEqual(['Earlier nested reply', 'Later reply', 'Undated reply']);
        expect(first.annotations[0]!.replies?.at(-1)).toMatchObject({ createdAt: '', author: { name: 'Unknown author' }, source: { ref: expect.stringMatching(/^\d+R/) } });
        const second = await read(doc, first.annotations);
        expect(second.annotations[0]!.replies).toEqual(first.annotations[0]!.replies);
    });

    it('leaves orphaned or cyclic reply graphics in the original PDF instead of inventing parent notes', async () => {
        const doc = await fixture();
        markup(doc, { Subtype: 'Text', IRT: PDFRef.of(99999), Contents: PDFString.of('Orphan reply') });
        const a = markup(doc, { Subtype: 'Text', Contents: PDFString.of('Cycle a') });
        const b = markup(doc, { Subtype: 'Text', IRT: a.ref, Contents: PDFString.of('Cycle b') });
        a.dict.set(PDFName.of('IRT'), b.ref);
        const result = await read(doc);
        expect(result.annotations).toEqual([]);
        expect(result.warnings.join(' ')).toContain('supported parent');
        expect(doc.getPage(0).node.Annots()?.size()).toBe(3);
    });

    it('uses page-local exact references across multiple pages and lazily requests only needed viewports', async () => {
        const doc = await fixture(3);
        markup(doc, { NM: PDFString.of('page-one') }, 1);
        markup(doc, { NM: PDFString.of('page-three') }, 3);
        const { pdf, getPage } = pdfProxy([DEFAULT, DEFAULT, [1, 0, 0, -1, 10, 220]]);
        const result = await read(doc, [], elements, tables(), pdf);
        expect(result.annotations.map((a) => a.page)).toEqual([1, 3]);
        expect(result.annotations[1]!.source?.bounds).toEqual([20, 140, 60, 200]);
        expect(getPage.mock.calls.map(([page]) => page)).toEqual([1, 3]);
    });

    it('keeps direct source identity and uses a renderer id only when the source match is unique', async () => {
        const doc = await fixture();
        const native = doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 20, 50, 80], Contents: PDFString.of('Direct note') });
        doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([native]));
        const proxy = pdfProxy([DEFAULT], [[{ id: 'annot_p0_0', subtype: 'Square', rect: [10, 20, 50, 80], contentsObj: { str: 'Direct note' } }]]).pdf;
        const imported = await read(doc, [], elements, tables(), proxy);
        expect(imported.annotations[0]!.source).toMatchObject({ ref: 'direct:0', renderId: 'annot_p0_0' });
        const ambiguousProxy = pdfProxy([DEFAULT], [[
            { id: 'one', subtype: 'Square', rect: [10, 20, 50, 80], contentsObj: { str: 'Direct note' } },
            { id: 'two', subtype: 'Square', rect: [10, 20, 50, 80], contentsObj: { str: 'Direct note' } },
        ]]).pdf;
        const ambiguous = await read(doc, [], elements, tables(), ambiguousProxy);
        expect(ambiguous.annotations[0]!.source?.renderId).toBeUndefined();
        expect(ambiguous.warnings.join(' ')).toContain('uniquely identified');
    });

    it('retains a direct native reply renderer id separately from its raw dictionary identity', async () => {
        const doc = await fixture();
        const root = markup(doc);
        const reply = doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 30, 40, 50], IRT: root.ref, Contents: PDFString.of('Direct reply') });
        doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([root.ref, reply]));
        const proxy = pdfProxy([DEFAULT], [[{ id: 'annot_p0_1', subtype: 'Text', rect: [20, 30, 40, 50], contentsObj: { str: 'Direct reply' } }]]).pdf;
        const result = await read(doc, [], elements, tables(), proxy);
        expect(result.annotations).toHaveLength(1);
        expect(result.annotations[0]!.replies?.[0]).toMatchObject({ text: 'Direct reply', source: { ref: 'direct:1', renderId: 'annot_p0_1' } });
        expect((await read(doc, result.annotations, elements, tables(), proxy)).annotations).toEqual(result.annotations);
    });
});
