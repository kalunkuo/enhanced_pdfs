import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../ui/Button';
import { Logo } from '../ui';
import { CheckIcon, ChevronDownIcon, CloseIcon, ExportIcon, HandIcon, MinusIcon, NextPageIcon, PlusIcon, PrevPageIcon, PrintIcon, SelectIcon, UploadIcon } from '../ui/icons';
import type { Tool, ZoomMode } from './PdfStage';

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

interface Props {
    disabled: boolean;
    saving: boolean;
    onSave: () => void;
    onPrint: () => void;
    page: number;
    pageCount: number;
    onPage: (n: number) => void;
    tool: Tool;
    onTool: (t: Tool) => void;
    zoom: number;
    zoomMode: ZoomMode;
    onZoomMode: (m: ZoomMode) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onUpload: () => void;
    /** Asks to forget the file, review state and profile this app stored in the browser. */
    onClearData: () => void;
    /** Your profile, shown at the far right. */
    account?: ReactNode;
}

/**
 * The document bar: upload, download, print, pages, select and pan, zoom, clear browser data, then your profile at the far right. Laid out like Acrobat's.
 * `docbar-optional` items are hidden on a phone in landscape (see mobile.css): print, the logo, Select (the tool rail has it), and
 * the zoom steps (pinch and the zoom menu remain).
 */
export function DocBar(p: Props) {
    return (
        <div className="docbar" role="toolbar" aria-label="Document">
            <Logo className="docbar-optional" />
            <span className="sep" />
            <IconButton label="Upload enhanced PDF" onClick={p.onUpload}><UploadIcon /></IconButton>
            <IconButton label={p.saving ? 'Saving…' : 'Download PDF with markups and review data (Ctrl+S)'} disabled={p.disabled || p.saving} onClick={p.onSave}><ExportIcon /></IconButton>
            <IconButton label="Print (Ctrl+P)" className="docbar-phone-hidden docbar-optional" disabled={p.disabled} onClick={p.onPrint}><PrintIcon /></IconButton>
            {/* On small screens the bar wraps here into a second row (see app.css); the class names group the controls for that layout. */}
            <span className="docbar-break" aria-hidden="true" />
            <span className="sep" />
            <IconButton label="Previous page (PageUp)" className="docbar-nav" disabled={p.disabled || p.page <= 1} onClick={() => p.onPage(p.page - 1)}><PrevPageIcon /></IconButton>
            <IconButton label="Next page (PageDown)" className="docbar-nav" disabled={p.disabled || p.page >= p.pageCount} onClick={() => p.onPage(p.page + 1)}><NextPageIcon /></IconButton>
            <PageInput page={p.page} pageCount={p.pageCount} disabled={p.disabled} onPage={p.onPage} />
            <span className="sep" />
            <IconButton label="Select (V)" className="docbar-tool docbar-optional" pressed={p.tool === 'select'} disabled={p.disabled} onClick={() => p.onTool('select')}><SelectIcon /></IconButton>
            <IconButton label="Pan (hand)" className="docbar-tool docbar-phone-hidden" pressed={p.tool === 'pan'} disabled={p.disabled} onClick={() => p.onTool('pan')}><HandIcon /></IconButton>
            <span className="sep" />
            <IconButton label="Zoom out" className="docbar-zoom docbar-optional" disabled={p.disabled} onClick={p.onZoomOut}><MinusIcon /></IconButton>
            <IconButton label="Zoom in" className="docbar-zoom docbar-optional" disabled={p.disabled} onClick={p.onZoomIn}><PlusIcon /></IconButton>
            <ZoomMenu zoom={p.zoom} mode={p.zoomMode} disabled={p.disabled} onMode={p.onZoomMode} />
            <span className="sep" />
            <IconButton label="Clear browser memory" className="docbar-clear" onClick={p.onClearData}><CloseIcon /></IconButton>
            <span className="docbar-spacer" />
            <span className="docbar-account">{p.account}</span>
        </div>
    );
}

function PageInput({ page, pageCount, disabled, onPage }: { page: number; pageCount: number; disabled: boolean; onPage: (n: number) => void }) {
    const [text, setText] = useState(String(page));
    useEffect(() => {
        setText(String(page));
    }, [page]);
    const commit = () => {
        const n = Math.round(Number(text));
        if (Number.isFinite(n) && n >= 1) onPage(Math.min(pageCount, n));
        else setText(String(page));
    };
    return (
        <span className="page-ctl">
            <input
                className="page-input"
                aria-label="Page number"
                inputMode="numeric"
                disabled={disabled}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                        setText(String(page));
                        e.currentTarget.blur();
                    }
                }}
            />
            <span className="muted">of {disabled ? '–' : pageCount}</span>
        </span>
    );
}

function ZoomMenu({ zoom, mode, disabled, onMode }: { zoom: number; mode: ZoomMode; disabled: boolean; onMode: (m: ZoomMode) => void }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        window.addEventListener('pointerdown', close);
        window.addEventListener('keydown', esc);
        return () => {
            window.removeEventListener('pointerdown', close);
            window.removeEventListener('keydown', esc);
        };
    }, [open]);
    const pick = (m: ZoomMode) => {
        onMode(m);
        setOpen(false);
    };
    const item = (label: string, active: boolean, m: ZoomMode) => (
        <button key={label} className="menu-item" role="menuitemradio" aria-checked={active} onClick={() => pick(m)}>
            <span className="tick">{active && <CheckIcon />}</span>
            {label}
        </button>
    );
    return (
        <div className="zoom-menu" ref={root}>
            <button className="btn zoom-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Zoom level" disabled={disabled} onClick={() => setOpen(!open)}>
                {(zoom * 100).toFixed(zoom * 100 < 100 ? 1 : 0).replace(/\.0$/, '')}%<ChevronDownIcon />
            </button>
            {open && (
                <div className="dropdown" role="menu">
                    {item('Fit width', mode.kind === 'fit-width', { kind: 'fit-width' })}
                    {item('Fit page', mode.kind === 'fit-page', { kind: 'fit-page' })}
                    <div className="menu-sep" />
                    {PRESETS.map((z) => item(`${z * 100}%`, mode.kind === 'value' && Math.abs(mode.value - z) < 0.001, { kind: 'value', value: z }))}
                </div>
            )}
        </div>
    );
}
