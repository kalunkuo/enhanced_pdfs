import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import type { DrawingComment } from './drawingAgent';
import type { Annotation } from './types';

// These are the standard review annotations that can carry human-written Contents.
// Links, form widgets, popups, attachments, and media are not drawing comments.
const REVIEW_SUBTYPES = new Set([
    'Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine',
    'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Redact',
]);
type CommentPdf = Pick<PDFDocumentProxy, 'getPage' | 'numPages'> & Partial<Pick<PDFDocumentProxy, 'getData'>>;
const viewerReferenceCache = new WeakMap<CommentPdf, Promise<ReadonlySet<string>>>();

/** PDF.js omits /NM; map the app's own registered annotation refs from source. */
async function viewerReferences(pdf: CommentPdf, sourceBytes?: Uint8Array): Promise<ReadonlySet<string>> {
    if (!sourceBytes && !pdf.getData) return new Set<string>();
    let cached = viewerReferenceCache.get(pdf);
    if (!cached) {
        cached = (async () => {
            const bytes = sourceBytes ?? await pdf.getData?.();
            if (!bytes) return new Set<string>();
            const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const result = new Set<string>();
            for (const page of source.getPages()) {
                const annotations = page.node.Annots();
                if (!annotations) continue;
                for (let i = 0; i < annotations.size(); i++) {
                    const reference = annotations.get(i);
                    if (!(reference instanceof PDFRef)) continue;
                    const annotation = source.context.lookup(reference, PDFDict);
                    const name = annotation.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)?.decodeText();
                    if (name?.startsWith('ep-')) result.add(`${reference.objectNumber}R${reference.generationNumber || ''}`);
                }
            }
            return result;
        })();
        viewerReferenceCache.set(pdf, cached);
    }
    return cached;
}

/**
 * Return an unambiguous PDF timestamp as ISO, preserving its UTC offset.
 * Incomplete dates and dates without an explicit time zone cannot establish which
 * comment is latest, so they remain undated instead of receiving guessed fields.
 */
export function parsePdfDate(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const match = /^(?:D:)?(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}(?:'?\d{2}'?)?)$/.exec(value.trim());
    if (!match) return undefined;
    const [, y, mo, d, h, mi, s, zone] = match;
    const year = Number(y), month = Number(mo), day = Number(d);
    const hour = Number(h), minute = Number(mi), second = Number(s);
    if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return undefined;
    // setUTCFullYear avoids Date.UTC's special handling of years 0 through 99.
    const local = new Date(0);
    local.setUTCFullYear(year, month - 1, day);
    local.setUTCHours(hour, minute, second, 0);
    if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return undefined;
    let offset = 0;
    if (zone !== 'Z') {
        const digits = zone!.slice(1).replaceAll("'", '');
        const offsetHour = Number(digits.slice(0, 2));
        const offsetMinute = Number(digits.slice(2) || '0');
        if (offsetHour > 23 || offsetMinute > 59) return undefined;
        offset = (offsetHour * 60 + offsetMinute) * (zone![0] === '+' ? 1 : -1);
    }
    return new Date(local.getTime() - offset * 60_000).toISOString();
}

function text(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = value.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
    return cleaned || undefined;
}

function stringFromObject(value: unknown): string | undefined {
    return value && typeof value === 'object' && 'str' in value
        ? text(value.str)
        : text(value);
}

function knownIsoDate(value: unknown): string | undefined {
    // Only full ISO timestamps with a declared zone establish chronological order.
    if (typeof value !== 'string') return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return undefined;
    const [, year, month, day, hour, minute, second, milliseconds, zone] = match;
    const base = parsePdfDate(`D:${year}${month}${day}${hour}${minute}${second}${zone!.replace(':', '')}`);
    if (!base) return undefined;
    return new Date(new Date(base).getTime() + Number(`0.${milliseconds ?? '0'}`) * 1000).toISOString();
}

/** Read real, text-bearing review annotations on one current PDF page. */
export async function readPdfComments(pdf: CommentPdf, pageNumber: number, sourceBytes?: Uint8Array): Promise<DrawingComment[]> {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) return [];
    const page = await pdf.getPage(pageNumber);
    const [annotations, excluded]: [unknown[], ReadonlySet<string>] = await Promise.all([
        page.getAnnotations({ intent: 'display' }), viewerReferences(pdf, sourceBytes),
    ]);
    const comments: DrawingComment[] = [];
    const seen = new Set<string>();
    for (const raw of annotations) {
        if (!raw || typeof raw !== 'object') continue;
        const annotation = raw as Record<string, unknown>;
        if (typeof annotation.subtype !== 'string' || !REVIEW_SUBTYPES.has(annotation.subtype)) continue;
        const author = stringFromObject(annotation.titleObj) ?? text(annotation.title);
        // /NM identifies app exports regardless of their custom author name.
        const name = text(annotation.annotationName) ?? text(annotation.name);
        const contents = stringFromObject(annotation.contentsObj) ?? text(annotation.contents) ?? stringFromObject(annotation.richText);
        const id = text(annotation.id);
        if (!contents || !id || excluded.has(id) || name?.startsWith('ep-') || seen.has(id)) continue;
        seen.add(id);
        const createdAt = parsePdfDate(annotation.creationDate);
        const modifiedAt = parsePdfDate(annotation.modificationDate);
        comments.push({
            id: `pdf:${pageNumber}:${id}`, page: pageNumber, text: contents, source: 'pdf',
            ...(author ? { author } : {}), ...(createdAt ? { createdAt } : {}), ...(modifiedAt ? { modifiedAt } : {}),
        });
    }
    return comments;
}

/** Viewer notes retain their original timestamps; old saved notes remain undated. */
export function viewerComments(annotations: readonly Annotation[]): DrawingComment[] {
    return annotations.flatMap((annotation) => {
        if (annotation.kind !== 'comment') return [];
        const contents = text(annotation.text);
        const createdAt = knownIsoDate(annotation.createdAt);
        const modifiedAt = knownIsoDate(annotation.modifiedAt);
        const author = typeof annotation.author === 'string' ? text(annotation.author) : text(annotation.author?.name);
        const shared = { page: annotation.page, source: 'viewer' as const, ...(annotation.elementKey ? { elementKey: annotation.elementKey } : {}) };
        const comments: DrawingComment[] = contents ? [{
            ...shared,
            id: annotation.id, text: contents,
            ...(author ? { author } : {}), ...(createdAt ? { createdAt } : {}), ...(modifiedAt ? { modifiedAt } : {}),
        }] : [];
        for (const reply of annotation.replies ?? []) {
            const replyText = text(reply.text);
            if (!replyText) continue;
            const replyDate = knownIsoDate(reply.createdAt);
            const replyAuthor = text(reply.author?.name);
            comments.push({
                ...shared, id: `${annotation.id}:reply:${reply.id}`, annotationId: annotation.id, text: replyText,
                ...(replyAuthor ? { author: replyAuthor } : {}), ...(replyDate ? { createdAt: replyDate } : {}),
            });
        }
        return comments;
    });
}
