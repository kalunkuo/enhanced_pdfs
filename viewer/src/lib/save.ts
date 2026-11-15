import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, StandardFonts, type PDFFont } from 'pdf-lib';
import { calloutBounds, leaderSegment, textBox } from './callout';
import { cloudPolyline, cloudRect } from './cloud';
import { initials, pdfDate, safeImage } from './comments';
import { cleanLinks } from './links';
import type { Annotation, AnnotationKind, ContainedElement, Point, Reply } from './types';

/**
 * Save annotations into the PDF two ways:
 *  - as standard PDF annotations with their own appearance streams, so Acrobat and other viewers show them, and
 *  - as an `annotations.json` attachment, which keeps the object-ID ties and lets this viewer restore them.
 * Annotations from an earlier save (named `ep-...`) are replaced, not duplicated.
 */

export const ANNOTATIONS_FILE = 'annotations.json';
const NAME_PREFIX = 'ep-';
const AUTHOR = 'Enhanced PDF Viewer';
export const ANNOTATION_KINDS: readonly AnnotationKind[] = ['line', 'rect', 'ellipse', 'pen', 'highlight', 'text', 'comment', 'signature', 'cloud'];

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
    return list
        .filter((a): a is Annotation =>
            typeof a?.id === 'string' && Number.isInteger(a.page) && a.page >= 1 && ANNOTATION_KINDS.includes(a.kind) && isPoint(a.from) && isPoint(a.to) &&
            (a.points === undefined || (Array.isArray(a.points) && a.points.every(isPoint))),
        )
        .map(cleanComment);
}

/** Keep comment fields only when they are well formed; a saved PDF is untrusted input. */
const MAX_REPLIES = 500;
const MAX_TEXT = 10_000;

export function cleanAuthor(author: unknown): { name: string; photo?: string } | undefined {
    const a = author as { name?: unknown; photo?: unknown } | undefined;
    const name = typeof a?.name === 'string' ? a.name.trim().slice(0, 80) : '';
    const photo = safeImage(a?.photo);
    return name ? { name, ...(photo ? { photo } : {}) } : undefined;
}

export function cleanReplies(value: unknown): Reply[] {
    if (!Array.isArray(value)) return [];
    const out: Reply[] = [];
    for (const r of value.slice(0, MAX_REPLIES) as Record<string, unknown>[]) {
        const author = cleanAuthor(r?.author);
        const text = typeof r?.text === 'string' ? r.text.slice(0, MAX_TEXT) : '';
        if (typeof r?.id !== 'string' || !author || !text.trim() || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) continue;
        const image = safeImage(r.image);
        out.push({ id: r.id, author, createdAt: r.createdAt, text, ...(image ? { image } : {}) });
    }
    return out;
}

export function cleanContained(value: unknown): ContainedElement[] {
    if (!Array.isArray(value)) return [];
    return (value.slice(0, MAX_REPLIES) as Record<string, unknown>[])
        .filter((c) => typeof c?.key === 'string' && c.key.length > 0 && c.key.length <= 200 && typeof c.fully === 'boolean')
        .map((c) => ({ key: c.key as string, fully: c.fully as boolean }));
}

function cleanComment(a: Annotation): Annotation {
    const { author, createdAt, image, replies, contained, elementKey, elementKeys, ...rest } = a as Annotation & Record<string, unknown>;
    const cleanedContained = cleanContained(contained);
    const cleanedReplies = cleanReplies(replies);
    const name = typeof author?.name === 'string' ? author.name.trim().slice(0, 80) : '';
    const photo = safeImage(author?.photo);
    const when = typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt)) ? createdAt : undefined;
    const picture = safeImage(image);
    return cleanLinks({
        ...rest,
        ...(name ? { author: { name, ...(photo ? { photo } : {}) } } : {}),
        ...(when ? { createdAt: when } : {}),
        ...(picture ? { image: picture } : {}),
        ...(cleanedReplies.length ? { replies: cleanedReplies } : {}),
        ...(cleanedContained.length ? { contained: cleanedContained } : {}),
    } as Annotation, { elementKey, elementKeys });
}

