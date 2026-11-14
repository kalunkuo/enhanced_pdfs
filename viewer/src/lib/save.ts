import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, StandardFonts, type PDFFont } from 'pdf-lib';
import type { Annotation, AnnotationKind, Point } from './types';

/**
 * Save annotations into the PDF two ways:
 *  - as standard PDF annotations with their own appearance streams, so Acrobat and other viewers show them, and
 *  - as an `annotations.json` attachment, which keeps the object-ID ties and lets this viewer restore them.
 * Annotations from an earlier save (named `ep-...`) are replaced, not duplicated.
 */

export const ANNOTATIONS_FILE = 'annotations.json';
const NAME_PREFIX = 'ep-';
const AUTHOR = 'Enhanced PDF Viewer';
const KINDS: readonly AnnotationKind[] = ['line', 'rect', 'ellipse', 'pen', 'highlight', 'text', 'comment', 'signature'];

type Rgb = readonly [number, number, number];
const TIED: Rgb = [0.937, 0.267, 0.267];
const UNTIED: Rgb = [0.443, 0.443, 0.478];
const INK: Rgb = [0.094, 0.094, 0.106];

const f = (n: number) => n.toFixed(3);
const rgb = (c: Rgb) => c.map(f).join(' ');

function hexToRgb(hex: string | undefined): Rgb {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
    if (!m) return [1, 0.83, 0.23];
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function parseAnnotations(bytes: Uint8Array): Annotation[] {
    let raw: unknown;
    try {
        raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return [];
    }
    const list = (raw as { annotations?: unknown })?.annotations;
    if (!Array.isArray(list)) return [];
    const isPoint = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
    return list.filter((a): a is Annotation =>
        typeof a?.id === 'string' && Number.isInteger(a.page) && a.page >= 1 && KINDS.includes(a.kind) && isPoint(a.from) && isPoint(a.to) &&
        (a.points === undefined || (Array.isArray(a.points) && a.points.every(isPoint))),
    );
}

interface Box { x0: number; y0: number; x1: number; y1: number }

/** Page-space (top-left origin) bounds of everything an annotation draws. */
function boundsOf(a: Annotation): Box {
    const [x0, y0] = a.from;
    const [x1, y1] = a.to;
    const text = a.text ?? '';
    switch (a.kind) {
        case 'pen': {
            const pts = a.points?.length ? a.points : [a.from, a.to];
            return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
        }
        case 'text': return { x0: x0 - 4, y0: y0 - 14, x1: x0 - 4 + Math.max(30, text.length * 6.6 + 10), y1: y0 + 6 };
        case 'comment': return { x0: x0 - 5, y0: y0 - 10, x1: x0 + 8 + Math.max(40, text.length * 6.2 + 12), y1: y0 + 10 };
        case 'signature': return { x0: x0 - 2, y0: y0 - 24, x1: x0 + Math.max(30, text.length * 11), y1: y0 + 8 };
        default: return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
    }
}

/** Fonts in a document, embedded once. */
interface Fonts { sans: PDFFont; script: PDFFont }

function encode(font: PDFFont, text: string): string {
    let safe = '';
    for (const ch of text) {
        try {
            font.encodeText(ch);
            safe += ch;
        } catch {
            safe += '?'; // outside the font's WinAnsi encoding
        }
    }
    return font.encodeText(safe).toString();
}

export interface PageFrame { cropX: number; cropY: number; cropH: number }

/** Content stream for one annotation, in PDF user space. */
function drawing(a: Annotation, frame: PageFrame, fonts: Fonts, tied: boolean): { content: string; resources: Record<string, unknown> } {
    const X = (x: number) => f(frame.cropX + x);
    const Y = (y: number) => f(frame.cropY + frame.cropH - y);
    const color = tied ? TIED : UNTIED;
    const dash = tied ? '' : '[6 4] 0 d ';
    const stroke = `${rgb(color)} RG 1.5 w 1 J 1 j ${dash}`;
    const [x0, y0] = a.from;
    const [x1, y1] = a.to;
    const b = boundsOf(a);
    const text = a.text ?? '';
    const resources: Record<string, unknown> = {};
    let content = '';

    switch (a.kind) {
        case 'line':
            content = `${stroke}${X(x0)} ${Y(y0)} m ${X(x1)} ${Y(y1)} l S`;
            break;
        case 'rect':
            content = `${stroke}${X(b.x0)} ${Y(b.y1)} ${f(b.x1 - b.x0)} ${f(b.y1 - b.y0)} re S`;
            break;
        case 'ellipse': {
            const k = 0.5523;
            const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2;
            content = `${stroke}${X(cx + rx)} ${Y(cy)} m ` +
                `${X(cx + rx)} ${Y(cy + k * ry)} ${X(cx + k * rx)} ${Y(cy + ry)} ${X(cx)} ${Y(cy + ry)} c ` +
                `${X(cx - k * rx)} ${Y(cy + ry)} ${X(cx - rx)} ${Y(cy + k * ry)} ${X(cx - rx)} ${Y(cy)} c ` +
                `${X(cx - rx)} ${Y(cy - k * ry)} ${X(cx - k * rx)} ${Y(cy - ry)} ${X(cx)} ${Y(cy - ry)} c ` +
                `${X(cx + k * rx)} ${Y(cy - ry)} ${X(cx + rx)} ${Y(cy - k * ry)} ${X(cx + rx)} ${Y(cy)} c S`;
            break;
        }
        case 'pen': {
            const pts = a.points?.length ? a.points : [a.from, a.to];
            content = `${stroke}${pts.map((p, i) => `${X(p[0])} ${Y(p[1])} ${i === 0 ? 'm' : 'l'}`).join(' ')} S`;
            break;
        }
        case 'highlight':
            resources.ExtGState = { GS0: { Type: 'ExtGState', CA: 0.4, ca: 0.4 } };
            content = `/GS0 gs ${rgb(hexToRgb(a.color))} rg ${X(b.x0)} ${Y(b.y1)} ${f(b.x1 - b.x0)} ${f(b.y1 - b.y0)} re f`;
            break;
        case 'text':
            resources.Font = { F1: fonts.sans.ref };
            content = `${rgb(color)} RG 1 w ${dash}${X(b.x0)} ${Y(b.y1)} ${f(b.x1 - b.x0)} ${f(b.y1 - b.y0)} re S ` +
                `BT ${rgb(INK)} rg /F1 12 Tf ${X(x0)} ${Y(y0)} Td ${encode(fonts.sans, text)} Tj ET`;
            break;
        case 'comment':
            resources.Font = { F1: fonts.sans.ref };
            content = `${rgb(color)} rg ${X(x0 + 5)} ${Y(y0)} m ${X(x0 + 5)} ${Y(y0 + 5)} ${X(x0)} ${Y(y0 + 5)} ${X(x0 - 5)} ${Y(y0)} c ` +
                `${X(x0 - 5)} ${Y(y0 - 5)} ${X(x0)} ${Y(y0 - 5)} ${X(x0 + 5)} ${Y(y0)} c f ` +
                `1 g ${rgb(color)} RG 1 w ${dash}${X(x0 + 8)} ${Y(y0 + 10)} ${f(b.x1 - x0 - 8)} 20 re B ` +
                `BT ${rgb(INK)} rg /F1 11 Tf ${X(x0 + 14)} ${Y(y0 + 4)} Td ${encode(fonts.sans, text)} Tj ET`;
            break;
        case 'signature':
            resources.Font = { F1: fonts.script.ref };
            content = `BT ${rgb(INK)} rg /F1 24 Tf ${X(x0)} ${Y(y0)} Td ${encode(fonts.script, text)} Tj ET`;
            break;
    }
    return { content, resources };
}

function removeOurAnnotations(doc: PDFDocument): void {
    for (const page of doc.getPages()) {
        const annots = page.node.Annots();
        if (!annots) continue;
        for (let i = annots.size() - 1; i >= 0; i--) {
            const dict = annots.lookupMaybe(i, PDFDict);
            const nm = dict?.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString);
            if (nm?.decodeText().startsWith(NAME_PREFIX)) annots.remove(i);
        }
    }
}

