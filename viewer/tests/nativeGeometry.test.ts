import { createCanvas, Path2D as NativePath2D } from '@napi-rs/canvas';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { contextToPage, createNativeGeometryCapture, transformedBounds, type NativeGeometry } from '../src/lib/nativeGeometry';
import type { NativeOperatorList, NativeOccurrence, NativeTagIndex } from '../src/lib/nativeTypes';
import type { Matrix, PagePresentation, RenderCapture, RenderCaptureFrame } from '../src/lib/presentation';

vi.mock('pdfjs-dist', () => ({ OPS: { constructPath: 91 } }));
beforeAll(() => vi.stubGlobal('Path2D', NativePath2D));

function presentation(zoom = 1, dpr = 1): PagePresentation {
    return {
        pageNumber: 1, generation: 1, pageBox: [0, 0, 100, 100], rotation: 0, userUnit: 1,
        pageWidth: 100, pageHeight: 100, cssWidth: 100 * zoom, cssHeight: 100 * zoom,
        zoom, outputScale: { x: dpr, y: dpr },
        pdfToPage: [1, 0, 0, 1, 0, 0], pageToPdf: [1, 0, 0, 1, 0, 0],
        pdfToCss: [zoom, 0, 0, zoom, 0, 0], cssToPdf: [1 / zoom, 0, 0, 1 / zoom, 0, 0],
        pageToCss: [zoom, 0, 0, zoom, 0, 0], cssToPage: [1 / zoom, 0, 0, 1 / zoom, 0, 0],
    };
}

const occurrence = (key = 'wall', id = 'group-1'): NativeOccurrence => ({ id, pageNumber: 1, nativeElementId: '676281', viewId: 'view', drawingId: 'drawing', elementKey: key, candidateKeys: [key], status: 'resolved', start: 0, end: 1 });

async function capture(bounds: readonly (readonly number[] | undefined)[], occurrences?: NativeOccurrence[], view = presentation()) {
    const groups = occurrences ?? bounds.map(() => occurrence());
    const operators: NativeOperatorList = { fnArray: bounds.map(() => 91), argsArray: bounds.map((box) => [20, [], box ? new Float32Array(box) : undefined]) };
    const source: NativeTagIndex = {
        pageNumber: 1, operators, active: groups, occurrences: groups,
        resolvedElementKeys: new Set(groups.map((group) => group.elementKey!)), forOperators: vi.fn(() => source),
    };
    const context = createCanvas(1, 1).getContext('2d') as unknown as CanvasRenderingContext2D;
    context.setTransform(view.outputScale.x * view.zoom, 0, 0, view.outputScale.y * view.zoom, 0, 0);
    context.lineWidth = 1;
    const controller = new AbortController();
    let geometry: NativeGeometry | undefined;
    const frame = {
        pdfPage: { getOperatorList: vi.fn(async () => operators) }, presentation: view, context,
        signal: controller.signal, annotationMode: 2,
    } as unknown as RenderCaptureFrame;
    const session = await createNativeGeometryCapture(source, (result) => { geometry = result; })(frame) as RenderCapture;
    return { source, frame, session, context: session.context!, controller, finish: async () => { await session.onComplete?.(); return geometry!; } };
}

function line(x0: number, y0: number, x1: number, y1: number): Path2D {
    const path = new NativePath2D(); path.moveTo(x0, y0); path.lineTo(x1, y1);
    return path as unknown as Path2D;
}

