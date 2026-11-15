import type { AgentContext } from './drawingAgent';
import { singularCategory } from './elementLabel';
import type { ElementInfo, ParameterInfo } from './types';

export type DrawingQueryOperator = 'equals' | 'not_equals' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'missing';
export interface DrawingQuery {
    categories: string[];
    search: string | null;
    filters: { property: string; operator: DrawingQueryOperator; value: string | null }[];
    properties: string[];
    groupBy: string | null;
    offset: number;
    limit: number;
}
export interface DrawingPropertyValue {
    value: string | null;
    scope: 'Element' | 'Instance' | 'Type' | null;
    unit: string | null;
    source: string | null;
    state: 'value' | 'missing' | 'conflicting';
}
export interface DrawingQueryRow {
    key: string;
    elementId: string;
    name: string;
    category: string;
    locatable: boolean;
    properties: Record<string, DrawingPropertyValue>;
}
export interface DrawingQueryData {
    pageNumber: number;
    total: number;
    locatable: number;
    rows: DrawingQueryRow[];
    groups: { label: string; count: number; locatable: number }[];
    groupCount: number;
    warnings: string[];
    truncated: boolean;
    returned: number;
    offset: number;
    hasMore: boolean;
    error?: string;
    availableProperties?: string[];
}
export interface DrawingQueryResult {
    data: DrawingQueryData;
    elementKeys: ReadonlySet<string>;
    groups?: readonly { label: string; elementKeys: ReadonlySet<string> }[];
}
// Keep complete result membership local. Only bounded rows/catalogs are sent to the planner.
const MAX_DATA_BYTES = 8_000;
const MAX_VALUE = 240;
const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
const fieldId = (value: string) => normalize(value).replaceAll(' ', '');
const clipped = (value: string, max = MAX_VALUE) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
const missing = (): DrawingPropertyValue => ({ value: null, scope: null, unit: null, source: null, state: 'missing' });
const BUILT_INS = ['Category', 'Name', 'Family', 'Type', 'Level', 'Model', 'Mark', 'Element ID', 'Fire Rating', 'Wall Function', 'Element Key', 'Type Key', 'Model Key', 'Link Instance ID'] as const;
const aliases: Record<string, string> = { id: 'elementid', element: 'elementid', key: 'elementkey', typename: 'type', familyname: 'family', modelname: 'model', levelname: 'level', linkinstance: 'linkinstanceid' };
const identity = (value: string) => { const id = fieldId(value); return Object.hasOwn(aliases, id) ? aliases[id]! : id; };
const builtinNames = new Set(BUILT_INS.map(identity));

