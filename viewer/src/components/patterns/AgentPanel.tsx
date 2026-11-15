import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { executeDrawingAgent, type AgentContext, type AgentHighlight, type DrawingComment } from '../../lib/drawingAgent';
import { getAgentApiStatus, requestAgent, type AgentApiStatus } from '../../lib/agentApi';
import type { AgentHostAction, AgentHostCallback } from '../../lib/agentWorkspace';
import { ActionButton } from '../ui/ActionButton';
import { AgentMarkdown } from './AgentMarkdown';
import { Button, IconButton } from '../ui/Button';
import '../../styles/agent.css';

interface SpeechResult { isFinal: boolean; readonly length: number; [index: number]: { transcript: string } }
interface SpeechEvent { results: { readonly length: number; [index: number]: SpeechResult } }
interface BrowserSpeechRecognition {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((event: SpeechEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    abort: () => void;
}
type SpeechConstructor = new () => BrowserSpeechRecognition;
type SpeechWindow = Window & { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor };

interface Message {
    id: number;
    role: 'user' | 'assistant';
    text: string;
    page: number;
    comments?: DrawingComment[];
    state?: 'pending' | 'failed' | 'canceled';
}

export interface AgentPanelProps {
    context: AgentContext | null;
    sessionKey: string;
    active?: boolean;
    activeHighlight: AgentHighlight | null;
    onHighlight: (highlight: AgentHighlight | null, preserveSelection?: boolean) => void;
    onSelectComment: (comment: DrawingComment) => void;
    onFitHighlights: () => void;
    onAction?: AgentHostCallback;
}

const STARTERS = [
    { title: 'See fire ratings', detail: 'Color code walls by fire rating', prompt: 'Highlight and color code walls based on fire rating', icon: 'walls' },
    { title: 'Check door widths', detail: 'Compare doors against 36 inches', prompt: 'Highlight doors by width: green below 36 inches, red above, and show doors exactly at 36 inches separately', icon: 'door' },
] as const;

function AgentGlyph({ small = false }: { small?: boolean }) {
    return <svg className={small ? 'agent-glyph is-small' : 'agent-glyph'} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 4 3.5 8.5L28 16l-8.5 3.5L16 28l-3.5-8.5L4 16l8.5-3.5L16 4Z" stroke="currentColor" strokeWidth="1.5" /><path d="m26 2 1.2 2.8L30 6l-2.8 1.2L26 10l-1.2-2.8L22 6l2.8-1.2L26 2Z" fill="currentColor" /></svg>;
}

function Glyph({ children }: { children: ReactNode }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function StarterGlyph({ kind }: { kind: typeof STARTERS[number]['icon'] }) {
    return <Glyph>{kind === 'walls' ? <><path d="M4 5h16v14H4zM4 12h16M12 5v7M8 12v7M16 12v7" /></> : <><path d="M5 20h14M7 20V4h10v16M13 12h1" /><path d="M3 8v8M1 10l2-2 2 2M1 14l2 2 2-2" /></>}</Glyph>;
}

function commentDate(comment: DrawingComment): string {
    for (const value of [comment.modifiedAt, comment.createdAt]) {
        if (!value) continue;
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    return 'Date unavailable';
}

/** Conversation state survives inspector tab changes; API credentials stay on the server. */
export function AgentPanel({ context, sessionKey, active = true, activeHighlight, onHighlight, onSelectComment, onFitHighlights, onAction }: AgentPanelProps) {
    const [draft, setDraft] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [listening, setListening] = useState(false);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [apiStatus, setApiStatus] = useState<AgentApiStatus | null>(null);
    const [checkingConnection, setCheckingConnection] = useState(true);
    const [connectionUnavailable, setConnectionUnavailable] = useState(false);
    const [connectionAttempt, setConnectionAttempt] = useState(0);
    const [mode, setMode] = useState<'api' | 'local'>('local');
    const [pending, setPending] = useState(false);
    const sequence = useRef(0);
    const previousPrompt = useRef<string | undefined>(undefined);
    const recognition = useRef<BrowserSpeechRecognition | null>(null);
    const end = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const explicitMode = useRef(false);
    const request = useRef<{ controller: AbortController; prompt: string; userId: number; writeStarted: boolean; completedWrites: string[] } | null>(null);
    const scope = useMemo(() => `${sessionKey}:${context?.pageNumber ?? ''}:${context && 'scopeKey' in context && typeof context.scopeKey === 'string' ? context.scopeKey : context?.elements.map((element) => element.key).sort().join('\n') ?? ''}`, [sessionKey, context]);
    const currentScope = useRef(scope);
    const isActive = useRef(active);
    const latestContext = useRef(context);
    const hostAction = useRef(onAction);
    hostAction.current = onAction;
    currentScope.current = scope;
    isActive.current = active;
    latestContext.current = context;
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

    const cancelRequest = useCallback((reason?: string) => {
        const previous = request.current;
        if (!previous) return;
        request.current = null;
        previous.controller.abort();
        setPending(false);
        setDraft((value) => previous.writeStarted ? '' : value || previous.prompt);
        setMessages((current) => current.map((message) => message.id === previous.userId ? { ...message, state: 'canceled' } : message));
        if (previous.writeStarted) setNotice(previous.completedWrites.length
            ? `Request stopped. ${previous.completedWrites.join(' ')} These changes are kept.`
            : 'Request stopped after an edit or download started. Check the drawing before sending that edit again.');
        else if (reason) setNotice(reason);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        setCheckingConnection(true);
        setConnectionUnavailable(false);
        void getAgentApiStatus(controller.signal).then(
            (status) => {
                if (controller.signal.aborted) return;
                setApiStatus(status);
                setCheckingConnection(false);
                if (!status.configured) setMode('local');
                else if (!explicitMode.current) setMode('api');
            },
            () => {
                if (controller.signal.aborted) return;
                setApiStatus(null);
                setConnectionUnavailable(true);
                setCheckingConnection(false);
                setMode('local');
            },
        );
        return () => controller.abort();
    }, [connectionAttempt]);

    useEffect(() => {
        cancelRequest();
        recognition.current?.abort();
        recognition.current = null;
        setListening(false);
        setVoiceError(null);
        setError(null);
        setNotice(null);
        setMessages([]);
        setDraft('');
        previousPrompt.current = undefined;
    }, [sessionKey, cancelRequest]);

    useEffect(() => {
        cancelRequest('Drawing context changed. Send the request again to use the current drawing view.');
    }, [scope, cancelRequest]);

    useEffect(() => {
        if (!active) {
            recognition.current?.abort();
            recognition.current = null;
            setListening(false);
            cancelRequest('Request canceled while you inspect the drawing. Send it again when ready.');
        }
    }, [active, cancelRequest]);

    useEffect(() => () => {
        recognition.current?.abort();
        recognition.current = null;
        request.current?.controller.abort();
        request.current = null;
    }, []);

    useEffect(() => {
        if (active && messages.length) end.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, [messages, active]);

    const send = async (raw: string) => {
        const prompt = raw.trim();
        if (!context || !prompt || !active || request.current || checkingConnection) return;
        recognition.current?.abort();
        recognition.current = null;
        setListening(false);
        setError(null);
        setNotice(null);
        const capturedScope = scope;
        const controller = new AbortController();
        const last = messages.at(-1);
        const reuseLast = last?.role === 'user' && last.text === prompt && (last.state === 'failed' || last.state === 'canceled');
        const userId = reuseLast ? last.id : ++sequence.current;
        const currentRequest = { controller, prompt, userId, writeStarted: false, completedWrites: [] as string[] };
        request.current = currentRequest;
        if (mode === 'api') {
            setPending(true);
            setMessages((current) => reuseLast ? current.map((message) => message.id === userId ? { ...message, state: 'pending' } : message)
                : [...current, { id: userId, role: 'user', text: prompt, page: context.pageNumber, state: 'pending' }]);
        }
        let effects: readonly AgentHostAction[] = [];
        try {
            const result = mode === 'api'
                ? await requestAgent(prompt, messages.filter((message) => !message.state).map((message) => ({ role: message.role, content: message.text })), context, controller.signal, () => latestContext.current ?? context, async (action: AgentHostAction) => {
                    if (!hostAction.current) throw new Error('Viewer actions are unavailable. Reopen the drawing and try again.');
                    const writes = action.type === 'add_comment' || action.type === 'reply_comment' || action.type === 'viewer_action' && action.action === 'download_pdf';
                    if (writes) currentRequest.writeStarted = true;
                    const result = await hostAction.current(action);
                    if (writes) currentRequest.completedWrites.push(result.message);
                    return result;
                })
                : executeDrawingAgent(prompt, context, previousPrompt.current);
            if (request.current !== currentRequest || controller.signal.aborted) return;
            if (currentScope.current !== capturedScope || !isActive.current) {
                cancelRequest('Drawing context changed. Send the request again when ready.');
                return;
            }
            const assistantId = ++sequence.current;
            setMessages((current) => [...(mode === 'api' || reuseLast ? current.map((message) => message.id === userId ? { ...message, state: undefined } : message)
                : [...current, { id: userId, role: 'user' as const, text: prompt, page: context.pageNumber }]),
                { id: assistantId, role: 'assistant', text: result.message, page: context.pageNumber, comments: result.comments },
            ]);
            if (result.highlight !== undefined) onHighlight(result.highlight, result.preserveSelection);
            effects = result.effects ?? [];
            // Retain the action domain through chained follow-ups such as “and 42?” then “48”.
            previousPrompt.current = result.highlight?.title.startsWith('Door widths') ? `${prompt} doors`
                : result.highlight?.title === 'Walls by fire rating' ? `${prompt} walls` : prompt;
            setDraft('');
            input.current?.focus();
        } catch (cause) {
            if (request.current !== currentRequest || controller.signal.aborted) return;
            if (currentScope.current !== capturedScope || !isActive.current) {
                cancelRequest('Drawing context changed. Send the request again when ready.');
                return;
            }
            setMessages((current) => current.map((message) => message.id === userId ? { ...message, state: 'failed' } : message));
            setDraft(prompt);
            setError(mode === 'api' && cause instanceof Error ? cause.message : 'I could not complete that request. Try again or choose one of the drawing actions above.');
        } finally {
            if (request.current === currentRequest) {
                request.current = null;
                setPending(false);
            }
        }
        // Navigation ends this turn before it changes the page or inspector scope.
        for (const effect of effects) {
            try { await hostAction.current?.(effect); }
            catch (cause) { setError(cause instanceof Error ? cause.message : 'The viewer action could not be completed.'); }
        }
    };

    const submit = (event: FormEvent) => { event.preventDefault(); void send(draft); };
    const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); }
    };

    const toggleVoice = () => {
        if (listening) { recognition.current?.abort(); recognition.current = null; setListening(false); return; }
        if (!SpeechRecognition || !context || pending || checkingConnection) return;
        recognition.current?.abort();
        recognition.current = null;
        setVoiceError(null);
        const next = new SpeechRecognition();
        recognition.current = next;
        next.lang = navigator.language || 'en-US';
        next.continuous = false;
        next.interimResults = true;
        const prefix = draft.trim();
        next.onresult = (event) => {
            if (recognition.current !== next) return;
            const words: string[] = [];
            for (let i = 0; i < event.results.length; i++) {
                const transcript = event.results[i]?.[0]?.transcript;
                if (transcript) words.push(transcript);
            }
            setDraft([prefix, words.join(' ')].filter(Boolean).join(' '));
        };
        next.onerror = (event) => {
            if (recognition.current !== next || event.error === 'aborted') return;
            setVoiceError(event.error === 'not-allowed' ? 'Microphone access was denied. Allow it in your browser, or type your request.' : event.error === 'no-speech' ? 'No speech detected. Try again, or type your request.' : 'Voice transcription is unavailable right now. You can still type your request.');
            setListening(false);
        };
        next.onend = () => {
            if (recognition.current !== next) return;
            recognition.current = null;
            setListening(false);
            input.current?.focus();
        };
        try { next.start(); setListening(true); }
        catch { recognition.current = null; setVoiceError('Could not start the microphone. Try typing your request.'); }
    };

    const clearConversation = () => {
        cancelRequest();
        recognition.current?.abort();
        recognition.current = null;
        setListening(false);
        setMessages([]);
        setDraft('');
        setError(null);
        setNotice(null);
        setVoiceError(null);
        previousPrompt.current = undefined;
    };

    const fitAvailable = activeHighlight && context && [...activeHighlight.elementKeys].some((key) => context.locatableKeys.has(key));
    const providerName = apiStatus?.provider === 'bedrock' ? 'Amazon Bedrock' : apiStatus?.provider === 'openai' ? 'OpenAI' : 'AI service';
    const providerModel = apiStatus?.model ? `${providerName} · ${apiStatus.model}` : providerName;
    const connectionLabel = checkingConnection ? 'Connecting to the AI service…' : mode === 'api' ? providerModel : connectionUnavailable ? 'AI service unavailable · drawing tools ready' : `${providerName} not connected · drawing tools ready`;
    const changeMode = (next: 'api' | 'local') => {
        cancelRequest('Request canceled after changing agent mode.');
        explicitMode.current = true;
        setMode(next);
        setError(null);
        setNotice(null);
    };

    return (
        <section className="drawing-agent" aria-label="Drawing agent">
            <header className="agent-heading">
                <div className="agent-heading-name"><strong>Drawing agent</strong><span className="agent-mode">{checkingConnection ? 'Connecting' : mode === 'api' ? 'API' : 'Local demo'}</span></div>
                <IconButton label="Clear conversation" disabled={!messages.length && !draft && !pending} onClick={clearConversation}><Glyph><path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5" /></Glyph></IconButton>
            </header>
            <div className="agent-connection">
                {apiStatus?.configured ? <label className="agent-mode-choice"><span className="agent-sr-only">Agent mode</span><select aria-label="Agent mode" value={mode} disabled={pending || checkingConnection} onChange={(event) => changeMode(event.target.value === 'api' ? 'api' : 'local')}><option value="api">{providerModel}</option><option value="local">Local demo</option></select></label>
                    : <span role="status">{connectionLabel}</span>}
                <button className="agent-text-button" type="button" disabled={pending || checkingConnection} onClick={() => setConnectionAttempt((attempt) => attempt + 1)}>Check connection</button>
            </div>
            <div className="agent-scroll">
                {!messages.length ? (
                    <div className="agent-welcome">
                        {!context && <p className="agent-load-hint">Open an enhanced PDF to start.</p>}
                        <h2 className="agent-welcome-title">Talk to your drawing.</h2>
                        <p>Find elements, explore their properties, color your results, and work with drawing comments.</p>
                        <div className="agent-starters">
                            {STARTERS.map((starter) => <ActionButton variant="secondary" className="agent-starter" key={starter.icon} disabled={!context || pending || checkingConnection} onClick={() => void send(starter.prompt)}>
                                <span className="agent-starter-icon"><StarterGlyph kind={starter.icon} /></span>
                                <span><strong>{starter.title}</strong><span>{starter.detail}</span></span>
                                <span className="agent-starter-arrow" aria-hidden="true">↗</span>
                            </ActionButton>)}
                        </div>
                    </div>
                ) : (
                    <div className="agent-conversation" role="log" aria-label="Drawing conversation" aria-live="polite" aria-relevant="additions">
                        {messages.map((message) => <article key={message.id} className={`agent-message is-${message.role}`} aria-label={message.role === 'user' ? 'You' : 'Drawing agent'}>
                            <div className="agent-message-byline">{message.role === 'assistant' && <AgentGlyph small />}<strong>{message.role === 'user' ? 'You' : 'Drawing agent'}</strong><span>{message.state === 'pending' ? 'Sending… · ' : message.state === 'failed' ? 'Failed · ' : message.state === 'canceled' ? 'Canceled · ' : ''}Page {message.page}</span></div>
                            {message.role === 'assistant' ? <AgentMarkdown text={message.text} /> : <p>{message.text}</p>}
                            {!!message.comments?.length && <div className="agent-comment-citations">{message.comments.map((comment) => <button type="button" key={`${comment.source}-${comment.page}-${comment.id}`} className="agent-comment-citation" onClick={() => onSelectComment(comment)}>
                                <span className="agent-comment-meta"><strong>{comment.author || 'Unknown author'}</strong><span>p. {comment.page} · {commentDate(comment)}</span></span>
                                <span className="agent-comment-text">{comment.text}</span>
                                <span className="agent-comment-open">Open comment context <span aria-hidden="true">↗</span></span>
                            </button>)}</div>}
                        </article>)}
                        <div ref={end} />
                    </div>
                )}
                {pending && <div className="agent-working" role="status"><span className="agent-working-dot" />Asking the model…<button type="button" className="agent-text-button" onClick={() => cancelRequest('Request canceled. Your draft is ready to send again.')}>Cancel request</button></div>}
                {error && <div className="agent-error" role="alert"><p>{error}</p><div className="agent-error-actions"><button type="button" className="agent-text-button" disabled={!context || pending || checkingConnection} onClick={() => void send(draft)}>Retry request</button>{mode === 'api' && <button type="button" className="agent-text-button" onClick={() => changeMode('local')}>Use local demo</button>}</div></div>}
                {notice && <p className="agent-request-notice" role="status">{notice}</p>}
            </div>
            {activeHighlight && <section className="agent-legend" aria-label="Active drawing colors">
                <div className="agent-legend-heading"><strong>{activeHighlight.title}</strong><button type="button" className="agent-text-button" onClick={() => onHighlight(null)}>Clear colors</button></div>
                <ul>{activeHighlight.legend.map((entry) => <li key={`${entry.label}-${entry.color}`}><span className="agent-color-dot" style={{ background: entry.color }} /><span>{entry.label}</span><strong>{entry.count}</strong></li>)}</ul>
                <Button className="agent-fit-button" onClick={onFitHighlights} disabled={!fitAvailable}>Fit highlighted elements</Button>
            </section>}
            <form className={`agent-composer${listening ? ' is-listening' : ''}`} onSubmit={submit}>
                <label className="agent-sr-only" htmlFor="drawing-agent-prompt">Ask about this drawing</label>
                <textarea ref={input} id="drawing-agent-prompt" rows={2} maxLength={4000} value={draft} disabled={!context || pending || checkingConnection} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKey} placeholder={context ? 'Ask about this drawing…' : 'Open a drawing to get started…'} />
                <div className="agent-composer-actions"><span>{listening ? 'Listening… review, then send' : 'Enter to send · Shift + Enter for a new line'}</span><div>
                    <IconButton label={listening ? 'Stop voice input' : SpeechRecognition ? 'Start voice input' : 'Voice input is unavailable in this browser'} pressed={listening} disabled={!context || !SpeechRecognition || pending || checkingConnection} onClick={toggleVoice}><Glyph><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" /></Glyph></IconButton>
                    <IconButton className="agent-send" label="Send request" type="submit" disabled={!context || !draft.trim() || pending || checkingConnection}><Glyph><path d="M12 19V5M6 11l6-6 6 6" /></Glyph></IconButton>
                </div></div>
            </form>
            {(voiceError || listening || mode === 'api' || apiStatus?.configured || context) && (
                <p className="agent-footer" role={voiceError ? 'status' : undefined}>{voiceError ?? (listening ? 'Your browser transcribes speech. Review the text, then send.' : mode === 'api' ? `Messages and requested drawing data go to ${providerName}. Your PDF stays in your browser.` : apiStatus?.configured ? 'Built-in drawing tools · AI requests are off' : 'Start with a drawing check above, or type a request.')}</p>
            )}
        </section>
    );
}
