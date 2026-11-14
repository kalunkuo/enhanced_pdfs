import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ActionButton, DataTable, Dialog, Field, FlyoutMenu, Icon, IconButton, MetadataRows, PageList, PageNavigation, Panel, StatusMessage, Tooltip, VerticalMenu, ZoomControl, type CommentTone, type StatusTone, type VerticalMenuItem } from './components/ui';
import { ComponentGallery } from './examples/ComponentGallery';
import { SampleDrawing, pages, type ElementKey } from './components/patterns/SampleDrawing';
import { ElementComments, type ViewerComment } from './components/patterns/ElementComments';
import { elements, specColumns } from './examples/sampleData';

type Tool = 'select' | 'pan' | 'annotate';
type Toast = { id: number; tone: StatusTone; message: string };
const navigation: VerticalMenuItem[] = [{ id: 'home', label: 'Home', icon: 'home' }, { id: 'viewer', label: 'Viewer', icon: 'document', children: [{ id: 'documents', label: 'Documents', icon: 'document' }, { id: 'sources', label: 'Data sources', icon: 'database' }, { id: 'geometry', label: 'Geometry', icon: 'geometry' }, { id: 'annotations', label: 'Annotations', icon: 'annotate' }] }];

export function App() {
  const [view, setView] = useState<'viewer' | 'gallery'>('gallery');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ElementKey | null>('wall');
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(100);
  const [highlights, setHighlights] = useState(true);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<ElementKey, string>>({ wall: '', door: '', window: '' });
  const [commentTones, setCommentTones] = useState<Record<ElementKey, CommentTone>>({ wall: 'info', door: 'info', window: 'info' });
  const [comments, setComments] = useState<Record<ElementKey, ViewerComment[]>>({ wall: [], door: [], window: [] });
  const [dialog, setDialog] = useState<'open' | 'search' | 'about' | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [markers, setMarkers] = useState<{ x: number; y: number }[]>([]);
  const toastId = useRef(0);
  const commentId = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const element = selected && page === 1 && !pdfUrl ? elements[selected] : null;
  const filteredElements = useMemo(() => Object.values(elements).filter(item => `${item.title} ${item.id}`.toLowerCase().includes(search.toLowerCase())), [search]);

  function pushToast(message: string, tone: StatusTone = 'success') { setToasts(current => [...current, { id: ++toastId.current, message, tone }]); }
  function dismissToast(id: number) { setToasts(current => current.filter(item => item.id !== id)); }
  function choosePage(next: number) { if (pdfUrl) { pushToast('Use the PDF preview controls for this file.', 'warning'); return; } setPage(Math.min(pages.length, Math.max(1, next))); setSelected(null); }
  function chooseElement(key: ElementKey) { setSelected(key); pushToast(`${elements[key].title} selected`); }
  function reset() { setPdfUrl(null); setPdfName(''); setPage(1); setSelected('wall'); setZoom(100); setTool('select'); setMarkers([]); pushToast('Sample drawing restored'); }
  function loadFile(file?: File) { if (!file) return; if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { pushToast('Choose a PDF file.', 'error'); return; } setPdfUrl(URL.createObjectURL(file)); setPdfName(file.name); setSelected(null); setDialog(null); pushToast(`${file.name} opened for preview`, 'warning'); }
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (view !== 'viewer' || dialog || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target as HTMLElement)?.closest('[role="menu"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'v' || key === 'h' || key === 'a') setTool({ v: 'select', h: 'pan', a: 'annotate' }[key] as Tool);
      if (key === '/') { event.preventDefault(); setDialog('search'); }
      if (key === '+' || key === '=') setZoom(current => Math.min(180, current + 10));
      if (key === '-') setZoom(current => Math.max(50, current - 10));
      if (key === 'arrowleft') choosePage(page - 1);
      if (key === 'arrowright') choosePage(page + 1);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [view, dialog, page, pdfUrl]);

  const moreItems = [{ id: 'gallery', label: 'Component gallery', icon: 'geometry' as const, onSelect: () => setView('gallery') }, { id: 'about', label: 'About this prototype', icon: 'help' as const, onSelect: () => setDialog('about') }, { id: 'reset', label: 'Reset demo', icon: 'reset' as const, separatorBefore: true, onSelect: reset }];
  const inspectorItems = [{ id: 'copy', label: 'Copy element ID', icon: 'copy' as const, disabled: !element, onSelect: () => { if (element) navigator.clipboard.writeText(element.id).then(() => pushToast('Element ID copied')).catch(() => pushToast(`Element ID: ${element.id}`, 'warning')); } }, { id: 'clear', label: 'Clear selection', icon: 'close' as const, disabled: !element, onSelect: () => { setSelected(null); pushToast('Selection cleared', 'info'); } }];
  const linkTone: StatusTone = element?.status === 'verified' ? 'success' : element?.status === 'possible' ? 'warning' : 'error';
  const linkTitle = element?.status === 'verified' ? 'Verified metadata link' : element?.status === 'possible' ? 'Possible metadata match' : 'No verified metadata link';

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-mark" /><strong>enhanced<span>.</span></strong><small>{view === 'gallery' ? 'Design system' : 'PDF viewer'}</small></div>
      <div className="header-file">{view === 'gallery' ? <><span className="ui-eyebrow">LIBRARY</span><strong>Components + tokens</strong><span className="file-tag">V1</span></> : <><span className="ui-eyebrow">DOCUMENT</span><strong>{pdfName || pages[page - 1].subtitle}</strong><span className="file-tag">{pdfUrl ? 'LOCAL' : 'DEMO'}</span></>}</div>
      <div className="header-actions">{view === 'gallery' ? <ActionButton variant="secondary" onClick={() => setView('viewer')}>Open viewer demo</ActionButton> : <><ActionButton variant="ghost" onClick={() => setView('gallery')}>Design library</ActionButton><ActionButton onClick={() => setDialog('open')}>Open PDF</ActionButton><FlyoutMenu label="More options" items={moreItems} /></>}</div>
    </header>
    {view === 'gallery' ? <ComponentGallery /> : <div className="workspace">
      <Panel as="aside" className="sidebar" aria-label="Document navigation" footer={<div className="source-footer"><Icon name="database" /><span>{pdfUrl ? 'PDF preview · attachments not parsed' : 'Parquet attached · 5 tables'}</span></div>}>
        <VerticalMenu items={navigation} selected="documents" onSelect={id => { if (id === 'home' || id === 'documents') choosePage(1); else if (id === 'geometry') { choosePage(1); setTool('select'); } else if (id === 'annotations') setTool('annotate'); else setDialog('about'); }} footer={{ id: 'help', label: 'Help center', icon: 'help' }} />
        <div className="sidebar-pages"><div className="sidebar-pages-heading"><span className="ui-eyebrow">WORKSPACE</span><h2 className="type-h3">Pages</h2></div><Field label="Find a page"><input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Page or view name" /></Field><PageList pages={pages} current={page} onPageChange={choosePage} filter={filter} /></div>
      </Panel>
      <main className="viewer" aria-label="Document viewer"><div className="viewer-toolbar" role="toolbar" aria-label="Viewer tools"><div className="tool-group">{(['select', 'pan', 'annotate'] as const).map(name => <Tooltip key={name} content={`${name[0].toUpperCase()}${name.slice(1)} (${name === 'select' ? 'V' : name === 'pan' ? 'H' : 'A'})`}><IconButton icon={name} label={`${name} document`} pressed={tool === name} onClick={() => setTool(name)} /></Tooltip>)}</div><span className="tool-divider" /><div className="tool-group"><Tooltip content="Search elements (/)"><IconButton icon="search" label="Search elements" onClick={() => setDialog('search')} /></Tooltip><Tooltip content="Toggle geometry highlights"><IconButton icon="layers" label="Toggle geometry highlights" pressed={highlights} onClick={() => setHighlights(current => !current)} /></Tooltip></div><div className="tool-spacer" /><PageNavigation page={page} total={pages.length} onPageChange={choosePage} disabled={Boolean(pdfUrl)} /><span className="tool-divider" /><ZoomControl value={zoom} onChange={setZoom} disabled={Boolean(pdfUrl)} /></div>
        <div className={`stage ${tool === 'pan' ? 'is-panning' : ''}`} ref={stageRef} onPointerDown={event => { if (tool !== 'pan' || (event.target as HTMLElement).closest('button,input,textarea') || !stageRef.current) return; drag.current = { x: event.clientX, y: event.clientY, left: stageRef.current.scrollLeft, top: stageRef.current.scrollTop }; stageRef.current.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current || !stageRef.current) return; stageRef.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x); stageRef.current.scrollTop = drag.current.top - (event.clientY - drag.current.y); }} onPointerUp={() => drag.current = null}>
          <div className="stage-label"><span className="live-dot" />{tool.toUpperCase()} MODE <span>/</span> {tool === 'select' ? 'Click highlighted geometry to inspect' : tool === 'pan' ? 'Drag to move around' : 'Click drawing to place a marker'}</div>
          <div className="document-wrap" style={{ zoom: `${zoom}%` } as CSSProperties}>{pdfUrl ? <iframe src={pdfUrl} title="Uploaded PDF preview" className="pdf-frame" /> : <SampleDrawing page={page} selected={selected} onSelect={chooseElement} tool={tool} highlights={highlights} markers={markers} onAnnotate={(x, y) => { setMarkers(current => [...current, { x, y }]); pushToast('Review marker placed', 'info'); }} />}</div>
          <div className="stage-status"><StatusMessage tone={pdfUrl ? 'warning' : element ? linkTone : 'info'} variant="inline" title={pdfUrl ? 'Local PDF preview · metadata unavailable' : element ? linkTitle : 'Select geometry to inspect'} /></div>
        </div>
      </main>
      <Panel as="aside" className="inspector" title="Inspector" eyebrow="INTELLIGENCE" aria-label="Metadata inspector" actions={<FlyoutMenu label="Inspector options" items={inspectorItems} />} footer={<div className="source-footer"><Icon name="database" /><span>{element ? `Source: ${element.source}` : 'No element selected'}</span></div>}>
        {element ? <div className="inspector-content"><div className="inspector-summary"><span className="ui-eyebrow">SELECTED GEOMETRY</span><h3 className="type-h3">{element.title}</h3><p>{element.subtitle}</p><div className="inspector-id">ELEMENT ID <strong>{element.id}</strong></div></div><StatusMessage tone={linkTone} variant="banner" title={linkTitle}>{element.status === 'verified' ? 'Geometry matched to a Parquet record.' : element.status === 'possible' ? 'Review the candidate before using specifications.' : 'Specification values are illustrative.'}</StatusMessage><section className="inspector-section"><h3>Properties <small>INSTANCE</small></h3><MetadataRows items={element.properties} provisional={element.status !== 'verified'} /></section><section className="inspector-section"><h3>Specifications <small>TYPE</small></h3><DataTable caption="Element specifications" columns={specColumns} rows={element.specs} rowKey={row => row.name} compact /></section><ElementComments elementId={element.id} comments={comments[element.key]} draft={commentDrafts[element.key]} tone={commentTones[element.key]} onDraftChange={value => setCommentDrafts(current => ({ ...current, [element.key]: value }))} onToneChange={tone => setCommentTones(current => ({ ...current, [element.key]: tone }))} onSubmit={(body, tone) => { setComments(current => ({ ...current, [element.key]: [...current[element.key], { id: String(++commentId.current), body, tone }] })); setCommentDrafts(current => ({ ...current, [element.key]: "" })); pushToast("Comment posted for this element"); }} onCommentToneChange={(id, tone) => setComments(current => ({ ...current, [element.key]: current[element.key].map(comment => comment.id === id ? { ...comment, tone } : comment) }))} /></div> : <div className="inspector-empty"><Icon name="geometry" size={28} /><h3 className="type-h3">No geometry selected</h3><p>{pdfUrl ? 'This preview does not parse Parquet attachments.' : 'Choose a highlighted element on page 1 to inspect its data.'}</p></div>}
      </Panel>
    </div>}
    <div className="toast-stack" aria-label="Notifications">{toasts.map(toast => <StatusMessage key={toast.id} tone={toast.tone} variant="toast" title={toast.message} onDismiss={() => dismissToast(toast.id)} autoDismissMs={toast.tone === 'error' ? undefined : 5000} />)}</div>
    <Dialog open={dialog === 'open'} onClose={() => setDialog(null)} title="Open a PDF" description="Preview a local PDF in the viewer. The sample drawing remains available in demo mode." footer={<><ActionButton variant="secondary" onClick={() => setDialog(null)}>Cancel</ActionButton><ActionButton onClick={() => { reset(); setDialog(null); }}>Use sample drawing</ActionButton></>}><Field label="Choose a PDF file" hint="Preview only · attached Parquet data is not parsed"><input type="file" accept="application/pdf,.pdf" onChange={event => loadFile(event.target.files?.[0])} /></Field></Dialog>
    <Dialog open={dialog === 'search'} onClose={() => setDialog(null)} title="Find an element" description="Search the sample drawing by name or element ID." footer={<ActionButton variant="secondary" onClick={() => setDialog(null)}>Close</ActionButton>}><Field label="Element or ID"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Try wall, door, or 676281" autoFocus /></Field><div className="search-results">{filteredElements.map(item => <button type="button" key={item.key} onClick={() => { setPage(1); chooseElement(item.key); setDialog(null); }}>{item.title}<small>{item.id} · {item.subtitle}</small></button>)}</div></Dialog>
    <Dialog open={dialog === 'about'} onClose={() => setDialog(null)} title="About this prototype" footer={<ActionButton onClick={() => setDialog(null)}>Done</ActionButton>}><p className="type-paragraph">This React and TypeScript viewer demonstrates the shared component kit with illustrative drawing and Parquet-backed records. Uploaded PDFs are previewed locally; real geometry mapping and attachment parsing are outside this prototype.</p></Dialog>
  </div>;
}

