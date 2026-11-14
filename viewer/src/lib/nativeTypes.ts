/** PDF.js's public operator arrays, independent of its private argument layouts. */
export interface NativeOperatorList {
    fnArray: readonly number[];
    argsArray: readonly unknown[];
}

export interface NativeOccurrence {
    id: string;
    pageNumber: number;
    nativeElementId: string;
    viewId?: string;
    drawingId?: string;
    elementKey?: string;
    candidateKeys: readonly string[];
    status: 'resolved' | 'ambiguous' | 'unmatched';
    start: number;
    end: number;
}

export interface NativeTagIndex {
    pageNumber: number;
    operators: NativeOperatorList;
    /** Active innermost element scope at each operation. */
    active: readonly (NativeOccurrence | undefined)[];
    occurrences: readonly NativeOccurrence[];
    resolvedElementKeys: ReadonlySet<string>;
    /** Re-index the exact render list when its annotation mode differs. */
    forOperators: (operators: NativeOperatorList) => NativeTagIndex;
}
