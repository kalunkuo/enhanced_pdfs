import { describe, expect, it } from 'vitest';
import { searchObjects } from '../src/lib/objectSearch';
import type { ElementInfo } from '../src/lib/types';

const el = (key: string, category: string, id: number, extra: Partial<ElementInfo> = {}): ElementInfo => ({ key, category, elementId: id, name: `${category} item`, ...extra });
const objects = [
    el('w10', 'Walls', 10, { level: 'GROUND FLOOR', family: 'Basic Wall', type: 'Exterior - 2HR' }),
    el('d2', 'Doors', 2, { level: 'LEVEL 2' }),
    el('w2', 'Walls', 2, { level: 'LEVEL 2', family: 'Basic Wall', type: 'Interior' }),
    el('win1', 'Windows', 1),
];

describe('searchObjects', () => {
    it('lists everything in natural order, grouped by type, with the true total', () => {
        const { items, total } = searchObjects(objects, '');
        expect(items.map((e) => e.key)).toEqual(['d2', 'w2', 'w10', 'win1']);
        expect(total).toBe(4);
    });
    it('puts "Wall 2" before "Wall 10"', () => {
        const keys = searchObjects(objects, 'wall').items.map((e) => e.key);
        expect(keys.indexOf('w2')).toBeLessThan(keys.indexOf('w10'));
    });
    it('matches every typed word, across label, level, family and type', () => {
        expect(searchObjects(objects, 'wall level 2').items.map((e) => e.key)).toEqual(['w2']);
        expect(searchObjects(objects, 'exterior').items.map((e) => e.key)).toEqual(['w10']);
        expect(searchObjects(objects, '10').items.map((e) => e.key)).toEqual(['w10']);
    });
    it('finds nothing for an unmatched word', () => {
        expect(searchObjects(objects, 'zebra')).toEqual({ items: [], total: 0 });
    });
    it('caps what it returns but still reports how many matched', () => {
        const many = Array.from({ length: 500 }, (_, i) => el(`w${i}`, 'Walls', i));
        const { items, total } = searchObjects(many, '', 50);
        expect(items).toHaveLength(50);
        expect(total).toBe(500);
    });
});
