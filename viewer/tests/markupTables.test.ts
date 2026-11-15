import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { MARKUP_LINKS_FILE, MARKUP_REPLIES_FILE, MARKUPS_FILE, buildMarkupTables } from '../src/lib/markupTables';
import { boundsOf, buildAnnotatedPdf } from '../src/lib/save';
import type { Annotation, AppearanceInfo, DrawingInfo, ElementInfo, Point } from '../src/lib/types';

const WALL = 'model-1/host/aaaa-0001';
const DOOR = 'model-1/link-7/bbbb-0002';
const elements = new Map<string, ElementInfo>([
    [WALL, { key: WALL, elementId: 900002, elementIdText: '900002', category: 'Walls', name: 'Wall 02', modelKey: 'model-1' }],
    [DOOR, { key: DOOR, elementId: 12, elementIdText: '9007199254740993', category: 'Doors', name: 'Door 1', modelKey: 'model-1', linkInstanceId: '77' }],
]);
const drawings: DrawingInfo[] = [
    { id: 'sheet-A101', page: 1, name: 'A101', viewId: '5001', viewUniqueId: 'sheet-uid' },
    { id: 'plan-L1', parentId: 'sheet-A101', page: 1, name: 'Level 1', viewId: '5002', viewUniqueId: 'plan-uid' },
];
const appearances: AppearanceInfo[] = [
    { drawingId: 'sheet-A101', elementKey: WALL },
    { drawingId: 'plan-L1', elementKey: WALL },
    { drawingId: 'plan-L1', elementKey: DOOR },
];
const source = { elements, drawings, appearances };

const comment: Annotation = {
    id: 'c1', page: 1, kind: 'comment', from: [100, 100], to: [100, 100], text: 'Check rating', elementKey: WALL, elementKeys: [WALL, DOOR, 'gone/host/x'],
    author: { name: 'Yam' }, createdAt: '2026-11-01T10:00:00.000Z',
    replies: [{ id: 'r1', author: { name: 'Ana' }, createdAt: '2026-11-02T10:00:00.000Z', text: 'Agreed', image: 'data:image/png;base64,AA==' }],
};
const cloud: Annotation = { id: 'k1', page: 1, kind: 'cloud', from: [10, 20], to: [110, 70], contained: [{ key: WALL, fully: true }, { key: DOOR, fully: false }] };
const highlight: Annotation = { id: 'h1', page: 1, kind: 'highlight', from: [0, 0], to: [50, 10], color: '#69db7c' };

async function attachments(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    const doc = await PDFDocument.load(bytes);
    const names = doc.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
    const out = new Map<string, Uint8Array>();
    for (let i = 0; i < names.size(); i += 2) {
        const spec = names.lookup(i + 1, PDFDict);
        const stream = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')) as PDFRawStream;
        out.set(names.lookup(i, PDFString, PDFHexString).decodeText(), decodePDFRawStream(stream).decode());
    }
    return out;
}
const read = async (bytes: Uint8Array) => (await parquetReadObjects({ file: bytes.slice().buffer, compressors })) as Record<string, unknown>[];

async function pdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    return doc.save();
}