/** Side of the comment teardrop, in page points. Its tip is the comment's anchor point. */
const DROP = 22;

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
        case 'text': return calloutBounds(a);
        case 'cloud': {
            const [cx0, cy0, cx1, cy1] = cloudRect(a);
            return { x0: cx0 - 6, y0: cy0 - 6, x1: cx1 + 6, y1: cy1 + 6 }; // room for the scallops
        }
        case 'comment': return { x0, y0: y0 - DROP, x1: x0 + DROP + 6 + Math.max(40, Math.min(text.length, 40) * 6.2 + 12), y1: y0 };
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
        case 'cloud': {
            const ring = cloudPolyline(cloudRect(a));
            content = `${stroke}${ring.map((p, i) => `${X(p[0])} ${Y(p[1])} ${i === 0 ? 'm' : 'l'}`).join(' ')} h S`;
            break;
        }
        case 'highlight':
            resources.ExtGState = { GS0: { Type: 'ExtGState', CA: 0.4, ca: 0.4 } };
            content = `/GS0 gs ${rgb(hexToRgb(a.color))} rg ${X(b.x0)} ${Y(b.y1)} ${f(b.x1 - b.x0)} ${f(b.y1 - b.y0)} re f`;
            break;
        case 'text': {
            // Box, then the leader and its dot when there is one. Untied boxes are gray, text included.
            const box = textBox(a);
            const seg = leaderSegment(a);
            const ink = tied ? TIED : UNTIED; // red when tied, like the box and leader; gray when untied
            resources.Font = { F1: fonts.sans.ref };
            content = `${rgb(color)} RG 1 w ${dash}${X(box.x)} ${Y(box.y + box.h)} ${f(box.w)} ${f(box.h)} re S `;
            if (seg) {
                const [tx, ty] = seg[1];
                const r = 3.5;
                const k = 0.5523 * r;
                content += `${rgb(color)} RG 1.5 w ${dash}${X(seg[0][0])} ${Y(seg[0][1])} m ${X(tx)} ${Y(ty)} l S ` +
                    `${rgb(color)} rg ${X(tx + r)} ${Y(ty)} m ` +
                    `${X(tx + r)} ${Y(ty + k)} ${X(tx + k)} ${Y(ty + r)} ${X(tx)} ${Y(ty + r)} c ` +
                    `${X(tx - k)} ${Y(ty + r)} ${X(tx - r)} ${Y(ty + k)} ${X(tx - r)} ${Y(ty)} c ` +
                    `${X(tx - r)} ${Y(ty - k)} ${X(tx - k)} ${Y(ty - r)} ${X(tx)} ${Y(ty - r)} c ` +
                    `${X(tx + k)} ${Y(ty - r)} ${X(tx + r)} ${Y(ty - k)} ${X(tx + r)} ${Y(ty)} c f `;
            }
            content += `BT ${rgb(ink)} rg /F1 12 Tf ${X(x0)} ${Y(y0)} Td ${encode(fonts.sans, text)} Tj ET`;
            break;
        }
        case 'comment': {
            // A teardrop whose tip (bottom-left) is the anchor, then the message in a pill beside it.
            const r = DROP / 2;
            const k = 0.5523 * r;
            const preview = text.length > 40 ? `${text.slice(0, 39)}…` : text;
            const initial = initials(a.author?.name ?? '?')[0] ?? '?';
            resources.Font = { F1: fonts.sans.ref };
            content = `${rgb(color)} rg ${X(x0)} ${Y(y0)} m ${X(x0)} ${Y(y0 - r)} l ` +
                `${X(x0)} ${Y(y0 - r - k)} ${X(x0 + r - k)} ${Y(y0 - DROP)} ${X(x0 + r)} ${Y(y0 - DROP)} c ` +
                `${X(x0 + r + k)} ${Y(y0 - DROP)} ${X(x0 + DROP)} ${Y(y0 - r - k)} ${X(x0 + DROP)} ${Y(y0 - r)} c ` +
                `${X(x0 + DROP)} ${Y(y0 - r + k)} ${X(x0 + r + k)} ${Y(y0)} ${X(x0 + r)} ${Y(y0)} c h f ` +
                `BT 1 g /F1 11 Tf ${X(x0 + r - 3.5)} ${Y(y0 - r + 4)} Td ${encode(fonts.sans, initial)} Tj ET ` +
                `1 g ${rgb(color)} RG 1 w ${dash}${X(x0 + DROP + 6)} ${Y(y0)} ${f(b.x1 - x0 - DROP - 6)} ${f(DROP)} re B ` +
                `BT ${rgb(INK)} rg /F1 11 Tf ${X(x0 + DROP + 12)} ${Y(y0 - r + 4)} Td ${encode(fonts.sans, preview)} Tj ET`;
            break;
        }
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

        const subtype = { line: 'Line', rect: 'Square', ellipse: 'Circle', pen: 'Ink', highlight: 'Highlight', text: 'FreeText', signature: 'FreeText', comment: 'Text', cloud: 'Polygon' }[a.kind];
        const subject = describe(a);
        const color = a.kind === 'highlight' ? hexToRgb(a.color) : tied ? TIED : UNTIED;
        const entries: Record<string, unknown> = {
            Type: 'Annot', Subtype: subtype, Rect: rect, F: 4, C: [...color],
            NM: PDFString.of(`${NAME_PREFIX}${a.id}`), T: PDFHexString.fromText(a.author?.name || AUTHOR), Subj: PDFHexString.fromText(subject),
            Contents: PDFHexString.fromText(a.text ?? subject), AP: { N: ap },
        };
        const created = a.createdAt ? pdfDate(a.createdAt) : undefined;
        if (created) Object.assign(entries, { CreationDate: PDFString.of(created), M: PDFString.of(created) });
        const [x0, y0] = a.from;
        const [x1, y1] = a.to;
        const PX = (x: number) => frame.cropX + x;
        const PY = (y: number) => frame.cropY + frame.cropH - y;
        if (a.kind === 'line') entries.L = [PX(x0), PY(y0), PX(x1), PY(y1)];
        if (a.kind === 'pen') entries.InkList = [(a.points?.length ? a.points : [a.from, a.to]).flatMap((p) => [PX(p[0]), PY(p[1])])];
        if (a.kind === 'highlight') entries.QuadPoints = [PX(b.x0), PY(b.y0), PX(b.x1), PY(b.y0), PX(b.x0), PY(b.y1), PX(b.x1), PY(b.y1)];
        if (a.kind === 'text' || a.kind === 'signature') entries.DA = PDFString.of('0 g /Helv 12 Tf');
        if (a.kind === 'cloud') {
            // A cloudy polygon: the four corners and the cloud border effect, with our own appearance drawn on top.
            const [cx0, cy0, cx1, cy1] = cloudRect(a);
            entries.Vertices = [PX(cx0), PY(cy0), PX(cx1), PY(cy0), PX(cx1), PY(cy1), PX(cx0), PY(cy1)];
            entries.IT = 'PolygonCloud';
            entries.BE = { S: 'C', I: 1 };
        }
        if (a.kind === 'text') {
            // A box with a leader is a standard callout: the line runs from the leader tip to the box.
            const seg = leaderSegment(a);
            if (seg) {
                entries.IT = 'FreeTextCallout';
                entries.CL = [PX(seg[1][0]), PY(seg[1][1]), PX(seg[0][0]), PY(seg[0][1])];
            }
        }
        if (a.kind === 'comment') entries.Name = 'Comment';

        const annotRef: PDFRef = ctx.register(ctx.obj(entries as never));
        page.node.addAnnot(annotRef);

        // Replies are standard reply annotations (IRT) with an empty appearance, so they list in a viewer's
        // comment panel without drawing anything extra on the page.
        for (const reply of a.replies ?? []) {
            const blank = ctx.register(ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: rect }));
            const when = pdfDate(reply.createdAt);
            const replyEntries: Record<string, unknown> = {
                Type: 'Annot', Subtype: 'Text', Rect: rect, F: 4, Name: 'Comment', IRT: annotRef, RT: 'R',
                NM: PDFString.of(`${NAME_PREFIX}${a.id}-r-${reply.id}`), T: PDFHexString.fromText(reply.author.name),
                Contents: PDFHexString.fromText(reply.text), AP: { N: blank },
                ...(when ? { CreationDate: PDFString.of(when), M: PDFString.of(when) } : {}),
            };
            page.node.addAnnot(ctx.register(ctx.obj(replyEntries as never)));
        }
    }

    const json = JSON.stringify({ app: 'enhanced-pdf-viewer', version: 1, annotations }, null, 1);
    await doc.attach(new TextEncoder().encode(json), ANNOTATIONS_FILE, {
        mimeType: 'application/json', description: 'Enhanced PDF Viewer annotations and their object-ID ties',
    });
    return doc.save();
}