describe('native painted geometry', () => {
    it('keeps the eight Snowdon wall strokes and rejects the opening inside their bounding box', async () => {
        const segments = [
            [-123.71069, 406.42633, -123.71069, 386.12946], [-123.71069, 356.12946, -123.71069, 353.12946],
            [-114.24194, 348.25446, -114.24194, 356.12946], [-114.24194, 386.12946, -114.24194, 386.55133],
            [-123.71069, 356.12946, -114.24194, 356.12946], [-123.71069, 386.12946, -114.24194, 386.12946],
            [-123.71069, 343.66071, -114.24194, 343.66071], [-123.71069, 406.42633, -114.24194, 406.42633],
        ] as const;
        const boxes = segments.map(([x0, y0, x1, y1]) => [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]);
        const test = await capture(boxes);
        test.context.lineWidth = 1.29601;
        segments.forEach((points, index) => { test.session.onOperation!(index); test.context.stroke(line(points[0], points[1], points[2], points[3])); });
        const geometry = await test.finish();
        expect(geometry.parts).toHaveLength(8);
        expect(geometry.pick([-123.71069, 396], 0)[0]?.elementKey).toBe('wall');
        expect(geometry.pick([-123.71069, 371], 4)).toEqual([]);
        expect(geometry.appearanceIds.size).toBe(1);
        expect(geometry.source).toBe(test.source);
    });

    it('honors evenodd holes rather than making the outer bounds clickable', async () => {
        const test = await capture([[0, 0, 20, 20]]);
        const path = new NativePath2D(); path.rect(0, 0, 20, 20); path.rect(5, 5, 10, 10);
        test.session.onOperation!(0); test.context.fill(path as unknown as Path2D, 'evenodd');
        const geometry = await test.finish();
        expect(geometry.pick([2, 2], 0)[0]?.elementKey).toBe('wall');
        expect(geometry.pick([10, 10], 4)).toEqual([]);
    });

    it('honors clipping and restores the earlier clip when canvas state is restored', async () => {
        const test = await capture([[0, 10, 20, 10], [0, 15, 20, 15]]);
        const clip = new NativePath2D(); clip.rect(0, 0, 10, 20);
        test.context.save(); test.context.clip(clip as unknown as Path2D);
        test.session.onOperation!(0); test.context.stroke(line(0, 10, 20, 10));
        test.context.restore();
        test.session.onOperation!(1); test.context.stroke(line(0, 15, 20, 15));
        const geometry = await test.finish();
        expect(geometry.pick([5, 10], 0)).toHaveLength(1);
        expect(geometry.pick([15, 10], 0)).toEqual([]);
        expect(geometry.pick([15, 15], 0)).toHaveLength(1);
    });

    it('uses paint order and preserves overlapping appearances for cycling', async () => {
        const test = await capture([[0, 5, 20, 5], [0, 5, 20, 5]], [occurrence('back', 'b'), occurrence('front', 'f')]);
        for (let index = 0; index < 2; index++) { test.session.onOperation!(index); test.context.stroke(line(0, 5, 20, 5)); }
        expect((await test.finish()).pick([10, 5], 0).map((hit) => hit.elementKey)).toEqual(['front', 'back']);
    });

    it('records presentation-effective stroke width and keeps hit tolerance independent of DPR', async () => {
        const test = await capture([[0, 10, 20, 10]], undefined, presentation(0.5, 2));
        test.context.lineWidth = 2;
        test.session.onOperation!(0); test.context.stroke(line(0, 10, 20, 10));
        const geometry = await test.finish();
        expect(geometry.parts[0]?.stroke.width).toBe(2);
        expect(geometry.pick([10, 13], 0)).toEqual([]);
        expect(geometry.pick([10, 13], 3)).toHaveLength(1);
        expect(test.frame.pdfPage.getOperatorList).toHaveBeenCalledWith({ annotationMode: 2 });
    });

    it('reports unsupported paint rather than inventing geometry when bounds are unavailable', async () => {
        const test = await capture([undefined]);
        test.session.onOperation!(0); test.context.stroke(line(0, 10, 20, 10));
        const geometry = await test.finish();
        expect(geometry.parts).toEqual([]);
        expect(geometry.unsupportedElementKeys.has('wall')).toBe(true);
        expect(geometry.unsupportedPaints).toBe(1);
        expect(geometry.pick([10, 10], 4)).toEqual([]);
    });

    it('does not publish an aborted render', async () => {
        const test = await capture([[0, 10, 20, 10]]);
        test.session.onOperation!(0); test.context.stroke(line(0, 10, 20, 10));
        test.controller.abort();
        expect(await test.finish()).toBeUndefined();
    });
});

describe('native page-space helpers', () => {
    it('removes only the backing scale and zoom, retaining the negative page origin', () => {
        const matrix: Matrix = [1, 0, 0, -1, 1512.12, 1080];
        expect(contextToPage(matrix, { zoom: 0.5, outputScale: { x: 2, y: 2 } })).toEqual(matrix);
        expect(transformedBounds([-10, 20, 10, 40], matrix)).toEqual([1502.12, 1040, 1522.12, 1060]);
    });
});
