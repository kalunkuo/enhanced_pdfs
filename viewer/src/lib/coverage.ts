import type { NativeGeometry } from './nativeGeometry';
import type { NativeTagIndex } from './nativeTypes';
import type { ElementInfo, Shape } from './types';
import { matchesDrawingScope } from './filters';

export type LocationStatus = 'ready' | 'partial' | 'mapping' | 'ambiguous' | 'unsupported' | 'metadata-only' | 'legacy';

export const LOCATION_LABELS: Record<LocationStatus, string> = {
    ready: 'Located on this page',
    partial: 'Located; some graphics unsupported',
    mapping: 'Preparing page geometry',
    ambiguous: 'Ambiguous model identity',
    unsupported: 'Drawing graphics unsupported',
    'metadata-only': 'No mapped graphics on this page',
    legacy: 'Located by attached demo geometry',
};

/** Metadata stays inspectable even when no reliable drawing location exists. */
export function elementLocations(elements: readonly ElementInfo[], source: NativeTagIndex | undefined, geometry: NativeGeometry | null, shapes: readonly Shape[], drawingIds: ReadonlySet<string> | null = null): ReadonlyMap<string, LocationStatus> {
    const resolved = drawingIds
        ? new Set(source?.occurrences.filter((occurrence) => occurrence.status === 'resolved' && matchesDrawingScope(occurrence.drawingId, drawingIds)).flatMap((occurrence) => occurrence.elementKey ? [occurrence.elementKey] : []))
        : source?.resolvedElementKeys ?? new Set<string>();
    const located = drawingIds && geometry ? new Set(geometry.parts.filter((part) => matchesDrawingScope(part.drawingId, drawingIds)).map((part) => part.elementKey)) : geometry?.elementKeys;
    const ambiguous = new Set(source?.occurrences.filter((occurrence) => occurrence.status === 'ambiguous').flatMap((occurrence) => [...occurrence.candidateKeys]));
    const legacy = new Set(shapes.filter((shape) => matchesDrawingScope(shape.drawingId, drawingIds)).map((shape) => shape.elementKey));
    return new Map(elements.map((element) => {
        let status: LocationStatus = 'metadata-only';
        if (located?.has(element.key)) status = geometry!.unsupportedElementKeys.has(element.key) ? 'partial' : 'ready';
        else if (resolved.has(element.key)) status = geometry ? 'unsupported' : 'mapping';
        else if (ambiguous.has(element.key)) status = 'ambiguous';
        else if (legacy.has(element.key)) status = 'legacy';
        return [element.key, status];
    }));
}
