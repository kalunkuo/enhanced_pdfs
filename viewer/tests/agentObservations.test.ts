import { describe, expect, it } from 'vitest';
import { validateAgentObservations } from '../src/lib/agentApi';
import { appendAgentObservation, boundedObservationData, MAX_OBSERVATION_BYTES, MAX_OBSERVATION_TOTAL_BYTES, MAX_OBSERVATIONS, observationBytes, type AgentJson, type AgentObservation } from '../src/lib/agentObservations';
import { parseAgentRequest } from '../server/agentMiddleware';

const observation = (id: string, data: AgentJson): AgentObservation => ({ id, tool: 'query_elements', data });
const request = (observations: unknown) => ({ prompt: 'Inspect the drawing.', history: [], observations, context: {
    pageNumber: 1, elementCount: 1, locatableCount: 1, categories: [{ name: 'Walls', count: 1 }], commentCount: 0, commentsStatus: 'ready',
} });
const largeData = (resultId: string): AgentJson => ({ resultId, total: 1000, locatable: 1000, rows: Array.from({ length: 8 }, (_, index) => ({ key: `e${index}`, text: 'x'.repeat(1400) })) });

describe('agent observation transport limits', () => {
    it('preserves bounded facts and validates them again at the server boundary', () => {
        const facts = [observation('o1', { resultId: 'r1', total: 2, rows: [{ key: 'wall-a', properties: { Manufacturer: { value: 'Acme', scope: 'Instance' } } }] })];
        expect(validateAgentObservations(facts)).toEqual(facts);
        expect(parseAgentRequest(request(facts)).observations).toEqual(facts);
        expect(observationBytes('雪')).toBe(5);
    });

    it('rejects unsupported tools, duplicate identities, extra fields, and malformed JSON structures', () => {
        let nested: unknown = { value: 'leaf' };
        for (let i = 0; i < 11; i++) nested = { nested };
        const invalid = [
            null, {}, [{ id: 'o1', tool: 'delete_model', data: {} }],
            [observation('o1', {}), observation('o1', {})],
            [{ ...observation('o1', {}), authorization: 'not-allowed' }],
            [{ id: 'x'.repeat(41), tool: 'query_elements', data: {} }],
            [observation('o1', 'x'.repeat(4001))],
            [observation('o1', NaN)], [observation('o1', Infinity)],
            [observation('o1', Array.from({ length: 201 }, () => 1))],
            [observation('o1', Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`k${index}`, 1])))],
            [observation('o1', { ['x'.repeat(201)]: 'value' })],
            [{ id: 'o1', tool: 'query_elements', data: nested }],
        ];
        for (const value of invalid) {
            expect(() => validateAgentObservations(value)).toThrow();
            expect(() => parseAgentRequest(request(value))).toThrow();
        }
    });

    it('enforces each UTF-8 result budget independently of the total request size', () => {
        const value = observation('o1', { rows: Array.from({ length: 7 }, () => ({ value: 'é'.repeat(1000) })) });
        expect(observationBytes(value)).toBeGreaterThan(MAX_OBSERVATION_BYTES);
        expect(observationBytes([value])).toBeLessThan(MAX_OBSERVATION_TOTAL_BYTES);
        expect(() => validateAgentObservations([value])).toThrow();
        expect(() => parseAgentRequest(request([value]))).toThrow('Invalid or oversized drawing tool results');
    });

    it('enforces total bytes and observation count even when every individual result is valid', () => {
        const large = Array.from({ length: 5 }, (_, index) => observation(`o${index}`, largeData(`r${index + 1}`)));
        for (const item of large) expect(validateAgentObservations([item])).toEqual([item]);
        expect(observationBytes(large)).toBeGreaterThan(MAX_OBSERVATION_TOTAL_BYTES);
        expect(() => validateAgentObservations(large)).toThrow('too large');
        expect(() => parseAgentRequest(request(large))).toThrow('Invalid or oversized drawing tool results');
        const tooMany = Array.from({ length: MAX_OBSERVATIONS + 1 }, (_, index) => observation(`o${index}`, {}));
        expect(() => validateAgentObservations(tooMany)).toThrow();
    });
});

