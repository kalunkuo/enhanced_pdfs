import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocBar } from './components/patterns/DocBar';
import { ElementList } from './components/patterns/ElementList';
import { FilterPanel } from './components/patterns/FilterPanel';
import { HoverCard } from './components/patterns/HoverCard';
import { NotesList } from './components/patterns/NotesList';
import { ProfileMenu } from './components/patterns/ProfileMenu';
import { PdfStage, clampZoom, type Tool, type ZoomMode } from './components/patterns/PdfStage';
import { PropertiesPanel } from './components/patterns/PropertiesPanel';
import { HIGHLIGHT_COLORS, Toolbar, type DrawKind } from './components/patterns/Toolbar';
import { Button } from './components/ui/Button';
import { StatusMessage } from './components/ui/StatusMessage';
import { UploadIcon } from './components/ui/icons';
import { createShapePicker, tieWithPicker } from './lib/hit';
import { elementLocations } from './lib/coverage';
import { EMPTY_FILTERS, filterElements, getDrawingScope, hasActiveFilters, matchesDrawingScope, type FilterState } from './lib/filters';
import { createNativeGeometryCapture, type NativeGeometry } from './lib/nativeGeometry';
import { loadEnhancedPdf } from './lib/load';
import { annotatedName, downloadPdf, printPdf } from './lib/print';
import { buildAnnotatedPdf } from './lib/save';
import type { FocusRequest } from './lib/navigation';
import { withAuthorship } from './lib/comments';
import { useProfile } from './lib/profile';
import type { Annotation, EnhancedPdf, PageData, Point, Reply } from './lib/types';

