import { colorWallsByFireRating, compareDoorWidths, latestComments, type AgentContext, type AgentResult } from './drawingAgent';

export type AgentAction =
    | { name: 'color_walls_by_fire_rating'; arguments: { rating: string | null } }
    | { name: 'compare_door_widths'; arguments: { thresholdInches: number } }
    | { name: 'latest_comments'; arguments: Record<string, never> }
    | { name: 'clear_highlights'; arguments: Record<string, never> };

export interface AgentChatTurn { role: 'user' | 'assistant'; content: string }
export interface AgentModelContext {
    pageNumber: number;
    elementCount: number;
    locatableCount: number;
    categories: { name: string; count: number }[];
    commentCount: number;
    commentsStatus: 'loading' | 'ready' | 'error';
}
export interface AgentApiRequest { prompt: string; history: AgentChatTurn[]; context: AgentModelContext }
export interface AgentApiResponse { message: string; actions: AgentAction[] }
export interface AgentApiStatus { configured: boolean; provider: 'openai'; model: string }

const INVALID_RESPONSE = 'The agent returned an unsupported response. No drawing action was applied. Try again or switch to Local demo.';
const UNAVAILABLE = 'The agent API is unavailable. Start the viewer with bun run dev, or use Local demo.';
const invalid = () => new Error(INVALID_RESPONSE);
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Validate every provider-selected action before any local drawing change. */
export function parseAgentAction(value: unknown): AgentAction {
    const action = record(value);
    if (!exactKeys(action, ['name', 'arguments'])) throw invalid();
    const args = record(action.arguments);
    switch (action.name) {
        case 'color_walls_by_fire_rating': {
            if (!exactKeys(args, ['rating']) || (args.rating !== null && (typeof args.rating !== 'string' || !args.rating.trim() || args.rating.length > 80))) throw invalid();
            return { name: action.name, arguments: { rating: args.rating === null ? null : (args.rating as string).trim() } };
        }
        case 'compare_door_widths':
            if (!exactKeys(args, ['thresholdInches']) || typeof args.thresholdInches !== 'number' || !Number.isFinite(args.thresholdInches) || args.thresholdInches <= 0 || args.thresholdInches > 10_000) throw invalid();
            return { name: action.name, arguments: { thresholdInches: args.thresholdInches } };
        case 'latest_comments':
        case 'clear_highlights':
            if (!exactKeys(args, [])) throw invalid();
            return { name: action.name, arguments: {} };
        default: throw invalid();
    }
}

export function parseAgentApiResponse(value: unknown): AgentApiResponse {
    const response = record(value);
    if (!exactKeys(response, ['message', 'actions']) || typeof response.message !== 'string' || response.message.length > 8_000 || !Array.isArray(response.actions) || response.actions.length > 4) throw invalid();
    const actions = response.actions.map(parseAgentAction);
    if (!actions.length && !response.message.trim()) throw invalid();
    return { message: response.message.trim(), actions };
}

/** Only aggregate capabilities leave the browser; drawing records and comments stay local. */
export function buildAgentModelContext(context: AgentContext): AgentModelContext {
    const categories = new Map<string, number>();
    for (const element of context.elements) categories.set(element.category, (categories.get(element.category) ?? 0) + 1);
    return {
        pageNumber: context.pageNumber,
        elementCount: context.elements.length,
        locatableCount: context.elements.filter((element) => context.locatableKeys.has(element.key)).length,
        categories: [...categories].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b)).slice(0, 80).map(([name, count]) => ({ name: name.slice(0, 160), count })),
        commentCount: context.comments.filter((comment) => comment.page === context.pageNumber && comment.text.trim()).length,
        commentsStatus: context.commentsStatus ?? 'ready',
    };
}

/** Execute tools against the current source data, never provider-invented element keys. */
export function executeAgentAction(action: AgentAction, context: AgentContext): AgentResult {
    const valid = parseAgentAction(action);
    switch (valid.name) {
        case 'color_walls_by_fire_rating': return colorWallsByFireRating(context, valid.arguments.rating);
        case 'compare_door_widths': return compareDoorWidths(context, valid.arguments.thresholdInches);
        case 'latest_comments': return latestComments(context);
        case 'clear_highlights': return { message: 'Agent highlights cleared.', highlight: null };
    }
}

function statusError(status: number): Error {
    if (status === 401 || status === 403) return new Error('The agent API key was rejected. Check the server configuration, or use Local demo.');
    if (status === 404) return new Error(UNAVAILABLE);
    if (status === 409 || status === 503) return new Error('The agent API is not configured or is unavailable. Add OPENAI_API_KEY to .env.local and restart the viewer, or use Local demo.');
    if (status === 429) return new Error('The agent API is busy or has reached its usage limit. Try again later, or use Local demo.');
    if (status === 408 || status === 504) return new Error('The agent API request timed out. Try again, or use Local demo.');
    if (status === 400 || status === 413 || status === 422) return new Error('The agent request could not be accepted. Try a shorter request, or use Local demo.');
    return new Error('The agent API could not complete the request. Try again, or use Local demo.');
}

async function fetchJson(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try { response = await fetch(path, init); }
    catch (error) {
        if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Request cancelled.', 'AbortError');
        throw new Error(UNAVAILABLE);
    }
    if (!response.ok) throw statusError(response.status);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) throw new Error(UNAVAILABLE);
    try { return await response.json(); }
    catch {
        if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Request cancelled.', 'AbortError');
        throw invalid();
    }
}

export async function getAgentApiStatus(signal?: AbortSignal): Promise<AgentApiStatus> {
    const value = record(await fetchJson('/api/agent/status', { signal, cache: 'no-store' }));
    if (!exactKeys(value, ['configured', 'provider', 'model']) || typeof value.configured !== 'boolean' || value.provider !== 'openai' || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 100) throw invalid();
    return { configured: value.configured, provider: 'openai', model: value.model };
}

export async function requestAgent(prompt: string, history: AgentChatTurn[], context: AgentContext, signal?: AbortSignal, getCurrentContext?: () => AgentContext): Promise<AgentResult> {
    const text = prompt.trim();
    if (!text || text.length > 4_000) throw new Error('Use a drawing request between 1 and 4,000 characters.');
    const request: AgentApiRequest = {
        prompt: text,
        history: history.slice(-12).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 4_000) })),
        context: buildAgentModelContext(context),
    };
    const response = parseAgentApiResponse(await fetchJson('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
    }));
    if (signal?.aborted) throw signal.reason ?? new DOMException('Request cancelled.', 'AbortError');
    if (!response.actions.length) return { message: response.message };
    // Validate the whole response before executing anything. The last highlight action wins.
    const currentContext = getCurrentContext?.() ?? context;
    const results = response.actions.map((action) => executeAgentAction(action, currentContext));
    const result: AgentResult = { message: results.map((entry) => entry.message).join('\n\n') };
    for (const entry of results) {
        if (entry.highlight !== undefined) result.highlight = entry.highlight;
        if (entry.comments !== undefined) result.comments = entry.comments;
    }
    return result;
}
