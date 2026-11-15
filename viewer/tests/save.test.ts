import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { annotatedName } from '../src/lib/print';
import { ANNOTATIONS_FILE, buildAnnotatedPdf, parseAnnotations } from '../src/lib/save';
import type { Annotation } from '../src/lib/types';
import { getViewerOwnedAnnotationRefs } from '../src/lib/pdfAnnotationOwnership';
import { importPdfAnnotations } from '../src/lib/importPdfAnnotations';
import { parseSessionState } from '../src/lib/session';

const ANNOTATIONS: Annotation[] = [
    { id: 'a1', page: 1, kind: 'rect', from: [100, 100], to: [160, 140], elementKey: 'w1' },
    { id: 'a2', page: 1, kind: 'pen', from: [0, 0], to: [30, 30], points: [[10, 10], [20, 25], [30, 30]] },
    { id: 'a3', page: 2, kind: 'highlight', from: [50, 50], to: [200, 80], color: '#69db7c' },
    { id: 'a4', page: 2, kind: 'comment', from: [60, 60], to: [60, 60], text: 'Check column size — “now”', elementKey: 'c1' },
    { id: 'a5', page: 2, kind: 'signature', from: [300, 300], to: [300, 300], text: 'Yam' },
    { id: 'a6', page: 1, kind: 'text', from: [80, 200], to: [80, 200], text: 'Text box' },
    { id: 'a7', page: 1, kind: 'line', from: [10, 10], to: [90, 40] },
    { id: 'a8', page: 1, kind: 'ellipse', from: [200, 200], to: [260, 240], elementKey: 'w2' },
];
const describe_ = (a: Annotation) => (a.elementKey ? `Tied to ${a.elementKey}` : 'Untied');

async function source(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([400, 300]);
    await doc.attach(new TextEncoder().encode('parquet-bytes'), 'elements.parquet', { mimeType: 'application/octet-stream' });
    return doc.save();
}

/** Read embedded files back out of a PDF. */
async function attachments(bytes: Uint8Array): Promise<Map<string, Uint8Array[]>> {
    const doc = await PDFDocument.load(bytes);
    const names = doc.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
    const out = new Map<string, Uint8Array[]>();
    for (let i = 0; i < names.size(); i += 2) {
        const name = names.lookup(i, PDFString, PDFHexString).decodeText();
        const spec = names.lookup(i + 1, PDFDict);
        const stream = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')) as PDFRawStream;
        out.set(name, [...(out.get(name) ?? []), decodePDFRawStream(stream).decode()]);
    }
    return out;
}

async function annots(bytes: Uint8Array, pageIndex: number): Promise<PDFDict[]> {
    const doc = await PDFDocument.load(bytes);
    const arr = doc.getPage(pageIndex).node.Annots();
    return arr ? arr.asArray().map((_, i) => arr.lookup(i, PDFDict)) : [];
}
const subtype = (d: PDFDict) => (d.get(PDFName.of('Subtype')) as PDFName).decodeText();