function splitProperty(property: string): { name: string; scope?: 'Instance' | 'Type' } {
    const match = /^(instance|type)\s*:\s*(.+)$/i.exec(property.trim());
    return match ? { name: match[2]!, scope: match[1]!.toLowerCase() === 'instance' ? 'Instance' : 'Type' } : { name: property.trim() };
}
function ownedParameters(context: AgentContext, element: ElementInfo): ParameterInfo[] {
    return [...(context.parameters.get(element.key) ?? []).filter((p) => p.scope === 'Instance'),
        ...(element.typeKey ? context.parameters.get(element.typeKey) ?? [] : []).filter((p) => p.scope === 'Type')];
}
function builtin(element: ElementInfo, name: string): DrawingPropertyValue | undefined {
    const values: Record<string, string | undefined> = {
        category: element.category, name: element.name, family: element.family, type: element.type, level: element.level,
        model: element.model, mark: element.mark, elementid: element.elementIdText ?? (Number.isSafeInteger(element.elementId) ? String(element.elementId) : undefined),
        firerating: element.fireRating, wallfunction: element.wallFunction, elementkey: element.key, typekey: element.typeKey, modelkey: element.modelKey, linkinstanceid: element.linkInstanceId,
    };
    if (!Object.hasOwn(values, name)) return undefined;
    const value = values[name];
    if (value === undefined || !value.trim()) return missing();
    const scope = name === 'firerating' && element.fireRatingSource === 'Type' ? 'Type' : 'Element';
    return { value, scope, unit: null, source: 'element', state: 'value' };
}
function parametersFor(context: AgentContext, element: ElementInfo, property: string): ParameterInfo[] {
    const { name, scope } = splitProperty(property);
    const matches = ownedParameters(context, element).filter((p) => identity(p.name) === identity(name) && (!scope || p.scope === scope));
    if (scope) return matches;
    const instance = matches.filter((p) => p.scope === 'Instance');
    return instance.length ? instance : matches.filter((p) => p.scope === 'Type');
}
function propertyValue(context: AgentContext, element: ElementInfo, property: string): DrawingPropertyValue {
    const { name, scope } = splitProperty(property);
    if (!scope) {
        const value = builtin(element, identity(name));
        // Missing identity summaries can still have a corresponding exported parameter.
        if (value?.state === 'value') return value;
    }
    const matches = parametersFor(context, element, property);
    if (!matches.length) return missing();
    const distinct = new Map(matches.map((p) => [JSON.stringify([p.value, p.unitId ?? null, p.valueSource ?? null, p.specId ?? null]), p]));
    if (distinct.size > 1) return { value: null, scope: matches[0]!.scope, unit: null, source: null, state: 'conflicting' };
    const parameter = matches[0]!;
    if (!parameter.value.trim()) return missing();
    return { value: parameter.value, scope: parameter.scope, unit: parameter.unitId ?? null, source: parameter.valueSource ?? null, state: 'value' };
}