describe('bounded observation construction', () => {
    it('truncates whole result rows while preserving count/handle facts and leaving the source unchanged', () => {
        const input = { resultId: 'r4', total: 400, rows: Array.from({ length: 400 }, (_, index) => ({ key: `wall-${index}`, value: '雪'.repeat(200) })) };
        const data = boundedObservationData(input) as { resultId: string; total: number; rows: { key: string; value: string }[]; truncated: boolean };
        expect(data).toMatchObject({ resultId: 'r4', total: 400, truncated: true });
        expect(data.rows.length).toBeGreaterThan(0);
        expect(data.rows.length).toBeLessThan(input.rows.length);
        expect(data.rows).toEqual(input.rows.slice(0, data.rows.length));
        expect(input.rows).toHaveLength(400);
        expect(observationBytes(data)).toBeLessThan(MAX_OBSERVATION_BYTES);
        expect(() => validateAgentObservations([observation('o1', data)])).not.toThrow();
    });

    it('also truncates structural overflows that are smaller than the byte budget', () => {
        const input = { resultId: 'r9', total: 201, rows: Array.from({ length: 201 }, (_, index) => ({ key: `e${index}` })) };
        expect(observationBytes(input)).toBeLessThan(MAX_OBSERVATION_BYTES);
        const bounded = boundedObservationData(input);
        expect(() => validateAgentObservations([observation('o1', bounded)])).not.toThrow();
        expect(bounded).toMatchObject({ resultId: 'r9', total: 201, truncated: true });
        expect((bounded as { rows: unknown[] }).rows.length).toBeLessThanOrEqual(200);
    });

    it('produces server-valid fallback data for excessive nesting and object width', () => {
        let nested: unknown = 'leaf';
        for (let i = 0; i < 15; i++) nested = { nested };
        const wide = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`k${index}`, index]));
        for (const input of [nested, wide]) {
            const bounded = boundedObservationData(input);
            expect(() => validateAgentObservations([observation('o1', bounded)])).not.toThrow();
        }
    });

    it('serializes exact integer values and safely handles cyclic input', () => {
        const exact = boundedObservationData({ elementId: 9007199254740993n, value: 'x'.repeat(5000) });
        expect(exact).toMatchObject({ elementId: '9007199254740993' });
        expect(() => validateAgentObservations([observation('o1', exact)])).not.toThrow();
        const cycle: { self?: unknown } = {}; cycle.self = cycle;
        const bounded = boundedObservationData(cycle);
        expect(bounded).toMatchObject({ truncated: true });
        expect(() => validateAgentObservations([observation('o2', bounded)])).not.toThrow();
    });

    it('summarizes old rows to retain result handles within the total budget without mutating prior observations', () => {
        const first = observation('o1', largeData('r1'));
        const original = structuredClone(first);
        let observations = [first];
        for (let index = 2; index <= 6; index++) observations = appendAgentObservation(observations, observation(`o${index}`, largeData(`r${index}`)));
        expect(observationBytes(observations)).toBeLessThanOrEqual(MAX_OBSERVATION_TOTAL_BYTES);
        expect(observations[0]?.data).toMatchObject({ resultId: 'r1', total: 1000, locatable: 1000, truncated: true });
        expect(observations).toHaveLength(6);
        expect(first).toEqual(original);
        expect(() => validateAgentObservations(observations)).not.toThrow();
    });

    it('keeps only the newest observation window when there are more than 32 small results', () => {
        let observations: AgentObservation[] = [];
        for (let index = 1; index <= 40; index++) observations = appendAgentObservation(observations, observation(`o${index}`, { total: index }));
        expect(observations).toHaveLength(MAX_OBSERVATIONS);
        expect(observations[0]?.id).toBe('o9');
        expect(observations.at(-1)?.id).toBe('o40');
        expect(() => validateAgentObservations(observations)).not.toThrow();
    });
});