/** Remove an earlier annotations.json from a flat /EmbeddedFiles name list. */
function removeAttachment(doc: PDFDocument, fileName: string): void {
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)?.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (!names) return;
    for (let i = names.size() - 2; i >= 0; i -= 2) {
        const n = names.lookupMaybe(i, PDFString, PDFHexString);
        if (n?.decodeText() === fileName) {
            names.remove(i + 1);
            names.remove(i);
        }
    }
}

/**
 * Write annotations into a copy of the PDF. `describe` gives the text shown in a viewer's comment list,
 * such as "Tied to Wall 02 (ID 900002)".
 */
export async function buildAnnotatedPdf(bytes: Uint8Array, annotations: readonly Annotation[], describe: (a: Annotation) => string): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const ctx = doc.context;
    removeOurAnnotations(doc);
    removeAttachment(doc, ANNOTATIONS_FILE);

    const fonts: Fonts = { sans: await doc.embedFont(StandardFonts.Helvetica), script: await doc.embedFont(StandardFonts.TimesRomanItalic) };
    const pages = doc.getPages();

    for (const a of annotations) {
        const page = pages[a.page - 1];
        if (!page) continue;
        if (page.getRotation().angle % 360 !== 0) throw new Error(`Page ${a.page} is rotated; saving annotations on rotated pages is not supported yet.`);
        const crop = page.getCropBox();
        const frame: PageFrame = { cropX: crop.x, cropY: crop.y, cropH: crop.height };
        const tied = a.elementKey !== undefined;
        const { content, resources } = drawing(a, frame, fonts, tied);

        const b = boundsOf(a);
        const pad = 4;
        const rect = [frame.cropX + b.x0 - pad, frame.cropY + frame.cropH - b.y1 - pad, frame.cropX + b.x1 + pad, frame.cropY + frame.cropH - b.y0 + pad];
        const stream = ctx.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: ctx.obj(resources as never) });
        const ap = ctx.register(stream);

        const subtype = { line: 'Line', rect: 'Square', ellipse: 'Circle', pen: 'Ink', highlight: 'Highlight', text: 'FreeText', signature: 'FreeText', comment: 'Text' }[a.kind];
        const subject = describe(a);
        const color = a.kind === 'highlight' ? hexToRgb(a.color) : tied ? TIED : UNTIED;
        const entries: Record<string, unknown> = {
            Type: 'Annot', Subtype: subtype, Rect: rect, F: 4, C: [...color],
            NM: PDFString.of(`${NAME_PREFIX}${a.id}`), T: PDFHexString.fromText(AUTHOR), Subj: PDFHexString.fromText(subject),
            Contents: PDFHexString.fromText(a.text ?? subject), AP: { N: ap },
        };
        const [x0, y0] = a.from;
        const [x1, y1] = a.to;
        const PX = (x: number) => frame.cropX + x;
        const PY = (y: number) => frame.cropY + frame.cropH - y;
        if (a.kind === 'line') entries.L = [PX(x0), PY(y0), PX(x1), PY(y1)];
        if (a.kind === 'pen') entries.InkList = [(a.points?.length ? a.points : [a.from, a.to]).flatMap((p) => [PX(p[0]), PY(p[1])])];
        if (a.kind === 'highlight') entries.QuadPoints = [PX(b.x0), PY(b.y0), PX(b.x1), PY(b.y0), PX(b.x0), PY(b.y1), PX(b.x1), PY(b.y1)];
        if (a.kind === 'text' || a.kind === 'signature') entries.DA = PDFString.of('0 g /Helv 12 Tf');
        if (a.kind === 'comment') entries.Name = 'Comment';

        const annotRef: PDFRef = ctx.register(ctx.obj(entries as never));
        page.node.addAnnot(annotRef);
    }

    const json = JSON.stringify({ app: 'enhanced-pdf-viewer', version: 1, annotations }, null, 1);
    await doc.attach(new TextEncoder().encode(json), ANNOTATIONS_FILE, {
        mimeType: 'application/json', description: 'Enhanced PDF Viewer annotations and their object-ID ties',
    });
    return doc.save();
}
