import { describe, expect, it } from 'vitest';
import { buildFilterFields, EMPTY_FILTERS, filterElements, hasActiveFilters, parameterFieldId, UNSPECIFIED_VALUE, type FilterState } from '../src/lib/filters';
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