describe('buildAnnotatedPdf', () => {
    it('writes standard annotations on the right pages, each with an appearance stream', async () => {
        const out = await buildAnnotatedPdf(await source(), ANNOTATIONS, describe_);
        const p1 = await annots(out, 0);
        const p2 = await annots(out, 1);
        expect(p1.map(subtype).sort()).toEqual(['Circle', 'FreeText', 'Ink', 'Line', 'Square']);
        expect(p2.map(subtype).sort()).toEqual(['FreeText', 'Highlight', 'Text']);
        for (const d of [...p1, ...p2]) {
            expect(d.has(PDFName.of('AP'))).toBe(true);
            expect(d.has(PDFName.of('Rect'))).toBe(true);
        }
        const tied = p1.find((d) => subtype(d) === 'Square')!;
        expect((tied.lookup(PDFName.of('Subj'), PDFHexString) as PDFHexString).decodeText()).toBe('Tied to w1');
    });

    it('keeps existing attachments and stores the annotations so the ties can be restored', async () => {
        const out = await buildAnnotatedPdf(await source(), ANNOTATIONS, describe_);
        const files = await attachments(out);
        expect([...files.keys()].sort()).toEqual([ANNOTATIONS_FILE, 'elements.parquet']);
        expect(new TextDecoder().decode(files.get('elements.parquet')![0])).toBe('parquet-bytes');
        expect(parseAnnotations(files.get(ANNOTATIONS_FILE)![0]!)).toEqual(ANNOTATIONS);
    });

    it('keeps a comment linked to several objects', async () => {
        const linked: Annotation = { id: 'a9', page: 1, kind: 'comment', from: [40, 40], to: [40, 40], text: 'Same type?', elementKey: 'w1', elementKeys: ['w1', 'w2', 'w3'] };
        const files = await attachments(await buildAnnotatedPdf(await source(), [linked], describe_));
        expect(parseAnnotations(files.get(ANNOTATIONS_FILE)![0]!)).toEqual([linked]);
    });

    it('replaces its own earlier annotations and attachment on a second save', async () => {
        const first = await buildAnnotatedPdf(await source(), ANNOTATIONS, describe_);
        const second = await buildAnnotatedPdf(first, ANNOTATIONS.slice(0, 2), describe_);
        expect(await annots(second, 0)).toHaveLength(2);
        expect(await annots(second, 1)).toHaveLength(0);
        const files = await attachments(second);
        expect(files.get(ANNOTATIONS_FILE)).toHaveLength(1);
        expect(parseAnnotations(files.get(ANNOTATIONS_FILE)![0]!)).toHaveLength(2);
    });

    it('survives text outside the font encoding', async () => {
        const odd: Annotation = { id: 'x', page: 1, kind: 'text', from: [50, 50], to: [50, 50], text: 'café 日本語 ✓' };
        await expect(buildAnnotatedPdf(await source(), [odd], describe_)).resolves.toBeInstanceOf(Uint8Array);
    });
});

describe('parseAnnotations', () => {
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    it('drops malformed entries and tolerates garbage', () => {
        expect(parseAnnotations(new TextEncoder().encode('nope'))).toEqual([]);
        expect(parseAnnotations(enc({ annotations: 'x' }))).toEqual([]);
        const good = ANNOTATIONS[0]!;
        expect(parseAnnotations(enc({ annotations: [good, { id: 'bad', page: 0, kind: 'rect', from: [0, 0], to: [1, 1] }, { ...good, id: 'k', kind: 'star' }, null] }))).toEqual([good]);
    });
});

describe('annotatedName', () => {
    it('adds the suffix once', () => {
        expect(annotatedName('plan.pdf')).toBe('plan-annotated.pdf');
        expect(annotatedName('plan-annotated.pdf')).toBe('plan-annotated.pdf');
        expect(annotatedName('Plan.PDF')).toBe('Plan-annotated.pdf');
    });
});

