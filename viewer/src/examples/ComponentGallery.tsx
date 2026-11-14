import { useRef, useState } from 'react';
import { ActionButton, Comment, CommentComposer, DataTable, Dialog, Field, FlyoutMenu, IconButton, MetadataRows, PageList, PageNavigation, Panel, StatusMessage, Tooltip, VerticalMenu, ZoomControl, type CommentTone, type DataColumn, type StatusTone, type VerticalMenuItem } from '../components/ui';
import { pages } from '../components/patterns/SampleDrawing';
import { TokenLibrary } from './TokenLibrary';

const columns: DataColumn<{ id: string; category: string; rating: string }>[] = [
  { key: 'id', label: 'Element ID', render: row => row.id, sortValue: row => row.id },
  { key: 'category', label: 'Category', render: row => row.category, sortValue: row => row.category },
  { key: 'rating', label: 'Fire rating', render: row => row.rating, sortValue: row => row.rating }
];
const rows = [{ id: '676281', category: 'Wall', rating: '2 HR' }, { id: '676315', category: 'Door', rating: '1 HR' }, { id: '676420', category: 'Window', rating: 'Unspecified' }];
const navigation: VerticalMenuItem[] = [{ id: 'home', label: 'Home', icon: 'home' }, { id: 'viewer', label: 'Viewer', icon: 'document', children: [{ id: 'documents', label: 'Documents', icon: 'document' }, { id: 'sources', label: 'Data sources', icon: 'database' }, { id: 'geometry', label: 'Geometry', icon: 'geometry' }] }];
type ExampleComment = { id: string; body: string; tone: CommentTone };
const exampleComments: ExampleComment[] = [
  { id: 'info', tone: 'info', body: 'Check the wall schedule before updating this detail.' },
  { id: 'warning', tone: 'warning', body: 'The geometry match needs review before these values are used.' },
  { id: 'error', tone: 'error', body: 'The specified fire rating conflicts with the drawing note.' }
];

