import { describe, expect, it } from 'vitest';
import { fingerprintBytes, nextAnnotationNumber, parseSessionState, SESSION_VERSION } from '../src/lib/session';
import type { Annotation } from '../src/lib/types';

const valid = {
    version: SESSION_VERSION,
    fingerprint: 'abc',
    page: 3,
    annotations: [
        { id: 'a1', page: 1, kind: 'pen', from: [0, 0], to: [5, 5], points: [[0, 0], [5, 5]], elementKey: 'w1' },
        { id: 'a2', page: 2, kind: 'comment', from: [1, 2], to: [1, 2], text: 'Check rating' },
    ],
    selectedKey: 'w1',
    selectedAnnotationId: 'a2',
    filters: { search: 'wall', facets: { category: ['Walls'], drawing: ['d1'] } },
    zoomMode: { kind: 'value', value: 2 },
    tab: 'notes',
    drawKind: 'rect',
    highlightColor: '#ff0',
};

describe('parseSessionState', () => {
    it('round-trips a structured clone of valid state', () => {
        expect(parseSessionState(structuredClone(valid))).toEqual(valid);
    });

    it('rejects missing, foreign, or older records', () => {
        expect(parseSessionState(undefined)).toBeNull();
        expect(parseSessionState('state')).toBeNull();
        expect(parseSessionState({ ...valid, version: 0 })).toBeNull();
        expect(parseSessionState({ ...valid, fingerprint: 42 })).toBeNull();
    });

    it('drops malformed annotations and falls back per field', () => {
        const state = parseSessionState({
            ...valid,
            page: -2,
            annotations: [valid.annotations[0], { id: 'bad', page: 1, kind: 'laser', from: [0, 0], to: [1, 1] }, { id: 'a9', page: 1, kind: 'line', from: [0], to: [1, 1] }],
            filters: { search: 7, facets: { category: ['Walls', 3], level: 'L1', empty: [] } },
            zoomMode: { kind: 'value', value: -1 },
            tab: 'settings',
            drawKind: null,
        });
        expect(state?.page).toBe(1);
        expect(state?.annotations.map((a) => a.id)).toEqual(['a1']);
        expect(state?.filters).toEqual({ search: '', facets: { category: ['Walls'] } });
        expect(state?.zoomMode).toEqual({ kind: 'fit-width' });
        expect(state?.tab).toBe('properties');
        expect(state?.drawKind).toBe('pen');
    });

    it('clamps a remembered zoom value into the supported range', () => {
        const state = parseSessionState({ ...valid, zoomMode: { kind: 'value', value: 1e6 } });
        expect(state?.zoomMode.kind).toBe('value');
        expect(state?.zoomMode.kind === 'value' && state.zoomMode.value < 1e6).toBe(true);
    });
});

describe('nextAnnotationNumber', () => {
    const a = (id: string): Annotation => ({ id, page: 1, kind: 'text', from: [0, 0], to: [0, 0] });
    it('continues after the highest viewer ID so restored markups keep unique IDs', () => {
        expect(nextAnnotationNumber([])).toBe(1);
        expect(nextAnnotationNumber([a('a1'), a('a7'), a('a3')])).toBe(8);
        expect(nextAnnotationNumber([a('imported'), a('x2')])).toBe(3);
    });
});

describe('fingerprintBytes', () => {
    it('distinguishes file revisions', async () => {
        const one = await fingerprintBytes(new Uint8Array([1, 2, 3]));
        expect(one).toMatch(/^[0-9a-f]{64}$/);
        expect(await fingerprintBytes(new Uint8Array([1, 2, 3]))).toBe(one);
        expect(await fingerprintBytes(new Uint8Array([1, 2, 4]))).not.toBe(one);
    });
});
