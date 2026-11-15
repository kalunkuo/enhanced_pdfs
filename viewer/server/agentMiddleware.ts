import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { AgentApiRequest, AgentChatTurn, AgentModelContext } from '../src/lib/agentApi';
import { AgentProviderError, planAgentRequest } from './openaiAgent';

export interface AgentServerConfig { apiKey: string; model: string }
type Next = (error?: unknown) => void;
type Planner = typeof planAgentRequest;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_HISTORY = 12;

class RequestError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
    return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}
function count(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000;
}

/** Only bounded conversation text and a small drawing summary cross the API boundary. */
export function parseAgentRequest(value: unknown): AgentApiRequest {
    if (!record(value) || !exactKeys(value, ['prompt', 'history', 'context']) ||
        typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 4000 ||
        !Array.isArray(value.history) || value.history.length > MAX_HISTORY) {
        throw new RequestError(400, 'Invalid agent request. Shorten your message and try again.');
    }
    const history = value.history.map((turn: unknown): AgentChatTurn => {
        if (!record(turn) || !exactKeys(turn, ['role', 'content']) ||
            (turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.content !== 'string' || turn.content.length > 4000) {
            throw new RequestError(400, 'Invalid conversation history. Clear the conversation and try again.');
        }
        return { role: turn.role, content: turn.content };
    });
    const context = value.context;
    if (!record(context) || !exactKeys(context, ['pageNumber', 'elementCount', 'locatableCount', 'categories', 'commentCount', 'commentsStatus']) ||
        !count(context.pageNumber) || context.pageNumber < 1 || !count(context.elementCount) ||
        !count(context.locatableCount) || context.locatableCount > context.elementCount || !count(context.commentCount) ||
        !['loading', 'ready', 'error'].includes(String(context.commentsStatus)) ||
        !Array.isArray(context.categories) || context.categories.length > 80 ||
        !context.categories.every((entry: unknown) => record(entry) && exactKeys(entry, ['name', 'count']) &&
            typeof entry.name === 'string' && entry.name.length > 0 && entry.name.length <= 160 && count(entry.count))) {
        throw new RequestError(400, 'Invalid drawing context. Reopen the drawing and try again.');
    }
    return { prompt: value.prompt.trim(), history, context: context as unknown as AgentModelContext };
}

function json(response: ServerResponse, status: number, value: unknown) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(value));
}

function sameLocalOrigin(request: IncomingMessage) {
    const host = request.headers.host;
    if (!host) return false;
    try {
        const target = new URL(`http://${host}`);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return false;
        if (request.headers['sec-fetch-site'] === 'cross-site') return false;
        const origin = request.headers.origin;
        if (!origin) return true;
        const source = new URL(origin);
        return ['http:', 'https:'].includes(source.protocol) && source.host === target.host;
    } catch { return false; }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
        throw new RequestError(415, 'Send agent requests as JSON.');
    }
    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new RequestError(413, 'The agent request is too large. Clear the conversation and try again.');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.length;
        if (length > MAX_BODY_BYTES) throw new RequestError(413, 'The agent request is too large. Clear the conversation and try again.');
        chunks.push(bytes);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new RequestError(400, 'The agent request is not valid JSON.'); }
}

/** A loopback-only API for this local hackathon app, shared by Vite dev and preview. */
export function createAgentMiddleware(config: AgentServerConfig, options: { plan?: Planner; timeoutMs?: number } = {}) {
    const plan = options.plan ?? planAgentRequest;
    let inFlight = 0;
    return (request: IncomingMessage, response: ServerResponse, next: Next) => {
        const path = request.url?.split('?')[0];
        if (path !== '/api/agent' && path !== '/api/agent/status') return next();
        if (!sameLocalOrigin(request)) return json(response, 403, { error: 'The drawing agent API is available only from this local viewer.' });
        const method = path === '/api/agent/status' ? 'GET' : 'POST';
        if (request.method !== method) {
            response.setHeader('Allow', method);
            return json(response, 405, { error: `Use ${method} for this endpoint.` });
        }
        if (path === '/api/agent/status') return json(response, 200, { configured: !!config.apiKey.trim(), provider: 'openai', model: config.model });
        if (!config.apiKey.trim()) return json(response, 503, { error: 'Add OPENAI_API_KEY to viewer/.env.local and restart the viewer, or use Local demo.' });
        if (inFlight >= 2) return json(response, 429, { error: 'The drawing agent is busy. Wait for the current request to finish.' });
        inFlight++;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
        const onClose = () => { if (!response.writableEnded) controller.abort(); };
        response.on('close', onClose);
        void (async () => {
            try {
                const input = parseAgentRequest(await readJson(request));
                if (controller.signal.aborted) throw new RequestError(504, 'The drawing agent timed out. Try again.');
                const result = await plan(input, config, { signal: controller.signal });
                json(response, 200, result);
            } catch (error) {
                if (controller.signal.aborted) json(response, 504, { error: 'The drawing agent timed out. Try again.' });
                else if (error instanceof RequestError || error instanceof AgentProviderError) json(response, error.status, { error: error.message });
                else json(response, 502, { error: 'The drawing agent could not complete the request. Try again or use Local demo.' });
            } finally {
                clearTimeout(timer);
                response.off('close', onClose);
                inFlight--;
            }
        })();
    };
}

export function agentApiPlugin(config: AgentServerConfig): Plugin {
    return {
        name: 'drawing-agent-api',
        configureServer(server) { server.middlewares.use(createAgentMiddleware(config)); },
        configurePreviewServer(server) { server.middlewares.use(createAgentMiddleware(config)); },
    };
}
