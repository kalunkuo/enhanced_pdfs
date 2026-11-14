import type { ElementInfo } from './types';

/**
 * How an object is named wherever it is tied to something: its type, then its ID ("Wall 51"). The family and
 * type names are long and belong in the Properties panel, not in a chip or a pin.
 */

// Revit category names that look plural but are not, or that singularize irregularly.
const UNCHANGED = new Set(['mass', 'glass', 'casework', 'furniture', 'entourage', 'topography', 'site', 'ramps and stairs']);

/** "Walls" -> "Wall", "Structural Columns" -> "Structural Column", "Doors" -> "Door". Only the last word changes. */
export function singularCategory(category: string): string {
    const trimmed = category.trim();
    if (!trimmed) return '';
    if (UNCHANGED.has(trimmed.toLowerCase())) return trimmed;
    const words = trimmed.split(/\s+/);
    const last = words.pop()!;
    let singular = last;
    if (/ies$/i.test(last) && last.length > 3) singular = last.slice(0, -3) + (last === last.toUpperCase() ? 'Y' : 'y');
    else if (/(ches|shes|sses|xes|zes)$/i.test(last)) singular = last.slice(0, -2);
    else if (/s$/i.test(last) && !/(ss|us|is)$/i.test(last)) singular = last.slice(0, -1);
    return [...words, singular].join(' ');
}

/** The object ID exactly as exported, so very large IDs are not rounded. */
export function elementIdOf(e: Pick<ElementInfo, 'elementId' | 'elementIdText'>): string {
    return e.elementIdText ?? String(e.elementId);
}

/** "Wall 51". Falls back to the element's name when it has no category. */
export function elementLabel(e: Pick<ElementInfo, 'category' | 'name' | 'elementId' | 'elementIdText'>): string {
    const type = singularCategory(e.category);
    return type ? `${type} ${elementIdOf(e)}` : `${e.name} ${elementIdOf(e)}`.trim();
}

/**
 * The short name drawn on the page: just the type ("Wall"). The ID is in the side panel, so the drawing stays
 * uncluttered. Falls back to the element's name when it has no category.
 */
export function elementTypeLabel(e: Pick<ElementInfo, 'category' | 'name'>): string {
    return singularCategory(e.category) || e.name;
}