describe('buildMarkupTables', () => {
    const frames = new Map([[1, { cropX: 0, cropY: 0, cropH: 792 }]]);

    it('writes PDF-space geometry with a bottom-left origin and the page drawing', () => {
        const { markups } = buildMarkupTables([highlight], frames, boundsOf, source);
        expect(markups[0]).toMatchObject({
            MarkupId: 'h1', Page: 1, DrawingId: 'sheet-A101', ViewId: 5001n, ViewUniqueId: 'sheet-uid', Kind: 'highlight', RevitKind: 'FilledRegion',
            Color: '#69db7c', MinX: 0, MinY: 782, MaxX: 50, MaxY: 792, AnchorX: 0, AnchorY: 792, SchemaVersion: 1,
        });
        expect(JSON.parse(markups[0]!.Points)).toEqual([[0, 792], [50, 792], [50, 782], [0, 782]]);
    });

    it('honors a cropped, offset page', () => {
        const { markups } = buildMarkupTables([highlight], new Map([[1, { cropX: 20, cropY: -30, cropH: 500 }]]), boundsOf);
        expect(markups[0]).toMatchObject({ MinX: 20, MinY: 460, MaxX: 70, MaxY: 470, DrawingId: null });
    });

    it.each([0, 90, 180, 270].flatMap((rotation) => [1, 2].map((userUnit) => ({ rotation, userUnit }))))(
        'exports imported review pins using the actual PDF.js viewport at $rotation degrees and UserUnit $userUnit',
        async ({ rotation, userUnit }) => {
            const document = await PDFDocument.create();
            const page = document.addPage([620, 840]);
            page.setMediaBox(-120, -200, 620, 840);
            page.setCropBox(-80, -150, 400, 500);
            page.setRotation(degrees(rotation));
            page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
            const loading = getDocument({ data: (await document.save()).slice(), disableWorkerRendering: true });
            const pdf = await loading.promise;
            try {
                const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
                const native: Point = [-41.25, 13.75];
                const position = viewport.convertToViewportPoint(...native);
                const anchor: Point = [position[0]!, position[1]!];
                const imported: Annotation = { id: 'source-square', page: 1, kind: 'comment', from: anchor, to: anchor, text: 'Existing square review',
                    source: { ref: '50R', subtype: 'Square', bounds: [0, 0, 100, 100], anchor, shape: 'area', linkState: 'linked' }, elementKey: WALL };
                const original = structuredClone(imported);
                const frame = { cropX: -80, cropY: -150, cropW: 400, cropH: 500, rotation, userUnit };
                const { markups, links } = buildMarkupTables([imported], new Map([[1, frame]]), boundsOf, source);
                const row = markups[0]!;
                expect(row).toMatchObject({ Kind: 'comment', RevitKind: 'TextNote', AnchorX: native[0], AnchorY: native[1] });
                expect(JSON.parse(row.Points)).toEqual([native]);
                const bounds = boundsOf(imported);
                const corners = [[bounds.x0, bounds.y0], [bounds.x1, bounds.y0], [bounds.x1, bounds.y1], [bounds.x0, bounds.y1]]
                    .map(([x, y]) => viewport.convertToPdfPoint(x!, y!));
                const rounded = (n: number) => Math.round(n * 1000) / 1000;
                expect([row.MinX, row.MinY, row.MaxX, row.MaxY]).toEqual([
                    rounded(Math.min(...corners.map((p) => p[0]!))), rounded(Math.min(...corners.map((p) => p[1]!))),
                    rounded(Math.max(...corners.map((p) => p[0]!))), rounded(Math.max(...corners.map((p) => p[1]!))),
                ]);
                expect(links[0]).toMatchObject({ ElementKey: WALL, Relation: 'Linked' });
                expect(imported).toEqual(original);
            } finally { await loading.destroy(); }
        },
    );

    it('rejects an incomplete rotated page frame rather than exporting misplaced coordinates', () => {
        expect(() => buildMarkupTables([comment], new Map([[1, { cropX: 20, cropY: -30, cropH: 500, rotation: 90 }]]), boundsOf)).toThrow('Invalid page frame');
    });

    it('resolves each link to its Revit identity and the viewport on that page', () => {
        const { markups, links } = buildMarkupTables([comment], frames, boundsOf, source);
        expect(markups[0]).toMatchObject({ ElementKey: WALL, LinkCount: 3, ReplyCount: 1, Author: 'Yam', CreatedUtc: '2026-11-01T10:00:00.000Z' });
        expect(links).toEqual([
            { MarkupId: 'c1', Ordinal: 0, ElementKey: WALL, Relation: 'Linked', DrawingId: 'plan-L1', ModelKey: 'model-1', UniqueId: 'aaaa-0001', ElementId: 900002n, LinkInstanceId: null, Category: 'Walls', Resolved: true },
            { MarkupId: 'c1', Ordinal: 1, ElementKey: DOOR, Relation: 'Linked', DrawingId: 'plan-L1', ModelKey: 'model-1', UniqueId: 'bbbb-0002', ElementId: 9007199254740993n, LinkInstanceId: 77n, Category: 'Doors', Resolved: true },
            { MarkupId: 'c1', Ordinal: 2, ElementKey: 'gone/host/x', Relation: 'Linked', DrawingId: null, ModelKey: null, UniqueId: null, ElementId: null, LinkInstanceId: null, Category: null, Resolved: false },
        ]);
    });

    it('lists what a revision cloud covers, fully or partly', () => {
        const { markups, links } = buildMarkupTables([cloud], frames, boundsOf, source);
        expect(markups[0]).toMatchObject({ RevitKind: 'RevisionCloud', ElementKey: null, LinkCount: 2 });
        expect(links.map((l) => [l.ElementKey, l.Relation])).toEqual([[WALL, 'Contained'], [DOOR, 'Overlaps']]);
    });
});

describe('markup Parquet attachments', () => {
    it('embeds readable markups, links, and replies tables next to annotations.json', async () => {
        const files = await attachments(await buildAnnotatedPdf(await pdf(), [comment, cloud, highlight], () => 'x', source));
        const markups = await read(files.get(MARKUPS_FILE)!);
        expect(markups.map((m) => m.MarkupId)).toEqual(['c1', 'k1', 'h1']);
        expect(markups[0]).toMatchObject({ Kind: 'comment', Text: 'Check rating', ViewId: 5001n, HasImage: false });
        expect(markups[1]!.Text).toBeNull();
        const links = await read(files.get(MARKUP_LINKS_FILE)!);
        expect(links).toHaveLength(5);
        expect(links[1]).toMatchObject({ ElementId: 9007199254740993n, LinkInstanceId: 77n });
        const replies = await read(files.get(MARKUP_REPLIES_FILE)!);
        expect(replies).toEqual([{ MarkupId: 'c1', ReplyId: 'r1', Ordinal: 0, Author: 'Ana', CreatedUtc: '2026-11-02T10:00:00.000Z', Text: 'Agreed', HasImage: true }]);
    });

    it('writes empty link and reply tables when no markup has any, and replaces tables on a second save', async () => {
        const first = await buildAnnotatedPdf(await pdf(), [comment, highlight], () => 'x', source);
        const second = await attachments(await buildAnnotatedPdf(first, [highlight], () => 'x', source));
        expect((await read(second.get(MARKUPS_FILE)!)).map((m) => m.MarkupId)).toEqual(['h1']);
        expect(await read(second.get(MARKUP_LINKS_FILE)!)).toEqual([]);
        expect(await read(second.get(MARKUP_REPLIES_FILE)!)).toEqual([]);
    });

    it('drops the tables when every markup is removed', async () => {
        const first = await buildAnnotatedPdf(await pdf(), [highlight], () => 'x', source);
        const files = await attachments(await buildAnnotatedPdf(first, [], () => 'x', source));
        expect([...files.keys()]).toEqual(['annotations.json']);
    });
});
