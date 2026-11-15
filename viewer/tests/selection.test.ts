import { describe, expect, it } from 'vitest';
import { categoryCounts, combineParameters, identityParameters, similarElementKeys, typeIdentity } from '../src/lib/selection';
import type { ElementInfo, ParameterInfo } from '../src/lib/types';

const p = (name: string, value: string, scope: ParameterInfo['scope'] = 'Instance'): ParameterInfo => ({ name, scope, value });
const wall = (key: string, extra: Partial<ElementInfo> = {}): ElementInfo => ({ key, elementId: Number(key.slice(1)), category: 'Walls', name: key, ...extra });

describe('combineParameters', () => {
    it('keeps shared values and marks disagreements as varying', () => {
        const rows = combineParameters([
            [p('Height', '3000'), p('Mark', 'A')],
            [p('Height', '3000'), p('Mark', 'B')],
        ]);
        expect(rows).toEqual([
            { name: 'Height', scope: 'Instance', value: '3000', varies: false },
            { name: 'Mark', scope: 'Instance', value: '', varies: true },
        ]);
    });

    it('treats a parameter missing from some elements as varying', () => {
        const rows = combineParameters([[p('Height', '3000'), p('Comments', 'x')], [p('Height', '3000')]]);
        expect(rows.find((row) => row.name === 'Comments')).toMatchObject({ varies: true, value: '' });
    });

    it('keeps instance and type parameters with the same name apart', () => {
        const rows = combineParameters([[p('Width', '200', 'Type'), p('Width', '210')], [p('Width', '200', 'Type'), p('Width', '220')]]);
        expect(rows).toEqual([
            { name: 'Width', scope: 'Type', value: '200', varies: false },
            { name: 'Width', scope: 'Instance', value: '', varies: true },
        ]);
    });

    it('returns a single element unchanged', () => {
        expect(combineParameters([[p('Height', '3000')]])).toEqual([{ name: 'Height', scope: 'Instance', value: '3000', varies: false }]);
    });
});

describe('selection identity and counts', () => {
    it('varies the element ID across several walls but shares the category', () => {
        const rows = combineParameters([identityParameters(wall('w1')), identityParameters(wall('w2'))]);
        expect(rows.find((row) => row.name === 'Element ID')?.varies).toBe(true);
        expect(rows.find((row) => row.name === 'Category')).toMatchObject({ value: 'Walls', varies: false });
    });

    it('counts categories largest first', () => {
        expect(categoryCounts([wall('w1'), wall('w2'), wall('d1', { category: 'Doors' })])).toEqual([['Walls', 2], ['Doors', 1]]);
    });
});

describe('similarElementKeys', () => {
    const typed = (key: string, typeKey: string | undefined, extra: Partial<ElementInfo> = {}) => wall(key, { ...(typeKey ? { typeKey } : {}), ...extra });

    it('selects every candidate with the same type record', () => {
        const candidates = [typed('w1', 't1'), typed('w2', 't2'), typed('w3', 't1'), typed('w4', 't1', { category: 'Doors' })];
        expect(similarElementKeys([candidates[0]!], candidates)).toEqual(['w1', 'w3', 'w4']);
    });

    it('falls back to category, family and type name without a type record', () => {
        const a = wall('w1', { family: 'Basic Wall', type: 'Generic 200' });
        const candidates = [a, wall('w2', { family: 'Basic Wall', type: 'Generic 200' }), wall('w3', { family: 'Basic Wall', type: 'Generic 300' }), wall('d1', { category: 'Doors', family: 'Basic Wall', type: 'Generic 200' })];
        expect(similarElementKeys([a], candidates)).toEqual(['w1', 'w2']);
    });

    it('unions the types of a mixed selection and keeps selected elements outside the candidates', () => {
        const candidates = [typed('w2', 't1'), typed('w3', 't2'), typed('w4', 't3')];
        expect(similarElementKeys([typed('w1', 't1'), typed('w9', 't2')], candidates)).toEqual(['w2', 'w3', 'w1', 'w9']);
    });

    it('treats a type record and a name-only element as different types', () => {
        expect(typeIdentity(typed('w1', 't1'))).not.toBe(typeIdentity(wall('w2')));
    });
});
