import { useLayoutEffect, useRef, useState, type RefObject, type SyntheticEvent } from 'react';
import type { Bounds } from '../../lib/navigation';
import { IconButton } from '../ui/Button';
import { CommentIcon, SelectSimilarIcon } from '../ui/icons';

export interface SelectionActionsProps {
    /** Page-space bounds of the selected elements on this page. */
    bounds: Bounds;
    zoom: number;
    pageWidth: number;
    pageHeight: number;
    /** The scrolling stage. The bar stays inside its visible area, clear of the chrome padding around it. */
    viewport: RefObject<HTMLDivElement | null>;
    /** How many elements are selected, for the comment button's name. */
    count: number;
    onSelectSimilar: () => void;
    onComment: () => void;
}

/** CSS size of the bar before it is measured: two 24px buttons, the gap, padding and border. */
const BAR_WIDTH = 64;
const BAR_HEIGHT = 34;
/** Space between the selection and the bar. */
const GAP = 8;

/** The stage's visible area in page CSS pixels, inset by the stage padding (which keeps clear of the floating rail). */
interface View { left: number; top: number; right: number; bottom: number }

const stop = (event: SyntheticEvent) => event.stopPropagation();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/**
 * Contextual actions for the element selection, pinned below the selection's bottom-right corner (or above its
 * top-right corner when there is no room below). The bar is kept on the page and inside the visible part of the
 * stage, so it never ends up off screen or under the tool rail. Comment pins go on the top edge, so the bar stays
 * clear of them. Pointer presses stay here, so using the bar never picks the element underneath it.
 */
export function SelectionActions({ bounds, zoom, pageWidth, pageHeight, viewport, count, onSelectSimilar, onComment }: SelectionActionsProps) {
    const barRef = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<View | null>(null);
    const [size, setSize] = useState({ w: BAR_WIDTH, h: BAR_HEIGHT });

    useLayoutEffect(() => {
        const stage = viewport.current;
        const bar = barRef.current;
        const page = bar?.offsetParent as HTMLElement | null;
        if (!stage || !bar || !page) return;
        let frame = 0;
        const measure = () => {
            frame = 0;
            const stageRect = stage.getBoundingClientRect();
            const pageRect = page.getBoundingClientRect();
            const style = getComputedStyle(stage);
            const left = stageRect.left + stage.clientLeft - pageRect.left;
            const top = stageRect.top + stage.clientTop - pageRect.top;
            const next: View = {
                left: left + parseFloat(style.paddingLeft),
                top: top + parseFloat(style.paddingTop),
                right: left + stage.clientWidth - parseFloat(style.paddingRight),
                bottom: top + stage.clientHeight - parseFloat(style.paddingBottom),
            };
            setView((prev) => prev && prev.left === next.left && prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom ? prev : next);
            const w = bar.offsetWidth, h = bar.offsetHeight;
            setSize((prev) => prev.w === w && prev.h === h ? prev : { w, h });
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
        measure();
        stage.addEventListener('scroll', schedule, { passive: true });
        const observer = new ResizeObserver(schedule);
        observer.observe(stage);
        return () => {
            stage.removeEventListener('scroll', schedule);
            observer.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, [viewport, zoom]);

    // Allowed area: the page, narrowed to the visible stage. If the two don't overlap, the visible stage wins.
    const pageW = pageWidth * zoom, pageH = pageHeight * zoom;
    const minX = view ? clamp(0, view.left, view.right) : 0;
    const maxX = view ? clamp(pageW, view.left, view.right) : pageW;
    const minY = view ? clamp(0, view.top, view.bottom) : 0;
    const maxY = view ? clamp(pageH, view.top, view.bottom) : pageH;

    const below = bounds[3] * zoom + GAP;
    const aboveTop = bounds[1] * zoom - GAP - size.h;
    const above = below + size.h > maxY && aboveTop >= minY;
    const top = clamp(above ? aboveTop : below, minY, Math.max(minY, maxY - size.h));
    const left = clamp(bounds[2] * zoom - size.w, minX, Math.max(minX, maxX - size.w));

    return (
        <div ref={barRef} className={`selection-actions${above ? ' above' : ''}`} style={{ left, top }} role="toolbar" aria-label="Selection actions"
            onPointerDown={stop} onPointerUp={stop} onClick={stop}>
            <IconButton label="Select all of the same type" onClick={onSelectSimilar}><SelectSimilarIcon /></IconButton>
            <IconButton label={count === 1 ? 'Comment on the selected object' : `Comment on the ${count} selected objects`} onClick={onComment}><CommentIcon /></IconButton>
        </div>
    );
}
