import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { annotatedName } from '../src/lib/print';
import { ANNOTATIONS_FILE, buildAnnotatedPdf, parseAnnotations } from '../src/lib/save';
import type { Annotation } from '../src/lib/types';

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
