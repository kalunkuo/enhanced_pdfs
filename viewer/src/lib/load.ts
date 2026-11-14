import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createNativeTagIndexer } from './nativeTags';
import { ANNOTATIONS_FILE, parseAnnotations } from './save';
import { buildAppearances, buildDrawings, buildElements, buildParameters, buildShapes, drawingPages, geometryForPage, readTables, type Attachments } from './tables';
import type { EnhancedPdf, PageData } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function loadEnhancedPdf(file: File): Promise<EnhancedPdf> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // pdf.js may take over the buffer it is given, so it gets its own copy.
    // Parsing stays in the PDF worker; painting is observable by our native-path adapter.
    const loadingTask = pdfjs.getDocument({ data: bytes.slice(), disableWorkerRendering: true });
    try {
        const pdf = await loadingTask.promise;
        // pdf.js lists attachments by name; the bytes are fetched one at a time.
        const names = [...((await pdf.getAttachments())?.keys() ?? [])];
        const attachments: Attachments = new Map(
            await Promise.all(names.map(async (n) => [n, (await pdf.getAttachmentContent(n)) as unknown as Uint8Array] as const)),
        );
        const { tables, warnings } = await readTables(attachments);

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
        return {
            fileName: file.name,
            bytes,
            pdf,
            pageCount: pdf.numPages,
            elements,
            parameters,
            drawings,
            appearances,
            savedAnnotations: saved ? parseAnnotations(saved).filter((a) => a.page <= pdf.numPages) : [],
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
