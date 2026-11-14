import { useEffect, useRef } from 'react';
import type { NativeGeometry, NativePaintPart } from '../../lib/nativeGeometry';
import { matchesDrawingScope } from '../../lib/filters';

export interface NativeElementOverlayProps {
    geometry: NativeGeometry | null;
    pageNumber: number;
    zoom: number;
    width: number;
    height: number;
    hoverKey: string | null;
    selectedKey: string | null;
    matchedKeys: ReadonlySet<string> | null;
    drawingIds?: ReadonlySet<string> | null;
}

/** Native paint emphasis is independent of base rendering and markup hit targets. */
export function NativeElementOverlay({ geometry, pageNumber, zoom, width, height, hoverKey, selectedKey, matchedKeys, drawingIds = null }: NativeElementOverlayProps) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = Math.max(1, width * zoom), cssHeight = Math.max(1, height * zoom);
        // Do not allocate an unbounded second full-page raster at high zoom.
        const reduction = Math.min(1, Math.sqrt(16_000_000 / (cssWidth * cssHeight * dpr * dpr)));
        canvas.width = Math.max(1, Math.ceil(cssWidth * dpr * reduction));
        canvas.height = Math.max(1, Math.ceil(cssHeight * dpr * reduction));
        const context = canvas.getContext('2d');
        if (!context || !geometry || geometry.presentation.pageNumber !== pageNumber) return;
        const xScale = canvas.width / width, yScale = canvas.height / height;
        const computedStyle = getComputedStyle(canvas);
        const color = computedStyle.getPropertyValue('--element').trim() || computedStyle.color;
        const setTransform = (transform: NativePaintPart['toPage']) => context.setTransform(
            xScale * transform[0], yScale * transform[1], xScale * transform[2], yScale * transform[3], xScale * transform[4], yScale * transform[5],
        );
        for (const part of geometry.parts) {
            if (!matchesDrawingScope(part.drawingId, drawingIds)) continue;
            const selected = part.elementKey === selectedKey;
            const hovered = part.elementKey === hoverKey;
            if (!selected && !hovered && !matchedKeys?.has(part.elementKey)) continue;
            context.save();
            for (const clip of part.clips) { setTransform(clip.toPage); context.clip(clip.path, clip.rule); }
            setTransform(part.toPage);
            context.strokeStyle = color;
            context.fillStyle = color;
            context.globalAlpha = part.mode === 'fill' ? selected ? 0.28 : hovered ? 0.2 : 0.12 : selected ? 0.95 : hovered ? 0.8 : 0.55;
            const pageToLocalScale = Math.max(Math.hypot(part.fromPage[0], part.fromPage[1]), Math.hypot(part.fromPage[2], part.fromPage[3]));
            const halo = (selected ? 4 : hovered ? 3 : 2) / zoom * pageToLocalScale;
            context.lineWidth = part.stroke.width + halo;
            context.lineCap = part.stroke.cap;
            context.lineJoin = part.stroke.join;
            context.miterLimit = part.stroke.miterLimit;
            context.setLineDash([...part.stroke.dash]);
            context.lineDashOffset = part.stroke.dashOffset;
            if (part.mode === 'fill') context.fill(part.path, part.rule);
            else context.stroke(part.path);
            context.restore();
        }
    }, [geometry, pageNumber, zoom, width, height, hoverKey, selectedKey, matchedKeys, drawingIds]);
    return <canvas ref={ref} aria-hidden="true" style={{ pointerEvents: 'none' }} />;
}