type Tab = 'properties' | 'elements' | 'notes';
const KEYS: Record<string, Tool | 'draw'> = { v: 'select', c: 'comment', h: 'highlight', d: 'draw', t: 'text', s: 'signature' };
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
    const [doc, setDoc] = useState<EnhancedPdf | null>(null);
    const [page, setPage] = useState(1);
    const [pageData, setPageData] = useState<PageData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [tool, setTool] = useState<Tool>('select');
    const [profile, setProfile] = useProfile();
    const [composerAt, setComposerAt] = useState<Point | null>(null);
    const [drawKind, setDrawKind] = useState<DrawKind>('pen');
    const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_COLORS[0].value);
    const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: 'fit-width' });
    const [zoom, setZoom] = useState(1);
    const [tab, setTab] = useState<Tab>('properties');
    const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
    const [nativeGeometry, setNativeGeometry] = useState<NativeGeometry | null>(null);
    const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
    const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
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
    const onRenderError = useCallback((error: unknown) => setError(`Could not render the page: ${errorText(error)}`), []);
    const fileInput = useRef<HTMLInputElement>(null);
    const nextId = useRef(1);
    const openRequest = useRef(0);

    useEffect(() => () => { void doc?.dispose?.(); }, [doc]);
    useEffect(() => () => { openRequest.current++; }, []);

    const open = useCallback(async (file: File) => {
        const request = ++openRequest.current;
        setError(null);
        try {
            const next = await loadEnhancedPdf(file);
            if (request !== openRequest.current) { await next.dispose?.(); return; }
            nextId.current = 1 + next.savedAnnotations.length;
            setDoc(next);
            setPage(1);
            setPageData(null);
            setNativeGeometry(null);
            setFilters(EMPTY_FILTERS);
            setFocusRequest(null);
            setAnnotations(next.savedAnnotations);
            setSelectedKey(null);
            setSelectedAnnotationId(null);
            setHover(null);
            setZoomMode({ kind: 'fit-width' });
            setTab('properties');
            setStatus(next.savedAnnotations.length ? `Restored ${next.savedAnnotations.length} saved annotations` : null);
        } catch (e) {
            if (request === openRequest.current) setError(`Could not open ${file.name}: ${errorText(e)}`);
        }
    }, []);

    const openDemo = async () => {
        const blob = await (await fetch('/demo/demo-enhanced.pdf')).blob();
        await open(new File([blob], 'demo-enhanced.pdf', { type: 'application/pdf' }));
    };

    // Page navigation clears the old interaction surface before this resolves.
    useEffect(() => {
        if (!doc) return;
        let cancelled = false;
        doc.page(page).then(
            (p) => !cancelled && setPageData(p),
            (e) => !cancelled && setError(`Could not read page ${page}: ${errorText(e)}`),
        );
        return () => {
            cancelled = true;
        };
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
            setSelectedKey(null);
            setSelectedAnnotationId(null);
        },
        [doc, page],
    );

    const labelFor = useCallback(
        (key: string) => {
            const e = doc?.elements.get(key);
            return e ? (e.mark ?? e.name) : key;
        },
        [doc],
    );

    const describeTie = useCallback(
        (a: Annotation) => {
            const e = a.elementKey ? doc?.elements.get(a.elementKey) : undefined;
            return e ? `Tied to ${e.mark ?? e.name} (ID ${e.elementIdText ?? e.elementId})` : a.elementKey ? `Tied to ${a.elementKey}` : 'Untied';
        },
        [doc],
    );

    const selectElement = useCallback((key: string | null) => {
        setFocusRequest(null);
        setSelectedKey(key);
        if (key) {
            setTab('properties');
            const drawingIds = new Set(doc?.appearances?.filter((appearance) => appearance.elementKey === key).map((appearance) => appearance.drawingId));
            const drawings = doc?.drawings?.filter((drawing) => drawingIds.has(drawing.id) && matchesDrawingScope(drawing.id, drawingScope)) ?? [];
            const target = drawings.find((drawing) => drawing.page === page) ?? drawings[0];
            if (target && target.page !== page) { setPage(target.page); setFocusRequest(null); setPageData(null); setNativeGeometry(null); setSelectedAnnotationId(null); setHover(null); }
        }
    }, [doc, page, drawingScope]);

    const onHover = useCallback((key: string | null, at: { x: number; y: number }) => {
        setHover((h) => (key ? { key, ...at } : h === null ? h : null));
    }, []);

    const addAnnotation = (a: Omit<Annotation, 'id' | 'elementKey' | 'page'>) => {
        if (!pageData) return;
        const draft: Annotation = withAuthorship(
            { ...a, page: pageData.number, id: `a${nextId.current++}`, ...(a.kind === 'highlight' ? { color: highlightColor } : {}) },
            profile,
            new Date().toISOString(),
        );
        const tied = tieWithPicker(draft, pickElement, 4 / zoom);
        setAnnotations((list) => [...list, tied]);
        setSelectedAnnotationId(tied.id);
        setSelectedKey(tied.elementKey ?? null);
        setTab('notes');
        setTool('select');
    };

    // A comment being written belongs to the comment tool and to one page.
    useEffect(() => {
        setComposerAt(null);
    }, [tool, pageData?.number]);

    const sendComment = (c: { text: string; image?: string; at: Point; name: string }) => {
        addAnnotation({
            kind: 'comment', from: c.at, to: c.at, text: c.text, createdAt: new Date().toISOString(),
            author: { name: c.name, ...(profile.photo ? { photo: profile.photo } : {}) },
            ...(c.image ? { image: c.image } : {}),
        });
        setComposerAt(null);
    };

    // Dropping a pin ties it to whatever is under its tip, or unties it on empty paper.
    const moveAnnotation = (id: string, patch: { from: Point; to: Point }) => {
        const moved = annotations.find((a) => a.id === id);
        if (!moved) return;
        const retied = tieWithPicker({ ...moved, ...patch }, pickElement, 4 / zoom);
        setAnnotations((list) => list.map((a) => (a.id === id ? retied : a)));
        setSelectedKey(retied.elementKey ?? null);
    };
    const moveComment = (id: string, at: Point) => moveAnnotation(id, { from: at, to: at });

    const sendReply = useCallback((id: string, r: { text: string; name: string }) => {
        const reply: Reply = {
            id: `r${nextId.current++}`, text: r.text, createdAt: new Date().toISOString(),
            author: { name: r.name, ...(profile.photo ? { photo: profile.photo } : {}) },
        };
        setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, replies: [...(a.replies ?? []), reply] } : a)));
    }, [profile.photo]);

    const deleteById = useCallback((id: string) => {
        setAnnotations((list) => list.filter((a) => a.id !== id));
        setSelectedAnnotationId((current) => (current === id ? null : current));
    }, []);

    const tieAnnotation = useCallback((id: string, elementKey: string | null) => {
        setAnnotations((list) =>
            list.map((a) => {
                if (a.id !== id) return a;
                const { elementKey: _old, ...rest } = a;
                return elementKey ? { ...rest, elementKey } : rest;
            }),
        );
        setSelectedKey(elementKey);
    }, []);

    const deleteSelected = useCallback(() => {
        setAnnotations((list) => list.filter((a) => a.id !== selectedAnnotationId));
        setSelectedAnnotationId(null);
    }, [selectedAnnotationId]);

    const clearAll = useCallback(() => {
        setAnnotations([]);
        setSelectedAnnotationId(null);
    }, []);

    const save = useCallback(async () => {
        if (!doc || saving) return;
        setSaving(true);
        setError(null);
        try {
            const bytes = await buildAnnotatedPdf(doc.bytes, annotations, describeTie);
            const name = annotatedName(doc.fileName);
            downloadPdf(bytes, name);
            setStatus(`Saved ${name} with ${annotations.length} annotation${annotations.length === 1 ? '' : 's'}`);
        } catch (e) {
            setError(`Could not save: ${errorText(e)}`);
        } finally {
            setSaving(false);
        }
    }, [doc, saving, annotations, describeTie]);

    const print = useCallback(async () => {
        if (!doc) return;
        try {
            printPdf(annotations.length ? await buildAnnotatedPdf(doc.bytes, annotations, describeTie) : doc.bytes);
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
    const hoverElement = hover && doc?.elements.get(hover.key);
    const pageAnnotations = useMemo(() => annotations.filter((a) => a.page === pageData?.number), [annotations, pageData]);

    const cancelFocus = useCallback(() => setFocusRequest(null), []);
    const changeFilters = useCallback((next: FilterState) => { setFilters(next); setFocusRequest(null); }, []);
    const changeZoomMode = useCallback((next: ZoomMode) => { setFocusRequest(null); setZoomMode(next); }, []);
    const changeTool = useCallback((next: Tool) => { setFocusRequest(null); setTool(next); }, []);
    const focusComplete = useCallback((request: FocusRequest, located: boolean) => {
        setStatus(located ? request.elementKeys.size === 1 ? 'Located element on drawing.' : 'Fitted filtered results on this page.' : 'No mapped geometry to locate in this drawing/view.');
    }, []);
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

    return (
        <div className="app">
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
                trailing={
                    <>
                        {doc && <span className="file-name" title={doc.fileName}>{doc.fileName}</span>}
                        {status && <span className="status" role="status">{status}</span>}
                        <Button variant="ghost" onClick={() => void openDemo()}>Open demo drawing</Button>
                        <Button variant="primary" onClick={() => fileInput.current?.click()}>
                            <UploadIcon /> Upload enhanced PDF
                        </Button>
                        <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ''; }} />
                        <ProfileMenu profile={profile} onChange={setProfile} />
                    </>
                }
            />
            <div className="viewer-notices">
                {error && <StatusMessage tone="error" variant="banner" title={error} />}
                {doc?.warnings.map((w) => <StatusMessage tone="warning" variant="banner" title={w} key={w} />)}
            </div>
            <main className="main">
                <div className="stage-wrap">
                    {doc && pageData ? (
                        <PdfStage
                            pdf={doc.pdf}
                            page={pageData}
                            zoomMode={zoomMode}
                            hideEmbeddedAnnotations={doc.savedAnnotations.length > 0}
                            tool={tool}
                            hoverKey={hover?.key ?? null}
                            selectedKey={selectedKey}
                            annotations={pageAnnotations}
                            selectedAnnotationId={selectedAnnotationId}
                            highlightColor={highlightColor}
                            labelFor={labelFor}
                            onZoom={setZoom}
                            onHover={onHover}
                            onSelectElement={selectElement}
                            onSelectAnnotation={(id) => {
                                setSelectedAnnotationId(id);
                                if (id) setTab('notes');
                            }}
                            onAddAnnotation={addAnnotation}
                            onMoveAnnotation={moveAnnotation}
                            onStartComment={(point) => { setSelectedAnnotationId(null); setComposerAt(point); }}
                            commentLayer={{
                                selectedId: selectedAnnotationId,
                                composerAt,
                                profile,
                                onProfile: setProfile,
                                labelFor,
                                onSelect: (id) => {
                                    setSelectedAnnotationId(id);
                                    setComposerAt(null);
                                    setSelectedKey(annotations.find((a) => a.id === id)?.elementKey ?? null);
                                    if (id) setTab('notes');
                                },
                                onMove: moveComment,
                                onDragTarget: (key, client) => onHover(key, client),
                                onSend: sendComment,
                                onCancel: () => setComposerAt(null),
                            }}
                            pickElement={pickElement}
                            onRenderError={onRenderError}
                            createCapture={createCapture}
                            geometry={geometry}
                            matchedKeys={hasActiveFilters(filters) ? matchedKeys : null}
                            drawingIds={drawingScope}
                            focusRequest={focusRequest}
                            onZoomMode={setZoomMode}
                            onFocusComplete={focusComplete}
                            onCancelFocus={cancelFocus}
                        />
                    ) : (
                        <div className="stage">
                            <div className="empty">
                                <div>
                                    <p><strong>{doc ? 'Loading page…' : 'Upload an enhanced PDF to begin.'}</strong></p>
                                    {!doc && <p>Hover an element for a quick summary, click it for every parameter, and annotate the drawing.</p>}
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
                <aside className="side">
                    {doc && nativeSource && nativeSource.occurrences.length > 0 && (
                        <div className="geometry-status" role="status">
                            {geometry ? `${geometry.elementKeys.size.toLocaleString()} elements located on this page` : nativeSource.resolvedElementKeys.size ? 'Preparing native element geometry…' : 'No unambiguous element locations on this page'}
                            {nativeSource.occurrences.some((occurrence) => occurrence.status === 'ambiguous') && ' · Some model identities are ambiguous'}
                            {!!geometry?.unsupportedPaints && ' · Some graphics are unsupported'}
                        </div>
                    )}
                    <div className="tabs" role="tablist">
                        {(['properties', 'elements', 'notes'] as const).map((t) => (
                            <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                                {t === 'notes' ? `Notes (${annotations.length})` : t === 'elements' ? `Elements (${matchedElements.length})` : 'Properties'}
                            </button>
                        ))}
                    </div>
                    <div className="panel" role="tabpanel">
                        {!doc ? (
                            <div className="panel-empty">Nothing loaded.</div>
                        ) : tab === 'properties' ? (
                            <PropertiesPanel doc={doc} element={selectedKey ? doc.elements.get(selectedKey) : undefined} hasShapes={!!geometry?.parts.length || (pageData?.shapes.length ?? 0) > 0} location={selectedKey ? locations.get(selectedKey) : undefined} onLocate={locateElement} />
                        ) : tab === 'elements' ? (
                            <>
                                <FilterPanel elements={elementList} parameters={doc.parameters} value={filters} onChange={changeFilters} matchedCount={matchedElements.length} locatableCount={locatableCount} appearanceCount={appearanceCount} context={filterContext} pageNumber={page} onFitMatches={fitMatches} />
                                <ElementList elements={matchedElements} selectedKey={selectedKey} onSelect={selectElement} locations={locations} onLocate={locateElement} />
                            </>
                        ) : (
                            <NotesList
                                annotations={annotations}
                                elements={doc.elements}
                                selectedId={selectedAnnotationId}
                                profile={profile}
                                onProfile={setProfile}
                                onTie={tieAnnotation}
                                onReply={sendReply}
                                onDelete={deleteById}
                                onOpenElement={selectElement}
                                onSelect={(a) => { goToPage(a.page); setSelectedAnnotationId(a.id); setSelectedKey(a.elementKey ?? null); }}
                            />
                        )}
                    </div>
                </aside>
            </main>
            {hoverElement && hover && tool === 'select' && <HoverCard element={hoverElement} at={hover} />}
        </div>
    );
}