export function ComponentGallery() {
  const [panelState, setPanelState] = useState<'ready' | 'empty' | 'loading' | 'error'>('ready');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fieldValue, setFieldValue] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [tone, setTone] = useState<StatusTone>('success');
  const [toastVisible, setToastVisible] = useState(false);
  const [provisional, setProvisional] = useState(false);
  const [selected, setSelected] = useState('documents');
  const [pressed, setPressed] = useState(false);
  const [tableEmpty, setTableEmpty] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentTone, setCommentTone] = useState<CommentTone>('info');
  const [comments, setComments] = useState<ExampleComment[]>(exampleComments);
  const commentId = useRef(0);

  return <main className="gallery"><div className="gallery-intro"><span className="ui-eyebrow">ENHANCED PDF / DESIGN SYSTEM</span><h1 className="type-title">Design library<span>.</span></h1><p className="type-paragraph">Browse the live token tiers and the reusable component catalog in one place. Controls below are examples for inspecting states and motion.</p><nav className="library-jump-links" aria-label="Library sections"><a href="#tokens">Design tokens</a><a href="#components">Components</a></nav></div>
    <TokenLibrary />
    <div className="library-section-heading" id="components"><span className="ui-eyebrow">REUSABLE CONTROLS</span><h2 className="type-h1">Components</h2><p>Each specimen uses the same React component and CSS as the viewer demo.</p></div>
    <div className="gallery-grid">
      <Panel className="gallery-card" title="Action and icon buttons" eyebrow="CONTROLS"><div className="gallery-content"><div className="gallery-row"><ActionButton onClick={() => setPressed(current => !current)}>{pressed ? 'On' : 'Primary action'}</ActionButton><ActionButton variant="secondary">Secondary</ActionButton><ActionButton variant="ghost">Ghost</ActionButton><ActionButton disabled>Disabled</ActionButton></div><div className="gallery-row"><Tooltip content="A clear keyboard and pointer tooltip"><IconButton icon="search" label="Search example" /></Tooltip><IconButton icon="layers" label="Toggle example" pressed={pressed} onClick={() => setPressed(current => !current)} /></div><p className="gallery-note">Action buttons scale to 0.97 on press. Toolbar icon buttons and menu triggers do not.</p></div></Panel>
      <Panel className="gallery-card" title="Panels" eyebrow="LAYOUT"><div className="gallery-content"><div className="gallery-row"><label>State <select value={panelState} onChange={event => setPanelState(event.target.value as typeof panelState)}><option>ready</option><option>empty</option><option>loading</option><option>error</option></select></label></div><Panel className="gallery-nested-panel" title="Element inspector" state={panelState} stateMessage={panelState === 'error' ? 'Metadata could not be loaded.' : undefined}><p>Selected geometry and properties appear here.</p></Panel></div></Panel>
      <Panel className="gallery-card" title="Dialog" eyebrow="OVERLAY"><div className="gallery-content"><p>Open a modal, use Escape or Cancel, and check focus return.</p><ActionButton onClick={() => setDialogOpen(true)}>Open example dialog</ActionButton></div></Panel>
      <Panel className="gallery-card" title="Fields" eyebrow="INPUT"><div className="gallery-content gallery-fields"><Field label="Element ID" hint="Enter a six-digit Revit element ID" error={fieldError}><input value={fieldValue} onChange={event => { setFieldValue(event.target.value); setFieldError(''); }} placeholder="676281" /></Field><Field label="Multiline text"><textarea rows={3} placeholder="Add a description…" /></Field><div className="gallery-row"><ActionButton onClick={() => setFieldError(/^\d{6}$/.test(fieldValue) ? '' : 'Enter a six-digit element ID.')}>Validate</ActionButton><ActionButton variant="secondary" disabled>Disabled field action</ActionButton></div></div></Panel>
      <Panel className="gallery-card gallery-card--wide" title="Comments" eyebrow="REVIEW"><div className="gallery-content"><p>Choose the tone when posting, then change a posted comment's tone to compare states.</p><CommentComposer value={commentText} tone={commentTone} onValueChange={setCommentText} onToneChange={setCommentTone} onSubmit={(body, tone) => { setComments(current => [...current, { id: String(++commentId.current), body, tone }]); setCommentText(''); }} /><div className="gallery-comments">{comments.map(comment => <Comment key={comment.id} author={comment.id === 'info' || comment.id === 'warning' || comment.id === 'error' ? 'Reviewer' : 'You'} body={comment.body} tone={comment.tone} timeLabel={comment.id === 'info' || comment.id === 'warning' || comment.id === 'error' ? 'Example' : 'Just now'} context="Page 1 · Wall W-102" onToneChange={tone => setComments(current => current.map(item => item.id === comment.id ? { ...item, tone } : item))} />)}</div></div></Panel>
      <Panel className="gallery-card gallery-card--wide" title="Data table" eyebrow="STRUCTURED DATA"><div className="gallery-content"><div className="gallery-row"><ActionButton variant="secondary" onClick={() => setTableEmpty(current => !current)}>{tableEmpty ? 'Show rows' : 'Show empty state'}</ActionButton></div><DataTable caption="Linked elements" columns={columns} rows={tableEmpty ? [] : rows} rowKey={row => row.id} emptyMessage="No linked elements found." /></div></Panel>
      <Panel className="gallery-card" title="Page navigation" eyebrow="DOCUMENT"><div className="gallery-content"><PageNavigation page={page} total={pages.length} onPageChange={setPage} /><PageList pages={pages} current={page} onPageChange={setPage} /></div></Panel>
      <Panel className="gallery-card" title="Zoom control" eyebrow="DOCUMENT"><div className="gallery-content"><ZoomControl value={zoom} onChange={setZoom} /><p>Committed zoom: {zoom}%</p><ZoomControl value={180} onChange={() => {}} disabled /></div></Panel>
      <Panel className="gallery-card" title="Status messages" eyebrow="FEEDBACK"><div className="gallery-content"><div className="gallery-row"><label>Tone <select value={tone} onChange={event => setTone(event.target.value as StatusTone)}><option>info</option><option>success</option><option>warning</option><option>error</option></select></label><ActionButton variant="secondary" onClick={() => setToastVisible(true)}>Show toast</ActionButton></div><StatusMessage tone={tone} variant="banner" title={`${tone[0].toUpperCase()}${tone.slice(1)} status`}>The message explains the state without relying on color.</StatusMessage>{toastVisible && <StatusMessage tone={tone} variant="toast" title="Example toast" onDismiss={() => setToastVisible(false)} autoDismissMs={tone === 'error' ? undefined : 5000} />}</div></Panel>
      <Panel className="gallery-card" title="Metadata rows" eyebrow="PARQUET"><div className="gallery-content"><label className="gallery-toggle"><input type="checkbox" checked={provisional} onChange={event => setProvisional(event.target.checked)} /> Provisional match</label><MetadataRows provisional={provisional} items={[{ label: 'Category', value: 'Walls' }, { label: 'Element ID', value: '676281' }, { label: 'Fire Rating', value: '' }, { label: 'Source', value: 'elements.parquet' }]} /></div></Panel>
      <Panel className="gallery-card" title="Menus" eyebrow="NAVIGATION"><div className="gallery-content"><div className="gallery-row"><FlyoutMenu label="Example flyout" items={[{ id: 'one', label: 'View profile', icon: 'home', onSelect: () => setSelected('home') }, { id: 'two', label: 'Data sources', icon: 'database', onSelect: () => setSelected('sources') }, { id: 'three', label: 'Reset example', icon: 'reset', separatorBefore: true, onSelect: () => setSelected('documents') }]} /><span>Open the flyout to inspect origin, stagger, and exit timing.</span></div><VerticalMenu items={navigation} selected={selected} onSelect={setSelected} /></div></Panel>
    </div>
    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Example dialog" description="This dialog demonstrates the shared modal pattern." footer={<><ActionButton variant="secondary" onClick={() => setDialogOpen(false)}>Cancel</ActionButton><ActionButton onClick={() => setDialogOpen(false)}>Confirm</ActionButton></>}><Field label="Example field"><input placeholder="Type here" /></Field></Dialog>
  </main>;
}

