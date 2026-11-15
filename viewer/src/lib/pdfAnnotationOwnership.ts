import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFObject, PDFRawStream, PDFRef, PDFString, decodePDFRawStream } from 'pdf-lib';

export const VIEWER_ANNOTATION_MARKER = 'EP_ViewerManaged';
export const VIEWER_ANNOTATION_PREFIX = 'epv-';
export const VIEWER_ANNOTATIONS_FILE = 'annotations.json';

export interface PdfAnnotationEntry {
    page: number;
    index: number;
    ref: string;
    object: PDFObject;
    dict: PDFDict;
}

export function annotationRefKey(object: PDFObject, index: number): string {
    return object instanceof PDFRef ? `${object.objectNumber}R${object.generationNumber || ''}` : `direct:${index}`;
}

export function listPdfAnnotationEntries(doc: PDFDocument): PdfAnnotationEntry[] {
    const entries: PdfAnnotationEntry[] = [];
    doc.getPages().forEach((page, pageIndex) => {
        const array = page.node.Annots();
        if (!array) return;
        for (let index = 0; index < array.size(); index++) {
            const object = array.get(index);
            try {
                const dict = doc.context.lookup(object);
                if (dict instanceof PDFDict) entries.push({ page: pageIndex + 1, index, ref: annotationRefKey(object, index), object, dict });
            } catch { /* An unreadable annotation remains untouched in its source array. */ }
        }
    });
    return entries;
}

export function pdfText(dict: PDFDict, key: string): string | undefined {
    try { return dict.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText(); }
    catch { return undefined; }
}

/** Walk the original name tree without decoding/replacing any unrelated file streams. */
function embeddedEntries(doc: PDFDocument): { root?: PDFDict; entries: { key: PDFString | PDFHexString; value: PDFObject }[]; complete: boolean } {
    const result: { root?: PDFDict; entries: { key: PDFString | PDFHexString; value: PDFObject }[]; complete: boolean } = { entries: [], complete: true };
    const visited = new Set<PDFDict>();
    let nodes = 0;
    const visit = (raw: PDFObject | undefined) => {
        if (!raw || ++nodes > 2048) { result.complete = false; return; }
        let node: PDFObject | undefined;
        try { node = doc.context.lookup(raw); } catch { result.complete = false; return; }
        if (!(node instanceof PDFDict) || visited.has(node)) { result.complete = false; return; }
        visited.add(node);
        const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
        if (names) {
            if (names.size() % 2 || result.entries.length + names.size() / 2 > 100_000) { result.complete = false; return; }
            for (let i = 0; i < names.size(); i += 2) {
                const key = doc.context.lookup(names.get(i));
                if (!(key instanceof PDFString || key instanceof PDFHexString)) { result.complete = false; continue; }
                result.entries.push({ key, value: names.get(i + 1) });
            }
        }
        const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
        if (kids) for (const kid of kids.asArray()) visit(kid);
    };
    try {
        const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
        const root = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
        if (root) { result.root = root; visit(root); }
    } catch { result.complete = false; }
    return result;
}

export function readEmbeddedFile(doc: PDFDocument, name: string): Uint8Array | undefined {
    const tree = embeddedEntries(doc);
    for (const entry of tree.entries) {
        if (entry.key.decodeText() !== name) continue;
        try {
            const spec = doc.context.lookup(entry.value, PDFDict);
            const streams = spec.lookup(PDFName.of('EF'), PDFDict);
            const raw = streams.get(PDFName.of('UF')) ?? streams.get(PDFName.of('F'));
            const stream = raw ? doc.context.lookup(raw) : undefined;
            if (stream instanceof PDFRawStream && stream.getContentsSize() <= 16_000_000) {
                const decoded = decodePDFRawStream(stream).decode();
                if (decoded.byteLength <= 16_000_000) return decoded;
            }
        } catch { /* An invalid manifest conveys no ownership. */ }
    }
    return undefined;
}

