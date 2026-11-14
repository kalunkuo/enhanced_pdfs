import type { NativeOccurrence, NativeOperatorList, NativeTagIndex } from './nativeTypes';
import { buildAppearances, buildDrawings, type Row } from './tables';

export interface NativeTagOps {
    beginMarkedContent: number;
    beginMarkedContentProps: number;
    endMarkedContent: number;
}

export interface NativeTagMetadata {
    elements: readonly Row[];
    drawings: readonly Row[];
    appearances: readonly Row[];
}

/** IDs are identifiers, not arithmetic values. Reject already-rounded unsafe numbers. */
function integerId(value: unknown): string | undefined {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : undefined;
    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return undefined;
    return BigInt(value).toString();
}

function name(value: unknown): string | undefined {
    const raw = typeof value === 'string' ? value : value && typeof value === 'object' && 'name' in value ? value.name : undefined;
    return typeof raw === 'string' ? raw.replace(/^\//, '') : undefined;
}

interface Scope { viewId?: string; occurrence?: NativeOccurrence }

/** Build metadata indexes once, then index each page's actual optimized operator list. */
export function createNativeTagIndexer(metadata: NativeTagMetadata, ops: NativeTagOps) {
    const elementsById = new Map<string, Set<string>>();
    for (const row of metadata.elements) {
        const id = integerId(row.ElementId);
        const key = typeof row.ElementKey === 'string' ? row.ElementKey : undefined;
        if (!id || !key) continue;
        const keys = elementsById.get(id) ?? new Set<string>();
        keys.add(key);
        elementsById.set(id, keys);
    }
    const drawings = buildDrawings(metadata.drawings);
    const members = new Map<string, Set<string>>();
    for (const appearance of buildAppearances(metadata.appearances)) {
        const keys = members.get(appearance.drawingId) ?? new Set<string>();
        keys.add(appearance.elementKey);
        members.set(appearance.drawingId, keys);
    }

    function resolve(nativeElementId: string, viewId: string | undefined, pageNumber: number) {
        const possibleKeys = elementsById.get(nativeElementId) ?? new Set<string>();
        const pairs = new Map<string, { drawingId: string; elementKey: string }>();
        for (const drawing of drawings) {
            if (drawing.page !== pageNumber || (viewId !== undefined && integerId(drawing.viewId) !== viewId)) continue;
            for (const elementKey of possibleKeys) {
                if (members.get(drawing.id)?.has(elementKey)) pairs.set(`${drawing.id}\u0000${elementKey}`, { drawingId: drawing.id, elementKey });
            }
        }
        const candidates = [...pairs.values()];
        const selected = candidates.length === 1 ? candidates[0] : undefined;
        return {
            status: (selected ? 'resolved' : candidates.length > 1 ? 'ambiguous' : 'unmatched') as NativeOccurrence['status'],
            candidateKeys: [...new Set(candidates.map((candidate) => candidate.elementKey))],
            elementKey: selected?.elementKey,
            drawingId: selected?.drawingId,
        };
    }

    function index(operators: NativeOperatorList, pageNumber: number): NativeTagIndex {
        const scopes: Scope[] = [];
        const occurrences: NativeOccurrence[] = [];
        const active: (NativeOccurrence | undefined)[] = [];
        const currentElement = () => scopes.findLast((scope) => scope.occurrence)?.occurrence;
        for (let operation = 0; operation < operators.fnArray.length; operation++) {
            const opcode = operators.fnArray[operation];
            if (opcode === ops.beginMarkedContent || opcode === ops.beginMarkedContentProps) {
                const args = operators.argsArray[operation];
                const tag = name(Array.isArray(args) ? args[0] : undefined);
                const viewMatch = tag?.match(/^ViewRegion(-?\d+)(?:-.*)?$/);
                const elementMatch = tag?.match(/^Element(-?\d+)$/);
                const scope: Scope = {};
                if (viewMatch) scope.viewId = integerId(viewMatch[1]);
                if (elementMatch) {
                    const nativeElementId = integerId(elementMatch[1])!;
                    const viewId = scopes.findLast((ancestor) => ancestor.viewId !== undefined)?.viewId;
                    const occurrence: NativeOccurrence = {
                        id: `page-${pageNumber}/op-${operation}`, pageNumber, nativeElementId, viewId,
                        ...resolve(nativeElementId, viewId, pageNumber), start: operation, end: operation,
                    };
                    scope.occurrence = occurrence;
                    occurrences.push(occurrence);
                }
                scopes.push(scope);
            }
            active.push(currentElement());
            if (opcode === ops.endMarkedContent) {
                const closed = scopes.pop();
                if (closed?.occurrence) closed.occurrence.end = operation;
            }
        }
        // Malformed, unclosed groups are inspectable but cannot claim authoritative identity.
        for (const scope of scopes) {
            if (!scope.occurrence) continue;
            scope.occurrence.end = Math.max(scope.occurrence.start, operators.fnArray.length - 1);
            scope.occurrence.status = 'unmatched';
            scope.occurrence.elementKey = undefined;
            scope.occurrence.drawingId = undefined;
        }
        const result: NativeTagIndex = {
            pageNumber, operators, active, occurrences,
            resolvedElementKeys: new Set(occurrences.flatMap((occurrence) => occurrence.elementKey ? [occurrence.elementKey] : [])),
            forOperators: (next) => next === operators ? result : index(next, pageNumber),
        };
        return result;
    }
    return index;
}
