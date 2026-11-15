import { describe, expect, it } from 'vitest';
import { inspectDrawing, inspectDrawingElements, queryDrawingElements, type DrawingQuery } from '../src/lib/drawingQuery';
import type { AgentContext } from '../src/lib/drawingAgent';
import type { ElementInfo, ParameterInfo } from '../src/lib/types';

const element = (key: string, category: string, patch: Partial<ElementInfo> = {}): ElementInfo => ({ key, category, name: key, elementId: Number(key.replace(/\D/g, '')) || 1, ...patch });
const p = (name: string, value: string, patch: Partial<ParameterInfo> = {}): ParameterInfo => ({ name, value, scope: 'Instance', valueSource: 'display', ...patch });
const elements = [
    element('c1', 'Columns', { name: 'Lobby column', family: 'Round column', type: '12 inch', typeKey: 't1', level: 'L1', model: 'Architecture', elementIdText: '9007199254740993' }),
    element('c2', 'Structural Columns', { name: 'Core column', family: 'Steel column', type: 'Steel', typeKey: 't2', level: 'L1' }),
    element('c3', 'Structural Columns', { name: 'Upper column', typeKey: 't3', level: 'L2' }),
    element('d1', 'Doors', { name: 'Lobby entrance', typeKey: 'td' }),
];
const parameters = new Map<string, ParameterInfo[]>([
    ['c1', [p('Height', '10 ft'), p('Count', '0', { valueSource: 'integer' }), p('Fire Rating', '2 HR')]],
    ['c2', [p('Width', '500', { unitId: 'autodesk.unit.unit:millimeters-1.0.1' }), p('Height', '-300 mm'), p('Material', 'Concrete'), p('Count', '-2', { valueSource: 'integer' })]],
    ['c3', [p('Width', '3', { unitId: 'autodesk.unit.unit:millimeters-1.0.1', valueSource: 'internal' }), p('Height', 'unknown')]],
    ['t1', [p('Width', '12 in', { scope: 'Type' }), p('Material', 'Concrete', { scope: 'Type' }), p('Area', '100 ft2', { scope: 'Type' })]],
    ['t2', [p('Width', '1 ft', { scope: 'Type' }), p('Material', 'Steel', { scope: 'Type' })]],
    ['t3', [p('Material', 'Steel', { scope: 'Type' })]],
    ['td', [p('Width', '3 ft', { scope: 'Type' })]],
    ['outside', [p('Secret other page property', 'not in current scope')]],
]);
const context = (patch: Partial<AgentContext> = {}): AgentContext => ({ elements, parameters, pageNumber: 1, comments: [], locatableKeys: new Set(['c1', 'c2', 'd1', 'outside']), ...patch });
const query = (patch: Partial<DrawingQuery> = {}): DrawingQuery => ({ categories: [], search: null, filters: [], properties: [], groupBy: null, offset: 0, limit: 25, ...patch });

describe('drawing property and category catalog', () => {
    it('uses only current-page members, preserves distinct column categories, and reports geometry coverage', () => {
        const data = inspectDrawing(context());
        expect(data.elementCount).toBe(4);
        expect(data.locatableCount).toBe(3);
        expect(data.categories).toEqual([{ name: 'Structural Columns', count: 2, locatable: 1 }, { name: 'Columns', count: 1, locatable: 1 }, { name: 'Doors', count: 1, locatable: 1 }]);
        expect(data.properties.find((property) => property.name === 'Width')?.scopes.sort()).toEqual(['Instance', 'Type']);
        expect(data.properties.some((property) => property.name.includes('Secret'))).toBe(false);
        expect(data.selectedCount).toBeNull();
    });

    it('reports only in-scope selected identities and bounds large catalogs', () => {
        const many = Array.from({ length: 80 }, (_, i) => element(`key-${i}`, 'Columns'));
        const c = { ...context({ elements: many }), selectedKeys: new Set([...many.map((e) => e.key), 'outside']), pageCount: 12 };
        const data = inspectDrawing(c);
        expect(data.selectedCount).toBe(80);
        expect(data.selectedElementKeys).toHaveLength(25);
        expect(data.selectionTruncated).toBe(true);
        expect(data.pageCount).toBe(12);
        expect(new TextEncoder().encode(JSON.stringify(data)).byteLength).toBeLessThanOrEqual(8_000);
    });

    it('keeps built-in fields discoverable before a large trimmed parameter catalog', () => {
        const manyParameters = Array.from({ length: 200 }, (_, i) => p(`A parameter ${i}`, 'value'));
        const data = inspectDrawing(context({ parameters: new Map([['c1', manyParameters]]) }));
        expect(data.properties.slice(0, 3).map((entry) => entry.name)).toEqual(['Category', 'Name', 'Family']);
        expect(data.properties.some((entry) => entry.name === 'Element ID')).toBe(true);
        expect(data.truncated).toBe(true);
    });
});

