import { OPS } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { visibleAnnotationOperations } from '../src/lib/annotationVisibility';

describe('selective source annotation rendering', () => {
    const operators = {
        fnArray: [OPS.save, OPS.transform, OPS.restore, OPS.beginAnnotation, OPS.save, OPS.transform, OPS.restore, OPS.endAnnotation, OPS.beginAnnotation, OPS.save, OPS.restore, OPS.endAnnotation],
        argsArray: [[], [], [], ['10R'], [], [], [], [], ['20R'], [], [], []],
    };
    it('keeps the original drawing and foreign markup while hiding one complete viewer copy', () => {
        const visible = visibleAnnotationOperations(operators, new Set(['10R']))!;
        expect(operators.fnArray.map((_, index) => visible(index))).toEqual([true, true, true, false, false, false, false, false, true, true, true, true]);
    });
    it('does not infer ownership from names or hide unmatched source annotations', () => {
        expect(visibleAnnotationOperations(operators, new Set(['ep-foreign']))).toBeUndefined();
        expect(visibleAnnotationOperations(operators, new Set())).toBeUndefined();
    });
    it('fails open when an independent annotation block is incomplete', () => {
        expect(visibleAnnotationOperations({ fnArray: [OPS.beginAnnotation, OPS.save], argsArray: [['10R'], []] }, new Set(['10R']))).toBeUndefined();
    });
});
