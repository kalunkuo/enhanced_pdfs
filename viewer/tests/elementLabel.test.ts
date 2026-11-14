import { describe, expect, it } from 'vitest';
import { elementIdOf, elementLabel, singularCategory } from '../src/lib/elementLabel';

describe('singularCategory', () => {
    it('turns Revit category names into the type of one object', () => {
        expect(singularCategory('Walls')).toBe('Wall');
        expect(singularCategory('Windows')).toBe('Window');
        expect(singularCategory('Doors')).toBe('Door');
        expect(singularCategory('Floors')).toBe('Floor');
        expect(singularCategory('Structural Columns')).toBe('Structural Column');
        expect(singularCategory('Curtain Panels')).toBe('Curtain Panel');
        expect(singularCategory('Generic Models')).toBe('Generic Model');
        expect(singularCategory('Plumbing Fixtures')).toBe('Plumbing Fixture');
    });
    it('handles -ies, -es and words that only look plural', () => {
        expect(singularCategory('Ceilings')).toBe('Ceiling');
        expect(singularCategory('Stairs')).toBe('Stair');
        expect(singularCategory('Entries')).toBe('Entry');
        expect(singularCategory('Branches')).toBe('Branch');
        expect(singularCategory('Mass')).toBe('Mass');
        expect(singularCategory('Casework')).toBe('Casework');
        expect(singularCategory('Furniture')).toBe('Furniture');
        expect(singularCategory('Glass')).toBe('Glass');
    });
    it('leaves an already singular or empty name alone', () => {
        expect(singularCategory('Wall')).toBe('Wall');
        expect(singularCategory('  ')).toBe('');
    });
});

describe('elementLabel', () => {
    const wall = { category: 'Walls', name: 'Basic Wall: Exterior - 2HR Stud-MTL', elementId: 51, elementIdText: undefined };
    it('is the type then the ID, never the family or type name', () => {
        expect(elementLabel(wall)).toBe('Wall 51');
        expect(elementLabel({ ...wall, category: 'Windows', name: 'Fixed: 0915 x 1220mm', elementId: 7 })).toBe('Window 7');
        expect(elementLabel({ ...wall, category: 'Doors', name: 'Single-Flush: 0915 x 2134mm', elementId: 12 })).toBe('Door 12');
    });
    it('uses the exact ID text, so a huge Int64 ID is not rounded', () => {
        const huge = '9007199254740993'; // beyond Number.MAX_SAFE_INTEGER
        expect(elementIdOf({ elementId: Number(huge), elementIdText: huge })).toBe(huge);
        expect(elementLabel({ ...wall, elementIdText: huge })).toBe(`Wall ${huge}`);
    });
    it('falls back to the name when there is no category', () => {
        expect(elementLabel({ category: '', name: 'Thing', elementId: 3 })).toBe('Thing 3');
    });
});

import { elementTypeLabel } from '../src/lib/elementLabel';

describe('elementTypeLabel', () => {
    it('is the type alone, with no ID, for labels drawn on the page', () => {
        expect(elementTypeLabel({ category: 'Walls', name: 'Basic Wall: Exterior' })).toBe('Wall');
        expect(elementTypeLabel({ category: 'Windows', name: 'Fixed' })).toBe('Window');
        expect(elementTypeLabel({ category: 'Doors', name: 'Single-Flush' })).toBe('Door');
    });
    it('falls back to the name when there is no category', () => {
        expect(elementTypeLabel({ category: '', name: 'Thing' })).toBe('Thing');
    });
});
