import type { Shape } from '../../lib/types';
import { matchesDrawingScope } from '../../lib/filters';

export interface ElementOverlayProps {
    shapes: readonly Shape[];
    hoverKey: string | null;
    selectedKey: string | null;
    matchedKeys?: ReadonlySet<string> | null;
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
export function ElementOverlay({ shapes, hoverKey, selectedKey, matchedKeys, drawingIds = null }: ElementOverlayProps) {
    const scoped = shapes.filter((shape) => matchesDrawingScope(shape.drawingId, drawingIds));
    const hovered = scoped.filter((shape) => shape.elementKey === hoverKey && shape.elementKey !== selectedKey);
    const selected = scoped.filter((shape) => shape.elementKey === selectedKey);
    return (
        <g aria-hidden="true" pointerEvents="none">
            {scoped.filter((shape) => matchedKeys?.has(shape.elementKey) && shape.elementKey !== hoverKey && shape.elementKey !== selectedKey).map((shape, index) => <polygon key={`match-${index}`} points={polygonPoints(shape)} fill="var(--element-soft)" stroke="var(--element)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            {hovered.map((shape, index) => <polygon key={`hover-${index}`} points={polygonPoints(shape)} fill="var(--element-soft)" stroke="var(--element)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
            {selected.map((shape, index) => <polygon key={`selected-${index}`} points={polygonPoints(shape)} fill="var(--element-strong)" stroke="var(--element)" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
        </g>
    );
}
