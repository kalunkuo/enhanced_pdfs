import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { executeDrawingAgent, type AgentContext, type AgentHighlight, type DrawingComment } from '../../lib/drawingAgent';
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
}

export interface AgentPanelProps {
    context: AgentContext | null;
    fileName?: string;
    sessionKey: string;
    active?: boolean;
    activeHighlight: AgentHighlight | null;
    onHighlight: (highlight: AgentHighlight | null) => void;
    onSelectComment: (comment: DrawingComment) => void;
    onFitHighlights: () => void;
}

const STARTERS = [
    { title: 'See fire ratings', detail: 'Color code walls by fire rating', prompt: 'Highlight and color code walls based on fire rating', icon: 'walls' },
    { title: 'Check door widths', detail: 'Compare doors against 36 inches', prompt: 'Highlight doors by width: green below 36 inches, red above, and show doors exactly at 36 inches separately', icon: 'door' },
    { title: 'Catch up on comments', detail: 'Get the latest drawing context', prompt: 'Give me context of the latest comments on this drawing', icon: 'comments' },
] as const;

function AgentGlyph({ small = false }: { small?: boolean }) {
    return <svg className={small ? 'agent-glyph is-small' : 'agent-glyph'} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 4 3.5 8.5L28 16l-8.5 3.5L16 28l-3.5-8.5L4 16l8.5-3.5L16 4Z" stroke="currentColor" strokeWidth="1.5" /><path d="m26 2 1.2 2.8L30 6l-2.8 1.2L26 10l-1.2-2.8L22 6l2.8-1.2L26 2Z" fill="currentColor" /></svg>;
}

