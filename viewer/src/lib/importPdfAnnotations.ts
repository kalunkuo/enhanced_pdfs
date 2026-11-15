import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { cleanImportedSource, normalizeImportedSuggestion } from './annotationSource';
import { parsePdfDate } from './drawingComments';
import { withLinks } from './links';
import { collectViewerOwnedNames, isViewerOwnedAnnotation, listPdfAnnotationEntries } from './pdfAnnotationOwnership';
import type { Row } from './tables';
import type { Annotation, ElementInfo, ImportedAnnotationSource, Point, Reply } from './types';

const REVIEW_SUBTYPES = new Set(['Text', 'FreeText', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Line', 'Ink', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Redact']);
const POINT_LIKE = 24;
type Pdf = Pick<PDFDocumentProxy, 'getPage' | 'numPages'>;
type Entry = ReturnType<typeof listPdfAnnotationEntries>[number];
type Viewport = Pick<ReturnType<Awaited<ReturnType<Pdf['getPage']>>['getViewport']>, 'convertToViewportPoint'>;

function lookup(dict: PDFDict, key: string): PDFObject | undefined {
    try { return dict.lookup(PDFName.of(key)); } catch { return undefined; }
}
function pdfText(value: PDFObject | undefined): string | undefined {
    if (!(value instanceof PDFString) && !(value instanceof PDFHexString)) return undefined;
    try { return value.decodeText().replace(/\r\n?/g, '\n').replaceAll('\0', ''); } catch { return undefined; }
}
const string = (value: unknown): string | undefined => value === null || value === undefined || value === '' ? undefined : String(value);
const name = (value: PDFObject | undefined): string | undefined => value instanceof PDFName ? value.decodeText() : undefined;
function numbers(value: PDFObject | undefined): number[] | undefined {
    if (!(value instanceof PDFArray)) return undefined;
    const result: number[] = [];
    for (let i = 0; i < value.size(); i++) {
        const item = value.lookup(i);
        if (!(item instanceof PDFNumber) || !Number.isFinite(item.asNumber())) return undefined;
        result.push(item.asNumber());
    }
    return result;
}
function point(viewport: Viewport, x: number, y: number): Point {
    const result = viewport.convertToViewportPoint(x, y);
    if (result.length !== 2 || result.some((value) => !Number.isFinite(value))) throw new Error('Invalid annotation transform');
    return [result[0]!, result[1]!];
}

function sourceGeometry(entry: Entry, viewport: Viewport): Pick<ImportedAnnotationSource, 'bounds' | 'anchor' | 'shape'> | undefined {
    const rect = numbers(lookup(entry.dict, 'Rect'));
    if (!rect || rect.length !== 4) return undefined;
    const x0 = Math.min(rect[0]!, rect[2]!), y0 = Math.min(rect[1]!, rect[3]!);
    const x1 = Math.max(rect[0]!, rect[2]!), y1 = Math.max(rect[1]!, rect[3]!);
    const corners = [point(viewport, x0, y0), point(viewport, x0, y1), point(viewport, x1, y0), point(viewport, x1, y1)];
    const bounds = [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))] as const;
    const subtype = name(lookup(entry.dict, 'Subtype'));
    if (subtype === 'Text') return { bounds, anchor: point(viewport, x0, y1), shape: 'point' };
    if (subtype === 'Line') {
        const line = numbers(lookup(entry.dict, 'L'));
        if (line?.length === 4) {
            const ends = lookup(entry.dict, 'LE');
            const first = ends instanceof PDFArray ? name(ends.lookup(0)) : undefined;
            const last = ends instanceof PDFArray && ends.size() > 1 ? name(ends.lookup(1)) : undefined;
            const startHead = !!first && first !== 'None', endHead = !!last && last !== 'None';
            const useStart = startHead && !endHead;
            return { bounds, anchor: point(viewport, line[useStart ? 0 : 2]!, line[useStart ? 1 : 3]!), shape: 'arrow' };
        }
    }
    if (subtype === 'FreeText') {
        const callout = numbers(lookup(entry.dict, 'CL'));
        if (callout && (callout.length === 4 || callout.length === 6)) return { bounds, anchor: point(viewport, callout[0]!, callout[1]!), shape: 'arrow' };
    }
    return { bounds, anchor: point(viewport, (x0 + x1) / 2, (y0 + y1) / 2), shape: x1 - x0 < POINT_LIKE && y1 - y0 < POINT_LIKE ? 'point' : 'area' };
}

