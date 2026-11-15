import type { AppearanceInfo, DrawingInfo, ElementInfo, ParameterInfo } from './types';

/** Missing metadata remains distinct from explicit values such as NR or 0. */
export const UNSPECIFIED_VALUE = '\u0000unspecified';

export interface FilterState {
    search: string;
    /** OR within each field, AND across fields. Values retain their display spelling. */
    facets: Readonly<Record<string, readonly string[]>>;
}

export interface FilterContext {
    drawings: readonly DrawingInfo[];
    appearances: readonly AppearanceInfo[];
}

const EMPTY_CONTEXT: FilterContext = Object.freeze({ drawings: Object.freeze([]), appearances: Object.freeze([]) });

/** Null means every drawing; the sentinel explicitly selects missing membership. */
export function getDrawingScope(state: FilterState): ReadonlySet<string> | null {
    const values = state.facets.drawing;
    return values?.length ? new Set(values) : null;
}

export function matchesDrawingScope(drawingId: string | undefined, scope: ReadonlySet<string> | null): boolean {
    return scope === null || scope.has(drawingId || UNSPECIFIED_VALUE);
}

export interface FilterValue {
    value: string;
    label: string;
    /** Distinct matching elements, not parameter-row or geometry-part counts. */
    count: number;
}

export interface FilterField {
    id: string;
    label: string;
    kind: 'builtin' | 'parameter';
    scope?: 'Instance' | 'Type';
    values: readonly FilterValue[];
}

export const EMPTY_FILTERS: FilterState = Object.freeze({ search: '', facets: Object.freeze({}) });

type ContextElement = ElementInfo & { model?: string; modelKey?: string };
type IdentifiedParameter = ParameterInfo & { parameterId?: string; sharedGuid?: string; specId?: string; unitId?: string };

const BUILT_INS = [
    ['category', 'Category'], ['family', 'Family'], ['type', 'Type'], ['level', 'Level'],
    ['model', 'Model'], ['wallFunction', 'Wall function'], ['fireRating', 'Fire rating'],
] as const;
type BuiltInId = typeof BUILT_INS[number][0];
const builtInIds = new Set<string>(BUILT_INS.map(([id]) => id));
const display = (value: string | undefined) => value?.trim() || UNSPECIFIED_VALUE;
export const filterValueLabel = (value: string) => value === UNSPECIFIED_VALUE ? 'Unspecified' : value;

function builtInValue(element: ContextElement, id: BuiltInId): string {
    return display(element[id]);
}

/** A shared GUID is cross-model; project IDs and names are scoped to their model. */
export function parameterFieldId(parameter: ParameterInfo, element: ElementInfo): string {
    const p = parameter as IdentifiedParameter;
    const e = element as ContextElement;
    const identity = p.sharedGuid?.trim()
        ? ['guid', p.sharedGuid.trim().toLowerCase()]
        : [p.parameterId?.trim() ? 'id' : 'name', e.modelKey ?? e.model ?? '', p.parameterId?.trim() || p.name];
    return `parameter:${JSON.stringify([p.scope, ...identity, p.specId ?? '', p.unitId ?? ''])}`;
}

function parametersFor(element: ElementInfo, parameters: ReadonlyMap<string, readonly ParameterInfo[]>): ParameterInfo[] {
    const instance = (parameters.get(element.key) ?? []).filter((parameter) => parameter.scope === 'Instance');
    const type = element.typeKey ? (parameters.get(element.typeKey) ?? []).filter((parameter) => parameter.scope === 'Type') : [];
    return [...instance, ...type];
}

function parameterLabel(parameter: IdentifiedParameter, element: ContextElement): string {
    const model = !parameter.sharedGuid && element.model ? ` · ${element.model}` : '';
    return `${parameter.name} (${parameter.scope}${model})`;
}

/** Only declared drawings can establish membership; dangling references stay unspecified. */
function drawingMembership(context: FilterContext): Map<string, Set<string>> {
    const known = new Set(context.drawings.map((drawing) => drawing.id));
    const membership = new Map<string, Set<string>>();
    for (const appearance of context.appearances) {
        if (!known.has(appearance.drawingId)) continue;
        const drawings = membership.get(appearance.elementKey) ?? new Set<string>();
        drawings.add(appearance.drawingId);
        membership.set(appearance.elementKey, drawings);
    }
    return membership;
}