interface Quantity { value: number; dimension: string }
const units: Record<string, readonly [string, number]> = {
    mm: ['length', .001], millimeter: ['length', .001], millimeters: ['length', .001], millimetre: ['length', .001], millimetres: ['length', .001],
    cm: ['length', .01], centimeter: ['length', .01], centimeters: ['length', .01], centimetre: ['length', .01], centimetres: ['length', .01],
    m: ['length', 1], meter: ['length', 1], meters: ['length', 1], metre: ['length', 1], metres: ['length', 1],
    in: ['length', .0254], inch: ['length', .0254], inches: ['length', .0254], fractionalinches: ['length', .0254],
    ft: ['length', .3048], foot: ['length', .3048], feet: ['length', .3048], feetfractionalinches: ['length', .3048], decimalfeet: ['length', .3048],
    m2: ['area', 1], squaremeters: ['area', 1], squaremetres: ['area', 1], sqm: ['area', 1],
    ft2: ['area', .09290304], squarefeet: ['area', .09290304], sqft: ['area', .09290304],
    in2: ['area', .00064516], squareinches: ['area', .00064516], sqin: ['area', .00064516],
    mm2: ['area', .000001], squaremillimeters: ['area', .000001], squaremillimetres: ['area', .000001],
    m3: ['volume', 1], cubicmeters: ['volume', 1], cubicmetres: ['volume', 1],
    ft3: ['volume', .028316846592], cubicfeet: ['volume', .028316846592],
    in3: ['volume', .000016387064], cubicinches: ['volume', .000016387064],
    mm3: ['volume', 1e-9], cubicmillimeters: ['volume', 1e-9], cubicmillimetres: ['volume', 1e-9],
    rad: ['angle', 1], radian: ['angle', 1], radians: ['angle', 1],
    deg: ['angle', Math.PI / 180], degree: ['angle', Math.PI / 180], degrees: ['angle', Math.PI / 180],
    s: ['time', 1], sec: ['time', 1], second: ['time', 1], seconds: ['time', 1],
    min: ['time', 60], minute: ['time', 60], minutes: ['time', 60],
    h: ['time', 3600], hr: ['time', 3600], hrs: ['time', 3600], hour: ['time', 3600], hours: ['time', 3600],
    number: ['number', 1], integer: ['number', 1], unitless: ['number', 1], ratio: ['number', 1], general: ['number', 1],
    '%': ['number', .01], percent: ['number', .01], percentage: ['number', .01],
};
function unit(value: string): readonly [string, number] | undefined {
    const id = value.toLowerCase().replace(/^autodesk\.unit\.unit:/, '').replace(/-\d+(?:\.\d+)*$/, '').replace(/²/g, '2').replace(/³/g, '3').replace(/°/g, 'deg').replace(/\s|\^|\./g, '');
    return Object.hasOwn(units, id) ? units[id] : undefined;
}
function magnitude(value: string): number | undefined {
    const text = value.trim();
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
        const number = Number(text);
        return Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number)) ? number : undefined;
    }
    const match = /^([+-])?(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(text);
    if (!match || Number(match[4]) === 0) return undefined;
    return (match[1] === '-' ? -1 : 1) * (Number(match[2] ?? 0) + Number(match[3]) / Number(match[4]));
}
function quantity(value: string, unitId?: string | null, unitless = false): Quantity | undefined {
    const text = value.trim().replace(/[′’]/g, "'").replace(/[″“”]/g, '"');
    const feet = /^([+-]?\d+(?:\.\d+)?)\s*(?:'|(?:ft\.?|feet|foot)(?=\s|$))\s*(?:-\s*)?(.*?)$/i.exec(text);
    if (feet) {
        const remainder = feet[2]!.replace(/(?:"|inches|inch|in\.?)\s*$/i, '').trim();
        const inches = remainder ? magnitude(remainder) : 0;
        if (inches === undefined || inches < 0 || inches >= 12) return undefined;
        return { value: (Number(feet[1]) + (feet[1]!.startsWith('-') ? -inches : inches) / 12) * .3048, dimension: 'length' };
    }
    const explicit = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[+-]?(?:\d+\s+)?\d+\/\d+)\s*([^\d\s].*)$/i.exec(text);
    const amount = magnitude(explicit ? explicit[1]! : text);
    if (amount === undefined || !Number.isFinite(amount)) return undefined;
    const suffix = explicit?.[2]!.trim().replace(/^"$/, 'in');
    const descriptor = suffix ? unit(suffix) : unitId ? unit(unitId) : unitless ? ['number', 1] as const : undefined;
    return descriptor ? { value: amount * descriptor[1], dimension: descriptor[0] } : undefined;
}
function numericProperty(context: AgentContext, element: ElementInfo, property: string, value: DrawingPropertyValue): Quantity | undefined {
    if (value.state !== 'value' || value.value === null || value.source === 'internal' || value.source === 'reference') return undefined;
    // Names, IDs, levels, and type labels are identities, even when their text contains a size.
    if (value.source === 'element' && identity(splitProperty(property).name) !== 'firerating') return undefined;
    const parameters = parametersFor(context, element, property);
    const declaredNumber = parameters.some((p) => p.valueSource === 'integer' || /(?:^|:)(?:number|integer|int|numberOf\w*)(?:-|$)/i.test(p.specId ?? ''));
    return quantity(value.value, value.unit, declaredNumber);
}
function testFilter(context: AgentContext, element: ElementInfo, filter: DrawingQuery['filters'][number]): boolean | undefined {
    const actual = propertyValue(context, element, filter.property);
    if (filter.operator === 'exists') return actual.state !== 'missing';
    if (filter.operator === 'missing') return actual.state === 'missing';
    if (actual.state !== 'value' || actual.value === null) return undefined;
    const wanted = filter.value ?? '';
    if (filter.operator === 'contains') return normalize(actual.value).includes(normalize(wanted));
    const a = numericProperty(context, element, filter.property, actual), b = quantity(wanted, null, true);
    if (filter.operator === 'equals' || filter.operator === 'not_equals') {
        if (a && b && a.dimension !== b.dimension) return undefined;
        const property = splitProperty(filter.property);
        const textIdentity = !property.scope && builtinNames.has(identity(property.name)) && identity(property.name) !== 'firerating';
        if (!a && b && !textIdentity && (b.dimension !== 'number' || actual.source === 'internal' ||
            actual.source !== 'reference' && /^[+-]?(?:\d|\.\d)/.test(actual.value))) return undefined;
        const equal = a && b ? Math.abs(a.value - b.value) <= Math.max(1, Math.abs(a.value), Math.abs(b.value)) * 1e-9 : normalize(actual.value) === normalize(wanted);
        return filter.operator === 'equals' ? equal : !equal;
    }
    if (!a || !b || a.dimension !== b.dimension) return undefined;
    if (filter.operator === 'gt') return a.value > b.value;
    if (filter.operator === 'gte') return a.value >= b.value;
    if (filter.operator === 'lt') return a.value < b.value;
    return a.value <= b.value;
}

function catalog(context: AgentContext) {
    const properties = new Map<string, { name: string; scopes: Set<string>; units: Set<string>; valueSources: Set<string> }>();
    for (const name of BUILT_INS) properties.set(identity(name), { name, scopes: new Set(['Element']), units: new Set(), valueSources: new Set(['element']) });
    for (const element of context.elements) for (const p of ownedParameters(context, element)) {
        const id = identity(p.name), entry = properties.get(id) ?? { name: p.name, scopes: new Set<string>(), units: new Set<string>(), valueSources: new Set<string>() };
        entry.scopes.add(p.scope);
        if (p.unitId) entry.units.add(p.unitId);
        if (p.valueSource) entry.valueSources.add(p.valueSource);
        properties.set(id, entry);
    }
    return properties;
}
function knownProperty(properties: ReturnType<typeof catalog>, property: string): boolean {
    const parts = splitProperty(property), entry = properties.get(identity(parts.name));
    return !!entry && (!parts.scope || entry.scopes.has(parts.scope));
}
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function bounded(data: DrawingQueryData): DrawingQueryData {
    data.warnings = data.warnings.slice(0, 10).map((warning) => clipped(warning, 320));
    while (byteLength(data) > MAX_DATA_BYTES && data.rows.length) { data.rows.pop(); data.truncated = true; }
    while (byteLength(data) > MAX_DATA_BYTES && data.groups.length) { data.groups.pop(); data.truncated = true; }
    while (byteLength(data) > MAX_DATA_BYTES && data.availableProperties?.length) { data.availableProperties.pop(); data.truncated = true; }
    data.returned = data.rows.length;
    data.hasMore = data.offset + data.returned < data.total;
    return data;
}
function failed(context: AgentContext, error: string): DrawingQueryResult {
    return { data: { pageNumber: context.pageNumber, total: 0, locatable: 0, rows: [], groups: [], groupCount: 0, warnings: [], truncated: false, returned: 0, offset: 0, hasMore: false, error }, elementKeys: new Set() };
}
function validQuery(query: DrawingQuery): boolean {
    const names = (list: unknown, max: number) => Array.isArray(list) && list.length <= max && list.every((name) => typeof name === 'string' && !!name.trim() && name.length <= 160);
    return !!query && names(query.categories, 20) && names(query.properties, 12) && (query.search === null || typeof query.search === 'string' && query.search.length <= 300) &&
        (query.groupBy === null || typeof query.groupBy === 'string' && !!query.groupBy.trim() && query.groupBy.length <= 160) &&
        Number.isInteger(query.offset) && query.offset >= 0 && query.offset <= 1_000_000 && Number.isInteger(query.limit) && query.limit >= 1 && query.limit <= 25 &&
        Array.isArray(query.filters) && query.filters.length <= 12 && query.filters.every((filter) => !!filter && typeof filter.property === 'string' && !!filter.property.trim() && filter.property.length <= 160 &&
            ['equals', 'not_equals', 'contains', 'gt', 'gte', 'lt', 'lte', 'exists', 'missing'].includes(filter.operator) &&
            (filter.value === null || typeof filter.value === 'string' && filter.value.length <= 500) &&
            (['exists', 'missing'].includes(filter.operator) || filter.value !== null));
}
function row(context: AgentContext, element: ElementInfo, properties: readonly string[]): DrawingQueryRow {
    return { key: element.key, elementId: element.elementIdText ?? (Number.isSafeInteger(element.elementId) ? String(element.elementId) : 'Unavailable exact ID'),
        name: clipped(element.name), category: clipped(element.category, 160), locatable: context.locatableKeys.has(element.key),
        properties: Object.fromEntries(properties.map((property) => { const value = propertyValue(context, element, property); return [property, { ...value, value: value.value === null ? null : clipped(value.value), unit: value.unit === null ? null : clipped(value.unit, 160) }]; })) };
}

/** Query actual exported current-page records; complete membership never leaves the browser. */
export function queryDrawingElements(context: AgentContext, query: DrawingQuery): DrawingQueryResult {
    if (!validQuery(query)) return failed(context, 'Invalid query. Use up to 20 categories, 12 filters/properties, and a row limit from 1 to 25.');
    const properties = catalog(context);
    for (const property of [...query.filters.map((filter) => filter.property), ...query.properties, ...(query.groupBy ? [query.groupBy] : [])]) {
        if (!knownProperty(properties, property)) return failed(context, `Unknown exported property: ${clipped(property, 160)}. Inspect the drawing's property catalog before filtering.`);
    }
    const requested = new Set(query.categories.map((category) => normalize(singularCategory(category))));
    const knownCategories = new Set(context.elements.map((element) => normalize(singularCategory(element.category))));
    const unknown = query.categories.filter((category) => !knownCategories.has(normalize(singularCategory(category))));
    if (unknown.length) return failed(context, `Unknown categories in this drawing: ${unknown.map((category) => clipped(category, 160)).join(', ')}.`);
    const unresolved = new Set<string>();
    const search = normalize(query.search ?? '');
    const matched = context.elements.filter((element) => {
        if (requested.size && !requested.has(normalize(singularCategory(element.category)))) return false;
        if (search) {
            const text = [element.key, element.elementIdText ?? String(element.elementId), element.name, element.category, element.family, element.type, element.level, element.model, element.mark,
                ...ownedParameters(context, element).flatMap((parameter) => [parameter.name, parameter.value])].filter(Boolean).join(' ');
            if (!normalize(text).includes(search)) return false;
        }
        for (const filter of query.filters) {
            const result = testFilter(context, element, filter);
            if (result === undefined) unresolved.add(element.key);
            if (result !== true) return false;
        }
        return true;
    });
    const elementKeys = new Set(matched.map((element) => element.key));
    const allGroups = new Map<string, { label: string; elementKeys: Set<string> }>();
    if (query.groupBy) for (const element of matched) {
        const value = propertyValue(context, element, query.groupBy);
        const label = value.state === 'missing' ? 'No exported value' : value.state === 'conflicting' ? 'Conflicting exported values' : value.value!;
        const id = `${value.state}:${normalize(label)}`;
        const group = allGroups.get(id) ?? { label, elementKeys: new Set<string>() };
        group.elementKeys.add(element.key); allGroups.set(id, group);
    }
    const groups = [...allGroups.values()].sort((a, b) => b.elementKeys.size - a.elementKeys.size || a.label.localeCompare(b.label));
    const data: DrawingQueryData = { pageNumber: context.pageNumber, total: matched.length, locatable: matched.filter((element) => context.locatableKeys.has(element.key)).length,
        rows: matched.slice(query.offset, query.offset + query.limit).map((element) => row(context, element, query.properties)),
        groups: groups.slice(0, 40).map((group) => ({ label: clipped(group.label), count: group.elementKeys.size, locatable: [...group.elementKeys].filter((key) => context.locatableKeys.has(key)).length })), groupCount: allGroups.size,
        warnings: unresolved.size ? [`Excluded ${unresolved.size} element${unresolved.size === 1 ? '' : 's'} with missing, conflicting, or incompatible filter values. Numeric comparisons require known compatible units or explicit unitless metadata.`] : [],
        truncated: query.offset + query.limit < matched.length || groups.length > 40,
        returned: 0, offset: query.offset, hasMore: false };
    return { data: bounded(data), elementKeys, ...(query.groupBy ? { groups } : {}) };
}

/** Inspect current scope and available property names before constructing a query. */
export function inspectDrawing(context: AgentContext) {
    const categories = new Map<string, { name: string; count: number; locatable: number }>();
    for (const element of context.elements) {
        const entry = categories.get(element.category) ?? { name: clipped(element.category, 160), count: 0, locatable: 0 };
        entry.count++; if (context.locatableKeys.has(element.key)) entry.locatable++;
        categories.set(element.category, entry);
    }
    const builtInOrder = new Map(BUILT_INS.map((name, index) => [identity(name), index]));
    const allProperties = [...catalog(context).values()].sort((a, b) =>
        (builtInOrder.get(identity(a.name)) ?? 1000) - (builtInOrder.get(identity(b.name)) ?? 1000) || a.name.localeCompare(b.name));
    const workspace = context as AgentContext & { pageCount?: number; selectedKeys?: ReadonlySet<string>; fileName?: string };
    const scoped = new Set(context.elements.map((element) => element.key));
    const selected = workspace.selectedKeys ? [...workspace.selectedKeys].filter((key) => scoped.has(key)) : null;
    const data = { pageNumber: context.pageNumber, pageCount: workspace.pageCount ?? null, fileName: workspace.fileName ? clipped(workspace.fileName) : null,
        elementCount: context.elements.length, locatableCount: context.elements.filter((element) => context.locatableKeys.has(element.key)).length,
        selectedCount: selected?.length ?? null, selectedElementKeys: selected?.slice(0, 25) ?? [], selectionTruncated: (selected?.length ?? 0) > 25,
        categories: [...categories.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 80),
        properties: allProperties.slice(0, 120).map((property) => ({ name: clipped(property.name, 160), scopes: [...property.scopes], units: [...property.units].slice(0, 8).map((value) => clipped(value, 160)), valueSources: [...property.valueSources] })),
        truncated: categories.size > 80 || allProperties.length > 120 };
    while (byteLength(data) > MAX_DATA_BYTES && data.properties.length) { data.properties.pop(); data.truncated = true; }
    while (byteLength(data) > MAX_DATA_BYTES && data.categories.length) { data.categories.pop(); data.truncated = true; }
    while (byteLength(data) > MAX_DATA_BYTES && data.selectedElementKeys.length) { data.selectedElementKeys.pop(); data.selectionTruncated = true; data.truncated = true; }
    return data;
}

/** Inspect exact local identities; unknown keys never become fabricated records. */
export function inspectDrawingElements(context: AgentContext, keys: readonly string[], properties: readonly string[]): DrawingQueryResult {
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 50 || keys.some((key) => typeof key !== 'string' || !key || key.length > 2_000) ||
        !Array.isArray(properties) || properties.length > 12 || properties.some((property) => typeof property !== 'string' || !property.trim() || property.length > 160)) return failed(context, 'Inspect up to 50 exact element keys and 12 exported properties.');
    const wanted = new Set(keys), elements = context.elements.filter((element) => wanted.has(element.key));
    const available = catalog({ ...context, elements });
    const selected = properties.length ? [...properties] : [...available.values()].filter((entry) => !builtinNames.has(identity(entry.name))).map((entry) => entry.name).slice(0, 12);
    const result = queryDrawingElements({ ...context, elements }, { categories: [], search: null, filters: [], properties: selected, groupBy: null, offset: 0, limit: 25 });
    if (wanted.size > elements.length) result.data.warnings.push(`${wanted.size - elements.length} requested identities are not in the current drawing scope.`);
    result.data.availableProperties = [...available.values()].map((entry) => clipped(entry.name, 160)).slice(0, 120);
    result.data.truncated ||= !properties.length && [...available.values()].filter((entry) => !builtinNames.has(identity(entry.name))).length > selected.length;
    result.data = bounded(result.data);
    return result;
}
