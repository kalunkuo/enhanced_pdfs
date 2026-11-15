import { describe, expect, it, vi } from 'vitest';
import { AgentProviderError, planAgentRequest } from '../server/openaiAgent';
import type { AgentApiRequest } from '../src/lib/agentApi';

const request: AgentApiRequest = {
    prompt: 'Use 42 inches instead',
    history: [{ role: 'user', content: 'Compare door widths at 36 inches' }, { role: 'assistant', content: 'Compared exported widths at 36 inches.' }],
    context: { pageNumber: 1, elementCount: 1204, locatableCount: 1099, categories: [{ name: 'Doors', count: 34 }], commentCount: 0, commentsStatus: 'ready' },
};
const config = { apiKey: 'test-secret-never-return', model: 'configured-model' };
const completed = (output: unknown[]) => ({ status: 'completed', output });
const call = (name = 'compare_door_widths', args = '{"thresholdInches":42}') => ({ type: 'function_call', name, arguments: args, call_id: 'call_1' });
const message = (text: string) => ({ type: 'message', status: 'completed', content: [{ type: 'output_text', text }] });
const mockFetch = (body: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('server-only OpenAI action planner', () => {
    it('uses Responses with strict functions, server authorization, compact scope and no storage', async () => {
        const fetch = mockFetch(completed([call()]));
        expect(await planAgentRequest(request, config, { fetch })).toEqual({ message: '', actions: [{ name: 'compare_door_widths', arguments: { thresholdInches: 42 } }] });
        const [url, init] = fetch.mock.calls[0]!;
        expect(url).toBe('https://api.openai.com/v1/responses');
        expect(init?.headers).toEqual({ Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' });
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ model: 'configured-model', store: false, max_output_tokens: 2048, parallel_tool_calls: false });
        expect(body.input).toEqual([
            { role: 'developer', content: expect.stringContaining(JSON.stringify(request.context)) },
            ...request.history, { role: 'user', content: request.prompt },
        ]);
        expect(body.tools).toHaveLength(4);
        expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(['color_walls_by_fire_rating', 'compare_door_widths', 'latest_comments', 'clear_highlights']);
        for (const tool of body.tools) expect(tool).toMatchObject({ type: 'function', strict: true, parameters: { type: 'object', additionalProperties: false } });
        expect(body.tools[0].parameters.required).toEqual(['rating']);
        expect(body.tools[0].parameters.properties.rating.type).toEqual(['string', 'null']);
        expect(JSON.stringify(body)).not.toContain(config.apiKey);
        expect(body.instructions).toContain('Never claim an action succeeded');
    });

    it('returns clarification text when there is no action and ignores reasoning items', async () => {
        const fetch = mockFetch(completed([{ type: 'reasoning', summary: [] }, message('What width threshold should I use?')]));
        expect(await planAgentRequest(request, config, { fetch })).toEqual({ message: 'What width threshold should I use?', actions: [] });
    });

    it('discards unverified model prose when drawing actions will supply the result', async () => {
        const fetch = mockFetch(completed([message('I highlighted 999 doors.'), call('color_walls_by_fire_rating', '{"rating":null}'), call('latest_comments', '{}')]));
        expect(await planAgentRequest(request, config, { fetch })).toEqual({ message: '', actions: [
            { name: 'color_walls_by_fire_rating', arguments: { rating: null } }, { name: 'latest_comments', arguments: {} },
        ] });
    });

    it.each([
        [call('delete_everything', '{}')],
        [call('compare_door_widths', '{"thresholdInches":-5}')],
        [call('compare_door_widths', '{"thresholdInches":42,"secret":"x"}')],
        [call('latest_comments', '{"page":2}')],
        [call('color_walls_by_fire_rating', '{"rating":true}')],
        [call('compare_door_widths', 'not json')],
        [call('compare_door_widths', 'x'.repeat(4097))],
        [{ ...call(), call_id: '' }],
        [{ ...call(), status: 'in_progress' }],
        [{ ...call(), status: 'incomplete' }],
        [null],
        [{ type: 'web_search_call' }],
    ])('rejects invalid or unsupported model output without executing anything', async (item) => {
        await expect(planAgentRequest(request, config, { fetch: mockFetch(completed([item])) })).rejects.toMatchObject({ name: 'AgentProviderError', status: 502 });
    });

    it('accepts an explicitly completed function call', async () => {
        const fetch = mockFetch(completed([{ ...call(), status: 'completed' }]));
        expect(await planAgentRequest(request, config, { fetch })).toEqual({ message: '', actions: [{ name: 'compare_door_widths', arguments: { thresholdInches: 42 } }] });
    });

    it.each([
        { status: 'incomplete', output: [call()] },
        { status: 'failed', output: [] },
        completed([]),
        completed([message('   ')]),
        completed([message('x'.repeat(8001))]),
        completed([{ type: 'message', status: 'in_progress', content: [{ type: 'output_text', text: 'Partial answer' }] }]),
        completed([{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }]),
        completed([{ type: 'message', content: 'wrong' }]),
        completed(Array.from({ length: 5 }, () => call('latest_comments', '{}'))),
    ])('rejects empty, refused, incomplete or excessive results', async (body) => {
        await expect(planAgentRequest(request, config, { fetch: mockFetch(body) })).rejects.toMatchObject({ name: 'AgentProviderError', status: 502 });
    });

    it.each([[401, 401], [403, 401], [429, 429], [408, 504], [504, 504], [400, 502], [404, 502], [500, 502]])('sanitizes upstream HTTP %s errors', async (status, expectedStatus) => {
        const fetch = mockFetch({ error: { message: `Upstream echoes ${config.apiKey}` } }, status);
        const error = await planAgentRequest(request, config, { fetch }).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(AgentProviderError);
        expect(error).toMatchObject({ status: expectedStatus });
        expect(String(error)).not.toContain(config.apiKey);
        expect(JSON.stringify(error)).not.toContain(config.apiKey);
    });

    it('rejects missing server config without sending a network request', async () => {
        const fetch = mockFetch(completed([call()]));
        await expect(planAgentRequest(request, { ...config, apiKey: ' ' }, { fetch })).rejects.toMatchObject({ status: 503 });
        await expect(planAgentRequest(request, { ...config, model: '' }, { fetch })).rejects.toMatchObject({ status: 503 });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not leak fetch exceptions and passes the caller signal through', async () => {
        const controller = new AbortController();
        const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(`Request failed with ${config.apiKey}`));
        const error = await planAgentRequest(request, config, { fetch, signal: controller.signal }).catch((error: unknown) => error);
        expect(error).toMatchObject({ status: 502 });
        expect(String(error)).not.toContain(config.apiKey);
        expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
        controller.abort();
        await expect(planAgentRequest(request, config, { fetch, signal: controller.signal })).rejects.toMatchObject({ status: 504 });
    });

    it('sanitizes non-JSON provider success bodies', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(`not json ${config.apiKey}`, { status: 200 }));
        const error = await planAgentRequest(request, config, { fetch }).catch((error: unknown) => error);
        expect(error).toMatchObject({ status: 502 });
        expect(String(error)).not.toContain(config.apiKey);
    });
});
