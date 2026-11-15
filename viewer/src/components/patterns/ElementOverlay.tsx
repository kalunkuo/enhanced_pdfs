import type { Shape } from '../../lib/types';
import { matchesDrawingScope } from '../../lib/filters';

export interface ElementOverlayProps {
    shapes: readonly Shape[];
    hoverKey: string | null;
    selectedKeys: ReadonlySet<string> | null;
    matchedKeys?: ReadonlySet<string> | null;
    elementColors?: ReadonlyMap<string, string> | null;
    drawingIds?: ReadonlySet<string> | null;
}

function polygonPoints(shape: Shape): string {
    const points = shape.outline ?? [
        [shape.bbox[0], shape.bbox[1]], [shape.bbox[2], shape.bbox[1]],
        [shape.bbox[2], shape.bbox[3]], [shape.bbox[0], shape.bbox[3]],
    ];
    return points.map((point) => point.join(',')).join(' ');
}

/** Presentation only. The shared picker owns interaction. */
export function ElementOverlay({ shapes, hoverKey, selectedKeys, matchedKeys, elementColors, drawingIds = null }: ElementOverlayProps) {
    const scoped = shapes.filter((shape) => matchesDrawingScope(shape.drawingId, drawingIds));
    const hovered = scoped.filter((shape) => shape.elementKey === hoverKey && !selectedKeys?.has(shape.elementKey));
    const selected = scoped.filter((shape) => !!selectedKeys?.has(shape.elementKey));
    return (
        <g aria-hidden="true" pointerEvents="none">
            {scoped.filter((shape) => elementColors?.has(shape.elementKey) && !selectedKeys?.has(shape.elementKey)).map((shape, index) => <polygon key={`agent-${index}`} points={polygonPoints(shape)} fill={elementColors!.get(shape.elementKey)} fillOpacity={0.24} stroke={elementColors!.get(shape.elementKey)} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />)}
            {scoped.filter((shape) => matchedKeys?.has(shape.elementKey) && !elementColors?.has(shape.elementKey) && shape.elementKey !== hoverKey && !selectedKeys?.has(shape.elementKey)).map((shape, index) => <polygon key={`match-${index}`} points={polygonPoints(shape)} fill="var(--color-geometry-highlight-soft)" stroke="var(--color-geometry-highlight)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            {hovered.map((shape, index) => <polygon key={`hover-${index}`} points={polygonPoints(shape)} fill="var(--color-geometry-highlight-soft)" stroke="var(--color-geometry-highlight)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
            {selected.map((shape, index) => <polygon key={`selected-${index}`} points={polygonPoints(shape)} fill="var(--color-selection-strong)" stroke="var(--color-selection)" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
        </g>
    );
}
