import type { AgentAction, AgentApiRequest, AgentApiResponse, AgentChatTurn, AgentModelContext } from './agentApi';
import { appendAgentObservation, boundedObservationData, observationBytes, type AgentObservation } from './agentObservations';
import { highlightElementKeys, type AgentContext, type AgentElementGroup, type AgentResult, type DrawingComment } from './drawingAgent';
import { inspectDrawing, inspectDrawingElements, queryDrawingElements, type DrawingQueryResult } from './drawingQuery';
import type { AgentHostAction, AgentHostCallback } from './agentWorkspace';

const MAX_ROUNDS = 8;
const LEGACY_TOOLS = new Set(['color_walls_by_fire_rating', 'compare_door_widths', 'highlight_elements', 'latest_comments', 'clear_highlights']);
type ResultHandle = { elementKeys: ReadonlySet<string>; groups?: readonly AgentElementGroup[]; title: string };

function scopeKey(context: AgentContext): string {
    return `${context.pageNumber}\n${context.scopeKey ?? ''}\n${context.elements.map((element) => element.key).sort().join('\n')}`;
}
function explicitIntent(prompt: string, history: readonly AgentChatTurn[], kind: 'comment' | 'reply' | 'download'): boolean {
    const prefix = '(?:^|[.!?;]\\s+|\\b(?:and|then)\\s+)(?:please\\s+)?(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?)?';
    const command = kind === 'download' ? '(?:download|save|export)\\b'
        : kind === 'reply' ? '(?:(?:reply|respond)\\b|(?:add|write|post)\\s+(?:(?:a|the|this)\\s+)?reply\\b)'
        : '(?:(?:add|create|leave|post|write|place|put|make)\\s+(?:(?:a|an|the|this|that|new|review)\\s+){0,3}(?:comments?|notes?|markups?)\\b|comment\\s+on\\b|annotate\\b)';
    const matches = (value: string) => {
        // Source quotations/code are data, even when they contain polite-looking imperative text.
        const outsideQuotes = value.replace(/```[\s\S]*?```|`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ').replace(/^\s*>.*$/gm, ' ');
        if (/^(?:please\s+)?(?:how\b|what\s+(?:is|are)\b|explain\s+how\b|describe\s+how\b|tell\s+me\s+how\b)/i.test(outsideQuotes.trim())) return false;
        const verbs = kind === 'download' ? '(?:download(?:ing)?|sav(?:e|ing)|export(?:ing)?)'
            : kind === 'reply' ? '(?:reply(?:ing)?|respond(?:ing)?|add(?:ing)?|writ(?:e|ing)|post(?:ing)?)'
            : '(?:add(?:ing)?|creat(?:e|ing)|leav(?:e|ing)|post(?:ing)?|writ(?:e|ing)|plac(?:e|ing)|put(?:ting)?|mak(?:e|ing)|annotat(?:e|ing))';
        if (new RegExp('\\b(?:do\\s+not|don[\u0027\u2019]?t|never|avoid|without)\\s+(?:please\\s+)?' + verbs + '\\b', 'i').test(outsideQuotes)) return false;
        return new RegExp(prefix + command, 'i').test(outsideQuotes.trim());
    };
    if (matches(prompt)) return true;
    if (!/^(?:yes|ok(?:ay)?|sure|please|go ahead|do it|confirm)[.!\s]*$/i.test(prompt.trim())) return false;
    const previous = history.findLast((turn) => turn.role === 'user');
    return !!previous && matches(previous.content);
}
function commentRoot(context: AgentContext, id: string): string | null {
    if (context.annotations?.some((annotation) => annotation.id === id && annotation.page === context.pageNumber && annotation.kind === 'comment')) return id;
    const comment = context.comments.find((comment) => comment.page === context.pageNumber && comment.id === id);
    return comment ? comment.annotationId ?? comment.id : null;
}
function recentComments(context: AgentContext, limit: number) {
    const time = (comment: DrawingComment) => Math.max(...[comment.createdAt, comment.modifiedAt].map((value) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity));
    const comments = context.comments.filter((comment) => comment.page === context.pageNumber);
    return { pageNumber: context.pageNumber, status: context.commentsStatus ?? 'ready', total: comments.length,
        comments: [...comments].sort((a, b) => time(b) - time(a)).slice(0, limit).map((comment) => ({
            commentId: comment.annotationId ?? comment.id, id: comment.id, text: comment.text.slice(0, 1800), author: comment.author ?? null,
            createdAt: comment.createdAt ?? null, modifiedAt: comment.modifiedAt ?? null, source: comment.source,
        })), truncated: comments.length > limit };
}

/** Bounded query/act/answer turns. Full result membership remains in this local workspace. */
export async function runAgentToolLoop(prompt: string, history: AgentChatTurn[], context: AgentContext, options: {
    signal?: AbortSignal;
    getCurrentContext?: () => AgentContext;
    onHostAction?: AgentHostCallback;
    buildContext: (context: AgentContext) => AgentModelContext;
    plan: (request: AgentApiRequest) => Promise<AgentApiResponse>;
    execute: (action: AgentAction, context: AgentContext) => AgentResult;
}): Promise<AgentResult> {
    const initialScope = scopeKey(context);
    const handles = new Map<string, ResultHandle>();
    const attemptedWrites = new Set<string>();
    const receipts: string[] = [];
    let observations: AgentObservation[] = [];
    let nextResult = 1, nextObservation = 1;
    let attemptedHostWrite = false;
    const result: AgentResult = { message: '' };
    const current = (): AgentContext => {
        if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Request cancelled.', 'AbortError');
        const latest = options.getCurrentContext?.() ?? context;
        if (scopeKey(latest) !== initialScope) throw new DOMException('Drawing context changed. Send the request again for the current drawing.', 'AbortError');
        return latest;
    };
    const merge = (entry: AgentResult, compose = true) => {
        if (compose && entry.highlight && result.highlight) {
            const previous = result.highlight;
            const colors = new Map(previous.colors);
            let recolored = false;
            for (const [key, value] of entry.highlight.colors) { recolored ||= colors.has(key) && colors.get(key) !== value; colors.set(key, value); }
            const labels = new Map<string, Set<string>>();
            for (const item of [...previous.legend, ...entry.highlight.legend]) {
                const values = labels.get(item.color) ?? new Set<string>();
                values.add(item.label); labels.set(item.color, values);
            }
            result.highlight = { title: 'Combined drawing highlights', colors, elementKeys: new Set(colors.keys()),
                legend: [...labels].map(([color, values]) => ({ color, label: [...values].join(' / '), count: [...colors.values()].filter((value) => value === color).length })).filter((item) => item.count > 0) };
            if (recolored) receipts.push('Later highlight colors replace earlier colors on overlapping elements.');
        } else if (entry.highlight !== undefined) result.highlight = entry.highlight;
        if (entry.comments !== undefined) result.comments = entry.comments;
        if (entry.message) receipts.push(entry.message);
    };
    const finish = (message: string): AgentResult => ({ ...result, message: [message, ...receipts.slice(-8)].filter(Boolean).join('\n\n') });
    const observe = (tool: AgentAction['name'], data: unknown) => {
        observations = appendAgentObservation(observations, { id: `o${nextObservation++}`, tool, data: boundedObservationData(data) });
    };
    const seedSelection = (latest: AgentContext) => {
        const allowed = new Set(latest.elements.map((element) => element.key));
        const selected = new Set([...(latest.selectedKeys ?? [])].filter((key) => allowed.has(key)));
        handles.set('selection', { elementKeys: selected, title: 'Selected elements' });
        return selected;
    };
    seedSelection(context);
    const register = (query: DrawingQueryResult, title: string) => {
        if (query.data.error) return { ...query.data, resultId: null };
        const resultId = `r${nextResult++}`;
        handles.set(resultId, { elementKeys: query.elementKeys, groups: query.groups, title });
        return { ...query.data, resultId };
    };
    const host = async (action: AgentHostAction, tool: AgentAction['name']) => {
        current();
        if (!options.onHostAction) { observe(tool, { error: 'This viewer action is unavailable in the current session.' }); return; }
        const write = action.type === 'add_comment' || action.type === 'reply_comment' || (action.type === 'viewer_action' && action.action === 'download_pdf');
        const key = action.type === 'add_comment' ? JSON.stringify({ ...action, elementKeys: [...action.elementKeys].sort() }) : JSON.stringify(action);
        if (write && attemptedWrites.has(key)) { observe(tool, { duplicate: true, message: 'This operation was already attempted in this request. It was not repeated.' }); return; }
        if (write) { attemptedWrites.add(key); attemptedHostWrite = true; }
        try {
            const receipt = await options.onHostAction(action);
            if (receipt.message) receipts.push(receipt.message.slice(0, 2000));
            if (action.type === 'select' || action.type === 'focus') result.preserveSelection = true;
            if (action.type === 'select' || action.type === 'focus' || action.type === 'add_comment') handles.set('selection', { elementKeys: new Set(action.elementKeys), title: 'Selected elements' });
            if (action.type === 'viewer_action' && action.action === 'clear_selection') handles.set('selection', { elementKeys: new Set(), title: 'Selected elements' });
            current();
            observe(tool, { message: receipt.message.slice(0, 2000), ...(receipt.id ? { id: receipt.id.slice(0, 2000) } : {}) });
        } catch (error) {
            current();
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            observe(tool, { error: 'The viewer could not confirm this action. It was not retried automatically.' });
        }
    };

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const latest = current();
        const request: AgentApiRequest = { prompt, history: history.slice(-12).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 4000) })), context: options.buildContext(latest),
            ...(observations.length ? { observations } : {}) };
        while (observationBytes(request) > 120 * 1024 && request.history.length) request.history.shift();
        let response: AgentApiResponse;
        try { response = await options.plan(request); }
        catch (error) {
            current();
            if (!attemptedHostWrite) throw error;
            return finish('A requested viewer action was attempted, but the agent could not finish its follow-up answer. Review the results above before retrying.');
        }
        current();
        if (!response.actions.length) return finish(response.message);
        const legacyOnly = response.actions.every((action) => LEGACY_TOOLS.has(action.name));
        for (const action of response.actions) {
            const scope = current();
            if (LEGACY_TOOLS.has(action.name)) {
                const actual = options.execute(action, scope);
                merge(actual);
                if (!legacyOnly) observe(action.name, { message: actual.message });
                continue;
            }
            switch (action.name) {
                case 'inspect_drawing': {
                    const selected = handles.get('selection')!.elementKeys;
                    observe(action.name, { ...inspectDrawing(scope), selectionResultId: 'selection', selectedCount: selected.size,
                        selectedElementKeys: [...selected].slice(0, 25), selectionTruncated: selected.size > 25 });
                    break;
                }
                case 'query_elements':
                    observe(action.name, { ...register(queryDrawingElements(scope, action.arguments), action.arguments.groupBy ? `Elements by ${action.arguments.groupBy}` : 'Query results'), query: action.arguments });
                    break;
                case 'inspect_elements':
                    observe(action.name, register(inspectDrawingElements(scope, action.arguments.elementKeys, action.arguments.properties), 'Inspected elements'));
                    break;
                case 'inspect_comments': observe(action.name, recentComments(scope, action.arguments.limit)); break;
                case 'show_elements': {
                    const handle = handles.get(action.arguments.resultId);
                    if (!handle) { observe(action.name, { error: 'Unknown resultId. Query the drawing first or use the selection result.' }); break; }
                    const keys = [...handle.elementKeys];
                    if (action.arguments.mode === 'highlight') {
                        const actual = highlightElementKeys(scope, keys, { color: action.arguments.color, title: handle.title, groups: handle.groups });
                        merge(actual, true);
                        observe(action.name, { message: actual.message, resultId: action.arguments.resultId, matched: keys.length,
                            highlighted: result.highlight?.elementKeys.size ?? 0, legend: result.highlight?.legend ?? [], status: 'prepared' });
                    } else await host({ type: action.arguments.mode, elementKeys: keys }, action.name);
                    break;
                }
                case 'viewer_action': {
                    const { action: name, page } = action.arguments;
                    if (name === 'download_pdf' && !explicitIntent(prompt, history, 'download')) { observe(action.name, { error: 'Download was not explicitly requested. Ask the user before downloading.' }); break; }
                    if (name === 'go_to_page') {
                        if (!scope.pageCount || !page || page > scope.pageCount) { observe(action.name, { error: 'That page is not available in this document.' }); break; }
                        result.effects = [...(result.effects ?? []), { type: 'viewer_action', action: name, page }];
                        return finish(`Opening page ${page}.`);
                    }
                    await host({ type: 'viewer_action', action: name, page }, action.name);
                    break;
                }
                case 'add_comment': {
                    if (!explicitIntent(prompt, history, 'comment')) { observe(action.name, { error: 'Adding a comment was not explicitly requested. Ask the user before writing.' }); break; }
                    const handle = handles.get(action.arguments.resultId ?? 'selection');
                    if (!handle) { observe(action.name, { error: 'Unknown resultId. Query the intended objects before commenting.' }); break; }
                    await host({ type: 'add_comment', text: action.arguments.text, elementKeys: [...handle.elementKeys] }, action.name);
                    break;
                }
                case 'reply_comment': {
                    if (!explicitIntent(prompt, history, 'reply')) { observe(action.name, { error: 'A reply was not explicitly requested. Ask the user before writing.' }); break; }
                    const id = commentRoot(scope, action.arguments.commentId);
                    if (!id) { observe(action.name, { error: 'That comment is not available on the current page.' }); break; }
                    await host({ type: 'reply_comment', commentId: id, text: action.arguments.text }, action.name);
                    break;
                }
                case 'open_comment': {
                    const id = commentRoot(scope, action.arguments.commentId);
                    if (!id) { observe(action.name, { error: 'That comment is not available on the current page.' }); break; }
                    result.effects = [...(result.effects ?? []), { type: 'open_comment', commentId: id }];
                    return finish('Opening the requested comment.');
                }
                default: observe(action.name, { error: 'This action is unavailable in the drawing workspace.' });
            }
        }
        if (legacyOnly) return finish('');
    }
    return finish('I reached the tool-step limit for this request. Narrow the request to continue from these results.');
}