describe('actual exported drawing queries', () => {
    it('combines category OR, property AND, search, and exact IDs without inventing geometry', () => {
        const result = queryDrawingElements(context(), query({ categories: ['column', 'structural column'], filters: [{ property: 'Level', operator: 'equals', value: 'L1' }], search: 'column', properties: ['Element ID', 'Family'] }));
        expect([...result.elementKeys]).toEqual(['c1', 'c2']);
        expect(result.data).toMatchObject({ total: 2, locatable: 2 });
        expect(result.data.rows[0]?.elementId).toBe('9007199254740993');
        expect(result.data.rows[0]?.properties['Element ID']?.value).toBe('9007199254740993');
        expect(queryDrawingElements(context(), query({ categories: ['Structural Columns'] })).data).toMatchObject({ total: 2, locatable: 1 });
        expect(queryDrawingElements(context(), query({ categories: ['column'] })).data.total).toBe(1);
    });

    it('honors instance-before-type precedence and explicit parameter scopes', () => {
        const result = queryDrawingElements(context(), query({ categories: ['Structural Columns'], properties: ['Width', 'type:Width', 'Material', 'type:Material'] }));
        const c2 = result.data.rows.find((row) => row.key === 'c2')!;
        expect(c2.properties.Width).toMatchObject({ value: '500', scope: 'Instance', unit: 'autodesk.unit.unit:millimeters-1.0.1' });
        expect(c2.properties['type:Width']).toMatchObject({ value: '1 ft', scope: 'Type' });
        expect(c2.properties.Material?.value).toBe('Concrete');
        expect(c2.properties['type:Material']?.value).toBe('Steel');
    });

    it('converts explicit compatible lengths and display-unit metadata for numeric filters', () => {
        const result = queryDrawingElements(context(), query({ categories: ['Columns', 'Structural Columns'], filters: [{ property: 'Width', operator: 'gt', value: '12 in' }], properties: ['Width'] }));
        expect([...result.elementKeys]).toEqual(['c2']);
        expect(result.data.warnings.join(' ')).toContain('1 element');
        expect(queryDrawingElements(context(), query({ filters: [{ property: 'Width', operator: 'equals', value: '304.8 mm' }] })).data.rows.map((row) => row.key)).toEqual(['c1']);
        expect(queryDrawingElements(context(), query({ filters: [{ property: 'type:Width', operator: 'equals', value: '12 inches' }] })).data.rows.map((row) => row.key)).toEqual(['c1', 'c2']);
    });

    it('keeps raw internal/reference quantities and incompatible dimensions unknown', () => {
        for (const wanted of ['4 mm', '4', '4 ft2']) {
            const result = queryDrawingElements(context(), query({ categories: ['Structural Columns'], filters: [{ property: 'Width', operator: 'lt', value: wanted }] }));
            expect([...result.elementKeys]).not.toContain('c3');
            expect(result.data.warnings.join(' ')).toContain('known compatible units');
        }
        const ref = context({ parameters: new Map([['c1', [p('Width', '500 mm', { valueSource: 'reference' })]]]) });
        expect(queryDrawingElements(ref, query({ categories: ['Columns'], filters: [{ property: 'Width', operator: 'gt', value: '1 mm' }] })).data.total).toBe(0);
        expect(queryDrawingElements(context(), query({ filters: [{ property: 'Width', operator: 'not_equals', value: '12 m2' }] })).data.total).toBe(0);
        expect(queryDrawingElements(context(), query({ categories: ['Columns'], filters: [{ property: 'Type', operator: 'gt', value: '6 in' }] })).data.total).toBe(0);
    });

    it('supports zero, negative, fractions, feet/inches, areas, and explicit unitless integers', () => {
        expect(queryDrawingElements(context(), query({ filters: [{ property: 'Height', operator: 'gte', value: '0 m' }] })).data.rows.map((row) => row.key)).toEqual(['c1']);
        expect(queryDrawingElements(context(), query({ filters: [{ property: 'Count', operator: 'gte', value: '0' }] })).data.rows.map((row) => row.key)).toEqual(['c1']);
        expect(queryDrawingElements(context(), query({ filters: [{ property: 'Area', operator: 'gt', value: '9 m2' }] })).data.rows.map((row) => row.key)).toEqual(['c1']);
        const c = context({ parameters: new Map([['c1', [p('Width', '3\' - 6"'), p('Fraction', '1 1/2 in')]]]) });
        expect(queryDrawingElements(c, query({ categories: ['Columns'], filters: [{ property: 'Width', operator: 'equals', value: '42 in' }, { property: 'Fraction', operator: 'gt', value: '1 in' }] })).data.total).toBe(1);
    });

    it('does not mistake a partial number, an unknown unit, or an unsafe integer for a measurement', () => {
        for (const value of ['12 nonsense', '12 constructor', '12 mm trailing', '3foo', '9007199254740993']) {
            const c = context({ parameters: new Map([['c1', [p('Count', value, { valueSource: 'integer' })]]]) });
            const result = queryDrawingElements(c, query({ categories: ['Columns'], filters: [{ property: 'Count', operator: 'gt', value: '0' }] }));
            expect(result.data.total).toBe(0);
            expect(result.data.warnings).not.toHaveLength(0);
        }
    });

    it('treats prototype-like exported names as ordinary properties', () => {
        const c = context({ parameters: new Map([['c1', [p('constructor', 'Literal parameter'), p('__proto__', 'Actual value')]]]) });
        const result = queryDrawingElements(c, query({ categories: ['Columns'], properties: ['constructor', '__proto__'], filters: [{ property: 'constructor', operator: 'equals', value: 'Literal parameter' }] }));
        expect(result.data.total).toBe(1);
        expect(result.data.rows[0]?.properties.constructor).toMatchObject({ value: 'Literal parameter' });
        expect(result.data.rows[0]?.properties.__proto__).toMatchObject({ value: 'Actual value' });
        expect({}.constructor).toBe(Object);
    });

    it('keeps conflicting values separate and never treats an unknown negative predicate as true', () => {
        const c = context({ parameters: new Map([['c1', [p('Material', 'Concrete'), p('Material', 'Steel')]]]) });
        const result = queryDrawingElements(c, query({ categories: ['Columns'], properties: ['Material'] }));
        expect(result.data.rows[0]?.properties.Material?.state).toBe('conflicting');
        expect(queryDrawingElements(c, query({ categories: ['Columns'], filters: [{ property: 'Material', operator: 'not_equals', value: 'Wood' }] })).data.total).toBe(0);
        expect(queryDrawingElements(c, query({ categories: ['Columns'], filters: [{ property: 'Material', operator: 'exists', value: null }] })).data.total).toBe(1);
    });

    it('returns a clear error for unknown categories/properties instead of silently dropping filters', () => {
        for (const patch of [
            { categories: ['Not real'] }, { filters: [{ property: 'Unknown parameter', operator: 'equals' as const, value: 'yes' }] },
            { properties: ['Unknown parameter'] }, { groupBy: 'Unknown parameter' },
        ]) {
            const result = queryDrawingElements(context(), query(patch));
            expect(result.data.error).toContain('Unknown');
            expect(result.elementKeys.size).toBe(0);
        }
    });

    it('groups arbitrary exported parameters while retaining all local members and metadata-only coverage', () => {
        const result = queryDrawingElements(context(), query({ categories: ['Columns', 'Structural Columns'], groupBy: 'Material', properties: ['Material'] }));
        expect(result.data.groups).toEqual([{ label: 'Concrete', count: 2, locatable: 2 }, { label: 'Steel', count: 1, locatable: 0 }]);
        expect([...result.groups![0]!.elementKeys]).toEqual(['c1', 'c2']);
        expect([...result.groups![1]!.elementKeys]).toEqual(['c3']);
        expect(result.data.groupCount).toBe(2);
    });

    it('retains every local group identity while bounding the planner group summary', () => {
        const many = Array.from({ length: 70 }, (_, i) => element(`id-${i}`, 'Columns', { type: `Type ${i}` }));
        const result = queryDrawingElements(context({ elements: many }), query({ groupBy: 'Type' }));
        expect(result.groups).toHaveLength(70);
        expect(result.data.groups).toHaveLength(40);
        expect(result.data.groupCount).toBe(70);
        expect(result.data.truncated).toBe(true);
        expect(new Set(result.groups!.flatMap((group) => [...group.elementKeys])).size).toBe(70);
    });

    it('keeps missing values distinct from explicit unspecified labels when grouping', () => {
        const c = context({ parameters: new Map([['c1', [p('Material', 'No exported value')]]]) });
        const result = queryDrawingElements(c, query({ groupBy: 'Material' }));
        expect(result.data.groupCount).toBe(2);
        expect(result.groups?.map((group) => group.elementKeys.size).sort()).toEqual([1, 3]);
    });

    it('paginates rows without losing complete local result membership', () => {
        const result = queryDrawingElements(context(), query({ offset: 1, limit: 1 }));
        expect(result.data.rows.map((row) => row.key)).toEqual(['c2']);
        expect(result.data).toMatchObject({ total: 4, returned: 1, offset: 1, hasMore: true, truncated: true });
        expect([...result.elementKeys]).toEqual(['c1', 'c2', 'c3', 'd1']);
    });

    it('bounds long Unicode output structurally and keeps every result key local', () => {
        const many = Array.from({ length: 70 }, (_, index) => element(`id-${index}`, 'Columns', { name: 'é'.repeat(400) }));
        const c = context({ elements: many, parameters: new Map(many.map((e) => [e.key, Array.from({ length: 12 }, (_, index) => p(`Property ${index}`, 'é'.repeat(400)))])) });
        const result = queryDrawingElements(c, query({ properties: Array.from({ length: 12 }, (_, i) => `Property ${i}`) }));
        expect(result.elementKeys.size).toBe(70);
        expect(result.data.total).toBe(70);
        expect(result.data.truncated).toBe(true);
        expect(new TextEncoder().encode(JSON.stringify(result.data)).byteLength).toBeLessThanOrEqual(8_000);
        expect(result.data.rows.length).toBeGreaterThan(0);
    });

    it('rejects malformed or unbounded query values', () => {
        for (const patch of [{ limit: 0 }, { limit: 26 }, { offset: -1 }, { properties: Array(13).fill('Width') }, { categories: [''] }, { filters: [{ property: 'Width', operator: 'gt', value: null }] }]) {
            expect(queryDrawingElements(context(), query(patch as Partial<DrawingQuery>)).data.error).toContain('Invalid query');
        }
    });
});

describe('exact element inspection', () => {
    it('inspects real identities with automatic parameter names and reports unknown keys', () => {
        const result = inspectDrawingElements(context(), ['c1', 'missing'], []);
        expect(result.data.total).toBe(1);
        expect(result.data.rows[0]?.key).toBe('c1');
        expect(result.data.rows[0]?.properties.Width?.value).toBe('12 in');
        expect(result.data.availableProperties).toContain('Width');
        expect(result.data.warnings.join(' ')).toContain('1 requested identities');
    });

    it('accepts 50 explicit keys with bounded rows but refuses unknown properties', () => {
        const many = Array.from({ length: 50 }, (_, i) => element(`id-${i}`, 'Columns'));
        const c = context({ elements: many });
        const result = inspectDrawingElements(c, many.map((e) => e.key), ['Category']);
        expect(result.data.total).toBe(50);
        expect(result.elementKeys.size).toBe(50);
        expect(result.data.returned).toBeLessThanOrEqual(25);
        expect(result.data.hasMore).toBe(true);
        expect(inspectDrawingElements(c, ['id-1'], ['Imaginary']).data.error).toContain('Unknown exported property');
    });
});