function drawingLabels(drawings: readonly DrawingInfo[]): Map<string, string> {
    const unique = [...new Map(drawings.map((drawing) => [drawing.id, drawing])).values()];
    const base = new Map(unique.map((drawing) => [drawing.id, [
        drawing.sheetNumber,
        drawing.name,
        drawing.detailNumber ? `Detail ${drawing.detailNumber}` : undefined,
        `Page ${drawing.page}`,
    ].filter(Boolean).join(' · ')]));
    const counts = new Map<string, number>();
    for (const label of base.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
    const shortened = new Map(unique.map((drawing) => {
        const label = base.get(drawing.id)!;
        return [drawing.id, counts.get(label)! > 1 ? `${label} · ${drawing.id.slice(-8)}` : label];
    }));
    const shortCounts = new Map<string, number>();
    for (const label of shortened.values()) shortCounts.set(label, (shortCounts.get(label) ?? 0) + 1);
    return new Map(unique.map((drawing) => {
        const label = shortened.get(drawing.id)!;
        return [drawing.id, shortCounts.get(label)! > 1 ? `${base.get(drawing.id)} · ${drawing.id}` : label];
    }));
}

/** Build the property picker once per document/context, never one control per parameter row. */
export function buildFilterFields(elements: readonly ElementInfo[], parameters: ReadonlyMap<string, readonly ParameterInfo[]>, context: FilterContext = EMPTY_CONTEXT): FilterField[] {
    const fields = new Map<string, { field: Omit<FilterField, 'values'>; owners: Map<string, Set<string>> }>();
    for (const [id, label] of BUILT_INS) fields.set(id, { field: { id, label, kind: 'builtin' }, owners: new Map() });
    const membership = drawingMembership(context);
    const labels = drawingLabels(context.drawings);
    fields.set('drawing', { field: { id: 'drawing', label: 'Drawing / view', kind: 'builtin' }, owners: new Map() });

    for (const element of elements) {
        for (const [id] of BUILT_INS) fields.get(id)!.owners.set(element.key, new Set([builtInValue(element, id)]));
        fields.get('drawing')!.owners.set(element.key, membership.get(element.key) ?? new Set([UNSPECIFIED_VALUE]));
        for (const parameter of parametersFor(element, parameters)) {
            const id = parameterFieldId(parameter, element);
            let entry = fields.get(id);
            if (!entry) {
                entry = { field: { id, label: parameterLabel(parameter, element), kind: 'parameter', scope: parameter.scope }, owners: new Map() };
                fields.set(id, entry);
            }
            let values = entry.owners.get(element.key);
            if (!values) entry.owners.set(element.key, values = new Set());
            values.add(display(parameter.value));
        }
    }

    const result = [...fields.values()].map(({ field, owners }): FilterField => {
        const counts = new Map<string, number>();
        for (const values of owners.values()) for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
        const missing = elements.length - owners.size;
        if (missing) counts.set(UNSPECIFIED_VALUE, (counts.get(UNSPECIFIED_VALUE) ?? 0) + missing);
        if (field.id === 'drawing') for (const id of labels.keys()) if (!counts.has(id)) counts.set(id, 0);
        const values = [...counts].map(([value, count]) => ({ value, label: field.id === 'drawing' ? labels.get(value) ?? filterValueLabel(value) : filterValueLabel(value), count }));
        values.sort((a, b) => a.value === UNSPECIFIED_VALUE ? 1 : b.value === UNSPECIFIED_VALUE ? -1 : a.label.localeCompare(b.label, undefined, { numeric: true }));
        return { ...field, values };
    });
    const common = result.filter((field) => field.kind === 'builtin');
    const extra = result.filter((field) => field.kind === 'parameter').sort((a, b) => a.label.localeCompare(b.label));
    return [...common, ...extra];
}

export function hasActiveFilters(state: FilterState): boolean {
    return state.search.trim().length > 0 || Object.values(state.facets).some((values) => values.length > 0);
}

export function filterElements(elements: readonly ElementInfo[], parameters: ReadonlyMap<string, readonly ParameterInfo[]>, state: FilterState, context: FilterContext = EMPTY_CONTEXT): ElementInfo[] {
    const query = state.search.trim().toLocaleLowerCase();
    const selected = Object.entries(state.facets).filter(([, values]) => values.length > 0);
    if (!query && selected.length === 0) return [...elements];
    const needsParameters = query.length > 0 || selected.some(([id]) => id !== 'drawing' && !builtInIds.has(id));
    const membership = query || selected.some(([id]) => id === 'drawing') ? drawingMembership(context) : new Map<string, Set<string>>();
    const labels = query ? drawingLabels(context.drawings) : new Map<string, string>();

    return elements.filter((element) => {
        const own = needsParameters ? parametersFor(element, parameters) : [];
        if (query) {
            const e = element as ContextElement;
            const text = [e.key, e.elementIdText ?? String(e.elementId), e.name, e.category, e.family, e.type, e.level, e.mark, e.model, e.wallFunction, e.fireRating,
                ...[...(membership.get(e.key) ?? [])].map((drawingId) => labels.get(drawingId)),
                ...own.flatMap((parameter) => [parameter.name, parameter.value])].filter((value) => value !== undefined).join(' ').toLocaleLowerCase();
            if (!text.includes(query)) return false;
        }
        return selected.every(([id, values]) => {
            if (id === 'drawing') {
                const actual = membership.get(element.key);
                return (actual?.size ? [...actual] : [UNSPECIFIED_VALUE]).some((value) => values.includes(value));
            }
            if (builtInIds.has(id)) return values.includes(builtInValue(element, id as BuiltInId));
            const actual = own.filter((parameter) => parameterFieldId(parameter, element) === id).map((parameter) => display(parameter.value));
            return (actual.length ? actual : [UNSPECIFIED_VALUE]).some((value) => values.includes(value));
        });
    });
}
