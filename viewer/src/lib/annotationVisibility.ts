import { OPS } from 'pdfjs-dist';

interface Operators { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown[]> }

/**
 * Hide complete, independent annotation blocks only. The base drawing's graphics
 * state, marked content, paths, and clips are never filtered. Both rendering and
 * native capture continue to use this same complete ENABLE operator list.
 */
export function visibleAnnotationOperations(operators: Operators, hiddenIds: ReadonlySet<string>): ((index: number) => boolean) | undefined {
    if (!hiddenIds.size) return undefined;
    const hidden = new Set<number>();
    let depth = 0;
    for (let index = 0; index < operators.fnArray.length; index++) {
        const operation = operators.fnArray[index];
        if (operation === OPS.beginAnnotation) {
            const id = operators.argsArray[index]?.[0];
            if (depth || (typeof id === 'string' && hiddenIds.has(id))) { depth++; hidden.add(index); }
        } else if (operation === OPS.endAnnotation) {
            if (depth) { hidden.add(index); depth--; }
        } else if (depth) hidden.add(index);
    }
    // An unexpected incomplete block must never hide unrelated drawing content.
    if (depth || !hidden.size) return undefined;
    return (index) => !hidden.has(index);
}
