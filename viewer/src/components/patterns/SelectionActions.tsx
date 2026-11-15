import type { SyntheticEvent } from 'react';
import type { Bounds } from '../../lib/navigation';
import { IconButton } from '../ui/Button';
import { CommentIcon, SelectSimilarIcon } from '../ui/icons';

export interface SelectionActionsProps {
    /** Page-space bounds of the selected elements on this page. */
    bounds: Bounds;
    zoom: number;
    pageWidth: number;
    pageHeight: number;
    /** How many elements are selected, for the comment button's name. */
    count: number;
    onSelectSimilar: () => void;
    onComment: () => void;
}

/** CSS width of the bar: two 24px buttons, the gap, padding and border. Keeps it on the page near the left edge. */
const BAR_WIDTH = 64;
/** Room the bar needs below the selection before it moves above it. */
const BAR_ROOM = 40;

const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Contextual actions for the element selection, pinned below the selection's bottom-right corner (or above its
 * top-right corner when the selection reaches the bottom of the page). Comment pins go on the top edge, so the bar
 * stays clear of them. Pointer presses stay here, so using the bar never picks the element underneath it.
 */
export function SelectionActions({ bounds, zoom, pageWidth, pageHeight, count, onSelectSimilar, onComment }: SelectionActionsProps) {
    const above = (pageHeight - bounds[3]) * zoom < BAR_ROOM;
    const left = Math.max(BAR_WIDTH, Math.min(bounds[2], pageWidth) * zoom);
    const top = (above ? bounds[1] : bounds[3]) * zoom;
    return (
        <div className={`selection-actions${above ? ' above' : ''}`} style={{ left, top }} role="toolbar" aria-label="Selection actions"
            onPointerDown={stop} onPointerUp={stop} onClick={stop}>
            <IconButton label="Select all of the same type" onClick={onSelectSimilar}><SelectSimilarIcon /></IconButton>
            <IconButton label={count === 1 ? 'Comment on the selected object' : `Comment on the ${count} selected objects`} onClick={onComment}><CommentIcon /></IconButton>
        </div>
    );
}
