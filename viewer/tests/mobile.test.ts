import { describe, expect, it } from 'vitest';
import { initialPanelSize, matchesMedia, nextPanelSize, panelGesture, pinchZoom } from '../src/lib/mobile';

describe('nextPanelSize', () => {
    it('cycles half → full → collapsed → half on a tap', () => {
        expect(nextPanelSize('half', 'tap')).toBe('full');
        expect(nextPanelSize('full', 'tap')).toBe('collapsed');
        expect(nextPanelSize('collapsed', 'tap')).toBe('half');
    });

    it('moves one step in the swipe direction and stops at the ends', () => {
        expect(nextPanelSize('collapsed', 'larger')).toBe('half');
        expect(nextPanelSize('half', 'larger')).toBe('full');
        expect(nextPanelSize('full', 'larger')).toBe('full');
        expect(nextPanelSize('full', 'smaller')).toBe('half');
        expect(nextPanelSize('half', 'smaller')).toBe('collapsed');
        expect(nextPanelSize('collapsed', 'smaller')).toBe('collapsed');
    });
});

describe('panelGesture', () => {
    it('treats small movements as a tap and larger ones as a swipe', () => {
        expect(panelGesture(0)).toBe('tap');
        expect(panelGesture(-12)).toBe('tap');
        expect(panelGesture(29)).toBe('tap');
        expect(panelGesture(-30)).toBe('larger');
        expect(panelGesture(80)).toBe('smaller');
    });
});

describe('initialPanelSize', () => {
    it('collapses the panel on short screens only', () => {
        expect(initialPanelSize(true)).toBe('collapsed');
        expect(initialPanelSize(false)).toBe('half');
    });
});

describe('pinchZoom', () => {
    it('scales the starting zoom by the change in finger distance', () => {
        expect(pinchZoom(1, 100, 200)).toBe(2);
        expect(pinchZoom(0.5, 200, 100)).toBe(0.25);
        expect(pinchZoom(1.5, 120, 120)).toBe(1.5);
    });

    it('ignores degenerate distances instead of producing NaN or Infinity', () => {
        expect(pinchZoom(1, 0, 100)).toBe(1);
        expect(pinchZoom(1, 100, 0)).toBe(1);
        expect(pinchZoom(1, Number.NaN, 100)).toBe(1);
    });
});

describe('matchesMedia', () => {
    it('is false where matchMedia does not exist', () => {
        expect(matchesMedia('(max-width: 860px)')).toBe(false);
    });
});
