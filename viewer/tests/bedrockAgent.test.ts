import { describe, expect, it, vi } from 'vitest';
import { planBedrockAgentRequest } from '../server/bedrockAgent';
import { planAgentRequest } from '../server/agentProvider';
import { AgentProviderError } from '../server/agentProviderError';
import type { AgentApiRequest } from '../src/lib/agentApi';

const request: AgentApiRequest = {
    prompt: 'Use 42 inches instead',
    history: [{ role: 'user', content: 'Compare doors at 36 inches' }, { role: 'assistant', content: 'Compared exported widths at 36 inches.' }],
    context: { pageNumber: 1, elementCount: 1204, locatableCount: 1099, categories: [{ name: 'Doors', count: 34 }], commentCount: 0, commentsStatus: 'ready' },
};
const config = { provider: 'bedrock' as const, apiKey: 'test-bedrock-never-return', region: 'us-east-1', model: 'us.anthropic.claude-opus-5-5' };
const tool = (name = 'compare_door_widths', input: unknown = { thresholdInches: 42 }) => ({ toolUse: { name, input, toolUseId: 'tool-1' } });
const answer = (content: unknown[], stopReason = 'tool_use') => ({ stopReason, output: { message: { role: 'assistant', content } } });
const mockFetch = (body: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('server-only Amazon Bedrock planner', () => {
    it('uses Converse bearer auth, bounded context, and supported drawing tool shapes', async () => {
        const fetch = mockFetch(answer([tool()]));
        expect(await planBedrockAgentRequest(request, config, { fetch })).toEqual({ message: '', actions: [{ name: 'compare_door_widths', arguments: { thresholdInches: 42 } }] });
        const [url, init] = fetch.mock.calls[0]!;
        expect(url).toBe(`https://bedrock-runtime.us-east-1.amazonaws.com/model/${config.model}/converse`);
        expect(init?.headers).toEqual({ Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' });
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ inferenceConfig: { maxTokens: 4096 }, system: [{ text: expect.stringContaining('Never claim an action succeeded') }, { text: expect.stringContaining(JSON.stringify(request.context)) }] });
        expect(body.messages).toEqual([...request.history, { role: 'user', content: request.prompt }].map((turn) => ({ role: turn.role, content: [{ text: turn.content }] })));
        expect(body.toolConfig.tools.map((entry: { toolSpec: { name: string } }) => entry.toolSpec.name)).toEqual(['color_walls_by_fire_rating', 'compare_door_widths', 'latest_comments', 'clear_highlights']);
        expect(body.toolConfig.tools[0].toolSpec.inputSchema.json).toMatchObject({ additionalProperties: false, required: ['rating'], properties: { rating: { type: ['string', 'null'] } } });
        expect(JSON.stringify(body)).not.toContain(config.apiKey);
        expect(JSON.stringify(body)).not.toContain('strict');
        expect(JSON.stringify(body)).not.toContain('maxLength');
        expect(JSON.stringify(body)).not.toContain('maximum');
    });

    it('discards opaque adaptive reasoning and unverified action prose', async () => {
        const fetch = mockFetch(answer([{ reasoningContent: { reasoningText: { text: 'private reasoning not retained', signature: 'private-signature' } } }, { text: 'I highlighted 999 doors.' }, tool()]));
        const result = await planBedrockAgentRequest(request, config, { fetch });
        expect(result).toEqual({ message: '', actions: [{ name: 'compare_door_widths', arguments: { thresholdInches: 42 } }] });
        expect(JSON.stringify(result)).not.toMatch(/private|999/);
        expect(await planBedrockAgentRequest(request, config, { fetch: mockFetch(answer([{ reasoningContent: { redactedContent: 'opaque' } }, { text: 'What width should I use?' }], 'end_turn')) })).toEqual({ message: 'What width should I use?', actions: [] });
    });

    it('normalizes bounded history to a user-first alternating conversation', async () => {
        const fetch = mockFetch(answer([{ text: 'What width should I use?' }], 'end_turn'));
        await planBedrockAgentRequest({ ...request, history: [{ role: 'assistant', content: 'Leading old answer' }, { role: 'user', content: '' }, { role: 'user', content: 'Compare doors' }, { role: 'user', content: 'Use inches' }] }, config, { fetch });
        const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
        expect(body.messages).toEqual([{ role: 'user', content: [{ text: 'Compare doors' }, { text: 'Use inches' }, { text: request.prompt }] }]);
    });

    it.each([
        tool('delete_everything', {}), tool('compare_door_widths', { thresholdInches: -1 }),
        tool('compare_door_widths', { thresholdInches: 42, code: 'bad' }), tool('latest_comments', { page: 1 }),
        tool('color_walls_by_fire_rating', { rating: true }), tool('latest_comments', 'not an object'),
        { toolUse: { name: 'latest_comments', input: {}, toolUseId: '' } },
        { toolUse: { name: 'latest_comments', input: { data: 'x'.repeat(4097) }, toolUseId: 'tool-1' } },
        { image: { source: 'unsupported' } }, null,
    ])('rejects invalid or unsupported tool output before any drawing action', async (block) => {
        await expect(planBedrockAgentRequest(request, config, { fetch: mockFetch(answer([block])) })).rejects.toMatchObject({ name: 'AgentProviderError', status: 502 });
    });

    it.each([
        answer([tool()], 'max_tokens'), answer([tool()], 'end_turn'), answer([], 'end_turn'), answer([{ text: ' ' }], 'end_turn'),
        answer([{ text: 'x'.repeat(8001) }], 'end_turn'), answer([tool()], 'guardrail_intervened'), answer([{ text: 'Denied' }], 'content_filtered'),
        answer([{ reasoningContent: { reasoningText: { text: 'reasoning only' } } }], 'end_turn'),
        answer(Array.from({ length: 5 }, () => tool('latest_comments', {}))),
        { stopReason: 'tool_use', output: { message: { role: 'user', content: [tool()] } } },
    ])('rejects incomplete, refused, empty, and excessive results', async (body) => {
        await expect(planBedrockAgentRequest(request, config, { fetch: mockFetch(body) })).rejects.toMatchObject({ status: 502 });
    });

    it.each([[401, 401], [403, 401], [429, 429], [408, 504], [504, 504], [400, 502], [404, 502], [500, 502]])('sanitizes upstream HTTP %s without returning credentials or provider text', async (status, expectedStatus) => {
        const error = await planBedrockAgentRequest(request, config, { fetch: mockFetch({ message: `echo ${config.apiKey}` }, status) }).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(AgentProviderError);
        expect(error).toMatchObject({ status: expectedStatus });
        expect(String(error)).not.toContain(config.apiKey);
        expect(JSON.stringify(error)).not.toContain(config.apiKey);
    });

    it('rejects missing or invalid regional configuration before fetching', async () => {
        const fetch = mockFetch(answer([tool()]));
        for (const patch of [{ apiKey: '' }, { region: '' }, { model: '' }, { region: 'us-east-1.attacker.example' }]) {
            await expect(planBedrockAgentRequest(request, { ...config, ...patch }, { fetch })).rejects.toMatchObject({ status: 503 });
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it('passes cancellation through and never returns action results after abort', async () => {
        const controller = new AbortController();
        const fetch = mockFetch(answer([tool()]));
        controller.abort();
        await expect(planBedrockAgentRequest(request, config, { fetch, signal: controller.signal })).rejects.toMatchObject({ status: 504 });
        expect(fetch).not.toHaveBeenCalled();
        const active = new AbortController();
        const cancelledFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
            expect(init?.signal).toBe(active.signal);
            active.abort();
            return new Response(JSON.stringify(answer([tool()])), { status: 200 });
        });
        await expect(planBedrockAgentRequest(request, config, { fetch: cancelledFetch, signal: active.signal })).rejects.toMatchObject({ status: 504 });
    });

    it('sanitizes transport and unreadable success errors', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(`Transport exposes ${config.apiKey}`));
        const error = await planBedrockAgentRequest(request, config, { fetch }).catch((error: unknown) => error);
        expect(error).toMatchObject({ status: 502 });
        expect(String(error)).not.toContain(config.apiKey);
        await expect(planBedrockAgentRequest(request, config, { fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('not json')) })).rejects.toMatchObject({ status: 502 });
    });

    it('dispatches Bedrock and existing OpenAI requests through the same provider boundary', async () => {
        const bedrock = mockFetch(answer([tool('latest_comments', {})]));
        expect(await planAgentRequest(request, config, { fetch: bedrock })).toEqual({ message: '', actions: [{ name: 'latest_comments', arguments: {} }] });
        expect(String(bedrock.mock.calls[0]?.[0])).toContain('bedrock-runtime.us-east-1.amazonaws.com');
        const openai = mockFetch({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'What threshold should I use?' }] }] });
        expect(await planAgentRequest(request, { apiKey: 'test-openai', model: 'test-model' }, { fetch: openai })).toEqual({ message: 'What threshold should I use?', actions: [] });
        expect(openai.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/responses');
    });
});
