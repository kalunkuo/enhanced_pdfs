import { singularCategory } from './elementLabel';

/**
 * Tie pills take a shade by object category (Wall, Floor, Furniture...) so what a note is tied to can be told at a
 * glance. The shades are the secondary accents (red, green, yellow, pink) kept clear of the primary blue, which means
 * selection. Each hue comes in a base and a lighter shade; both stay readable on the dark sidebar.
 */
export const CATEGORY_HUES = ['red', 'green', 'yellow', 'pink'] as const;
/** Share of white mixed into the accent. Never darker: a darker shade would lose contrast on the dark surface. */
export const CATEGORY_WHITE = [20, 55] as const;

export interface CategoryShade { hue: (typeof CATEGORY_HUES)[number]; white: number }

/** Eight shades: every hue at the base mix first, then every hue lighter. */
export const CATEGORY_SHADES: readonly CategoryShade[] = CATEGORY_WHITE.flatMap((white) => CATEGORY_HUES.map((hue) => ({ hue, white })));

// The common categories get fixed shades so the usual ones are never neighbours of each other.
const FIXED: Record<string, number> = { wall: 0, floor: 1, furniture: 2, door: 3, window: 4, column: 5, beam: 6, roof: 7 };

function hash(text: string): number {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h;
}

/** Which of the eight shades a category uses. The same category always gets the same one. */
export function categoryShadeIndex(category: string): number {
    const key = singularCategory(category).toLowerCase();
    const last = key.split(/\s+/).at(-1) ?? key;
    return FIXED[key] ?? FIXED[last] ?? hash(key) % CATEGORY_SHADES.length;
}

/** CSS color for a category's pill, built from the design system's primitives. */
export function categoryColor(category: string): string {
    const { hue, white } = CATEGORY_SHADES[categoryShadeIndex(category)]!;
    return `color-mix(in srgb, var(--primitive-color-${hue}-${hue === 'pink' ? 300 : 500}) ${100 - white}%, #fff)`;
}
