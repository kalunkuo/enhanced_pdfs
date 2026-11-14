import { describe, expect, it } from 'vitest';
import { buildFilterFields, EMPTY_FILTERS, filterElements, getDrawingScope, hasActiveFilters, matchesDrawingScope, parameterFieldId, UNSPECIFIED_VALUE, type FilterContext, type FilterState } from '../src/lib/filters';
import type { ElementInfo, ParameterInfo } from '../src/lib/types';

type ContextElement = ElementInfo & { model?: string; modelKey?: string };
type TestParameter = ParameterInfo & { parameterId?: string; sharedGuid?: string; specId?: string; unitId?: string };
const elements: ContextElement[] = [
    { key: 'w1', elementId: 676281, name: 'Exterior wall', category: 'Walls', typeKey: 't1', wallFunction: 'Exterior', fireRating: '2 HR', model: 'Architecture', modelKey: 'a' },
    { key: 'w2', elementId: 2, name: 'Interior wall', category: 'Walls', typeKey: 't2', wallFunction: 'Interior', fireRating: 'NR', model: 'Architecture', modelKey: 'a' },
    { key: 'w3', elementId: 3, name: 'Blank wall', category: 'Walls', fireRating: ' ', model: 'Structure', modelKey: 's' },
    { key: 'd1', elementId: 4, name: 'Door', category: 'Doors', fireRating: '2 HR', model: 'Architecture', modelKey: 'a' },
];
const instance: TestParameter = { name: 'Review', scope: 'Instance', value: 'Checked', parameterId: '100' };
const type: TestParameter = { name: 'Review', scope: 'Type', value: 'Pending', parameterId: '100' };
const parameters = new Map<string, TestParameter[]>([
    ['w1', [instance, { ...instance }]],
    ['t1', [type]],
    ['w2', [{ ...instance, value: 'Pending' }]],
]);
const keys = (state: FilterState) => filterElements(elements, parameters, state).map((element) => element.key);

describe('BIM filters', () => {
    it('uses OR within each field and AND between fields', () => {
        expect(keys({ search: '', facets: { category: ['Walls', 'Doors'], fireRating: ['2 HR'] } })).toEqual(['w1', 'd1']);
        expect(keys({ search: '', facets: { category: ['Walls'], wallFunction: ['Exterior'] } })).toEqual(['w1']);
    });

    it('keeps absent or blank values separate from explicit NR', () => {
        expect(keys({ search: '', facets: { fireRating: [UNSPECIFIED_VALUE] } })).toEqual(['w3']);
        expect(keys({ search: '', facets: { fireRating: ['NR'] } })).toEqual(['w2']);
    });

    it('filters model context independently from repeated category labels', () => {
        expect(keys({ search: '', facets: { category: ['Walls'], model: ['Structure'] } })).toEqual(['w3']);
    });

    it('searches IDs, properties, and parameter values without treating undefined as data', () => {
        expect(keys({ search: '676281', facets: {} })).toEqual(['w1']);
        expect(keys({ search: 'checked', facets: {} })).toEqual(['w1']);
        expect(keys({ search: 'undefined', facets: {} })).toEqual([]);
    });

    it('searches the exact Int64 ID rather than its rounded JavaScript number', () => {
        const largeId: ElementInfo = { key: 'large-id', elementId: Number('9007199254740993'), elementIdText: '9007199254740993', name: 'Wall', category: 'Walls' };
        expect(filterElements([largeId], new Map(), { search: '9007199254740993', facets: {} })).toEqual([largeId]);
        expect(filterElements([largeId], new Map(), { search: '9007199254740992', facets: {} })).toEqual([]);
    });

    it('keeps instance and type facets distinct and counts each element once', () => {
        const ownId = parameterFieldId(instance, elements[0]!);
        const typeId = parameterFieldId(type, elements[0]!);
        expect(ownId).not.toBe(typeId);
        expect(keys({ search: '', facets: { [ownId]: ['Checked'], [typeId]: ['Pending'] } })).toEqual(['w1']);
        const field = buildFilterFields(elements, parameters).find((candidate) => candidate.id === ownId)!;
        expect(field.values.find((value) => value.value === 'Checked')?.count).toBe(1);
        expect(field.values.find((value) => value.value === UNSPECIFIED_VALUE)?.count).toBe(2);
    });

    it('does not inherit an instance parameter from the type owner', () => {
        const id = parameterFieldId(instance, elements[0]!);
        const onlyType = new Map([['t1', [instance]]]);
        expect(filterElements(elements, onlyType, { search: '', facets: { [id]: ['Checked'] } })).toEqual([]);
    });

    it('scopes project parameter IDs by model and distinguishes typed property definitions', () => {
        expect(parameterFieldId(instance, elements[0]!)).not.toBe(parameterFieldId(instance, elements[2]!));
        expect(parameterFieldId({ ...instance, specId: 'length' } as TestParameter, elements[0]!))
            .not.toBe(parameterFieldId({ ...instance, specId: 'area' } as TestParameter, elements[0]!));
    });

    it('shares GUID identity across models while retaining instance/type scope', () => {
        const shared: TestParameter = { ...instance, sharedGuid: 'ABC-123' };
        expect(parameterFieldId(shared, elements[0]!)).toBe(parameterFieldId({ ...shared, sharedGuid: 'abc-123' } as TestParameter, elements[2]!));
        expect(parameterFieldId(shared, elements[0]!)).not.toBe(parameterFieldId({ ...shared, scope: 'Type' }, elements[0]!));
    });

    it('does not mutate the empty state or source metadata', () => {
        expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
        expect(hasActiveFilters({ search: ' ', facets: { category: [] } })).toBe(false);
        expect(hasActiveFilters({ search: '', facets: { category: ['Walls'] } })).toBe(true);
        expect(keys(EMPTY_FILTERS)).toHaveLength(4);
        buildFilterFields(elements, parameters);
        expect(EMPTY_FILTERS).toEqual({ search: '', facets: {} });
        expect(parameters.get('w1')).toHaveLength(2);
    });
});

