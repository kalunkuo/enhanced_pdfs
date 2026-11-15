import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAgentMiddleware, readJson, RequestError, type AgentMiddlewareOptions } from './agentMiddleware';
import { resolveAgentConfig } from './agentConfig';

/**
 * The drawing agent as a hosted serverless function (Vercel, `api/agent.ts` and `api/agent/status.ts`).
 * It is the same middleware the local Vite server runs, with two differences: requests are admitted
 * from the deployed site itself instead of loopback only, and the body may already be parsed by the
 * platform. Credentials come from the platform's environment variables, never from the browser.
 */

const MAX_BODY_BYTES = 128 * 1024;

/** The site's own host as the platform's proxy reports it. */
function requestHost(request: IncomingMessage): string | null {
    const forwarded = request.headers['x-forwarded-host'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    return first || request.headers.host?.trim() || null;
}

/**
 * Browser requests from the deployed viewer: same host, never a cross-site fetch. This stops other
 * sites from calling the function from a visitor's browser; it does not stop a direct request, so
 * the deployed function is a demo setting (see README, "Hosted agent API").
 */
export function sameSiteRequest(request: IncomingMessage): boolean {
    const host = requestHost(request);
    if (!host) return false;
    if (request.headers['sec-fetch-site'] === 'cross-site') return false;
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
        const source = new URL(origin);
        return ['http:', 'https:'].includes(source.protocol) && source.host === host;
    } catch {
        return false;
    }
}

/** Vercel's Node runtime parses JSON bodies before the handler runs; anywhere else the stream is read. */
export async function hostedBody(request: IncomingMessage & { body?: unknown }): Promise<unknown> {
    if (request.body === undefined) return readJson(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415, 'Send agent requests as JSON.');
    let body: unknown = request.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); }
        catch { throw new RequestError(400, 'The agent request is not valid JSON.'); }
    }
    if ((JSON.stringify(body) ?? '').length > MAX_BODY_BYTES) throw new RequestError(413, 'The agent request is too large. Clear the conversation and try again.');
    return body;
}

/** One handler serves both routes; the middleware dispatches on the request path. */
export function createHostedAgentHandler(env: Record<string, string | undefined> = process.env, options: Pick<AgentMiddlewareOptions, 'plan' | 'timeoutMs'> = {}) {
    const middleware = createAgentMiddleware(resolveAgentConfig(env), { ...options, allowRequest: sameSiteRequest, readBody: hostedBody });
    return (request: IncomingMessage, response: ServerResponse) => middleware(request, response, () => {
        response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: 'Not found.' }));
    });
}