function exactId(value: unknown): string | undefined {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined;
    const text = string(value);
    if (!text || !/^-?\d+$/.test(text)) return undefined;
    try { return BigInt(text).toString(); } catch { return undefined; }
}

function pluginLinks(
    source: ImportedAnnotationSource, page: number, duplicateName: boolean,
    tables: ReadonlyMap<string, readonly Row[]>, elements: ReadonlyMap<string, ElementInfo>, warnings: Set<string>,
): { source: ImportedAnnotationSource; keys: string[] } {
    if (!source.name) return { source, keys: [] };
    if (duplicateName) {
        warnings.add('Some PDF markups share an annotation name. Their plugin links require review; the separate source markups were retained.');
        return { source, keys: [] };
    }
    const rows = (tables.get('annotations') ?? []).filter((row) => string(row.AnnotationId) === source.name && Number(row.Page) === page);
    if (rows.length !== 1) {
        if (rows.length > 1) warnings.add('Some plugin annotation rows have duplicate identities; their links require review.');
        return { source, keys: [] };
    }
    const row = rows[0]!;
    if (String(row.Status).toLowerCase() === 'deleted') {
        warnings.add('A visible PDF markup is marked deleted in the plugin tables. Its original markup was retained for review.');
        return { source, keys: [] };
    }
    if (Number(row.SchemaVersion) !== 1) {
        warnings.add('Some plugin annotations use an unsupported schema; their source markups were imported without plugin links.');
        return { source, keys: [] };
    }
    const linked = new Set<string>(), referenced = new Set<string>();
    for (const link of tables.get('annotation-links') ?? []) {
        if (string(link.AnnotationId) !== source.name) continue;
        const key = string(link.ElementKey), element = key ? elements.get(key) : undefined;
        if (!key || !element || (link.ElementId !== undefined && link.ElementId !== null && exactId(link.ElementId) !== exactId(element.elementIdText ?? element.elementId))) {
            warnings.add('Some plugin links do not match the embedded model identities and were left for review.');
            continue;
        }
        if (link.Relation === 'linked') linked.add(key);
        else if (link.Relation === 'referenced') referenced.add(key);
    }
    const drawingId = string(row.DrawingId);
    const validDrawing = drawingId && (tables.get('drawings') ?? []).some((drawing) => string(drawing.DrawingId) === drawingId && Number(drawing.Page) === page);
    return { source: { ...source, ...(validDrawing ? { drawingId } : {}),
        ...(referenced.size ? { referencedElementKeys: [...referenced] } : {}),
        ...(linked.size ? { linkState: 'linked', linkMethod: 'plugin' } : {}) }, keys: [...linked] };
}

const geometryEqual = (a: ImportedAnnotationSource, b: ImportedAnnotationSource) => a.shape === b.shape &&
    a.bounds.every((value, index) => Math.abs(value - b.bounds[index]!) < 0.001) &&
    a.anchor.every((value, index) => Math.abs(value - b.anchor[index]!) < 0.001);
const identity = (page: number, ref: string) => `${page}:${ref}`;

/**
 * Import standard review records while retaining the source annotation dictionaries and appearances.
 * Geometry is always the PDF.js scale-1 viewport; imported records never reconstruct a markup graphic.
 */