describe('text box with a leader', () => {
    const callout: Annotation = { id: 'c', page: 1, kind: 'text', from: [100, 100], to: [250, 180], text: 'Check this', elementKey: 'w1' };

    it('is saved as a standard callout whose rectangle includes the leader tip', async () => {
        const src = await PDFDocument.create();
        src.addPage([400, 300]);
        const out = await PDFDocument.load(await buildAnnotatedPdf(await src.save(), [callout], describe_));
        const annot = out.getPage(0).node.Annots()!.lookup(0, PDFDict);
        expect((annot.get(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('FreeText');
        expect((annot.get(PDFName.of('IT')) as PDFName).decodeText()).toBe('FreeTextCallout');
        const cl = (annot.lookup(PDFName.of('CL')) as PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
        expect(cl).toEqual([250, 300 - 180, expect.any(Number), expect.any(Number)]); // tip first, in PDF space
        const rect = (annot.lookup(PDFName.of('Rect')) as PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
        expect(rect[2]!).toBeGreaterThanOrEqual(250); // right edge reaches the tip
        expect(rect[1]!).toBeLessThanOrEqual(300 - 180); // bottom edge reaches the tip
    });

    it('is a plain FreeText with no callout line when there is no leader', async () => {
        const src = await PDFDocument.create();
        src.addPage([400, 300]);
        const plain: Annotation = { ...callout, to: callout.from };
        const out = await PDFDocument.load(await buildAnnotatedPdf(await src.save(), [plain], describe_));
        const annot = out.getPage(0).node.Annots()!.lookup(0, PDFDict);
        expect(annot.has(PDFName.of('IT'))).toBe(false);
        expect(annot.has(PDFName.of('CL'))).toBe(false);
    });

    it('survives a reload with the same box, tip and tie', async () => {
        const [back] = parseAnnotations(new TextEncoder().encode(JSON.stringify({ annotations: [callout] })));
        expect(back).toEqual(callout);
    });
});

describe('revision cloud', () => {
    const contained = [{ key: 'w1', fully: true }, { key: 'w2', fully: false }];
    const cloud: Annotation = { id: 'k', page: 1, kind: 'cloud', from: [100, 100], to: [260, 180], elementKey: 'w1', contained };

    it('is saved as a cloudy polygon with its own appearance and a comment-list description', async () => {
        const src = await PDFDocument.create();
        src.addPage([400, 300]);
        const out = await PDFDocument.load(await buildAnnotatedPdf(await src.save(), [cloud], () => 'Covers 2 objects: Wall 01, Wall 02'));
        const annot = out.getPage(0).node.Annots()!.lookup(0, PDFDict);
        expect((annot.get(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('Polygon');
        expect((annot.get(PDFName.of('IT')) as PDFName).decodeText()).toBe('PolygonCloud');
        const be = annot.lookup(PDFName.of('BE'), PDFDict);
        expect((be.get(PDFName.of('S')) as PDFName).decodeText()).toBe('C');
        expect(annot.has(PDFName.of('AP'))).toBe(true);
        const vertices = (annot.lookup(PDFName.of('Vertices')) as PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
        expect(vertices).toEqual([100, 300 - 100, 260, 300 - 100, 260, 300 - 180, 100, 300 - 180]);
        const rect = (annot.lookup(PDFName.of('Rect')) as PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
        expect(rect[0]!).toBeLessThan(100); // the rectangle leaves room for the scallops
        expect(rect[2]!).toBeGreaterThan(260);
        expect(annot.lookup(PDFName.of('Subj'), PDFHexString).decodeText()).toBe('Covers 2 objects: Wall 01, Wall 02');
    });

    it('keeps the list of covered objects when a file is reopened', () => {
        const [back] = parseAnnotations(new TextEncoder().encode(JSON.stringify({ annotations: [cloud] })));
        expect(back).toEqual(cloud);
    });

    it('drops malformed entries from the covered list without dropping the cloud', () => {
        const hostile = { ...cloud, contained: [{ key: 'ok', fully: true }, { key: '', fully: true }, { key: 'x', fully: 'yes' }, 'str', null, { key: 'y'.repeat(300), fully: false }] };
        const [clean] = parseAnnotations(new TextEncoder().encode(JSON.stringify({ annotations: [hostile] })));
        expect(clean!.kind).toBe('cloud');
        expect(clean!.contained).toEqual([{ key: 'ok', fully: true }]);
    });

    it('survives a second save without duplicating', async () => {
        const src = await PDFDocument.create();
        src.addPage([400, 300]);
        const first = await buildAnnotatedPdf(await src.save(), [cloud], () => 'x');
        const second = await buildAnnotatedPdf(first, [cloud], () => 'x');
        expect((await PDFDocument.load(second)).getPage(0).node.Annots()!.size()).toBe(1);
    });
});

describe('text box colors in the saved PDF', () => {
    const RED = '0.937 0.267 0.267 rg';
    const GRAY = '0.443 0.443 0.478 rg';
    const appearance = async (a: Annotation): Promise<string> => {
        const src = await PDFDocument.create();
        src.addPage([400, 300]);
        const out = await PDFDocument.load(await buildAnnotatedPdf(await src.save(), [a], () => 'x'));
        const annot = out.getPage(0).node.Annots()!.lookup(0, PDFDict);
        const ap = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as PDFRawStream;
        return new TextDecoder().decode(decodePDFRawStream(ap).decode());
    };

    it('draws the text red when the box is tied', async () => {
        const stream = await appearance({ id: 't', page: 1, kind: 'text', from: [100, 100], to: [200, 160], text: 'Check', elementKey: 'w1' });
        expect(stream).toContain(`BT ${RED}`);
        expect(stream).not.toContain(`BT ${GRAY}`);
    });
    it('draws the text gray when the box is untied', async () => {
        const stream = await appearance({ id: 't', page: 1, kind: 'text', from: [100, 100], to: [200, 160], text: 'Check' });
        expect(stream).toContain(`BT ${GRAY}`);
        expect(stream).not.toContain(`BT ${RED}`);
    });
});

async function importedSource(options: { named?: boolean; rotated?: boolean; nested?: boolean } = {}) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    page.setCropBox(-20, -30, 360, 250);
    if (options.rotated) page.setRotation(degrees(90));
    const ap = doc.context.register(doc.context.stream('0.25 0.5 0.75 RG 17 21 m 77 101 l S', { Type: 'XObject', Subtype: 'Form', BBox: [17, 21, 77, 101] }));
    const name = 'ep-01234567-89ab-4def-8123-456789abcdef';
    const root = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Polygon', Rect: [17, 21, 77, 101],
        Vertices: [17, 21, 77, 101, 20, 90], BE: { S: 'C', I: 2 }, AP: { N: ap }, C: [0.25, 0.5, 0.75],
        Contents: PDFHexString.fromText('Existing contractor markup'), T: PDFHexString.fromText('Reviewer'),
        CreationDate: PDFString.of('D:20261114120000Z'), M: PDFString.of('D:20261114123000Z'),
        ...(options.named !== false ? { NM: PDFString.of(name) } : {}),
    }));
    const popup = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Popup', Parent: root, Rect: [100, 100, 200, 200] }));
    doc.context.lookup(root, PDFDict).set(PDFName.of('Popup'), popup);
    const reply = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [17, 21, 77, 101], IRT: root, RT: 'R',
        Contents: PDFString.of('Undated original reply'), AP: { N: ap } }));
    const unrelated = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: { S: 'URI', URI: PDFString.of('https://example.com') } }));
    for (const ref of [root, popup, reply, unrelated]) page.node.addAnnot(ref);
    const originalFiles = new Map<string, Uint8Array>();
    for (const file of ['elements.parquet', 'parameters.parquet', 'drawings.parquet', 'appearances.parquet', 'geometry.parquet', 'annotations.parquet', 'annotation-links.parquet']) {
        const bytes = new TextEncoder().encode(`exact original bytes for ${file}`);
        originalFiles.set(file, bytes);
        await doc.attach(bytes, file);
    }
    let bytes = await doc.save();
    if (options.nested) {
        const nested = await PDFDocument.load(bytes);
        const tree = nested.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict);
        const flat = tree.lookup(PDFName.of('Names'), PDFArray);
        tree.delete(PDFName.of('Names'));
        tree.set(PDFName.of('Kids'), nested.context.obj([nested.context.register(nested.context.obj({ Names: flat }))]));
        bytes = await nested.save();
    }
    const annotation: Annotation = {
        id: 'imported-1', kind: 'comment', page: 1, from: [47, 239], to: [47, 239], text: 'Existing contractor markup',
        author: { name: 'Reviewer' }, createdAt: '2026-11-14T12:00:00.000Z',
        source: { ref: `${root.objectNumber}R`, ...(options.named !== false ? { name } : {}), subtype: 'Polygon', bounds: [17, 199, 77, 279], anchor: [47, 239], shape: 'area', linkState: 'linked', linkMethod: 'geometry' },
        elementKey: 'w1',
        replies: [{ id: 'original-reply', text: 'Undated original reply', author: { name: '' }, createdAt: '', source: { ref: `${reply.objectNumber}R` } }],
    };
    return { bytes, annotation, originalFiles, name };
}

