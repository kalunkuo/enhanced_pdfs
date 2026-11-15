import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentModelContext, executeAgentAction, getAgentApiStatus, parseAgentAction, parseAgentApiResponse, requestAgent, type AgentChatTurn } from '../src/lib/agentApi';
import type { AgentContext } from '../src/lib/drawingAgent';

const context = (more: Partial<AgentContext> = {}): AgentContext => ({
    elements: [
        { key: 'private-wall-key', elementId: 123456, name: 'Private model name', category: 'Walls', fireRating: 'NR' },
        { key: 'door-1', elementId: 77, name: 'Private door name', category: 'Doors' },
    ],
    parameters: new Map([['door-1', [{ name: 'Width', value: '42 in', scope: 'Instance' }]]]),
    pageNumber: 2,
    locatableKeys: new Set(['private-wall-key', 'door-1', 'outside-page']),
    comments: [{ id: 'comment-secret', page: 2, text: 'Private comment body', author: 'Private reviewer', source: 'viewer' }],
    ...more,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('API-selected drawing actions', () => {
    it('accepts only the supported exact tool arguments', () => {
        expect(parseAgentAction({ name: 'color_walls_by_fire_rating', arguments: { rating: ' NR ' } })).toEqual({ name: 'color_walls_by_fire_rating', arguments: { rating: 'NR' } });
        expect(parseAgentAction({ name: 'compare_door_widths', arguments: { thresholdInches: 42 } })).toEqual({ name: 'compare_door_widths', arguments: { thresholdInches: 42 } });
        for (const action of [
            { name: 'delete_element', arguments: {} },
            { name: 'latest_comments', arguments: { elementId: 'invented' } },
            { name: 'clear_highlights', arguments: {}, code: 'execute me' },
            { name: 'color_walls_by_fire_rating', arguments: {} },
            { name: 'color_walls_by_fire_rating', arguments: { rating: '' } },
            { name: 'color_walls_by_fire_rating', arguments: { rating: 'x'.repeat(81) } },
            { name: 'compare_door_widths', arguments: { thresholdInches: '42' } },
            ...[0, -1, NaN, Infinity, 10001].map((thresholdInches) => ({ name: 'compare_door_widths', arguments: { thresholdInches } })),
        ]) expect(() => parseAgentAction(action)).toThrow('unsupported response');
    });

    it('validates all response actions before exposing any result', () => {
        expect(parseAgentApiResponse({ message: 'Which threshold?', actions: [] })).toEqual({ message: 'Which threshold?', actions: [] });
        expect(() => parseAgentApiResponse({ message: '', actions: [] })).toThrow();
        expect(() => parseAgentApiResponse({ message: 'ok', actions: Array.from({ length: 5 }, () => ({ name: 'latest_comments', arguments: {} })) })).toThrow();
        expect(() => parseAgentApiResponse({ message: 'ok', actions: [{ name: 'clear_highlights', arguments: {} }, { name: 'unsupported', arguments: {} }] })).toThrow();
        expect(() => parseAgentApiResponse({ message: 'ok', actions: [], apiKey: 'secret' })).toThrow();
    });

    it('uses typed local execution for NR/unspecified ratings, numeric widths, notes and clear', () => {
        const c = context({ elements: [...context().elements, { key: 'wall-unknown', elementId: 88, category: 'Walls', name: 'Wall' }] });
        expect([...executeAgentAction({ name: 'color_walls_by_fire_rating', arguments: { rating: 'NR' } }, c).highlight!.elementKeys]).toEqual(['private-wall-key']);
        expect([...executeAgentAction({ name: 'color_walls_by_fire_rating', arguments: { rating: 'Unspecified' } }, c).highlight!.elementKeys]).toEqual(['wall-unknown']);
        expect(executeAgentAction({ name: 'compare_door_widths', arguments: { thresholdInches: 36 } }, c).highlight?.colors.get('door-1')).toBe('var(--color-agent-alert)');
        expect(executeAgentAction({ name: 'latest_comments', arguments: {} }, c).comments?.[0]?.id).toBe('comment-secret');
        expect(executeAgentAction({ name: 'clear_highlights', arguments: {} }, c)).toEqual({ message: 'Agent highlights cleared.', highlight: null });
    });
});

describe('API transport and local source authority', () => {
    it('sends aggregates only, without model identities, parameters, or comment contents', () => {
        const snapshot = buildAgentModelContext(context());
        expect(snapshot).toEqual({ pageNumber: 2, elementCount: 2, locatableCount: 2, categories: [{ name: 'Doors', count: 1 }, { name: 'Walls', count: 1 }], commentCount: 1, commentsStatus: 'ready' });
        const body = JSON.stringify(snapshot);
        for (const forbidden of ['private-wall-key', '123456', 'Private model name', 'Private comment body', 'Private reviewer', 'Width', '42 in']) expect(body).not.toContain(forbidden);
    });

    it('bounds category names/count while preserving truthful total element counts', () => {
        const elements = Array.from({ length: 90 }, (_, i) => ({ key: `e${i}`, elementId: i, name: `Element ${i}`, category: `${String(i).padStart(3, '0')}${'x'.repeat(200)}` }));
        elements.push({ key: 'duplicate', elementId: 91, name: 'Element 91', category: elements[89]!.category });
        const snapshot = buildAgentModelContext(context({ elements, locatableKeys: new Set(elements.map((element) => element.key)) }));
        expect(snapshot.elementCount).toBe(91);
        expect(snapshot.locatableCount).toBe(91);
        expect(snapshot.categories).toHaveLength(80);
        expect(snapshot.categories.every((category) => category.name.length <= 160)).toBe(true);
        expect(snapshot.categories[0]).toEqual({ name: elements[89]!.category.slice(0, 160), count: 2 });
        expect(snapshot.categories.reduce((total, category) => total + category.count, 0)).toBe(81);
    });

    it('reads connection status without receiving any key', async () => {
        const fetchMock = vi.fn(async () => json({ configured: true, provider: 'openai', model: 'configured-model' }));
        vi.stubGlobal('fetch', fetchMock);
        expect(await getAgentApiStatus()).toEqual({ configured: true, provider: 'openai', model: 'configured-model' });
        expect(fetchMock).toHaveBeenCalledWith('/api/agent/status', { cache: 'no-store', signal: undefined });
    });

    it('rejects unsupported status payloads', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ configured: true, provider: 'openai', model: 'x', key: 'secret' })));
        await expect(getAgentApiStatus()).rejects.toThrow('unsupported response');
    });

    it('accepts Bedrock model and inference profile identifiers without receiving credentials', async () => {
        const model = `arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/${'profile-'.repeat(20)}`;
        vi.stubGlobal('fetch', vi.fn(async () => json({ configured: true, provider: 'bedrock', model })));
        expect(await getAgentApiStatus()).toEqual({ configured: true, provider: 'bedrock', model });
    });

    it('accepts an unconfigured Bedrock service before a model has been selected', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ configured: false, provider: 'bedrock', model: '' })));
        expect(await getAgentApiStatus()).toEqual({ configured: false, provider: 'bedrock', model: '' });
    });

    it.each([
        { configured: true, provider: 'bedrock', model: '' },
        { configured: true, provider: 'bedrock', model: 'x'.repeat(2049) },
        { configured: true, provider: 'openai', model: 'x'.repeat(101) },
        { configured: true, provider: 'unknown', model: 'model' },
        { configured: false, provider: 'bedrock', model: '', token: 'private-token' },
    ])('rejects malformed or secret-bearing connection metadata %#', async (status) => {
        vi.stubGlobal('fetch', vi.fn(async () => json(status)));
        await expect(getAgentApiStatus()).rejects.toThrow('unsupported response');
    });

    it('uses local facts instead of provider-invented completion counts and bounds history', async () => {
        const fetchMock = vi.fn(async () => json({ message: 'I highlighted 999 doors!', actions: [{ name: 'compare_door_widths', arguments: { thresholdInches: 36 } }] }));
        vi.stubGlobal('fetch', fetchMock);
        const history: AgentChatTurn[] = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i} ${'x'.repeat(5000)}` }));
        const result = await requestAgent('  Check doors at 36 inches  ', history, context());
        expect(result.message).toContain('1 matching element');
        expect(result.message).not.toContain('999');
        expect(result.highlight?.elementKeys).toEqual(new Set(['door-1']));
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/agent');
        const payload = JSON.parse(init.body as string);
        expect(payload.prompt).toBe('Check doors at 36 inches');
        expect(payload.history).toHaveLength(12);
        expect(payload.history[0].content).toHaveLength(4000);
        expect(JSON.stringify(payload)).not.toContain('Private comment body');
        expect(history[0]?.content.length).toBeGreaterThan(4000);
    });

    it('combines a comments query with highlights while preserving the last requested overlay', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ message: '', actions: [
            { name: 'compare_door_widths', arguments: { thresholdInches: 36 } },
            { name: 'latest_comments', arguments: {} },
        ] })));
        const result = await requestAgent('Show doors and latest comments', [], context());
        expect(result.highlight?.title).toBe('Door widths · 36 in');
        expect(result.comments?.[0]?.text).toBe('Private comment body');
        expect(result.message).toContain('1 comment');
    });

    it('executes received tools against the latest geometry and comment context', async () => {
        const sendContext = context({ locatableKeys: new Set(), comments: [], commentsStatus: 'loading' });
        let latest = sendContext;
        vi.stubGlobal('fetch', vi.fn(async () => {
            latest = context({ comments: [...context().comments, { id: 'new-reply', page: 2, text: 'A reply added while the model was planning.', source: 'viewer', createdAt: '2026-11-15T00:00:00Z' }] });
            return json({ message: '', actions: [
                { name: 'compare_door_widths', arguments: { thresholdInches: 36 } },
                { name: 'latest_comments', arguments: {} },
            ] });
        }));
        const result = await requestAgent('Compare doors and show comments', [], sendContext, undefined, () => latest);
        expect(result.message).toContain('1 can be highlighted');
        expect(result.message).toContain('2 comments on page 2');
        expect(result.message).not.toContain('still loading');
        expect(result.comments?.[0]?.id).toBe('new-reply');
        expect(sendContext.comments).toEqual([]);
        expect(sendContext.locatableKeys.size).toBe(0);
    });

    it('returns a model clarification when it requests no drawing actions', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'What width threshold should I use?', actions: [] })));
        expect(await requestAgent('Compare doors', [], context())).toEqual({ message: 'What width threshold should I use?' });
    });

    it.each([
        [401, 'access was rejected'], [403, 'access was rejected'], [429, 'usage limit'],
        [503, 'not configured'], [504, 'timed out'], [413, 'shorter request'], [500, 'could not complete'],
    ])('shows a safe error for status %s without returning upstream secrets', async (status, expected) => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'sk-secret-provider-key-and-raw-server-stack' }, status as number)));
        await expect(requestAgent('Check walls', [], context())).rejects.toThrow(expected as string);
        await expect(requestAgent('Check walls', [], context())).rejects.not.toThrow('sk-secret');
    });

    it('does not mistake a static hosting HTML fallback for a working API', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>App fallback</html>', { headers: { 'Content-Type': 'text/html' } })));
        await expect(getAgentApiStatus()).rejects.toThrow('API is unavailable');
    });

    it('rejects malformed model responses rather than silently using demo results', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Done', actions: [{ name: 'unknown', arguments: {} }] })));
        await expect(requestAgent('Check walls', [], context())).rejects.toThrow('No drawing action was applied');
    });

    it('propagates cancellation and never performs stale local actions', async () => {
        const controller = new AbortController();
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
            expect(init.signal).toBe(controller.signal);
            controller.abort();
            return json({ message: 'done', actions: [{ name: 'clear_highlights', arguments: {} }] });
        }));
        await expect(requestAgent('Clear colors', [], context(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects oversized input before making an API request', async () => {
        const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
        await expect(requestAgent('x'.repeat(4001), [], context())).rejects.toThrow('4,000');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