export async function importPdfAnnotations(
    pdf: Pdf, bytes: Uint8Array, existing: readonly Annotation[], tables: ReadonlyMap<string, readonly Row[]>, elements: ReadonlyMap<string, ElementInfo>,
): Promise<{ annotations: Annotation[]; importedCount: number; warnings: string[] }> {
    existing = existing.map(normalizeImportedSuggestion);
    const warnings = new Set<string>();
    let document: PDFDocument;
    try { document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
    catch { return { annotations: [...existing], importedCount: 0, warnings: ['Existing PDF markups could not be imported. Their original PDF content remains untouched.'] }; }
    const entries = listPdfAnnotationEntries(document);
    const ownedNames = new Set(collectViewerOwnedNames(document));
    // A caller may already have parsed the viewer manifest. Only exact ids establish ownership.
    for (const annotation of existing) if (!annotation.source) {
        for (const prefix of ['ep-', 'epv-']) {
            ownedNames.add(`${prefix}${annotation.id}`);
            for (const reply of annotation.replies ?? []) if (!reply.source) ownedNames.add(`${prefix}${annotation.id}-r-${reply.id}`);
        }
    }
    const byObject = new Map(entries.map((entry) => [entry.dict, entry]));
    const byRef = new Map(entries.filter((entry) => !entry.ref.startsWith('direct:')).map((entry) => [entry.ref, entry]));
    const byName = new Map<string, Entry[]>();
    const nameCounts = new Map<string, number>();
    for (const entry of entries) {
        const nm = pdfText(lookup(entry.dict, 'NM'));
        if (nm) {
            const key = identity(entry.page, nm);
            byName.set(key, [...(byName.get(key) ?? []), entry]);
            nameCounts.set(nm, (nameCounts.get(nm) ?? 0) + 1);
        }
    }
    // Parsed JSON cannot re-establish name-only ownership that the raw PDF made
    // ambiguous. Keep its viewer record and recover every colliding source.
    for (const [nm, count] of nameCounts) if (count > 1) ownedNames.delete(nm);
    const oldSources = existing.filter((annotation) => !!cleanImportedSource(annotation.source));
    const matchedOld = new Set<Annotation>();
    const annotations = existing.filter((annotation) => !annotation.source);
    const usedIds = new Set(existing.map((annotation) => annotation.id));
    const importedByEntry = new Map<Entry, Annotation>();
    const viewports = new Map<number, Viewport>();
    const renderedAnnotations = new Map<number, Promise<unknown[]>>();
    const getViewport = async (page: number) => {
        let viewport = viewports.get(page);
        if (!viewport) { viewport = (await pdf.getPage(page)).getViewport({ scale: 1 }); viewports.set(page, viewport); }
        return viewport;
    };
    const renderId = async (entry: Entry, subtype: string) => {
        if (!entry.ref.startsWith('direct:')) return entry.ref;
        let annotations = renderedAnnotations.get(entry.page);
        if (!annotations) {
            annotations = pdf.getPage(entry.page).then((page) => page.getAnnotations({ intent: 'display' }) as Promise<unknown[]>);
            renderedAnnotations.set(entry.page, annotations);
        }
        const rect = numbers(lookup(entry.dict, 'Rect'));
        const contents = pdfText(lookup(entry.dict, 'Contents'));
        const matches = (await annotations).filter((raw): raw is { id: string } => {
            if (!raw || typeof raw !== 'object') return false;
            const candidate = raw as Record<string, unknown>;
            if (candidate.subtype !== subtype || typeof candidate.id !== 'string' || !Array.isArray(candidate.rect) || candidate.rect.length !== 4 || !rect) return false;
            if (!candidate.rect.every((value, index) => typeof value === 'number' && Math.abs(value - rect[index]!) < 0.001)) return false;
            const object = candidate.contentsObj;
            const actualContents = object && typeof object === 'object' && 'str' in object ? object.str : candidate.contents;
            return contents === undefined || actualContents === contents;
        });
        if (matches.length === 1) return matches[0]!.id;
        warnings.add('A direct PDF markup could not be uniquely identified by the renderer. Its original appearance remains until the upgraded PDF is saved and reopened.');
        return undefined;
    };
    for (const entry of entries) {
        const subtype = name(lookup(entry.dict, 'Subtype'));
        if (!subtype || !REVIEW_SUBTYPES.has(subtype) || entry.dict.has(PDFName.of('IRT')) || isViewerOwnedAnnotation(entry.dict, ownedNames)) continue;
        if (entry.page < 1 || entry.page > pdf.numPages) continue;
        let geometry: ReturnType<typeof sourceGeometry>;
        try { geometry = sourceGeometry(entry, await getViewport(entry.page)); } catch { geometry = undefined; }
        if (!geometry) { warnings.add('Some existing PDF markups have no usable location. Their original annotations were preserved but cannot be linked in this viewer.'); continue; }
        const originalName = pdfText(lookup(entry.dict, 'NM')) || undefined;
        let renderedId: string | undefined;
        try { renderedId = await renderId(entry, subtype); } catch { /* A renderer lookup cannot discard the real source annotation. */ }
        let source: ImportedAnnotationSource = { ref: entry.ref, ...(renderedId ? { renderId: renderedId } : {}), ...(originalName ? { name: originalName } : {}), subtype, ...geometry, linkState: elements.size ? 'pending' : 'metadata-only' };
        const exact = oldSources.filter((annotation) => annotation.page === entry.page && annotation.source!.ref === entry.ref && annotation.source!.name === originalName);
        const named = originalName && byName.get(identity(entry.page, originalName))?.length === 1
            ? oldSources.filter((annotation) => annotation.page === entry.page && annotation.source!.name === originalName) : [];
        const previous = exact.length === 1 ? exact[0] : named.length === 1 ? named[0] : undefined;
        let id = previous?.id ?? `pdf-${entry.page}-${entry.ref}`;
        if (!previous) { let suffix = 2; while (usedIds.has(id)) id = `pdf-${entry.page}-${entry.ref}-${suffix++}`; }
        usedIds.add(id);
        const contents = pdfText(lookup(entry.dict, 'Contents'));
        const author = pdfText(lookup(entry.dict, 'T'))?.trim();
        const createdAt = parsePdfDate(pdfText(lookup(entry.dict, 'CreationDate'))), modifiedAt = parsePdfDate(pdfText(lookup(entry.dict, 'M')));
        let imported: Annotation = { id, page: entry.page, kind: 'comment', from: source.anchor, to: source.anchor, source,
            ...(contents !== undefined ? { text: contents } : {}), ...(author ? { author: { name: author.slice(0, 80) } } : {}),
            ...(createdAt ? { createdAt } : {}), ...(modifiedAt ? { modifiedAt } : {}) };
        const restored = pluginLinks(source, entry.page, !!originalName && (byName.get(identity(entry.page, originalName))?.length ?? 0) > 1, tables, elements, warnings);
        source = restored.source;
        if (previous) {
            matchedOld.add(previous);
            const old = previous.source!;
            const retainedKeys = (previous.elementKeys ?? (previous.elementKey ? [previous.elementKey] : [])).filter((key) => elements.has(key));
            // Explicit corrections win; a validated plugin link supersedes an older geometry suggestion.
            const preserve = old.linkMethod === 'manual' || (!restored.keys.length && geometryEqual(old, source));
            if (preserve) {
                source = { ...old, ...source, linkState: old.linkState, ...(old.linkMethod ? { linkMethod: old.linkMethod } : {}),
                    ...(old.suggestedElementKeys ? { suggestedElementKeys: old.suggestedElementKeys.filter((key) => elements.has(key)) } : {}),
                    ...(old.candidateKeys ? { candidateKeys: old.candidateKeys.filter((key) => elements.has(key)) } : {}) };
                imported = withLinks(imported, retainedKeys);
                if (old.linkState === 'linked' && !retainedKeys.length) {
                    source.linkState = elements.size ? 'unlinked' : 'metadata-only';
                    warnings.add('Some saved object links are absent from this PDF\'s embedded model and were left unlinked for review.');
                }
            } else if (restored.keys.length) imported = withLinks(imported, restored.keys);
            if (previous.replies?.length) imported.replies = previous.replies.filter((reply) => !reply.source || entries.some((candidate) => candidate.page === entry.page &&
                (candidate.ref === reply.source!.ref || (!!reply.source!.name && byName.get(identity(entry.page, reply.source!.name))?.length === 1 && pdfText(lookup(candidate.dict, 'NM')) === reply.source!.name))));
        } else if (restored.keys.length) imported = withLinks(imported, restored.keys);
        imported = normalizeImportedSuggestion({ ...imported, source });
        annotations.push(imported);
        importedByEntry.set(entry, imported);
    }
    for (const entry of entries) {
        if (!entry.dict.has(PDFName.of('IRT')) || isViewerOwnedAnnotation(entry.dict, ownedNames)) continue;
        const parentObject = lookup(entry.dict, 'IRT');
        let parent = byObject.get(parentObject as PDFDict);
        const rawParent = entry.dict.get(PDFName.of('IRT'));
        if (!parent && rawParent instanceof PDFRef) parent = byRef.get(`${rawParent.objectNumber}R${rawParent.generationNumber || ''}`);
        const visited = new Set<Entry>([entry]);
        while (parent && !importedByEntry.has(parent) && !visited.has(parent)) {
            visited.add(parent);
            const next = lookup(parent.dict, 'IRT');
            parent = next instanceof PDFDict ? byObject.get(next) : undefined;
        }
        const root = parent && !visited.has(parent) ? importedByEntry.get(parent) : undefined;
        const contents = pdfText(lookup(entry.dict, 'Contents'));
        if (!root || root.page !== entry.page || !contents?.trim()) {
            if (contents?.trim()) warnings.add('Some PDF replies could not be attached to a supported parent markup. Their original PDF annotations were preserved.');
            continue;
        }
        const nm = pdfText(lookup(entry.dict, 'NM')) || undefined;
        let renderedId: string | undefined;
        const subtype = name(lookup(entry.dict, 'Subtype'));
        try { if (subtype) renderedId = await renderId(entry, subtype); } catch { /* Native reply provenance survives a renderer lookup failure. */ }
        const sourceRef = { ref: entry.ref, ...(nm ? { name: nm } : {}), ...(renderedId ? { renderId: renderedId } : {}) };
        const previousReply = root.replies?.find((reply) => (reply.source?.ref === entry.ref && reply.source?.name === nm) ||
            (nm && byName.get(identity(entry.page, nm))?.length === 1 && reply.source?.name === nm));
        const reply: Reply = { id: previousReply?.id ?? `pdf-reply-${entry.page}-${entry.ref}`, text: contents,
            author: { name: pdfText(lookup(entry.dict, 'T'))?.trim().slice(0, 80) || 'Unknown author' },
            createdAt: parsePdfDate(pdfText(lookup(entry.dict, 'CreationDate'))) ?? '', source: sourceRef };
        root.replies = [...(root.replies ?? []).filter((item) => item !== previousReply), reply];
    }
    for (const annotation of importedByEntry.values()) if (annotation.replies?.length) annotation.replies.sort((a, b) => {
        const aTime = Date.parse(a.createdAt), bTime = Date.parse(b.createdAt);
        return Number.isFinite(aTime) ? Number.isFinite(bTime) ? aTime - bTime : -1 : Number.isFinite(bTime) ? 1 : 0;
    });
    if (oldSources.some((annotation) => !matchedOld.has(annotation))) warnings.add('A previously imported markup is no longer present in the PDF. Its stale review record was omitted.');
    return { annotations, importedCount: importedByEntry.size, warnings: [...warnings] };
}
