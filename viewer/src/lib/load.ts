import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PLACEHOLDER_TYPE_PARAMETERS, detectWallShapes, placeholderWall } from './placeholderWalls';
import { ANNOTATIONS_FILE, parseAnnotations } from './save';
import { buildElements, buildParameters, buildShapes, drawingPages, geometryForPage, readTables, type Attachments } from './tables';
import type { EnhancedPdf, PageData } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function loadEnhancedPdf(file: File): Promise<EnhancedPdf> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // pdf.js may take over the buffer it is given, so it gets its own copy.
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
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
    const usePlaceholders = geometry.length === 0;

    if (usePlaceholders) {
        const why = tables.has('elements')
            ? 'No geometry table yet, so Revit elements cannot be located on the drawing.'
            : 'No Revit data in this PDF.';
        warnings.push(`${why} Hovering shows placeholder walls detected from the drawing; their data is made up.`);
    }

    const cache = new Map<number, Promise<PageData>>();
    const loadPage = async (n: number): Promise<PageData> => {
        const page = await pdf.getPage(n);
        const view = page.getViewport({ scale: 1 });
        if (!usePlaceholders) {
            return { number: n, width: view.width, height: view.height, shapes: buildShapes(geometryForPage(geometry, pagesOf, n), view.height) };
        }
        // PLACEHOLDER: no geometry table yet, so guess walls from the drawing and give them made-up data.
        const walls = detectWallShapes(
            await page.getOperatorList(),
            pdfjs.OPS as unknown as Record<string, number>,
            (x, y) => {
                const [px, py] = view.convertToViewportPoint(x, y);
                return [px, py];
            },
            n,
        );
        walls.forEach((_, i) => {
            const w = placeholderWall(i, n);
            elements.set(w.element.key, w.element);
            parameters.set(w.element.key, w.parameters);
        });
        parameters.set('placeholder-wall-type', PLACEHOLDER_TYPE_PARAMETERS);
        return { number: n, width: view.width, height: view.height, shapes: walls };
    };

    const saved = attachments.get(ANNOTATIONS_FILE);
    return {
        fileName: file.name,
        bytes,
        pdf,
        pageCount: pdf.numPages,
        elements,
        parameters,
        savedAnnotations: saved ? parseAnnotations(saved).filter((a) => a.page <= pdf.numPages) : [],
        warnings,
        page: (n) => {
            let p = cache.get(n);
            if (!p) {
                p = loadPage(n);
                cache.set(n, p);
            }
            return p;
        },
    };
}
