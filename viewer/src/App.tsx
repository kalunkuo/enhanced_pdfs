import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocBar } from './components/patterns/DocBar';
import { AgentPanel } from './components/patterns/AgentPanel';
import { ElementList } from './components/patterns/ElementList';
import { FilterPanel } from './components/patterns/FilterPanel';
import { HoverCard } from './components/patterns/HoverCard';
import { NotesList } from './components/patterns/NotesList';
import { ProfileMenu } from './components/patterns/ProfileMenu';
import { PdfStage, clampZoom, type Tool, type ZoomMode } from './components/patterns/PdfStage';
import { PropertiesPanel } from './components/patterns/PropertiesPanel';
import { HIGHLIGHT_COLORS, Toolbar, type DrawKind } from './components/patterns/Toolbar';
import { SegmentedControl } from './components/ui/SegmentedControl';
import { Dialog } from './components/ui/Dialog';
import { ActionButton } from './components/ui/ActionButton';
import { UploadIcon } from './components/ui/icons';
import { ProgressBar } from './components/ui/ProgressBar';
import { StatusMessage } from './components/ui/StatusMessage';
import { elementsInCloud, tieCloud, type BoundsSource } from './lib/cloud';
import { elementLabel, elementTypeLabel } from './lib/elementLabel';
import { createShapePicker, tieWithPicker } from './lib/hit';
import { elementLocations } from './lib/coverage';
import { EMPTY_FILTERS, filterElements, getDrawingScope, hasActiveFilters, matchesDrawingScope, type FilterState } from './lib/filters';
import { createNativeGeometryCapture, type NativeGeometry } from './lib/nativeGeometry';
import { LOAD_STAGE_SPAN, loadEnhancedPdf, type LoadStage } from './lib/load';
import { annotatedName, downloadPdf, printPdf } from './lib/print';
import { buildAnnotatedPdf } from './lib/save';
import { fingerprintBytes, loadSession, nextAnnotationNumber, saveSessionFile, saveSessionState, SESSION_VERSION, type SessionState } from './lib/session';
import type { FocusRequest } from './lib/navigation';
import { withAuthorship } from './lib/comments';
import { linkedKeys, linksSummary, withLinks } from './lib/links';
import { similarElementKeys } from './lib/selection';
import { useProfile } from './lib/profile';
import type { Annotation, ElementInfo, EnhancedPdf, PageData, Point, Reply } from './lib/types';
import type { AgentContext, AgentHighlight, DrawingComment } from './lib/drawingAgent';
import { readPdfComments, viewerComments } from './lib/drawingComments';
import { upgradePageAnnotations } from './lib/upgradeAnnotations';
import { recoverReviewAnnotations } from './lib/reviewRecovery';
import { upgradeDocumentAnnotations } from './lib/upgradeDocumentAnnotations';
import type { AgentHostAction, AgentHostResult } from './lib/agentWorkspace';
import './styles/imported-annotations.css';

type Tab = 'agent' | 'properties' | 'elements' | 'notes';
const TABS: readonly Tab[] = ['agent', 'properties', 'elements', 'notes'];
const KEYS: Record<string, Tool | 'draw'> = { v: 'select', c: 'comment', h: 'highlight', d: 'draw', t: 'text', s: 'signature' };
const LOAD_STEPS: Record<LoadStage | 'page', string> = {
    reading: 'Reading file',
    parsing: 'Parsing PDF',
    attachments: 'Extracting model data',
    tables: 'Reading model tables',
    annotations: 'Importing existing PDF markups',
    page: 'Preparing first page',
};
// The loader covers most of the bar; the first page render finishes it.
const LOADER_SHARE = 0.95;
// `ceiling` is where the current step ends; the bar creeps toward it while reports stall.
// `done`: work finished, bar finishing its fill. `revealing`: bar at 100%, dialog fading out.
type Loading = { fileName: string; fraction: number; ceiling: number; step: string; done?: boolean; revealing?: boolean };
// Matches --dialog-reveal-duration; the dialog unmounts after its fade.
const REVEAL_MS = 1500;
const stageCeiling = (stage: LoadStage) => LOAD_STAGE_SPAN[stage][1] * LOADER_SHARE;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DRAW_KINDS = new Set<string>(['pen', 'line', 'rect', 'ellipse']);
// Review state is written this long after the last change, and immediately when the page hides.
const PERSIST_DELAY_MS = 300;
// Review suggestions can be highlighted without turning them into accepted object links.
const reviewKeys = (annotation: Annotation) => annotation.source?.linkState === 'suggested' ? annotation.source.suggestedElementKeys ?? [] : linkedKeys(annotation);

