import { colorWallsByFireRating, compareDoorWidths, highlightElementsByCategory, latestComments, type AgentContext, type AgentResult } from './drawingAgent.ts';
import type { DrawingQuery } from './drawingQuery.ts';
import { parseAgentObservations, type AgentObservation } from './agentObservations.ts';
import { runAgentToolLoop } from './agentToolLoop.ts';
import type { AgentHostCallback } from './agentWorkspace.ts';
export type { AgentHostAction, AgentHostResult, AgentHostCallback } from './agentWorkspace.ts';
export type { AgentObservation } from './agentObservations.ts';

const CATEGORY_COLORS = ['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink'] as const;
type CategoryColor = typeof CATEGORY_COLORS[number];
const QUERY_OPERATORS = ['equals', 'not_equals', 'contains', 'gt', 'gte', 'lt', 'lte', 'exists', 'missing'] as const;
const VIEWER_ACTIONS = ['clear_selection', 'fit_page', 'fit_width', 'zoom_in', 'zoom_out', 'go_to_page', 'download_pdf'] as const;
export const AGENT_ACTION_NAMES = ['color_walls_by_fire_rating', 'compare_door_widths', 'highlight_elements', 'latest_comments', 'clear_highlights',
    'inspect_drawing', 'query_elements', 'inspect_elements', 'inspect_comments', 'show_elements', 'viewer_action', 'add_comment', 'reply_comment', 'open_comment'] as const;
const ACTION_NAMES = new Set<string>(AGENT_ACTION_NAMES);

export type AgentAction =
    | { name: 'color_walls_by_fire_rating'; arguments: { rating: string | null } }
    | { name: 'compare_door_widths'; arguments: { thresholdInches: number } }
    | { name: 'highlight_elements'; arguments: { categories: string[]; color: CategoryColor | null } }
    | { name: 'latest_comments'; arguments: Record<string, never> }
    | { name: 'clear_highlights'; arguments: Record<string, never> }
    | { name: 'inspect_drawing'; arguments: Record<string, never> }
    | { name: 'query_elements'; arguments: DrawingQuery }
    | { name: 'inspect_elements'; arguments: { elementKeys: string[]; properties: string[] } }
    | { name: 'inspect_comments'; arguments: { limit: number } }
    | { name: 'show_elements'; arguments: { resultId: string; mode: 'highlight' | 'select' | 'focus'; color: CategoryColor | null } }
    | { name: 'viewer_action'; arguments: { action: typeof VIEWER_ACTIONS[number]; page: number | null } }
    | { name: 'add_comment'; arguments: { text: string; resultId: string | null } }
    | { name: 'reply_comment'; arguments: { commentId: string; text: string } }
    | { name: 'open_comment'; arguments: { commentId: string } };

export interface AgentChatTurn { role: 'user' | 'assistant'; content: string }
export interface AgentModelContext {
    pageNumber: number;
    elementCount: number;
    locatableCount: number;
    categories: { name: string; count: number }[];
    commentCount: number;
    commentsStatus: 'loading' | 'ready' | 'error';
}
export interface AgentApiRequest { prompt: string; history: AgentChatTurn[]; context: AgentModelContext; observations?: AgentObservation[] }
export interface AgentApiResponse { message: string; actions: AgentAction[] }
export interface AgentApiStatus { configured: boolean; provider: 'openai' | 'bedrock'; model: string }