const decodedAppearance = (dict: PDFDict) => new TextDecoder().decode(decodePDFRawStream(dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as PDFRawStream).decode());

describe('imported PDF markups and ownership', () => {
    it('preserves long native reply Contents through session recovery and save', async () => {
        const { bytes, annotation } = await importedSource();
        const document = await PDFDocument.load(bytes);
        const originalText = 'Original native review text. '.repeat(500);
        document.getPage(0).node.Annots()!.lookup(2, PDFDict).set(PDFName.of('Contents'), PDFHexString.fromText(originalText));
        annotation.replies![0]!.text = originalText;
        annotation.replies!.push({ id: 'browser-reply', text: originalText, author: { name: 'Browser reviewer' }, createdAt: '2026-11-15T00:00:00Z' });
        const recovered = parseSessionState({ version: 1, fingerprint: 'source-file', annotations: [annotation], importedAnnotationIds: [annotation.id] })!;
        expect(recovered.annotations[0]!.replies![0]!.text).toBe(originalText);
        expect(recovered.annotations[0]!.replies![1]!.text).toHaveLength(10_000);
        const saved = await buildAnnotatedPdf(await document.save(), recovered.annotations, describe_, { originalAnnotations: [annotation] });
        const reopened = await annots(saved, 0);
        expect(reopened[2]!.lookup(PDFName.of('Contents'), PDFHexString).decodeText()).toBe(originalText);
        const manifest = parseAnnotations((await attachments(saved)).get(ANNOTATIONS_FILE)![0]!);
        expect(manifest[0]!.replies![0]!.text).toBe(originalText);
    });

    it('imports and saves nested native replies without flattening their PDF parent relationships', async () => {
        const { bytes } = await importedSource();
        const document = await PDFDocument.load(bytes);
        const page = document.getPage(0), array = page.node.Annots()!;
        const originalRoot = array.get(0);
        const originalReply = array.get(2);
        const nestedReply = document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [17, 21, 77, 101],
            IRT: originalReply, RT: 'R', Contents: PDFString.of('Reply to the existing reply') }));
        page.node.addAnnot(nestedReply);
        const nativeBytes = await document.save();
        const pdf = { numPages: 1, getPage: async () => ({ getViewport: () => ({ convertToViewportPoint: (x: number, y: number) => [x, 300 - y] }) }) } as unknown as Parameters<typeof importPdfAnnotations>[0];
        const imported = await importPdfAnnotations(pdf, nativeBytes, [], new Map(), new Map());
        expect(imported.annotations).toHaveLength(1);
        expect(imported.annotations[0]!.replies?.map((reply) => reply.text)).toEqual(['Undated original reply', 'Reply to the existing reply']);
        const saved = await buildAnnotatedPdf(nativeBytes, imported.annotations, describe_, { originalAnnotations: imported.annotations });
        const reopened = await PDFDocument.load(saved);
        const savedArray = reopened.getPage(0).node.Annots()!;
        expect(savedArray.size()).toBe(5);
        const savedNested = savedArray.asArray().map((_, index) => savedArray.lookup(index, PDFDict)).find((dict) =>
            dict.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)?.decodeText() === 'Reply to the existing reply')!;
        expect(savedNested.get(PDFName.of('IRT'))?.toString()).toBe(originalReply.toString());
        const savedParent = reopened.context.lookup(savedNested.get(PDFName.of('IRT'))!, PDFDict);
        expect(savedParent.get(PDFName.of('IRT'))?.toString()).toBe(originalRoot.toString());
        const files = await attachments(saved);
        const restored = await importPdfAnnotations(pdf, saved, parseAnnotations(files.get(ANNOTATIONS_FILE)![0]!), new Map(), new Map());
        expect(restored.annotations[0]!.replies).toHaveLength(2);
        expect(await annots(await buildAnnotatedPdf(saved, restored.annotations, describe_, { originalAnnotations: restored.annotations }), 0)).toHaveLength(5);
    });

    it.each(['cycle', 'cross-page'])('stops when a native reply ancestry has a %s relationship', async (relationship) => {
        const { bytes, annotation } = await importedSource();
        const document = await PDFDocument.load(bytes);
        const array = document.getPage(0).node.Annots()!;
        const originalReply = array.get(2);
        const nestedReply = document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [17, 21, 77, 101],
            IRT: originalReply, RT: 'R', Contents: PDFString.of('Nested reply') }));
        document.getPage(0).node.addAnnot(nestedReply);
        if (relationship === 'cycle') array.lookup(2, PDFDict).set(PDFName.of('IRT'), nestedReply);
        else {
            document.addPage([400, 300]).node.set(PDFName.of('Annots'), document.context.obj([originalReply]));
            array.remove(2);
        }
        annotation.replies = [{ id: 'nested', text: 'Nested reply', createdAt: '', author: { name: '' }, source: { ref: `${nestedReply.objectNumber}R` } }];
        await expect(buildAnnotatedPdf(await document.save(), [annotation], describe_, { originalAnnotations: [annotation] })).rejects.toThrow('source thread');
    });

    it('preserves foreign ep- markups and original replies without a browser manifest or inventory', async () => {
        const { bytes, originalFiles } = await importedSource();
        const out = await buildAnnotatedPdf(bytes, [], describe_);
        expect(await annots(out, 0)).toHaveLength(4);
        const files = await attachments(out);
        for (const [name, content] of originalFiles) expect(files.get(name)).toEqual([content]);
        expect(await getViewerOwnedAnnotationRefs(out)).toEqual(new Set());
    });

    it('keeps the source polygon/AP/metadata and adds one standard reply without a duplicate pin', async () => {
        const { bytes, annotation, originalFiles, name } = await importedSource();
        annotation.replies!.push({ id: 'new-reply', text: 'Verified in browser', author: { name: 'Browser reviewer' }, createdAt: '2026-11-14T13:00:00.000Z' });
        const out = await buildAnnotatedPdf(bytes, [annotation], describe_, { originalAnnotations: [annotation] });
        const list = await annots(out, 0);
        expect(list).toHaveLength(5);
        const original = list.find((dict) => subtype(dict) === 'Polygon')!;
        expect(original.lookup(PDFName.of('NM'), PDFString).decodeText()).toBe(name);
        expect(decodedAppearance(original)).toBe('0.25 0.5 0.75 RG 17 21 m 77 101 l S');
        expect(original.lookup(PDFName.of('Rect'), PDFArray).asArray().map((v) => (v as PDFNumber).asNumber())).toEqual([17, 21, 77, 101]);
        expect(original.lookup(PDFName.of('CreationDate'), PDFString).decodeText()).toBe('D:20261114120000Z');
        expect(original.lookup(PDFName.of('M'), PDFString).decodeText()).toBe('D:20261114123000Z');
        const files = await attachments(out);
        for (const [file, content] of originalFiles) expect(files.get(file)).toEqual([content]);
        const [restored] = parseAnnotations(files.get(ANNOTATIONS_FILE)![0]!);
        expect(restored?.replies).toHaveLength(2);
        expect(restored?.replies?.[0]).toMatchObject({ createdAt: '', author: { name: '' }, source: { ref: annotation.replies![0]!.source!.ref } });
        const twice = await buildAnnotatedPdf(out, [restored!], describe_);
        expect(await annots(twice, 0)).toHaveLength(5);
        expect(decodedAppearance((await annots(twice, 0)).find((dict) => subtype(dict) === 'Polygon')!)).toBe(decodedAppearance(original));
    });

    it('assigns a stable name to an unnamed source and preserves it through repeated saves', async () => {
        const { bytes, annotation } = await importedSource({ named: false });
        const out = await buildAnnotatedPdf(bytes, [annotation], describe_, { originalAnnotations: [annotation] });
        const files = await attachments(out);
        const [restored] = parseAnnotations(files.get(ANNOTATIONS_FILE)![0]!);
        expect(restored?.source?.name).toBe('epu-imported-1');
        expect(annotation.source?.name).toBeUndefined(); // caller state is not mutated
        expect((await annots(out, 0)).filter((dict) => subtype(dict) === 'Polygon')).toHaveLength(1);
        const twice = await buildAnnotatedPdf(out, [restored!], describe_);
        expect((await annots(twice, 0)).find((dict) => subtype(dict) === 'Polygon')!.lookup(PDFName.of('NM'), PDFString).decodeText()).toBe('epu-imported-1');
        expect(await annots(twice, 0)).toHaveLength(4);
    });

    it('deletes only an explicitly removed source root, its original reply, and popup', async () => {
        const { bytes, annotation, originalFiles } = await importedSource();
        const out = await buildAnnotatedPdf(bytes, [], describe_, { originalAnnotations: [annotation] });
        expect((await annots(out, 0)).map(subtype)).toEqual(['Link']);
        for (const [name, content] of originalFiles) expect((await attachments(out)).get(name)).toEqual([content]);
    });

    it('remembers source deletions after reopen from the viewer manifest', async () => {
        const { bytes, annotation } = await importedSource();
        const first = await buildAnnotatedPdf(bytes, [annotation], describe_, { originalAnnotations: [annotation] });
        const second = await buildAnnotatedPdf(first, [], describe_);
        expect((await annots(second, 0)).map(subtype)).toEqual(['Link']);
    });

    it('saves imported sources on cropped, rotated pages without regenerating their geometry', async () => {
        const { bytes, annotation } = await importedSource({ rotated: true });
        const out = await buildAnnotatedPdf(bytes, [annotation], describe_);
        const restored = await PDFDocument.load(out);
        expect(restored.getPage(0).getRotation().angle).toBe(90);
        expect(restored.getPage(0).getCropBox()).toEqual({ x: -20, y: -30, width: 360, height: 250 });
        expect(decodedAppearance((await annots(out, 0)).find((dict) => subtype(dict) === 'Polygon')!)).toBe('0.25 0.5 0.75 RG 17 21 m 77 101 l S');
        await expect(buildAnnotatedPdf(bytes, [{ id: 'new', page: 1, kind: 'comment', from: [1, 1], to: [1, 1], text: 'New pin' }], describe_)).rejects.toThrow('rotated');
    });

    it('stops rather than fabricating a new appearance if a source identity cannot be resolved', async () => {
        const { bytes, annotation } = await importedSource();
        await expect(buildAnnotatedPdf(bytes, [{ ...annotation, source: { ...annotation.source!, ref: '99999R', name: 'not-present' } }], describe_)).rejects.toThrow('could not be found');
    });

    it('preserves all nested-tree attachment bytes and writes one readable, sorted review manifest', async () => {
        const { bytes, annotation, originalFiles } = await importedSource({ nested: true });
        const first = await buildAnnotatedPdf(bytes, [annotation], describe_);
        const files = await attachments(first);
        for (const [name, content] of originalFiles) expect(files.get(name)).toEqual([content]);
        expect(files.get(ANNOTATIONS_FILE)).toHaveLength(1);
        const [restored] = parseAnnotations(files.get(ANNOTATIONS_FILE)![0]!);
        const second = await buildAnnotatedPdf(first, [restored!], describe_);
        expect((await attachments(second)).get(ANNOTATIONS_FILE)).toHaveLength(1);
    });

    it('cleans malformed source metadata while retaining valid imported provenance and undated replies', async () => {
        const { annotation } = await importedSource();
        const [valid, invalid] = parseAnnotations(new TextEncoder().encode(JSON.stringify({ annotations: [annotation, { ...annotation, id: 'bad', source: { ...annotation.source, bounds: [20, 20, 0, 0] } }] })));
        expect(valid).toEqual(annotation);
        expect(invalid?.source).toBeUndefined();
    });
});
