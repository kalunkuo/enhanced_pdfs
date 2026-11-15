export type AgentJson = null | boolean | number | string | AgentJson[] | { [key: string]: AgentJson };
export interface AgentObservation { id: string; tool: string; data: AgentJson }

export const MAX_OBSERVATIONS = 32;
export const MAX_OBSERVATION_BYTES = 12 * 1024;
export const MAX_OBSERVATION_TOTAL_BYTES = 40 * 1024;
const encoder = new TextEncoder();
export const observationBytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).byteLength;

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Validate untrusted facts separately from tool arguments; these facts never grant tool authority. */
export function parseAgentObservations(value: unknown, tools: ReadonlySet<string>): AgentObservation[] {
    if (!Array.isArray(value) || value.length > MAX_OBSERVATIONS) throw new Error('Invalid agent observations.');
    let nodes = 0;
    const json = (item: unknown, depth: number): item is AgentJson => {
        if (++nodes > 15_000 || depth > 10) return false;
        if (item === null || typeof item === 'boolean') return true;
        if (typeof item === 'number') return Number.isFinite(item);
        if (typeof item === 'string') return item.length <= 4000;
        if (Array.isArray(item)) return item.length <= 200 && item.every((entry) => json(entry, depth + 1));
        return record(item) && Object.keys(item).length <= 100 && Object.entries(item).every(([key, entry]) => key.length <= 200 && json(entry, depth + 1));
    };
    const ids = new Set<string>();
    const result = value.map((item): AgentObservation => {
        if (!record(item) || Object.keys(item).length !== 3 || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(item.id) || ids.has(item.id) ||
            typeof item.tool !== 'string' || !tools.has(item.tool) || !Object.hasOwn(item, 'data') || !json(item.data, 0) || observationBytes(item) > MAX_OBSERVATION_BYTES) {
            throw new Error('Invalid agent observations.');
        }
        ids.add(item.id);
        return { id: item.id, tool: item.tool, data: item.data };
    });
    if (observationBytes(result) > MAX_OBSERVATION_TOTAL_BYTES) throw new Error('Agent observations are too large.');
    return result;
}

/** Local tool data is already bounded; trim whole rows if it still exceeds the transport budget. */
export function boundedObservationData(value: unknown): AgentJson {
    let truncated = false, nodes = 0;
    const visited = new WeakSet<object>();
    const clean = (item: unknown, depth = 0): AgentJson => {
        if (++nodes > 7000 || depth > 8) { truncated = true; return '[Nested data omitted]'; }
        if (item === null || typeof item === 'boolean') return item;
        if (typeof item === 'number') { if (Number.isFinite(item)) return item; truncated = true; return null; }
        if (typeof item === 'bigint') return item.toString();
        if (typeof item === 'string') { truncated ||= item.length > 3000; return item.slice(0, 3000); }
        if (!item || typeof item !== 'object' || visited.has(item)) { truncated = true; return null; }
        visited.add(item);
        if (Array.isArray(item)) {
            truncated ||= item.length > 200;
            const array = item.slice(0, 200).map((entry) => clean(entry, depth + 1));
            visited.delete(item);
            return array;
        }
        const entries = Object.entries(item).filter(([key]) => { if (key.length <= 200) return true; truncated = true; return false; });
        truncated ||= entries.length > 99;
        const object = Object.fromEntries(entries.slice(0, 99).map(([key, entry]) => [key, clean(entry, depth + 1)]));
        visited.delete(item);
        return object;
    };
    const data = clean(value);
    if (truncated && record(data)) data.truncated = true;
    if (truncated && !record(data)) return boundedObservationData({ value: data, truncated: true });
    const budget = MAX_OBSERVATION_BYTES - 256;
    if (record(data)) {
        while (observationBytes(data) > budget) {
            const arrays = Object.values(data).filter((entry): entry is AgentJson[] => Array.isArray(entry) && entry.length > 0).sort((a, b) => observationBytes(b) - observationBytes(a));
            if (!arrays[0]) break;
            arrays[0].pop();
            data.truncated = true;
        }
    }
    return observationBytes(data) <= budget ? data : { error: 'The tool result was too large. Request fewer rows or properties.', truncated: true };
}

/** Retain handle/count summaries when older rows must leave the bounded observation window. */
export function appendAgentObservation(observations: readonly AgentObservation[], observation: AgentObservation): AgentObservation[] {
    const result = [...observations, { ...observation, data: boundedObservationData(observation.data) }].slice(-MAX_OBSERVATIONS);
    const valid = () => { try { parseAgentObservations(result, new Set(result.map((entry) => entry.tool))); return true; } catch { return false; } };
    for (let index = 0; !valid() && index < result.length - 1; index++) {
        const previous = result[index]!;
        const data = record(previous.data) ? previous.data : {};
        const summary: Record<string, AgentJson> = { truncated: true };
        for (const key of ['resultId', 'selectionResultId', 'total', 'locatable', 'matched', 'id', 'message', 'error']) {
            const value = data[key];
            if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') summary[key] = typeof value === 'string' ? value.slice(0, 300) : value;
        }
        result[index] = { ...previous, data: summary };
    }
    while (result.length && !valid()) result.shift();
    return result;
}