describe('drawing and view filters', () => {
    const context: FilterContext = {
        drawings: [
            { id: 'plan-a', name: 'L1', sheetNumber: 'A101', detailNumber: '1', page: 1 },
            { id: 'plan-b', name: 'L1', sheetNumber: 'A102', detailNumber: '1', page: 2 },
            { id: 'empty', name: 'Empty detail', sheetNumber: 'A103', page: 3 },
        ],
        appearances: [
            { drawingId: 'plan-a', elementKey: 'w1' }, { drawingId: 'plan-a', elementKey: 'w1' },
            { drawingId: 'plan-b', elementKey: 'w1' }, { drawingId: 'plan-a', elementKey: 'w2' },
            { drawingId: 'plan-b', elementKey: 'w3' }, { drawingId: 'missing-drawing', elementKey: 'd1' },
        ],
    };
    const matchingKeys = (facets: FilterState['facets'], search = '') => filterElements(elements, parameters, { search, facets }, context).map((element) => element.key);

    it('uses placement IDs and membership when the same element appears in multiple views', () => {
        expect(matchingKeys({ drawing: ['plan-a'] })).toEqual(['w1', 'w2']);
        expect(matchingKeys({ drawing: ['plan-b'] })).toEqual(['w1', 'w3']);
        expect(matchingKeys({ drawing: ['plan-a', 'plan-b'] })).toEqual(['w1', 'w2', 'w3']);
    });

    it('ANDs drawing choices with existing property facets and never joins by numeric element ID', () => {
        expect(matchingKeys({ drawing: ['plan-a'], category: ['Walls'], fireRating: ['2 HR'] })).toEqual(['w1']);
        const repeatedIds = elements.slice(0, 2).map((element) => ({ ...element, elementId: 42 }));
        const isolated = { ...context, appearances: [{ drawingId: 'plan-a', elementKey: 'w2' }] };
        expect(filterElements(repeatedIds, parameters, { search: '', facets: { drawing: ['plan-a'] } }, isolated).map((element) => element.key)).toEqual(['w2']);
    });

    it('keeps dangling or absent memberships unspecified instead of inventing a drawing', () => {
        expect(matchingKeys({ drawing: [UNSPECIFIED_VALUE] })).toEqual(['d1']);
        expect(matchingKeys({ drawing: ['missing-drawing'] })).toEqual([]);
        expect(matchingKeys({ drawing: ['empty'] })).toEqual([]);
        expect(filterElements(elements, parameters, { search: '', facets: { drawing: [UNSPECIFIED_VALUE] } })).toHaveLength(elements.length);
    });

    it('counts each element once per drawing and labels identical view names with page context', () => {
        const field = buildFilterFields(elements, parameters, context).find((candidate) => candidate.id === 'drawing')!;
        expect(field.label).toBe('Drawing / view');
        expect(field.values.find((option) => option.value === 'plan-a')).toMatchObject({ count: 2, label: 'A101 · L1 · Detail 1 · Page 1' });
        expect(field.values.find((option) => option.value === 'plan-b')).toMatchObject({ count: 2, label: 'A102 · L1 · Detail 1 · Page 2' });
        expect(field.values.find((option) => option.value === 'empty')?.count).toBe(0);
        expect(field.values.find((option) => option.value === UNSPECIFIED_VALUE)).toMatchObject({ count: 1, label: 'Unspecified' });
    });

    it('disambiguates identical placements even when their shortened IDs collide', () => {
        const duplicateNames: FilterContext = { drawings: [
            { id: 'first-same1234', name: 'Detail', page: 1 }, { id: 'second-same1234', name: 'Detail', page: 1 },
        ], appearances: [] };
        const field = buildFilterFields([], new Map(), duplicateNames).find((candidate) => candidate.id === 'drawing')!;
        expect(field.values.map((option) => option.value).sort()).toEqual(['first-same1234', 'second-same1234']);
        expect(new Set(field.values.map((option) => option.label)).size).toBe(2);
        expect(field.values.every((option) => option.label.includes(option.value))).toBe(true);
    });

    it('puts drawing scope before generic parameters and includes drawing context in search', () => {
        const fields = buildFilterFields(elements, parameters, context);
        expect(fields.findIndex((field) => field.id === 'drawing')).toBeLessThan(fields.findIndex((field) => field.kind === 'parameter'));
        expect(matchingKeys({}, 'A102')).toEqual(['w1', 'w3']);
    });

    it('exports matching scope rules for overlays and navigation, including unspecified parts', () => {
        expect(getDrawingScope(EMPTY_FILTERS)).toBeNull();
        expect(getDrawingScope({ search: '', facets: { drawing: [] } })).toBeNull();
        const scope = getDrawingScope({ search: '', facets: { drawing: ['plan-a', UNSPECIFIED_VALUE] } });
        expect(matchesDrawingScope('plan-a', scope)).toBe(true);
        expect(matchesDrawingScope('plan-b', scope)).toBe(false);
        expect(matchesDrawingScope(undefined, scope)).toBe(true);
        expect(matchesDrawingScope(undefined, null)).toBe(true);
        expect(matchesDrawingScope(undefined, new Set(['plan-a']))).toBe(false);
    });
});
