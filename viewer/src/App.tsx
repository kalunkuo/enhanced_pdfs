import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocBar } from './components/patterns/DocBar';
import { ElementList } from './components/patterns/ElementList';
import { HoverCard } from './components/patterns/HoverCard';
import { NotesList } from './components/patterns/NotesList';
import { ProfileMenu } from './components/patterns/ProfileMenu';
import { PdfStage, clampZoom, type Tool, type ZoomMode } from './components/patterns/PdfStage';
import { PropertiesPanel } from './components/patterns/PropertiesPanel';
import { HIGHLIGHT_COLORS, Toolbar, type DrawKind } from './components/patterns/Toolbar';
import { Button } from './components/ui/Button';
import { UploadIcon } from './components/ui/icons';
import { createShapePicker, tieWithPicker } from './lib/hit';
import { loadEnhancedPdf } from './lib/load';
import { annotatedName, downloadPdf, printPdf } from './lib/print';
import { buildAnnotatedPdf } from './lib/save';
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
    const pickElement = useMemo(() => createShapePicker(pageData?.shapes ?? []), [pageData]);
    const onRenderError = useCallback((error: unknown) => setError(`Could not render the page: ${errorText(error)}`), []);
    const fileInput = useRef<HTMLInputElement>(null);
    const nextId = useRef(1);

    const open = useCallback(async (file: File) => {
        setError(null);
        try {
            const next = await loadEnhancedPdf(file);
            nextId.current = 1 + next.savedAnnotations.length;
            setDoc(next);
            setPage(1);
            setPageData(null);
            setAnnotations(next.savedAnnotations);
            setSelectedKey(null);
            setSelectedAnnotationId(null);
            setHover(null);
            setZoomMode({ kind: 'fit-width' });
            setTab('properties');
            setStatus(next.savedAnnotations.length ? `Restored ${next.savedAnnotations.length} saved annotations` : null);
        } catch (e) {
            setError(`Could not open ${file.name}: ${errorText(e)}`);
        }
    }, []);

    const openDemo = async () => {
        const blob = await (await fetch('/demo/demo-enhanced.pdf')).blob();
        await open(new File([blob], 'demo-enhanced.pdf', { type: 'application/pdf' }));
    };

    // Load the current page. The old page stays on screen until the new one is ready.
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
            return e ? `Tied to ${e.mark ?? e.name} (ID ${e.elementId})` : a.elementKey ? `Tied to ${a.elementKey}` : 'Untied';
        },
        [doc],
    );

    const selectElement = useCallback((key: string | null) => {
        setSelectedKey(key);
        if (key) setTab('properties');
    }, []);

    const onHover = useCallback((key: string | null, at: { x: number; y: number }) => {
        setHover((h) => (key ? { key, ...at } : h === null ? h : null));
    }, []);

    const addAnnotation = (a: Omit<Annotation, 'id' | 'elementKey' | 'page'>) => {
        if (!pageData) return;
        const draft: Annotation = { ...a, page: pageData.number, id: `a${nextId.current++}`, ...(a.kind === 'highlight' ? { color: highlightColor } : {}) };
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
    const moveComment = (id: string, at: Point) => {
        setAnnotations((list) => list.map((a) => (a.id === id ? tieWithPicker({ ...a, from: at, to: at }, pickElement, 4 / zoom) : a)));
        const moved = annotations.find((a) => a.id === id);
        if (moved) setSelectedKey(tieWithPicker({ ...moved, from: at, to: at }, pickElement, 4 / zoom).elementKey ?? null);
    };

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
            if (e.key === 'Escape') setTool('select');
            else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
            else if (e.key === 'PageDown') goToPage(page + 1);
            else if (e.key === 'PageUp') goToPage(page - 1);
            else if (doc && KEYS[e.key.toLowerCase()]) {
                const t = KEYS[e.key.toLowerCase()]!;
                setTool(t === 'draw' ? drawKind : t);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [doc, page, drawKind, deleteSelected, goToPage, save, print]);

    const elementList = useMemo(() => (doc ? [...doc.elements.values()] : []), [doc, pageData]);
    const hoverElement = hover && doc?.elements.get(hover.key);
    const pageAnnotations = useMemo(() => annotations.filter((a) => a.page === pageData?.number), [annotations, pageData]);

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
                onTool={setTool}
                zoom={zoom}
                zoomMode={zoomMode}
                onZoomMode={setZoomMode}
                onZoomIn={() => setZoomMode({ kind: 'value', value: clampZoom(zoom * 1.25) })}
                onZoomOut={() => setZoomMode({ kind: 'value', value: clampZoom(zoom / 1.25) })}
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
            <div>
                {error && <div className="banner" role="alert">{error}</div>}
                {doc?.warnings.map((w) => <div className="banner" key={w}>{w}</div>)}
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
                            onSelectAnnotation={setSelectedAnnotationId}
                            onAddAnnotation={addAnnotation}
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
                        onTool={setTool}
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
                    <div className="tabs" role="tablist">
                        {(['properties', 'elements', 'notes'] as const).map((t) => (
                            <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                                {t === 'notes' ? `Notes (${annotations.length})` : t[0]!.toUpperCase() + t.slice(1)}
                            </button>
                        ))}
                    </div>
                    <div className="panel" role="tabpanel">
                        {!doc ? (
                            <div className="panel-empty">Nothing loaded.</div>
                        ) : tab === 'properties' ? (
                            <PropertiesPanel doc={doc} element={selectedKey ? doc.elements.get(selectedKey) : undefined} hasShapes={(pageData?.shapes.length ?? 0) > 0} />
                        ) : tab === 'elements' ? (
                            <ElementList elements={elementList} selectedKey={selectedKey} onSelect={selectElement} />
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
