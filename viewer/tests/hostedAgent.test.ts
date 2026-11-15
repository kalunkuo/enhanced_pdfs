import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostedAgentHandler, hostedBody, sameSiteRequest } from '../server/hostedAgent';
import { RequestError } from '../server/agentMiddleware';
import type { planAgentRequest } from '../server/agentProvider';

const bedrockEnv = { AGENT_PROVIDER: 'bedrock', AWS_BEARER_TOKEN_BEDROCK: 'server-only-test-token', AWS_REGION: 'us-east-1', BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-5-5' };
const input = {
    prompt: 'Color walls by fire rating', history: [],
    context: { pageNumber: 1, elementCount: 3, locatableCount: 2, categories: [{ name: 'Walls', count: 3 }], commentCount: 0, commentsStatus: 'ready' },
};
type Parsed = IncomingMessage & { body?: unknown };
const headers = (extra: Record<string, string | string[] | undefined>, body?: unknown): Parsed => ({ headers: extra, body } as unknown as Parsed);

const servers: Server[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    })));
});

async function serve(env: Record<string, string> = bedrockEnv, plan: typeof planAgentRequest = vi.fn(async () => ({ message: 'Done.', actions: [] }))) {
    const handler = createHostedAgentHandler(env, { plan });
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    return { base: `http://127.0.0.1:${address.port}`, host: `127.0.0.1:${address.port}` };
}

describe('sameSiteRequest', () => {
    it('admits the deployed site itself, including behind the platform proxy', () => {
        expect(sameSiteRequest(headers({ host: 'viewer.example', origin: 'https://viewer.example' }))).toBe(true);
        expect(sameSiteRequest(headers({ host: 'internal.lambda', 'x-forwarded-host': 'viewer.example', origin: 'https://viewer.example' }))).toBe(true);
        expect(sameSiteRequest(headers({ host: 'viewer.example', 'sec-fetch-site': 'same-origin' }))).toBe(true);
    });

    it('rejects cross-site browser requests and malformed origins', () => {
        expect(sameSiteRequest(headers({ host: 'viewer.example', origin: 'https://other.example' }))).toBe(false);
        expect(sameSiteRequest(headers({ host: 'viewer.example', 'sec-fetch-site': 'cross-site' }))).toBe(false);
        expect(sameSiteRequest(headers({ host: 'viewer.example', origin: 'not a url' }))).toBe(false);
        expect(sameSiteRequest(headers({}))).toBe(false);
    });
});

describe('hostedBody', () => {
    it('uses a body the platform already parsed, as an object or a JSON string', async () => {
        const json = { 'content-type': 'application/json' };
        expect(await hostedBody(headers(json, { a: 1 }))).toEqual({ a: 1 });
        expect(await hostedBody(headers(json, '{"a":2}'))).toEqual({ a: 2 });
    });

    it('keeps the local API limits on type, validity and size', async () => {
        await expect(hostedBody(headers({ 'content-type': 'text/plain' }, 'x'))).rejects.toMatchObject({ status: 415 });
        await expect(hostedBody(headers({ 'content-type': 'application/json' }, '{'))).rejects.toMatchObject({ status: 400 });
        const huge = { prompt: 'x'.repeat(130 * 1024) };
        await expect(hostedBody(headers({ 'content-type': 'application/json' }, huge))).rejects.toBeInstanceOf(RequestError);
    });
});

describe('hosted agent HTTP API', () => {
    it('reports configuration from environment variables without disclosing the token', async () => {
        const { base } = await serve();
        const response = await fetch(`${base}/api/agent/status`);
        expect(response.status).toBe(200);
        const body = await response.text();
        expect(JSON.parse(body)).toEqual({ configured: true, provider: 'bedrock', model: 'us.anthropic.claude-opus-5-5' });
        expect(body).not.toContain('server-only-test-token');
        const unset = await serve({});
        expect(await (await fetch(`${unset.base}/api/agent/status`)).json()).toMatchObject({ configured: false });
    });

    it('serves same-site requests from the stream body and refuses cross-site ones', async () => {
        const plan = vi.fn<typeof planAgentRequest>(async () => ({ message: 'Done.', actions: [] }));
        const { base, host } = await serve(bedrockEnv, plan);
        const ok = await fetch(`${base}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://${host}` }, body: JSON.stringify(input) });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ message: 'Done.', actions: [] });
        expect(plan).toHaveBeenCalledTimes(1);
        expect(plan.mock.calls[0]![1]).toMatchObject({ provider: 'bedrock', apiKey: 'server-only-test-token' });
        const denied = await fetch(`${base}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: JSON.stringify(input) });
        expect(denied.status).toBe(403);
        expect(plan).toHaveBeenCalledTimes(1);
    });

    it('answers 404 for any other path', async () => {
        const { base } = await serve();
        expect((await fetch(`${base}/api/other`)).status).toBe(404);
    });
});
