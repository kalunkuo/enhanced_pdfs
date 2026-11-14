import { useEffect, useRef, useState } from 'react';
import type { AnnotationKind } from '../../lib/types';
import { IconButton } from '../ui/Button';
import { CircleIcon, CommentIcon, DrawIcon, HighlightIcon, LineIcon, MoreIcon, RectIcon, SelectIcon, SignatureIcon, TextBoxIcon, TrashIcon } from '../ui/icons';
import type { Tool } from './PdfStage';

export type DrawKind = Extract<AnnotationKind, 'pen' | 'line' | 'rect' | 'ellipse'>;

export const HIGHLIGHT_COLORS = [
    { name: 'Yellow', value: '#ffd43b' },
    { name: 'Green', value: '#69db7c' },
    { name: 'Pink', value: '#ff8fab' },
    { name: 'Blue', value: '#74c0fc' },
] as const;

const DRAW_KINDS: { kind: DrawKind; label: string; Icon: () => React.JSX.Element }[] = [
    { kind: 'pen', label: 'Freehand', Icon: DrawIcon },
    { kind: 'line', label: 'Line', Icon: LineIcon },
    { kind: 'rect', label: 'Rectangle', Icon: RectIcon },
    { kind: 'ellipse', label: 'Circle', Icon: CircleIcon },
];

type Menu = 'draw' | 'highlight' | 'more' | null;

interface Props {
    tool: Tool;
    onTool: (t: Tool) => void;
    drawKind: DrawKind;
    onDrawKind: (k: DrawKind) => void;
    highlightColor: string;
    onHighlightColor: (c: string) => void;
    canDelete: boolean;
    onDelete: () => void;
    annotationCount: number;
    onClearAll: () => void;
    disabled: boolean;
}

/** Vertical tool rail, modeled on Acrobat's. A corner triangle marks a tool with options. */
export function Toolbar(p: Props) {
    const [menu, setMenu] = useState<Menu>(null);
    const rail = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menu) return;
        const close = (e: PointerEvent) => {
            if (!rail.current?.contains(e.target as Node)) setMenu(null);
        };
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
        window.addEventListener('pointerdown', close);
        window.addEventListener('keydown', esc);
        return () => {
            window.removeEventListener('pointerdown', close);
            window.removeEventListener('keydown', esc);
        };
    }, [menu]);

    const DrawCurrent = DRAW_KINDS.find((d) => d.kind === p.drawKind)!.Icon;
    const isDraw = DRAW_KINDS.some((d) => d.kind === p.tool);
    const choose = (t: Tool) => { setMenu(null); p.onTool(t); };

    return (
        <div className="vtoolbar" ref={rail} role="toolbar" aria-orientation="vertical" aria-label="Annotation tools">
            <div className="grip" aria-hidden="true" />
            <IconButton label="Select (V)" pressed={p.tool === 'select'} disabled={p.disabled} onClick={() => choose('select')}><SelectIcon /></IconButton>
            <IconButton label="Add comment (C)" pressed={p.tool === 'comment'} disabled={p.disabled} onClick={() => choose('comment')}><CommentIcon /></IconButton>

            <div className="tool-slot">
                <IconButton label="Highlight (H)" pressed={p.tool === 'highlight'} disabled={p.disabled} onClick={() => choose('highlight')}>
                    <HighlightIcon />
                </IconButton>
                <button className="corner" aria-label="Highlight color" aria-expanded={menu === 'highlight'} disabled={p.disabled} onClick={() => setMenu(menu === 'highlight' ? null : 'highlight')} />
                {menu === 'highlight' && (
                    <div className="flyout" role="menu">
                        {HIGHLIGHT_COLORS.map((c) => (
                            <button key={c.value} role="menuitemradio" aria-checked={p.highlightColor === c.value} className="swatch" title={c.name} aria-label={c.name}
                                style={{ background: c.value }} onClick={() => { p.onHighlightColor(c.value); choose('highlight'); }} />
                        ))}
                    </div>
                )}
            </div>

            <div className="tool-slot">
                <IconButton label="Draw (D)" pressed={isDraw} disabled={p.disabled} onClick={() => choose(p.drawKind)}><DrawCurrent /></IconButton>
                <button className="corner" aria-label="Drawing shapes" aria-expanded={menu === 'draw'} disabled={p.disabled} onClick={() => setMenu(menu === 'draw' ? null : 'draw')} />
                {menu === 'draw' && (
                    <div className="flyout" role="menu">
                        {DRAW_KINDS.map(({ kind, label, Icon }) => (
                            <IconButton key={kind} label={label} pressed={p.tool === kind} onClick={() => { p.onDrawKind(kind); choose(kind); }}><Icon /></IconButton>
                        ))}
                    </div>
                )}
            </div>

            <IconButton label="Text box (T)" pressed={p.tool === 'text'} disabled={p.disabled} onClick={() => choose('text')}><TextBoxIcon /></IconButton>
            <IconButton label="Sign (S)" pressed={p.tool === 'signature'} disabled={p.disabled} onClick={() => choose('signature')}><SignatureIcon /></IconButton>

            <div className="tool-slot">
                <IconButton label="More" aria-haspopup="menu" aria-expanded={menu === 'more'} disabled={p.disabled} onClick={() => setMenu(menu === 'more' ? null : 'more')}><MoreIcon /></IconButton>
                {menu === 'more' && (
                    <div className="flyout column" role="menu">
                        <button className="menu-item" role="menuitem" disabled={!p.canDelete} onClick={() => { p.onDelete(); setMenu(null); }}><TrashIcon /> Delete selected</button>
                        <button className="menu-item" role="menuitem" disabled={p.annotationCount === 0} onClick={() => { p.onClearAll(); setMenu(null); }}><TrashIcon /> Clear all ({p.annotationCount})</button>
                    </div>
                )}
            </div>
        </div>
    );
}