const INVALID_RESPONSE = 'The agent returned an unsupported response. No drawing action was applied. Try again or switch to Local demo.';
const UNAVAILABLE = 'The agent API is unavailable. Try again shortly, or use Local demo.';
const invalid = () => new Error(INVALID_RESPONSE);
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function text(value: unknown, max: number, empty = false): string {
    if (typeof value !== 'string' || value.trim().length > max || (!empty && !value.trim())) throw invalid();
    return value.trim();
}
function nullableText(value: unknown, max: number): string | null { return value === null ? null : text(value, max, true); }
function names(value: unknown, min: number, max: number, length = 160, folded = true): string[] {
    if (!Array.isArray(value) || value.length < min || value.length > max) throw invalid();
    const result: string[] = [], seen = new Set<string>();
    for (const item of value) {
        const name = text(item, length), key = folded ? name.toLowerCase() : name;
        if (!seen.has(key)) { result.push(name); seen.add(key); }
    }
    return result;
}
function color(value: unknown): CategoryColor | null {
    if (value !== null && !CATEGORY_COLORS.includes(value as CategoryColor)) throw invalid();
    return value as CategoryColor | null;
}
function resultId(value: unknown): string {
    const id = text(value, 20);
    if (id !== 'selection' && !/^r[1-9]\d{0,2}$/.test(id)) throw invalid();
    return id;
}
export function validateAgentObservations(value: unknown): AgentObservation[] { return parseAgentObservations(value, ACTION_NAMES); }

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
        case 'highlight_elements': {
            if (!exactKeys(args, ['categories', 'color']) || !Array.isArray(args.categories) || args.categories.length < 1 || args.categories.length > 20 ||
                (args.color !== null && !CATEGORY_COLORS.includes(args.color as CategoryColor))) throw invalid();
            const categories: string[] = [];
            const seen = new Set<string>();
            for (const value of args.categories) {
                if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw invalid();
                const category = value.trim();
                const identity = category.toLowerCase();
                if (!seen.has(identity)) { seen.add(identity); categories.push(category); }
            }
            return { name: action.name, arguments: { categories, color: args.color as CategoryColor | null } };
        }
        case 'latest_comments':
        case 'clear_highlights':
        case 'inspect_drawing':
            if (!exactKeys(args, [])) throw invalid();
            return { name: action.name, arguments: {} };
        case 'query_elements': {
            if (!exactKeys(args, ['categories', 'search', 'filters', 'properties', 'groupBy', 'offset', 'limit']) ||
                !Array.isArray(args.filters) || args.filters.length > 12 || !Number.isInteger(args.offset) || Number(args.offset) < 0 || Number(args.offset) > 1_000_000 ||
                !Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 25) throw invalid();
            const filters = args.filters.map((value) => {
                const filter = record(value);
                if (!exactKeys(filter, ['property', 'operator', 'value']) || !QUERY_OPERATORS.includes(filter.operator as typeof QUERY_OPERATORS[number])) throw invalid();
                return { property: text(filter.property, 160), operator: filter.operator as typeof QUERY_OPERATORS[number], value: nullableText(filter.value, 500) };
            });
            return { name: action.name, arguments: { categories: names(args.categories, 0, 20), search: nullableText(args.search, 300), filters,
                properties: names(args.properties, 0, 12), groupBy: nullableText(args.groupBy, 160), offset: Number(args.offset), limit: Number(args.limit) } };
        }
        case 'inspect_elements':
            if (!exactKeys(args, ['elementKeys', 'properties'])) throw invalid();
            return { name: action.name, arguments: { elementKeys: names(args.elementKeys, 1, 50, 2000, false), properties: names(args.properties, 0, 12) } };
        case 'inspect_comments':
            if (!exactKeys(args, ['limit']) || !Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 20) throw invalid();
            return { name: action.name, arguments: { limit: Number(args.limit) } };
        case 'show_elements':
            if (!exactKeys(args, ['resultId', 'mode', 'color']) || !['highlight', 'select', 'focus'].includes(String(args.mode))) throw invalid();
            return { name: action.name, arguments: { resultId: resultId(args.resultId), mode: args.mode as 'highlight' | 'select' | 'focus', color: color(args.color) } };
        case 'viewer_action':
            if (!exactKeys(args, ['action', 'page']) || !VIEWER_ACTIONS.includes(args.action as typeof VIEWER_ACTIONS[number]) ||
                (args.page !== null && (!Number.isInteger(args.page) || Number(args.page) < 1 || Number(args.page) > 1_000_000)) ||
                (args.action === 'go_to_page' ? args.page === null : args.page !== null)) throw invalid();
            return { name: action.name, arguments: { action: args.action as typeof VIEWER_ACTIONS[number], page: args.page as number | null } };
        case 'add_comment':
            if (!exactKeys(args, ['text', 'resultId'])) throw invalid();
            return { name: action.name, arguments: { text: text(args.text, 4000), resultId: args.resultId === null ? null : resultId(args.resultId) } };
        case 'reply_comment':
            if (!exactKeys(args, ['commentId', 'text'])) throw invalid();
            return { name: action.name, arguments: { commentId: text(args.commentId, 2000), text: text(args.text, 4000) } };
        case 'open_comment':
            if (!exactKeys(args, ['commentId'])) throw invalid();
            return { name: action.name, arguments: { commentId: text(args.commentId, 2000) } };
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
        case 'highlight_elements': return highlightElementsByCategory(context, valid.arguments.categories, valid.arguments.color);
        case 'latest_comments': return latestComments(context);
        case 'clear_highlights': return { message: 'Agent highlights cleared.', highlight: null };
        default: throw new Error('This action requires the drawing workspace tool loop.');
    }
}

function statusError(status: number): Error {
    if (status === 401 || status === 403) return new Error('Agent access was rejected. Check the provider credentials, region, and model access, or use Local demo.');
    if (status === 404) return new Error(UNAVAILABLE);
    if (status === 409 || status === 503) return new Error('The agent API is not configured or is unavailable. Try again shortly, or use Local demo.');
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
    if (!exactKeys(value, ['configured', 'provider', 'model']) || typeof value.configured !== 'boolean' ||
        !['openai', 'bedrock'].includes(String(value.provider)) || typeof value.model !== 'string' ||
        (value.configured && !value.model.trim()) || value.model.length > (value.provider === 'bedrock' ? 2048 : 100)) throw invalid();
    return { configured: value.configured, provider: value.provider as AgentApiStatus['provider'], model: value.model.trim() };
}

export async function requestAgent(prompt: string, history: AgentChatTurn[], context: AgentContext, signal?: AbortSignal, getCurrentContext?: () => AgentContext, onHostAction?: AgentHostCallback): Promise<AgentResult> {
    const text = prompt.trim();
    if (!text || text.length > 4_000) throw new Error('Use a drawing request between 1 and 4,000 characters.');
    return runAgentToolLoop(text, history, context, {
        signal, getCurrentContext, onHostAction, buildContext: buildAgentModelContext, execute: executeAgentAction,
        plan: async (request) => parseAgentApiResponse(await fetchJson('/api/agent', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
        })),
    });
}
