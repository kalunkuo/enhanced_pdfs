import type { Shape } from '../../lib/types';
import { matchesDrawingScope } from '../../lib/filters';

export interface ElementOverlayProps {
    shapes: readonly Shape[];
    hoverKey: string | null;
    previewKeys?: ReadonlySet<string> | null;
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
export function ElementOverlay({ shapes, hoverKey, previewKeys, selectedKeys, matchedKeys, elementColors, drawingIds = null }: ElementOverlayProps) {
    const scoped = shapes.filter((shape) => matchesDrawingScope(shape.drawingId, drawingIds));
    const isSelected = (key: string) => !!selectedKeys?.has(key);
    const isHovered = (key: string) => key === hoverKey || !!previewKeys?.has(key);
    const hovered = scoped.filter((shape) => isHovered(shape.elementKey));
    const selected = scoped.filter((shape) => isSelected(shape.elementKey));
    return (
        <g aria-hidden="true" pointerEvents="none">
            {scoped.filter((shape) => elementColors?.has(shape.elementKey) && !isSelected(shape.elementKey)).map((shape, index) => <polygon key={`agent-${index}`} points={polygonPoints(shape)} fill={elementColors!.get(shape.elementKey)} fillOpacity={0.24} stroke={elementColors!.get(shape.elementKey)} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />)}
            {scoped.filter((shape) => matchedKeys?.has(shape.elementKey) && !elementColors?.has(shape.elementKey) && !isHovered(shape.elementKey) && !isSelected(shape.elementKey)).map((shape, index) => <polygon key={`match-${index}`} points={polygonPoints(shape)} fill="var(--color-geometry-highlight-soft)" stroke="var(--color-geometry-highlight)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            {selected.filter((shape) => !isHovered(shape.elementKey)).map((shape, index) => <polygon key={`selected-${index}`} points={polygonPoints(shape)} fill={elementColors?.get(shape.elementKey) ?? 'var(--color-selection-strong)'} fillOpacity={elementColors?.has(shape.elementKey) ? 0.28 : undefined} stroke={elementColors?.get(shape.elementKey) ?? 'var(--color-selection)'} strokeWidth={elementColors?.has(shape.elementKey) ? 3 : 2} vectorEffect="non-scaling-stroke" />)}
            {hovered.map((shape, index) => <polygon key={`hover-${index}`} points={polygonPoints(shape)} fill="var(--color-hover-strong)" stroke="var(--color-hover)" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
        </g>
    );
}
