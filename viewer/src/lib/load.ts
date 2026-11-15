import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createNativeTagIndexer } from './nativeTags';
import { ANNOTATIONS_FILE, parseAnnotations } from './save';
import { importPdfAnnotations } from './importPdfAnnotations';
import { getViewerOwnedAnnotationRefs } from './pdfAnnotationOwnership';
import { buildAppearances, buildDrawings, buildElements, buildParameters, buildShapes, drawingPages, geometryForPage, readTables, type Attachments } from './tables';
import type { EnhancedPdf, PageData } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Loading stages, in order. `fraction` is overall progress from 0 to 1 across all stages. */
export type LoadStage = 'reading' | 'parsing' | 'attachments' | 'tables' | 'annotations';
export type LoadProgress = { stage: LoadStage; fraction: number };

// Share of overall progress each stage covers; reading the file is usually the longest.
export const LOAD_STAGE_SPAN: Record<LoadStage, readonly [number, number]> = {
    reading: [0, 0.4],
    parsing: [0.4, 0.55],
    attachments: [0.55, 0.75],
    tables: [0.75, 0.9],
    annotations: [0.9, 1],
};

function readFile(file: File, onFraction: (f: number) => void): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (e) => { if (e.lengthComputable && e.total) onFraction(e.loaded / e.total); };
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
        reader.readAsArrayBuffer(file);
    });
}

export async function loadEnhancedPdf(file: File, onProgress?: (progress: LoadProgress) => void): Promise<EnhancedPdf> {
    const report = (stage: LoadStage, f: number) => {
        const [from, to] = LOAD_STAGE_SPAN[stage];
        onProgress?.({ stage, fraction: from + (to - from) * Math.min(1, Math.max(0, f)) });
    };
    report('reading', 0);
    const bytes = await readFile(file, (f) => report('reading', f));
    report('parsing', 0);
    // pdf.js may take over the buffer it is given, so it gets its own copy.
    // Parsing stays in the PDF worker; painting is observable by our native-path adapter.
    const loadingTask = pdfjs.getDocument({ data: bytes.slice(), disableWorkerRendering: true });
    loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => { if (total) report('parsing', loaded / total); };
    try {
        const pdf = await loadingTask.promise;
        report('attachments', 0);
        // pdf.js lists attachments by name; the bytes are fetched one at a time.
        const names = [...((await pdf.getAttachments())?.keys() ?? [])];
        let fetched = 0;
        const attachments: Attachments = new Map(
            await Promise.all(names.map(async (n) => {
                const content = (await pdf.getAttachmentContent(n)) as unknown as Uint8Array;
                report('attachments', ++fetched / names.length);
                return [n, content] as const;
            })),
        );
        report('tables', 0);
        const { tables, warnings } = await readTables(attachments, (done, total) => report('tables', done / total));

        const elements = buildElements(tables.get('elements') ?? []);
        const parameters = buildParameters(tables.get('parameters') ?? []);
        const geometry = tables.get('geometry') ?? [];
        const pagesOf = drawingPages(tables.get('drawings') ?? []);
        const drawings = buildDrawings(tables.get('drawings') ?? []);
        const appearances = buildAppearances(tables.get('appearances') ?? []);
        const indexTags = createNativeTagIndexer({ elements: tables.get('elements') ?? [], drawings: tables.get('drawings') ?? [], appearances: tables.get('appearances') ?? [] }, pdfjs.OPS);
        if (!elements.size) warnings.push('No embedded BIM element records. The PDF remains viewable; markups can be added without an element tie.');

        const cache = new Map<number, Promise<PageData>>();
        const loadPage = async (n: number): Promise<PageData> => {
            const page = await pdf.getPage(n);
            const view = page.getViewport({ scale: 1 });
            const nativeTags = indexTags(await page.getOperatorList(), n);
            const drawingIds = new Set(drawings.filter((drawing) => drawing.page === n).map((drawing) => drawing.id));
            const elementKeys = new Set(appearances.filter((appearance) => drawingIds.has(appearance.drawingId) && elements.has(appearance.elementKey)).map((appearance) => appearance.elementKey));
            const native = nativeTags.resolvedElementKeys.size > 0;
            const shapes = native ? [] : buildShapes(geometryForPage(geometry, pagesOf, n), view.height).filter((shape) => elements.has(shape.elementKey));
            return { number: n, width: view.width, height: view.height, shapes, nativeTags,
                elementKeys, geometrySource: native ? 'native' : shapes.length ? 'legacy' : 'none' };
        };

        const saved = attachments.get(ANNOTATIONS_FILE);
        const existing = saved ? parseAnnotations(saved).filter((a) => a.page <= pdf.numPages) : [];
        report('annotations', 0);
        const [importResult, ownership] = await Promise.allSettled([
            importPdfAnnotations(pdf, bytes, existing, tables, elements),
            getViewerOwnedAnnotationRefs(bytes),
        ]);
        const imported = importResult.status === 'fulfilled' ? importResult.value : null;
        if (imported) warnings.push(...imported.warnings);
        else warnings.push('Existing PDF markups could not be imported for review. Their original graphics remain in the PDF.');
        if (ownership.status === 'rejected') warnings.push('Saved viewer annotation copies could not be identified; original PDF annotations remain visible.');
        report('annotations', 1);
        return {
            fileName: file.name,
            bytes,
            pdf,
            pageCount: pdf.numPages,
            elements,
            parameters,
            drawings,
            appearances,
            savedAnnotations: imported?.annotations ?? existing,
            importedAnnotationCount: imported?.importedCount ?? 0,
            viewerOwnedAnnotationRefs: ownership.status === 'fulfilled' ? ownership.value : new Set(),
            warnings,
            dispose: () => loadingTask.destroy(),
            page: (n) => {
                let p = cache.get(n);
                if (!p) {
                    p = loadPage(n);
                    cache.set(n, p);
                }
                return p;
            },
        };
    } catch (error) {
        await loadingTask.destroy().catch(() => undefined);
        throw error;
    }
}