export function App() {
    const [doc, setDoc] = useState<EnhancedPdf | null>(null);
    const [page, setPage] = useState(1);
    const [pageData, setPageData] = useState<PageData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [persistWarning, setPersistWarning] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState<Loading | null>(null);
    const awaitingFirstPage = useRef<EnhancedPdf | null>(null);
    const [tool, setTool] = useState<Tool>('select');
    const [profile, setProfile] = useProfile();
    // A comment being written: where its pin goes, and the objects it links to when written from the selection bar.
    const [composer, setComposer] = useState<{ at: Point; links?: readonly string[] } | null>(null);
    const [drawKind, setDrawKind] = useState<DrawKind>('pen');
    const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_COLORS[0].value);
    const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: 'fit-width' });
    const [zoom, setZoom] = useState(1);
    const [tab, setTab] = useState<Tab>('agent');
    const [documentSession, setDocumentSession] = useState(0);
    const [agentHighlight, setAgentHighlight] = useState<AgentHighlight | null>(null);
    const [pdfComments, setPdfComments] = useState<DrawingComment[]>([]);
    const [commentsStatus, setCommentsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [selectedPdfComment, setSelectedPdfComment] = useState<DrawingComment | null>(null);
    const [upgradeAttempt, setUpgradeAttempt] = useState(0);
    const [upgradeProgress, setUpgradeProgress] = useState<{ completed: number; total: number } | null>(null);
    const [upgradeWarning, setUpgradeWarning] = useState<string | null>(null);
    const upgradeController = useRef<AbortController | null>(null);
    const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
    // Picked elements: one clicked element, or several (Select similar, a note linked to several objects).
    const [pickedKeys, setPickedKeys] = useState<readonly string[]>([]);
    const selectedKey = pickedKeys.length === 1 ? pickedKeys[0]! : null;
    // Filtering selects every match until something is picked; picking anything replaces it.
    const [filterSelected, setFilterSelected] = useState(false);
    const setSelectedKeys = useCallback((keys: readonly string[]) => { setPickedKeys([...new Set(keys)]); setFilterSelected(false); }, []);
    const setSelectedKey = useCallback((key: string | null) => setSelectedKeys(key ? [key] : []), [setSelectedKeys]);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    // Objects previewed on the canvas while a category pill or list row in Properties is hovered.
    const [previewKeys, setPreviewKeys] = useState<ReadonlySet<string> | null>(null);
    const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
    const [nativeGeometry, setNativeGeometry] = useState<NativeGeometry | null>(null);
    const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
    const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
    // Fingerprint of the open file; review state is remembered only once this is known.
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [restoring, setRestoring] = useState(true);
    const nextFocusId = useRef(0);
    const drawingScope = useMemo(() => getDrawingScope(filters), [filters]);
    const nativeSource = pageData?.nativeTags;
    const geometry = nativeGeometry?.source === nativeSource ? nativeGeometry : null;
    const createCapture = useMemo(() => nativeSource?.resolvedElementKeys.size ? createNativeGeometryCapture(nativeSource, setNativeGeometry) : undefined, [nativeSource]);
    const pickElement = useMemo(() => {
        if (!geometry) return createShapePicker((pageData?.shapes ?? []).filter((shape) => matchesDrawingScope(shape.drawingId, drawingScope)));
        if (!drawingScope) return geometry.pick;
        const appearances = new Set(geometry.parts.filter((part) => matchesDrawingScope(part.drawingId, drawingScope)).map((part) => part.appearanceId));
        return (point: Parameters<typeof geometry.pick>[0], tolerance: number) => geometry.pick(point, tolerance).filter((hit) => appearances.has(hit.occurrenceId ?? ''));
    }, [geometry, pageData, drawingScope]);
    // Page bounds of everything an element is drawn with, for finding what a revision cloud covers.
    // It follows the same geometry source and drawing scope the picker uses.
    const regionSources = useMemo<BoundsSource[]>(() => {
        if (!geometry) return (pageData?.shapes ?? []).filter((shape) => matchesDrawingScope(shape.drawingId, drawingScope)).map((shape) => ({ elementKey: shape.elementKey, bounds: shape.bbox }));
        return geometry.parts.filter((part) => matchesDrawingScope(part.drawingId, drawingScope)).map((part) => ({ elementKey: part.elementKey, bounds: part.bounds }));
    }, [geometry, pageData, drawingScope]);
    // Imported marks are matched against their actual page location, independently of sidebar filters.
    const upgradeBounds = useMemo(() => geometry
        ? geometry.parts.map((part) => ({ elementKey: part.elementKey, drawingId: part.drawingId, bounds: part.bounds }))
        : (pageData?.shapes ?? []).map((shape) => ({ elementKey: shape.elementKey, drawingId: shape.drawingId, bounds: shape.bbox })), [geometry, pageData]);
    const upgradePicker = useMemo(() => geometry?.pick ?? createShapePicker(pageData?.shapes ?? []), [geometry, pageData]);
    useEffect(() => {
        if (!doc || !pageData || (pageData.geometrySource === 'native' && !geometry)) return;
        const pageElementKeys = new Set([...(pageData.elementKeys ?? []), ...(nativeSource?.resolvedElementKeys ?? []), ...pageData.shapes.map((shape) => shape.elementKey)]);
        setAnnotations((current) => {
            if (!current.some((annotation) => annotation.page === pageData.number && annotation.source?.linkState === 'pending')) return current;
            return upgradePageAnnotations(current, { pageNumber: pageData.number, elements: doc.elements, picker: upgradePicker, bounds: upgradeBounds, geometryReady: true, pageElementKeys }).annotations;
        });
    }, [doc, pageData, geometry, nativeSource, upgradeBounds, upgradePicker]);

    const hiddenAnnotationKey = useMemo(() => {
        const active = new Set(annotations.filter((annotation) => annotation.source).map((annotation) => annotation.id));
        const ids = new Set(doc?.viewerOwnedAnnotationRefs ?? []);
        for (const annotation of doc?.savedAnnotations ?? []) {
            if (!annotation.source || active.has(annotation.id)) continue;
            ids.add(annotation.source.renderId ?? annotation.source.ref);
            for (const reply of annotation.replies ?? []) if (reply.source) ids.add(reply.source.renderId ?? reply.source.ref);
        }
        return [...ids].sort().join('\n');
    }, [doc, annotations]);
    const hiddenAnnotationIds = useMemo(() => new Set(hiddenAnnotationKey ? hiddenAnnotationKey.split('\n') : []), [hiddenAnnotationKey]);
    useEffect(() => {
        if (!doc) return;
        const controller = new AbortController();
        upgradeController.current = controller;
        setUpgradeWarning(null);
        setUpgradeProgress(null);
        // Capture this review once per file/retry. Results are merged only into notes still awaiting a match.
        void upgradeDocumentAnnotations(doc, annotations, {
            signal: controller.signal,
            onProgress: (completed, total) => { if (!controller.signal.aborted) setUpgradeProgress({ completed, total }); },
            onPage: (result) => {
                if (controller.signal.aborted) return;
                const imported = new Map(result.annotations.filter((annotation) => annotation.source).map((annotation) => [annotation.id, annotation]));
                setAnnotations((current) => {
                    let changed = false;
                    const next = current.map((annotation) => {
                        const matched = imported.get(annotation.id);
                        if (annotation.source?.linkState !== 'pending' || !matched || matched.source?.linkState === 'pending') return annotation;
                        changed = true;
                        return { ...annotation, elementKey: matched.elementKey, elementKeys: matched.elementKeys, source: matched.source };
                    });
                    return changed ? next : current;
                });
            },
        }).catch((cause) => {
            if (!controller.signal.aborted) setUpgradeWarning(`Some markup links could not be matched: ${errorText(cause)}. The original PDF markups are preserved.`);
        }).finally(() => {
            if (!controller.signal.aborted) setUpgradeProgress(null);
        });
        return () => { controller.abort(); if (upgradeController.current === controller) upgradeController.current = null; };
    }, [doc, upgradeAttempt]);
    const onRenderError = useCallback((error: unknown) => setError(`Could not render the page: ${errorText(error)}`), []);
    const fileInput = useRef<HTMLInputElement>(null);
    const nextId = useRef(1);
    const openRequest = useRef(0);

    useEffect(() => () => { void doc?.dispose?.(); }, [doc]);
    useEffect(() => () => { openRequest.current++; }, []);

    /** `restore` reapplies a remembered review; without it the file opens fresh and becomes the remembered file. */
    const open = useCallback(async (file: File, restore?: Pick<SessionState, 'fingerprint'> & Partial<SessionState>) => {
        const request = ++openRequest.current;
        setError(null);
        setLoading({ fileName: file.name, fraction: 0, ceiling: stageCeiling('reading'), step: LOAD_STEPS.reading });
        try {
            const next = await loadEnhancedPdf(file, ({ stage, fraction }) => {
                if (request === openRequest.current) setLoading({ fileName: file.name, fraction: fraction * LOADER_SHARE, ceiling: stageCeiling(stage), step: LOAD_STEPS[stage] });
            });
            const fingerprint = await fingerprintBytes(next.bytes).catch(() => null);
            if (request !== openRequest.current) { await next.dispose?.(); return; }
            let rememberFailure: string | null = null;
            if (fingerprint && !restore) {
                await saveSessionFile({ fingerprint, fileName: file.name, blob: file }).catch((e) => { rememberFailure = errorText(e); });
                if (request !== openRequest.current) { await next.dispose?.(); return; }
            }
            // State recorded for a different file revision is never applied.
            const state = restore && restore.fingerprint === fingerprint ? restore : null;
            const annotations = recoverReviewAnnotations(next.savedAnnotations, state?.annotations, state?.importedAnnotationIds).filter((a) => a.page <= next.pageCount);
            awaitingFirstPage.current = next;
            setLoading({ fileName: file.name, fraction: LOADER_SHARE, ceiling: 0.99, step: LOAD_STEPS.page });
            nextId.current = nextAnnotationNumber(annotations);
            setDoc(next);
            setSessionId(rememberFailure ? null : fingerprint);
            setPage(state?.page ? Math.min(next.pageCount, state.page) : 1);
            setPageData(null);
            setNativeGeometry(null);
            setFilters(state?.filters ?? EMPTY_FILTERS);
            setFocusRequest(null);
            setAnnotations(annotations);
            const remembered = (state?.selectedKeys ?? []).filter((key) => next.elements.has(key));
            setPickedKeys(remembered);
            setFilterSelected(!!state?.filterSelected && !remembered.length);
            setSelectedAnnotationId(state?.selectedAnnotationId && annotations.some((a) => a.id === state.selectedAnnotationId) ? state.selectedAnnotationId : null);
            setHover(null);
            setZoomMode(state?.zoomMode ?? { kind: 'fit-width' });
            setTab(state?.tab ?? 'agent');
            setDocumentSession((session) => session + 1);
            setAgentHighlight(null);
            setPdfComments([]);
            setSelectedPdfComment(null);
            if (state?.drawKind && DRAW_KINDS.has(state.drawKind)) setDrawKind(state.drawKind as DrawKind);
            if (state?.highlightColor && HIGHLIGHT_COLORS.some((c) => c.value === state.highlightColor)) setHighlightColor(state.highlightColor);
            setPersistWarning(rememberFailure ? `This drawing will not be kept after a reload: ${rememberFailure}` : null);
        } catch (e) {
            if (request === openRequest.current) {
                setLoading(null);
                setError(`Could not open ${file.name}: ${errorText(e)}`);
            }
        }
    }, []);

    const revealViewer = useCallback(() => {
        setLoading((current) => (current?.done && !current.revealing ? { ...current, revealing: true } : current));
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.setTimeout(() => setLoading((current) => (current?.revealing ? null : current)), reduced ? 0 : REVEAL_MS);
    }, []);

    // Reopen the remembered file and review after a reload.
    useEffect(() => {
        let cancelled = false;
        const request = openRequest.current;
        loadSession().then(
            (session) => {
                if (cancelled) return;
                setRestoring(false);
                // The user already opened something else while storage was being read.
                if (!session || request !== openRequest.current) return;
                void open(new File([session.file.blob], session.file.fileName, { type: 'application/pdf' }), session.state ?? { fingerprint: session.file.fingerprint });
            },
            () => { if (!cancelled) setRestoring(false); },
        );
        return () => { cancelled = true; };
    }, [open]);

    const sessionState = useMemo<SessionState | null>(() => sessionId ? {
        version: SESSION_VERSION, fingerprint: sessionId, page, annotations, selectedKeys: [...pickedKeys], filterSelected, selectedAnnotationId, filters, zoomMode, tab, drawKind, highlightColor,
        importedAnnotationIds: doc?.savedAnnotations.filter((annotation) => annotation.source).map((annotation) => annotation.id),
    } : null, [sessionId, page, annotations, pickedKeys, filterSelected, selectedAnnotationId, filters, zoomMode, tab, drawKind, highlightColor, doc]);
    const pendingState = useRef<SessionState | null>(null);
    const persistWarned = useRef(false);
    const flushState = useCallback(() => {
        const state = pendingState.current;
        pendingState.current = null;
        if (!state) return;
        saveSessionState(state).catch((e) => {
            if (persistWarned.current) return;
            persistWarned.current = true;
            setPersistWarning(`Changes will not be kept after a reload: ${errorText(e)}`);
        });
    }, []);
    useEffect(() => {
        if (!sessionState) return;
        pendingState.current = sessionState;
        const timer = window.setTimeout(flushState, PERSIST_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [sessionState, flushState]);
    useEffect(() => {
        const onHide = () => { if (document.visibilityState === 'hidden') flushState(); };
        window.addEventListener('pagehide', flushState);
        document.addEventListener('visibilitychange', onHide);
        return () => {
            window.removeEventListener('pagehide', flushState);
            document.removeEventListener('visibilitychange', onHide);
        };
    }, [flushState]);

    // Page navigation clears the old interaction surface before this resolves.
    useEffect(() => {
        if (!doc) return;
        let cancelled = false;
        // The open dialog stays up until the newly opened document's first page is ready.
        const finishOpen = (ok: boolean) => {
            if (awaitingFirstPage.current !== doc) return;
            awaitingFirstPage.current = null;
            if (!ok) return setLoading(null);
            // The fade starts from the progress bar's onComplete, once its fill visibly reaches 100%.
            setLoading((current) => current && { ...current, fraction: 1, ceiling: 1, step: 'Ready', done: true });
        };
        doc.page(page).then(
            (p) => { if (!cancelled) { setPageData(p); finishOpen(true); } },
            (e) => { if (!cancelled) { setError(`Could not read page ${page}: ${errorText(e)}`); finishOpen(false); } },
        );
        return () => {
            cancelled = true;
        };
    }, [doc, page]);

    useEffect(() => {
        let cancelled = false;
        setPdfComments([]);
        setCommentsStatus('loading');
        if (doc) void readPdfComments(doc.pdf, page, doc.bytes, doc.savedAnnotations).then(
            (comments) => { if (!cancelled) { setPdfComments(comments); setCommentsStatus('ready'); } },
            () => { if (!cancelled) setCommentsStatus('error'); },
        );
        return () => { cancelled = true; };
    }, [doc, page]);

    const goToPage = useCallback(
        (n: number) => {
            if (!doc) return;
            const target = Math.min(doc.pageCount, Math.max(1, n));
            if (target === page) return;
            setPage(target);
            setFocusRequest(null);
            setPageData(null);
            setNativeGeometry(null);
            setHover(null);
            setPickedKeys([]);
            setSelectedAnnotationId(null);
            setAgentHighlight(null);
            setSelectedPdfComment(null);
            setTab('agent');
        },
        [doc, page],
    );

    const linksLabel = useCallback((keys: readonly string[]) => linksSummary(keys, doc?.elements), [doc]);
    const labelFor = useCallback(
        (key: string) => {
            const e = doc?.elements.get(key);
            // Drawn on the page, so just the type; the panel shows the ID (elementLabel).
            return e ? elementTypeLabel(e) : key;
        },
        [doc],
    );

    const describeTie = useCallback(
        (a: Annotation) => {
            const list = (keys: readonly string[]) => {
                const names = keys.map((key) => {
                    const el = doc?.elements.get(key);
                    return el ? elementLabel(el) : key;
                });
                return `${names.length} object${names.length === 1 ? '' : 's'}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? `, and ${names.length - 8} more` : ''}`;
            };
            if (a.kind === 'cloud') return a.contained?.length ? `Covers ${list(a.contained.map((c) => c.key))}` : 'Untied: covers no objects';
            const links = linkedKeys(a);
            if (links.length > 1) return `Linked to ${list(links)}`;
            const e = a.elementKey ? doc?.elements.get(a.elementKey) : undefined;
            return e ? `Tied to ${elementLabel(e)}` : a.elementKey ? `Tied to ${a.elementKey}` : 'Untied';
        },
        [doc],
    );

    /** Replace, extend or toggle the selection (shift-click, box drag). Extending a filter selection starts from its matches. */
    const selectElements = useCallback((keys: readonly string[], mode: 'replace' | 'add' | 'toggle') => {
        setFocusRequest(null);
        setSelectedPdfComment(null);
        setComposer(null);
        setSelectedAnnotationId(null);
        const next = mode === 'replace' ? [] : [...(selectedKeysRef.current ?? [])];
        for (const key of keys) {
            const at = next.indexOf(key);
            if (mode === 'toggle' && at >= 0) next.splice(at, 1);
            else if (at < 0) next.push(key);
        }
        setSelectedKeys(next);
        if (next.length > 0) setTab('properties');
    }, [setSelectedKeys]);

    const selectElement = useCallback((key: string | null) => {
        setFocusRequest(null);
        setSelectedKey(key);
        setSelectedPdfComment(null);
        setComposer(null);
        if (key) {
            setTab('properties');
            const drawingIds = new Set(doc?.appearances?.filter((appearance) => appearance.elementKey === key).map((appearance) => appearance.drawingId));
            const drawings = doc?.drawings?.filter((drawing) => drawingIds.has(drawing.id) && matchesDrawingScope(drawing.id, drawingScope)) ?? [];
            const target = drawings.find((drawing) => drawing.page === page) ?? drawings[0];
            if (target && target.page !== page) { setPage(target.page); setAgentHighlight(null); setFocusRequest(null); setPageData(null); setNativeGeometry(null); setSelectedAnnotationId(null); setHover(null); }
        } else if (!hasActiveFilters(filters)) {
            // Properties is empty with nothing selected and no filters, so fall back to the agent.
            setTab((current) => (current === 'properties' ? 'agent' : current));
        }
    }, [doc, page, drawingScope, filters, setSelectedKey]);

    const onHover = useCallback((key: string | null, at: { x: number; y: number }) => {
        setHover((h) => (key ? { key, ...at } : h === null ? h : null));
    }, []);

    /** `links` ties the annotation to those objects instead of to the object under its anchor. */
    const addAnnotation = (a: Omit<Annotation, 'id' | 'elementKey' | 'elementKeys' | 'page'>, links?: readonly string[], keepAgentOpen = false) => {
        if (!pageData) return;
        const draft: Annotation = withAuthorship(
            { ...a, page: pageData.number, id: `a${nextId.current++}`, ...(a.kind === 'highlight' ? { color: highlightColor } : {}) },
            profile,
            new Date().toISOString(),
        );
        // A cloud ties to what it covers; everything else ties to the object under its anchor.
        const tied = links !== undefined ? withLinks(draft, links) : draft.kind === 'cloud' ? tieCloud(draft, regionSources) : tieWithPicker(draft, pickElement, 4 / zoom);
        setAnnotations((list) => [...list, tied]);
        setSelectedAnnotationId(tied.id);
        setSelectedKeys(linkedKeys(tied));
        setTab(keepAgentOpen ? 'agent' : 'notes');
        setTool('select');
        return tied.id;
    };

    // A comment being written belongs to the comment tool and to one page.
    useEffect(() => {
        setComposer(null);
    }, [tool, pageData?.number]);

    const sendComment = (c: { text: string; at: Point; name: string }) => {
        addAnnotation({
            kind: 'comment', from: c.at, to: c.at, text: c.text, createdAt: new Date().toISOString(),
            author: { name: c.name, ...(profile.photo ? { photo: profile.photo } : {}) },
        }, composer?.links);
        setComposer(null);
    };

    // Dropping a pin ties it to whatever is under its tip, or unties it on empty paper.
    // A note linked to several objects keeps its links: they came from a selection, not from where it sits.
    const moveAnnotation = (id: string, patch: { from: Point; to: Point }) => {
        const moved = annotations.find((a) => a.id === id);
        if (!moved || moved.source) return;
        const next = { ...moved, ...patch };
        const retied = linkedKeys(moved).length > 1 ? next : next.kind === 'cloud' ? tieCloud(next, regionSources) : tieWithPicker(next, pickElement, 4 / zoom);
        setAnnotations((list) => list.map((a) => (a.id === id ? retied : a)));
        setSelectedKeys(linkedKeys(retied));
    };
    const moveComment = (id: string, at: Point) => moveAnnotation(id, { from: at, to: at });

    const sendReply = useCallback((id: string, r: { text: string; name: string }) => {
        const reply: Reply = {
            id: `r${nextId.current++}`, text: r.text, createdAt: new Date().toISOString(),
            author: { name: r.name, ...(profile.photo ? { photo: profile.photo } : {}) },
        };
        setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, replies: [...(a.replies ?? []), reply] } : a)));
        return reply.id;
    }, [profile.photo]);

    const editComment = useCallback((id: string, text: string) => {
        setAnnotations((list) => list.map((a) => (a.id === id && !a.source ? { ...a, text, modifiedAt: new Date().toISOString() } : a)));
    }, []);
    const editReply = useCallback((id: string, replyId: string, text: string) => {
        setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, replies: (a.replies ?? []).map((r) => (r.id === replyId && !r.source ? { ...r, text } : r)) } : a)));
    }, []);

    const deleteById = useCallback((id: string) => {
        setPreviewKeys(null);
        setAnnotations((list) => list.filter((a) => a.id !== id));
        setSelectedAnnotationId((current) => (current === id ? null : current));
    }, []);

    const tieAnnotation = useCallback((id: string, elementKey: string | null) => {
        setAnnotations((list) => list.map((a) => (a.id === id ? withLinks({ ...a,
            ...(a.source ? { source: { ...a.source, linkState: elementKey ? 'linked' as const : 'unlinked' as const, linkMethod: 'manual' as const, candidateKeys: undefined, suggestedElementKeys: undefined } } : {}),
        }, elementKey ? [elementKey] : []) : a)));
        setSelectedKey(elementKey);
    }, [setSelectedKey]);

    const linkImported = (id: string, keys: readonly string[]) => {
        const valid = keys.filter((key) => doc?.elements.has(key));
        if (!valid.length) return;
        setAnnotations((current) => current.map((annotation) => annotation.id === id && annotation.source
            ? withLinks({ ...annotation, source: { ...annotation.source, linkState: 'linked' as const, linkMethod: 'manual' as const, candidateKeys: undefined, suggestedElementKeys: undefined } }, valid)
            : annotation));
        setSelectedKeys(valid);
    };

    const deleteSelected = useCallback(() => {
        setAnnotations((list) => list.filter((a) => a.id !== selectedAnnotationId));
        setSelectedAnnotationId(null);
    }, [selectedAnnotationId]);

    const clearAll = useCallback(() => {
        setAnnotations([]);
        setSelectedAnnotationId(null);
    }, []);

    const save = useCallback(async () => {
        if (!doc || saving) return false;
        setSaving(true);
        setError(null);
        try {
            const bytes = await buildAnnotatedPdf(doc.bytes, annotations, describeTie, { originalAnnotations: doc.savedAnnotations, elements: doc.elements, drawings: doc.drawings, appearances: doc.appearances });
            const name = annotatedName(doc.fileName);
            downloadPdf(bytes, name);
            return true;
        } catch (e) {
            setError(`Could not save: ${errorText(e)}`);
            return false;
        } finally {
            setSaving(false);
        }
    }, [doc, saving, annotations, describeTie]);

    const print = useCallback(async () => {
        if (!doc) return;
        try {
            printPdf(annotations.length || doc.importedAnnotationCount ? await buildAnnotatedPdf(doc.bytes, annotations, describeTie, { originalAnnotations: doc.savedAnnotations, elements: doc.elements, drawings: doc.drawings, appearances: doc.appearances }) : doc.bytes);
        } catch (e) {
            setError(`Could not print: ${errorText(e)}`);
        }
    }, [doc, annotations, describeTie]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const typing = (e.target as HTMLElement).closest('input, textarea, select');
            if ((e.metaKey || e.ctrlKey) && doc && !e.altKey) {
                const k = e.key.toLowerCase();
                if (k === 's') { e.preventDefault(); void save(); }
                else if (k === 'p') { e.preventDefault(); void print(); }
                return;
            }
            if (typing) return;
            if (e.key === 'Escape') { setTool('select'); setFocusRequest(null); }
            else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
            else if (e.key === 'PageDown') goToPage(page + 1);
            else if (e.key === 'PageUp') goToPage(page - 1);
            else if (doc && KEYS[e.key.toLowerCase()]) {
                const t = KEYS[e.key.toLowerCase()]!;
                setFocusRequest(null);
                setTool(t === 'draw' ? drawKind : t);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [doc, page, drawKind, deleteSelected, goToPage, save, print]);

    // Hold Space to pan temporarily; releasing restores the previous tool.
    const toolRef = useRef(tool);
    toolRef.current = tool;
    const spacePanFrom = useRef<Tool | null>(null);
    useEffect(() => {
        if (!doc) return;
        const release = () => {
            const previous = spacePanFrom.current;
            if (previous === null) return;
            spacePanFrom.current = null;
            if (toolRef.current === 'pan') setTool(previous);
        };
        const onDown = (e: KeyboardEvent) => {
            if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey) return;
            if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
            e.preventDefault();
            if (e.repeat || spacePanFrom.current !== null || toolRef.current === 'pan') return;
            spacePanFrom.current = toolRef.current;
            setTool('pan');
        };
        const onUp = (e: KeyboardEvent) => {
            if (e.code !== 'Space' || spacePanFrom.current === null) return;
            e.preventDefault();
            release();
        };
        window.addEventListener('keydown', onDown);
        window.addEventListener('keyup', onUp);
        window.addEventListener('blur', release);
        return () => {
            window.removeEventListener('keydown', onDown);
            window.removeEventListener('keyup', onUp);
            window.removeEventListener('blur', release);
            release();
        };
    }, [doc]);

    const elementList = useMemo(() => (doc ? [...doc.elements.values()] : []), [doc, pageData]);
    const filterContext = useMemo(() => ({ drawings: doc?.drawings ?? [], appearances: doc?.appearances ?? [] }), [doc]);
    const matchedElements = useMemo(() => filterElements(elementList, doc?.parameters ?? new Map(), filters, filterContext), [elementList, doc, filters, filterContext]);
    const matchedKeys = useMemo(() => new Set(matchedElements.map((element) => element.key)), [matchedElements]);
    const locations = useMemo(() => elementLocations(elementList, nativeSource, geometry, pageData?.shapes ?? [], drawingScope), [elementList, nativeSource, geometry, pageData, drawingScope]);
    const locatableCount = useMemo(() => matchedElements.filter((element) => ['ready', 'partial', 'legacy'].includes(locations.get(element.key) ?? '')).length, [matchedElements, locations]);
    const appearanceCount = useMemo(() => geometry
        ? new Set(geometry.parts.filter((part) => matchedKeys.has(part.elementKey) && matchesDrawingScope(part.drawingId, drawingScope)).map((part) => part.appearanceId)).size
        : new Set((pageData?.shapes ?? []).filter((shape) => matchedKeys.has(shape.elementKey) && matchesDrawingScope(shape.drawingId, drawingScope)).map((shape) => JSON.stringify([shape.drawingId, shape.elementKey]))).size,
    [geometry, pageData, matchedKeys, drawingScope]);
    const filtersActive = hasActiveFilters(filters);
    const selectedKeys = useMemo<ReadonlySet<string> | null>(() => pickedKeys.length ? new Set(pickedKeys) : filterSelected && filtersActive ? matchedKeys : null, [pickedKeys, filterSelected, filtersActive, matchedKeys]);
    const selectedKeysRef = useRef(selectedKeys);
    selectedKeysRef.current = selectedKeys;
    const selectedElements = useMemo(() => pickedKeys.length ? pickedKeys.map((key) => doc?.elements.get(key)).filter((e): e is ElementInfo => !!e) : filterSelected && filtersActive ? matchedElements : [], [doc, pickedKeys, filterSelected, filtersActive, matchedElements]);
    const hoverElement = hover && doc?.elements.get(hover.key);
    const pageAnnotations = useMemo(() => annotations.filter((a) => a.page === pageData?.number), [annotations, pageData]);
    const importedAnnotations = useMemo(() => annotations.filter((annotation) => annotation.source), [annotations]);
    const importedLinkedCount = importedAnnotations.filter((annotation) => annotation.source?.linkState === 'linked').length;
    const importedSuggestedCount = importedAnnotations.filter((annotation) => annotation.source?.linkState === 'suggested').length;
    const importedPendingCount = importedAnnotations.filter((annotation) => annotation.source?.linkState === 'pending').length;
    const importedReviewCount = importedAnnotations.length - importedLinkedCount - importedSuggestedCount - importedPendingCount;

    // Elements on this page within the drawing/view filter: what the agent sees and what Select similar picks from.
    const pageElements = useMemo(() => {
        if (!doc || !pageData) return [];
        const pageKeys = new Set([
            ...(pageData.elementKeys ?? []),
            ...(pageData.nativeTags?.resolvedElementKeys ?? []),
            ...pageData.shapes.map((shape) => shape.elementKey),
        ]);
        const scopedKeys = drawingScope ? new Set((doc.appearances ?? []).filter((appearance) => matchesDrawingScope(appearance.drawingId, drawingScope)).map((appearance) => appearance.elementKey)) : null;
        return elementList.filter((element) => pageKeys.has(element.key) && (!scopedKeys || scopedKeys.has(element.key)));
    }, [doc, pageData, elementList, drawingScope]);

    const agentContext = useMemo<AgentContext | null>(() => {
        if (!doc || !pageData) return null;
        const elements = pageElements;
        return {
            elements, parameters: doc.parameters, pageNumber: pageData.number,
            scopeKey: drawingScope ? JSON.stringify([...drawingScope].sort()) : 'all-views',
            locatableKeys: new Set(elements.filter((element) => ['ready', 'partial', 'legacy'].includes(locations.get(element.key) ?? '')).map((element) => element.key)),
            comments: [...pdfComments, ...viewerComments(pageAnnotations)], commentsStatus,
            annotations: pageAnnotations, selectedKeys: selectedKeys ?? new Set<string>(), pageCount: doc.pageCount,
        };
    }, [doc, pageData, pageElements, drawingScope, locations, pdfComments, pageAnnotations, commentsStatus, selectedKeys]);

    const cancelFocus = useCallback(() => setFocusRequest(null), []);
    const changeFilters = useCallback((next: FilterState) => {
        setFilters(next);
        setPickedKeys([]);
        setFilterSelected(hasActiveFilters(next));
        setAgentHighlight(null);
        setFocusRequest(null);
    }, []);
    const changeZoomMode = useCallback((next: ZoomMode) => { setFocusRequest(null); setZoomMode(next); }, []);
    const changeTool = useCallback((next: Tool) => { setFocusRequest(null); setTool(next); }, []);
    const locateElement = (key: string) => {
        if (!pageData || !['ready', 'partial', 'legacy'].includes(locations.get(key) ?? '')) return;
        setSelectedKey(key);
        setSelectedAnnotationId(null);
        setHover(null);
        setTool('select');
        setFocusRequest({ id: ++nextFocusId.current, pageNumber: pageData.number, elementKeys: new Set([key]), drawingIds: drawingScope });
    };
    const fitMatches = () => {
        if (!pageData || !locatableCount) return;
        setTool('select');
        setFocusRequest({ id: ++nextFocusId.current, pageNumber: pageData.number, elementKeys: matchedKeys, drawingIds: drawingScope });
    };

    const applyAgentHighlight = (highlight: AgentHighlight | null, preserveSelection = false) => {
        setAgentHighlight(highlight);
        if (highlight && !preserveSelection) setSelectedKey(null);
        setSelectedAnnotationId(null);
        setFocusRequest(null);
        setTool('select');
        setComposer(null);
    };

    // Selection bar: widen the selection to every element of the same type on this page and view.
    const selectSimilar = () => {
        if (!selectedElements.length) return;
        setSelectedKeys(similarElementKeys(selectedElements, pageElements));
        setSelectedAnnotationId(null);
        setSelectedPdfComment(null);
        setComposer(null);
        setFocusRequest(null);
        setTab('properties');
    };
    // Selection bar: start a comment at `at` that links to every selected element.
    const commentOnSelection = (at: Point) => {
        if (!selectedKeys?.size) return;
        setSelectedAnnotationId(null);
        setSelectedPdfComment(null);
        setFocusRequest(null);
        setComposer({ at, links: [...selectedKeys] });
    };
    const composerContext = (() => {
        const links = composer?.links;
        if (!links?.length) return null;
        if (links.length > 1) return `On ${linksSummary(links, doc?.elements)}`;
        const element = doc?.elements.get(links[0]!);
        return `On ${element ? elementLabel(element) : links[0]}`;
    })();
    const fitAgentHighlights = () => {
        if (!pageData || !agentHighlight) return;
        setTool('select');
        setFocusRequest({ id: ++nextFocusId.current, pageNumber: pageData.number, elementKeys: agentHighlight.elementKeys, drawingIds: drawingScope });
    };
    const selectComment = (comment: DrawingComment) => {
        goToPage(comment.page);
        setSelectedPdfComment(comment.source === 'pdf' ? comment : null);
        const annotationId = comment.source === 'viewer' ? comment.annotationId ?? comment.id : null;
        const annotation = annotations.find((note) => note.id === annotationId);
        setSelectedAnnotationId(annotationId);
        setSelectedKeys(annotation ? reviewKeys(annotation) : comment.elementKey ? [comment.elementKey] : []);
        setTab('notes');
    };
    const reviewImported = () => {
        const annotation = importedAnnotations.find((note) => note.source?.linkState === 'suggested') ?? importedAnnotations.find((note) => note.source?.linkState !== 'linked') ?? importedAnnotations[0];
        if (!annotation) return;
        goToPage(annotation.page);
        setSelectedAnnotationId(annotation.id);
        setSelectedKeys(reviewKeys(annotation));
        setSelectedPdfComment(null);
        setTab('notes');
    };

    const handleAgentAction = async (action: AgentHostAction): Promise<AgentHostResult> => {
        if (!doc || !pageData) throw new Error('Open a drawing before using viewer tools.');
        const scoped = new Set(pageElements.map((element) => element.key));
        const checkedKeys = (values: readonly string[]) => {
            const keys = [...new Set(values)];
            if (keys.some((key) => !scoped.has(key))) throw new Error('Some results are outside the current drawing view. Query the drawing again.');
            return keys;
        };
        if (action.type === 'select' || action.type === 'focus') {
            const keys = checkedKeys(action.elementKeys);
            if (!keys.length) throw new Error('There are no matching elements to show.');
            if (action.type === 'focus') {
                const located = keys.filter((key) => agentContext?.locatableKeys.has(key));
                if (!located.length) throw new Error('These elements have no mapped geometry in this drawing. Their properties remain available.');
                setTool('select');
                setFocusRequest({ id: ++nextFocusId.current, pageNumber: pageData.number, elementKeys: new Set(located), drawingIds: drawingScope });
                return { message: `Focused ${located.length} mapped elements on page ${pageData.number}.` };
            }
            setComposer(null);
            setSelectedPdfComment(null);
            setSelectedAnnotationId(null);
            setSelectedKeys(keys);
            setTab('agent');
            return { message: `Selected ${keys.length} elements on page ${pageData.number}.` };
        }
        if (action.type === 'add_comment') {
            const text = action.text.trim();
            if (!text || text.length > 4000) throw new Error('A comment must contain between 1 and 4000 characters.');
            const keys = checkedKeys(action.elementKeys);
            const wanted = new Set(keys);
            const parts = regionSources.filter((source) => wanted.has(source.elementKey));
            if (keys.length && !parts.length) throw new Error('These elements have no mapped location for a comment pin. Add a general page comment instead.');
            const bounds = parts.reduce((box, part) => [Math.min(box[0], part.bounds[0]), Math.min(box[1], part.bounds[1]), Math.max(box[2], part.bounds[2]), Math.max(box[3], part.bounds[3])] as const, [Infinity, Infinity, -Infinity, -Infinity] as readonly [number, number, number, number]);
            const at: Point = parts.length ? [
                Math.max(12, Math.min(pageData.width - 12, bounds[2])),
                Math.max(24, Math.min(pageData.height - 12, bounds[1])),
            ] : [pageData.width / 2, pageData.height / 2];
            const id = addAnnotation({ kind: 'comment', from: at, to: at, text, author: { name: profile.name.trim() || 'Drawing agent', ...(profile.name.trim() && profile.photo ? { photo: profile.photo } : {}) } }, keys, true);
            if (!id) throw new Error('The comment could not be added. Reopen the drawing and try again.');
            return { message: keys.length ? `Added a comment linked to ${keys.length} elements.` : 'Added a general page comment.', id };
        }
        if (action.type === 'reply_comment') {
            const comment = annotations.find((annotation) => annotation.id === action.commentId && annotation.kind === 'comment' && annotation.page === pageData.number);
            if (!comment) throw new Error('That comment is unavailable on the current page. Inspect the comments again.');
            if (!action.text.trim() || action.text.length > 4000) throw new Error('A reply must contain between 1 and 4000 characters.');
            const id = sendReply(comment.id, { text: action.text.trim(), name: profile.name.trim() || 'Drawing agent' });
            return { message: 'Added the reply to the comment thread.', id };
        }
        if (action.type === 'open_comment') {
            const context = agentContext?.comments.find((comment) => comment.id === action.commentId);
            const annotation = annotations.find((note) => note.id === (context?.annotationId ?? action.commentId));
            if (annotation) {
                goToPage(annotation.page);
                setSelectedAnnotationId(annotation.id);
                setSelectedKeys(reviewKeys(annotation));
                setSelectedPdfComment(null);
                setTab('notes');
                return { message: 'Opened the comment in Notes.', id: annotation.id };
            }
            if (context) { selectComment(context); return { message: 'Opened the PDF comment in Notes.', id: context.id }; }
            throw new Error('That comment is no longer available. Inspect the comments again.');
        }
        if (action.type !== 'viewer_action') throw new Error('That viewer action is unavailable.');
        switch (action.action) {
            case 'clear_selection': setSelectedKeys([]); setSelectedAnnotationId(null); setSelectedPdfComment(null); return { message: 'Selection cleared.' };
            case 'fit_page': changeZoomMode({ kind: 'fit-page' }); return { message: 'Fitted the page to the viewer.' };
            case 'fit_width': changeZoomMode({ kind: 'fit-width' }); return { message: 'Fitted the page width to the viewer.' };
            case 'zoom_in': changeZoomMode({ kind: 'value', value: clampZoom(zoom * 1.25) }); return { message: 'Zoomed in.' };
            case 'zoom_out': changeZoomMode({ kind: 'value', value: clampZoom(zoom / 1.25) }); return { message: 'Zoomed out.' };
            case 'go_to_page':
                if (!Number.isInteger(action.page) || action.page! < 1 || action.page! > doc.pageCount) throw new Error(`Choose a page from 1 to ${doc.pageCount}.`);
                goToPage(action.page!); return { message: `Opened page ${action.page}.` };
            case 'download_pdf':
                if (!await save()) throw new Error('The PDF could not be downloaded. Check the viewer error and try again.');
                return { message: 'Downloaded the PDF with its markups and review data.' };
        }
    };

    return (
        <div className="app">
            <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ''; }} />
            <DocBar
                disabled={!doc}
                saving={saving}
                onSave={() => void save()}
                onPrint={() => void print()}
                page={page}
                pageCount={doc?.pageCount ?? 0}
                onPage={goToPage}
                tool={tool}
                onTool={changeTool}
                zoom={zoom}
                zoomMode={zoomMode}
                onZoomMode={changeZoomMode}
                onZoomIn={() => changeZoomMode({ kind: 'value', value: clampZoom(zoom * 1.25) })}
                onZoomOut={() => changeZoomMode({ kind: 'value', value: clampZoom(zoom / 1.25) })}
                onUpload={() => fileInput.current?.click()}
                account={<ProfileMenu profile={profile} onChange={setProfile} />}
            />
            <Dialog open={loading !== null} onClose={() => undefined} dismissible={false} title="Opening drawing" titleClassName="type-h3" description={loading?.fileName} className={`load-dialog${loading?.revealing ? ' is-revealing' : ''}`}>
                {loading && <ProgressBar label={`Opening ${loading.fileName}`} value={loading.fraction} ceiling={loading.ceiling} detail={loading.step} onComplete={revealViewer} />}
            </Dialog>
            <div className="viewer-notices">
                {error && <StatusMessage tone="error" variant="banner" title={error} />}
                {persistWarning && <StatusMessage tone="warning" variant="banner" title={persistWarning} />}
                {doc?.warnings.map((w) => <StatusMessage tone="warning" variant="banner" title={w} key={w} />)}
                {importedAnnotations.length > 0 && <section className="imported-review-summary" aria-label="Existing PDF markup upgrade">
                    <span role="status"><strong>{importedAnnotations.length} existing PDF markup{importedAnnotations.length === 1 ? '' : 's'} imported</strong> · {importedLinkedCount} smart{importedSuggestedCount ? ` · ${importedSuggestedCount} awaiting acceptance` : ''} · {importedReviewCount} {importedReviewCount === 1 ? 'needs' : 'need'} review{importedPendingCount ? ` · ${importedPendingCount} awaiting geometry` : ''}</span>
                    <button type="button" className="btn" onClick={reviewImported}>Review imported notes</button>
                    {upgradeProgress ? <><span className="muted">Matching page {Math.min(upgradeProgress.completed + 1, upgradeProgress.total)} of {upgradeProgress.total}</span><button type="button" className="btn" onClick={() => { upgradeController.current?.abort(); setUpgradeProgress(null); setUpgradeWarning('Matching paused. Original markups are preserved.'); }}>Cancel matching</button></>
                        : importedPendingCount > 0 && <button type="button" className="btn" onClick={() => setUpgradeAttempt((attempt) => attempt + 1)}>Match remaining notes</button>}
                </section>}
                {upgradeWarning && <StatusMessage tone="warning" variant="banner" title={upgradeWarning} />}
            </div>
            <main className="main">
                <div className="stage-wrap">
                    {doc && <div className="file-chip" title={doc.fileName}>{doc.fileName}</div>}
                    {doc && pageData ? (
                        <PdfStage
                            pdf={doc.pdf}
                            page={pageData}
                            zoomMode={zoomMode}
                            hiddenAnnotationIds={hiddenAnnotationIds}
                            tool={tool}
                            hoverKey={hover?.key ?? null}
                            previewKeys={previewKeys}
                            selectedKeys={selectedKeys}
                            onSelectElements={selectElements}
                            regionOf={(rect) => elementsInCloud({ from: [rect[0], rect[1]], to: [rect[2], rect[3]] }, regionSources)}
                            annotations={pageAnnotations}
                            selectedAnnotationId={selectedAnnotationId}
                            highlightColor={highlightColor}
                            labelFor={labelFor}
                            linksLabel={linksLabel}
                            onZoom={setZoom}
                            onZoomMode={setZoomMode}
                            onHover={onHover}
                            onSelectElement={selectElement}
                            onSelectAnnotation={(id) => {
                                setSelectedAnnotationId(id);
                                if (!id) return;
                                // The markup layer has already picked the note's first tie; a note linked to several objects selects them all.
                                const a = annotations.find((x) => x.id === id);
                                if (a && linkedKeys(a).length > 1) setSelectedKeys(linkedKeys(a));
                                setSelectedPdfComment(null);
                                setTab('notes');
                            }}
                            onAddAnnotation={addAnnotation}
                            onMoveAnnotation={moveAnnotation}
                            coverOf={(cloud) => elementsInCloud(cloud, regionSources)}
                            onStartComment={(point) => { setSelectedAnnotationId(null); setComposer({ at: point }); }}
                            commentLayer={{
                                selectedId: selectedAnnotationId,
                                composerAt: composer?.at ?? null,
                                composerContext,
                                profile,
                                onProfile: setProfile,
                                labelFor,
                                linksLabel,
                                onPreview: setPreviewKeys,
                                onSelect: (id) => {
                                    setSelectedAnnotationId(id);
                                    setComposer(null);
                                    const a = id ? annotations.find((x) => x.id === id) : undefined;
                                    setSelectedKeys(a ? reviewKeys(a) : []);
                                    if (id) { setSelectedPdfComment(null); setTab('notes'); }
                                },
                                onMove: moveComment,
                                onDragTarget: (key, client) => onHover(key, client),
                                onSend: sendComment,
                                onCancel: () => setComposer(null),
                            }}
                            pickElement={pickElement}
                            onRenderError={onRenderError}
                            createCapture={createCapture}
                            geometry={geometry}
                            matchedKeys={filtersActive ? matchedKeys : null}
                            elementColors={agentHighlight?.colors}
                            drawingIds={drawingScope}
                            focusRequest={focusRequest}
                            onCancelFocus={cancelFocus}
                            selectionActions={{ onSelectSimilar: selectSimilar, onComment: commentOnSelection }}
                        />
                    ) : (
                        <div className="stage">
                            <div className="empty">
                                <div className="splash-copy">
                                    {doc || restoring ? <p><strong>{doc ? 'Loading page…' : 'Restoring previous session…'}</strong></p> : <>
                                        <h1 className="type-h1 splash-title">Explore your drawing with AI.</h1>
                                        <p className="splash-description">Open an enhanced PDF to ask the drawing agent, inspect element properties, and review markups.</p>
                                        <ActionButton className="upload-btn empty-upload" onClick={() => fileInput.current?.click()}><UploadIcon />Open enhanced PDF</ActionButton>
                                    </>}
                                </div>
                            </div>
                        </div>
                    )}
                    <Toolbar
                        tool={tool}
                        onTool={changeTool}
                        drawKind={drawKind}
                        onDrawKind={setDrawKind}
                        highlightColor={highlightColor}
                        onHighlightColor={setHighlightColor}
                        canDelete={selectedAnnotationId !== null}
                        onDelete={deleteSelected}
                        annotationCount={annotations.length}
                        onClearAll={clearAll}
                        disabled={!doc}
                    />
                </div>
                <aside className="side" data-doc={doc ? 'open' : 'none'}>
                    <SegmentedControl label="Inspector" value={tab} onChange={setTab} options={TABS.map((t) => ({
                        value: t,
                        label: t === 'agent' ? 'Agent' : t === 'notes' ? 'Notes' : t === 'elements' ? 'Elements' :'Properties',
                    }))} />
                    <div className="panel" role="tabpanel" aria-label={tab === 'agent' ? 'Agent' : tab === 'properties' ? 'Properties' : tab === 'elements' ? 'Elements' : 'Notes'}>
                        <div className="agent-panel-host" hidden={tab !== 'agent'}>
                            <AgentPanel context={agentContext} sessionKey={`${documentSession}:${page}`} active={tab === 'agent'} onHighlight={applyAgentHighlight} activeHighlight={agentHighlight} onFitHighlights={fitAgentHighlights} onSelectComment={selectComment} onAction={handleAgentAction} />
                        </div>
                        {tab === 'agent' ? null : !doc ? (
                            <div className="panel-empty">Nothing loaded.</div>
                        ) : tab === 'properties' ? (
                            <PropertiesPanel doc={doc} elements={selectedElements} hasShapes={!!geometry?.parts.length || (pageData?.shapes.length ?? 0) > 0} locations={locations} onLocate={locateElement} onFitSelection={fitMatches} onPreview={setPreviewKeys} />
                        ) : tab === 'elements' ? (
                            <>
                                <FilterPanel elements={elementList} parameters={doc.parameters} value={filters} onChange={changeFilters} matchedCount={matchedElements.length} locatableCount={locatableCount} appearanceCount={appearanceCount} context={filterContext} pageNumber={page} onFitMatches={fitMatches} />
                                {hasActiveFilters(filters) && <ElementList elements={matchedElements} selectedKey={selectedKey} onSelect={selectElement} locations={locations} onLocate={locateElement} />}
                            </>
                        ) : (
                            <>
                            {selectedPdfComment && <section className="pdf-comment-context">
                                <span className="chip">PDF review comment · page {selectedPdfComment.page}</span>
                                <p>{selectedPdfComment.text}</p>
                                <div className="muted">{selectedPdfComment.author ?? 'Author not recorded'} · {selectedPdfComment.modifiedAt ?? selectedPdfComment.createdAt ?? 'Date not recorded'}</div>
                                <p className="muted">Embedded in the source PDF.</p>
                            </section>}
                            <NotesList
                                annotations={annotations}
                                elements={doc.elements}
                                selectedId={selectedAnnotationId}
                                profile={profile}
                                onProfile={setProfile}
                                onTie={tieAnnotation}
                                onReply={sendReply}
                                onEdit={editComment}
                                onEditReply={editReply}
                                onPreview={setPreviewKeys}
                                onDelete={deleteById}
                                onOpenElement={selectElement}
                                onLinkImported={linkImported}
                                onSelect={(a) => { goToPage(a.page); setSelectedPdfComment(null); setSelectedAnnotationId(a.id); setSelectedKeys(reviewKeys(a)); }}
                            />
                            </>
                        )}
                    </div>
                </aside>
            </main>
            {hoverElement && hover && tool === 'select' && <HoverCard element={hoverElement} at={hover} />}
        </div>
    );
}
