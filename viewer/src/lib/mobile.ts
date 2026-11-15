import { useEffect, useState } from 'react';

/**
 * Small-screen behaviour shared by App and PdfStage. Pure functions here are unit-tested; the
 * CSS side lives behind `@media (max-width: 860px)` and `@media (pointer: coarse)`.
 */

/** Media query that switches the layout to the stacked, phone-friendly arrangement. */
export const NARROW_LAYOUT = '(max-width: 860px)';
/** Viewports too short to show a drawing and a half-height panel at once (a phone held sideways). */
export const SHORT_LAYOUT = '(max-width: 860px) and (max-height: 520px)';

/** How much of the screen the inspector takes when it sits under the drawing. */
export type PanelSize = 'collapsed' | 'half' | 'full';
export type PanelGesture = 'tap' | 'larger' | 'smaller';

const SIZES: readonly PanelSize[] = ['collapsed', 'half', 'full'];

/** A tap on the grabber cycles half → full → collapsed; a swipe moves one step in its direction. */
export function nextPanelSize(current: PanelSize, gesture: PanelGesture): PanelSize {
    const index = SIZES.indexOf(current);
    if (gesture === 'larger') return SIZES[Math.min(SIZES.length - 1, index + 1)]!;
    if (gesture === 'smaller') return SIZES[Math.max(0, index - 1)]!;
    return SIZES[(index + 1) % SIZES.length]!;
}

/** Classifies a vertical drag on the grabber; small movements count as a tap. */
export function panelGesture(deltaY: number, threshold = 30): PanelGesture {
    if (deltaY <= -threshold) return 'larger';
    if (deltaY >= threshold) return 'smaller';
    return 'tap';
}

/** A short screen starts with the panel collapsed so the drawing is what the user sees first. */
export function initialPanelSize(shortScreen: boolean): PanelSize {
    return shortScreen ? 'collapsed' : 'half';
}

/** Zoom after a two-finger pinch: the ratio of the current finger distance to the starting one. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
    if (!(startDistance > 0) || !(distance > 0)) return startZoom;
    return startZoom * (distance / startDistance);
}

export function matchesMedia(query: string): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Tracks a media query; false where matchMedia is unavailable (tests, server). */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() => matchesMedia(query));
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const list = window.matchMedia(query);
        const update = () => setMatches(list.matches);
        update();
        list.addEventListener('change', update);
        return () => list.removeEventListener('change', update);
    }, [query]);
    return matches;
}