function Glyph({ children }: { children: ReactNode }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function StarterGlyph({ kind }: { kind: typeof STARTERS[number]['icon'] }) {
    return <Glyph>{kind === 'walls' ? <><path d="M4 5h16v14H4zM4 12h16M12 5v7M8 12v7M16 12v7" /></> : kind === 'door' ? <><path d="M5 20h14M7 20V4h10v16M13 12h1" /><path d="M3 8v8M1 10l2-2 2 2M1 14l2 2 2-2" /></> : <><path d="M4 5h16v12H9l-5 4V5Z" /><path d="M8 9h8M8 13h5" /></>}</Glyph>;
}

function commentDate(comment: DrawingComment): string {
    for (const value of [comment.modifiedAt, comment.createdAt]) {
        if (!value) continue;
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    return 'Date unavailable';
}

/** A local drawing-action agent. Conversation state survives inspector tab changes. */
export function AgentPanel({ context, fileName, sessionKey, active = true, activeHighlight, onHighlight, onSelectComment, onFitHighlights }: AgentPanelProps) {
    const [draft, setDraft] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [listening, setListening] = useState(false);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const sequence = useRef(0);
    const previousPrompt = useRef<string | undefined>(undefined);
    const recognition = useRef<BrowserSpeechRecognition | null>(null);
    const end = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

    useEffect(() => {
        recognition.current?.abort();
        recognition.current = null;
        setListening(false);
        setVoiceError(null);
        setError(null);
        setMessages([]);
        setDraft('');
        previousPrompt.current = undefined;
    }, [sessionKey]);

    useEffect(() => {
        if (!active) {
            recognition.current?.abort();
            recognition.current = null;
            setListening(false);
        }
        return () => { recognition.current?.abort(); recognition.current = null; };
    }, [active]);

    useEffect(() => {
        if (active && messages.length) end.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, [messages, active]);

    const send = (raw: string) => {
        const prompt = raw.trim();
        if (!context || !prompt || !active) return;
        recognition.current?.abort();
        recognition.current = null;
        setListening(false);
        setError(null);
        try {
            const result = executeDrawingAgent(prompt, context, previousPrompt.current);
            const userId = ++sequence.current;
            const assistantId = ++sequence.current;
            setMessages((current) => [...current,
                { id: userId, role: 'user', text: prompt, page: context.pageNumber },
                { id: assistantId, role: 'assistant', text: result.message, page: context.pageNumber, comments: result.comments },
            ]);
            if (result.highlight !== undefined) onHighlight(result.highlight);
            // Retain the action domain through chained follow-ups such as “and 42?” then “48”.
            previousPrompt.current = result.highlight?.title.startsWith('Door widths') ? `${prompt} doors`
                : result.highlight?.title === 'Walls by fire rating' ? `${prompt} walls` : prompt;
            setDraft('');
            input.current?.focus();
        } catch {
            setError('I could not complete that request. Try again or choose one of the drawing actions above.');
        }
    };

    const submit = (event: FormEvent) => { event.preventDefault(); send(draft); };
    const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); }
    };

    const toggleVoice = () => {
        if (listening) { recognition.current?.abort(); recognition.current = null; setListening(false); return; }
        if (!SpeechRecognition || !context) return;
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
        recognition.current?.abort();
        recognition.current = null;
        setListening(false);
        setMessages([]);
        setDraft('');
        setError(null);
        setVoiceError(null);
        previousPrompt.current = undefined;
    };

    const fitAvailable = activeHighlight && context && [...activeHighlight.elementKeys].some((key) => context.locatableKeys.has(key));

    return (
        <section className="drawing-agent" aria-label="Drawing agent">
            <header className="agent-heading">
                <div className="agent-heading-name"><AgentGlyph small /><strong>Drawing agent</strong><span className="agent-mode">Local demo</span></div>
                <IconButton label="Clear conversation" disabled={!messages.length && !draft} onClick={clearConversation}><Glyph><path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5" /></Glyph></IconButton>
            </header>
            <div className="agent-document" title={fileName}>
                <Glyph><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></Glyph>
                <span>{fileName ?? 'No drawing open'}</span>
                {context && <span className="agent-page">Page {context.pageNumber}</span>}
            </div>
            <div className="agent-scroll">
                {!messages.length ? (
                    <div className="agent-welcome">
                        <div className="agent-welcome-mark"><AgentGlyph /></div>
                        <h2>Your drawing,<br />in conversation.</h2>
                        <p>Find patterns, compare properties, and catch up on the conversation around your drawing.</p>
                        {!context && <p className="agent-load-hint">Open an enhanced PDF or the demo drawing to start.</p>}
                        <div className="agent-starters">
                            {STARTERS.map((starter) => <button className="agent-starter" type="button" key={starter.icon} disabled={!context} onClick={() => send(starter.prompt)}>
                                <span className="agent-starter-icon"><StarterGlyph kind={starter.icon} /></span>
                                <span><strong>{starter.title}</strong><span>{starter.detail}</span></span>
                                <span className="agent-starter-arrow" aria-hidden="true">↗</span>
                            </button>)}
                        </div>
                        <p className="agent-data-note">Answers use the loaded drawing’s embedded properties and comments.</p>
                    </div>
                ) : (
                    <div className="agent-conversation" role="log" aria-label="Drawing conversation" aria-live="polite" aria-relevant="additions">
                        {messages.map((message) => <article key={message.id} className={`agent-message is-${message.role}`} aria-label={message.role === 'user' ? 'You' : 'Drawing agent'}>
                            <div className="agent-message-byline">{message.role === 'assistant' && <AgentGlyph small />}<strong>{message.role === 'user' ? 'You' : 'Drawing agent'}</strong><span>Page {message.page}</span></div>
                            <p>{message.text}</p>
                            {!!message.comments?.length && <div className="agent-comment-citations">{message.comments.map((comment) => <button type="button" key={`${comment.source}-${comment.page}-${comment.id}`} className="agent-comment-citation" onClick={() => onSelectComment(comment)}>
                                <span className="agent-comment-meta"><strong>{comment.author || 'Unknown author'}</strong><span>p. {comment.page} · {commentDate(comment)}</span></span>
                                <span className="agent-comment-text">{comment.text}</span>
                                <span className="agent-comment-open">Open comment context <span aria-hidden="true">↗</span></span>
                            </button>)}</div>}
                        </article>)}
                        <div ref={end} />
                    </div>
                )}
                {error && <p className="agent-error" role="alert">{error}</p>}
            </div>
            {activeHighlight && <section className="agent-legend" aria-label="Active drawing colors">
                <div className="agent-legend-heading"><strong>{activeHighlight.title}</strong><button type="button" className="agent-text-button" onClick={() => onHighlight(null)}>Clear colors</button></div>
                <ul>{activeHighlight.legend.map((entry) => <li key={`${entry.label}-${entry.color}`}><span className="agent-color-dot" style={{ background: entry.color }} /><span>{entry.label}</span><strong>{entry.count}</strong></li>)}</ul>
                <Button className="agent-fit-button" onClick={onFitHighlights} disabled={!fitAvailable}>Fit highlighted elements</Button>
            </section>}
            <form className={`agent-composer${listening ? ' is-listening' : ''}`} onSubmit={submit}>
                <label className="agent-sr-only" htmlFor="drawing-agent-prompt">Ask about this drawing</label>
                <textarea ref={input} id="drawing-agent-prompt" rows={2} value={draft} disabled={!context} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKey} placeholder={context ? 'Ask about this drawing…' : 'Open a drawing to get started…'} />
                <div className="agent-composer-actions"><span>{listening ? 'Listening… review, then send' : 'Enter to send · Shift + Enter for a new line'}</span><div>
                    <IconButton label={listening ? 'Stop voice input' : SpeechRecognition ? 'Start voice input' : 'Voice input is unavailable in this browser'} pressed={listening} disabled={!context || !SpeechRecognition} onClick={toggleVoice}><Glyph><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" /></Glyph></IconButton>
                    <IconButton className="agent-send" label="Send request" type="submit" disabled={!context || !draft.trim()}><Glyph><path d="M12 19V5M6 11l6-6 6 6" /></Glyph></IconButton>
                </div></div>
            </form>
            <p className="agent-footer" role={voiceError ? 'status' : undefined}>{voiceError ?? (listening ? 'Your browser transcribes speech. Review the text, then send.' : 'Local drawing actions · no model API connected')}</p>
        </section>
    );
}
