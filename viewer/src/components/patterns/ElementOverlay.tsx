import type { Shape } from '../../lib/types';

export interface ElementOverlayProps {
    shapes: readonly Shape[];
    hoverKey: string | null;
    selectedKey: string | null;
}

function polygonPoints(shape: Shape): string {
    const points = shape.outline ?? [
        [shape.bbox[0], shape.bbox[1]], [shape.bbox[2], shape.bbox[1]],
        [shape.bbox[2], shape.bbox[3]], [shape.bbox[0], shape.bbox[3]],
    ];
    return points.map((point) => point.join(',')).join(' ');
}

/** Presentation only. The shared picker owns interaction. */
export function ElementOverlay({ shapes, hoverKey, selectedKey }: ElementOverlayProps) {
    const hovered = shapes.find((shape) => shape.elementKey === hoverKey);
    const selected = shapes.find((shape) => shape.elementKey === selectedKey);
    return (
        <g aria-hidden="true" pointerEvents="none">
            {hovered && hovered !== selected && <polygon points={polygonPoints(hovered)} fill="var(--element-soft)" stroke="var(--element)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
            {selected && <polygon points={polygonPoints(selected)} fill="var(--element-strong)" stroke="var(--element)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        </g>
    );
}