/** Remove exactly one attachment's entries, retaining original file specs and bytes. */
export function removeEmbeddedFile(doc: PDFDocument, name: string): void {
    const tree = embeddedEntries(doc);
    if (!tree.complete) throw new Error('The PDF attachment name tree is unreadable; save was stopped to preserve its embedded files.');
    if (!tree.root) return;
    const removed = tree.entries.filter((entry) => entry.key.decodeText() === name).map((entry) => entry.value);
    const kept = tree.entries.filter((entry) => entry.key.decodeText() !== name).sort((a, b) => a.key.decodeText() < b.key.decodeText() ? -1 : a.key.decodeText() > b.key.decodeText() ? 1 : 0);
    // pdf-lib appends new attachments to /Names. A valid flat tree also avoids
    // mixed /Kids + /Names nodes and stale limits when adding annotations.json.
    tree.root.delete(PDFName.of('Kids'));
    tree.root.delete(PDFName.of('Limits'));
    tree.root.set(PDFName.of('Names'), doc.context.obj(kept.flatMap((entry) => [entry.key, entry.value])));
    const associated = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
    if (associated && removed.length) {
        for (let i = associated.size() - 1; i >= 0; i--) {
            const object = associated.get(i);
            if (removed.some((old) => old === object || old.toString() === object.toString())) associated.remove(i);
        }
    }
}

export function readViewerManifest(doc: PDFDocument): Record<string, unknown> | undefined {
    const bytes = readEmbeddedFile(doc, VIEWER_ANNOTATIONS_FILE);
    if (!bytes) return undefined;
    try {
        const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).app === 'enhanced-pdf-viewer') return raw as Record<string, unknown>;
    } catch { /* Missing or malformed metadata cannot own existing annotations. */ }
    return undefined;
}

/** Legacy ep-* names are owned only when the viewer's manifest names that record. */
export function collectViewerOwnedNames(doc: PDFDocument): ReadonlySet<string> {
    const manifest = readViewerManifest(doc);
    const result = new Set<string>();
    const annotations = Array.isArray(manifest?.annotations) ? manifest.annotations.slice(0, 100_000) : [];
    for (const raw of annotations) {
        if (!raw || typeof raw !== 'object') continue;
        const a = raw as Record<string, unknown>;
        if (typeof a.id !== 'string' || a.id.length > 2000) continue;
        if (!a.source) for (const prefix of ['ep-', VIEWER_ANNOTATION_PREFIX]) result.add(`${prefix}${a.id}`);
        if (Array.isArray(a.replies)) for (const reply of a.replies.slice(0, 500)) {
            if (!reply || typeof reply !== 'object') continue;
            const r = reply as Record<string, unknown>;
            if (r.source || typeof r.id !== 'string' || r.id.length > 2000) continue;
            for (const prefix of ['ep-', VIEWER_ANNOTATION_PREFIX]) result.add(`${prefix}${a.id}-r-${r.id}`);
        }
    }
    const counts = new Map<string, number>();
    for (const entry of listPdfAnnotationEntries(doc)) {
        const name = pdfText(entry.dict, 'NM');
        if (name && result.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    // A name alone cannot distinguish two different annotations. Prefer
    // recovering both as source records to deleting an unrelated markup.
    for (const [name, count] of counts) if (count > 1) result.delete(name);
    return result;
}

export function isViewerOwnedAnnotation(dict: PDFDict, names: ReadonlySet<string>): boolean {
    // A marker without its review manifest can be recovered as an imported
    // markup. Hiding/removing it would lose its only surviving representation.
    return names.has(pdfText(dict, 'NM') ?? '');
}

export async function getViewerOwnedAnnotationRefs(bytes: Uint8Array): Promise<ReadonlySet<string>> {
    try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const names = collectViewerOwnedNames(doc);
        return new Set(listPdfAnnotationEntries(doc).filter((entry) => isViewerOwnedAnnotation(entry.dict, names)).map((entry) => entry.ref));
    } catch { return new Set<string>(); }
}

/** Sort after pdf-lib flushes a newly attached file into the original name tree. */
export function sortEmbeddedFileNames(doc: PDFDocument): void {
    removeEmbeddedFile(doc, '\u0000-not-a-real-attachment-name');
}
