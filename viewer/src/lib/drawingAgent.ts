import type { ElementInfo, ParameterInfo } from './types';

export interface DrawingComment {
    id: string;
    /** Parent viewer annotation for navigation from a flattened reply. */
    annotationId?: string;
    page: number;
    text: string;
    author?: string;
    createdAt?: string;
    modifiedAt?: string;
    elementKey?: string;
    source: 'viewer' | 'pdf';
}

export interface AgentContext {
    /** Already scoped to the current drawing/page by the viewer. */
    elements: readonly ElementInfo[];
    parameters: ReadonlyMap<string, ParameterInfo[]>;
    comments: readonly DrawingComment[];
    pageNumber: number;
    locatableKeys: ReadonlySet<string>;
    commentsStatus?: 'loading' | 'ready' | 'error';
}

export interface AgentHighlight {
    title: string;
    colors: ReadonlyMap<string, string>;
    legend: { label: string; color: string; count: number }[];
    elementKeys: ReadonlySet<string>;
}

export interface AgentResult {
    message: string;
    /** Absent keeps the current overlay; null clears it. */
    highlight?: AgentHighlight | null;
    comments?: DrawingComment[];
}

const COLORS = {
    safe: 'var(--color-agent-safe)',
    alert: 'var(--color-agent-alert)',
    equal: 'var(--color-agent-equal)',
    unknown: 'var(--color-agent-unknown)',
};
const normalized = (value: string) => value.trim().toLowerCase().replace(/[ _-]+/g, ' ');
const categoryIs = (element: ElementInfo, category: string) => normalized(element.category).replace(/^ost /, '').replace(/s$/, '') === category;
const numberText = (value: number) => Number(value.toFixed(3)).toString();
const unavailable = /^(?:\s*|\(none\)|none|n\/a|not specified|unspecified|unknown|—|-)$/i;

/** Parse a complete number or mixed fraction without accepting a partial value. */
function fraction(value: string): number | null {
    const text = value.trim().replace(/(?<=\d)-(?=\d+\/\d+$)/, ' ');
    const match = /^(?:(\d+(?:\.\d+)?)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(text);
    if (match) {
        const denominator = Number(match[3]);
        return denominator ? Number(match[1] ?? 0) + Number(match[2]) / denominator : null;
    }
    return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}

function unitFactor(unit: string): number | null {
    const text = unit.toLowerCase().replace(/^autodesk\.unit\.unit:/, '').replace(/-\d+(?:\.\d+)*$/, '').trim();
    if (/^(?:in|inch|inches|fractionalinches)$/.test(text)) return 1;
    if (/^(?:ft|foot|feet|feetfractionalinches|decimalfeet)$/.test(text)) return 12;
    if (/^(?:mm|millimeters?|millimetres?)$/.test(text)) return 1 / 25.4;
    if (/^(?:cm|centimeters?|centimetres?)$/.test(text)) return 1 / 2.54;
    if (/^(?:m|meters?|metres?)$/.test(text)) return 100 / 2.54;
    return null;
}

/** Widths with no explicit unit and no known unit metadata remain unknown. */
export function parseWidthInches(value: string, unitId?: string): number | null {
    const text = value.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″“”]/g, '"');
    let width: number | null = null;
    const feet = /^(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet|foot)\s*(?:-\s*)?(.*?)$/.exec(text);
    if (feet) {
        const rest = feet[2]!.replace(/(?:"|in\.?|inches|inch)\s*$/, '').trim();
        const inches = rest ? fraction(rest) : 0;
        if (inches !== null && inches < 12) width = Number(feet[1]) * 12 + inches;
    } else {
        const explicit = /^(.*?)\s*("|inches|inch|in\.?|millimeters?|millimetres?|mm|centimeters?|centimetres?|cm|meters?|metres?|m)$/.exec(text);
        const magnitude = fraction(explicit ? explicit[1]! : text);
        const factor = explicit ? unitFactor(explicit[2]!.replace(/\.$/, '').replace('"', 'in')) : unitId ? unitFactor(unitId) : null;
        if (magnitude !== null && factor !== null) width = magnitude * factor;
    }
    return width !== null && Number.isFinite(width) && width > 0 ? width : null;
}

function parametersFor(element: ElementInfo, context: AgentContext, name: string): ParameterInfo[] {
    const own = (context.parameters.get(element.key) ?? []).filter((parameter) => parameter.scope === 'Instance' && normalized(parameter.name) === name);
    if (own.length) return own;
    return element.typeKey ? (context.parameters.get(element.typeKey) ?? []).filter((parameter) => parameter.scope === 'Type' && normalized(parameter.name) === name) : [];
}

function doorWidth(element: ElementInfo, context: AgentContext): number | null {
    const widths = parametersFor(element, context, 'width').map((parameter) => parameter.valueSource === 'internal' || parameter.valueSource === 'reference' ? null : parseWidthInches(parameter.value, parameter.unitId));
    // Contradictory exported values are not resolved by array order.
    if (!widths.length || widths.some((value) => value === null)) return null;
    return widths.every((value) => Math.abs(value! - widths[0]!) < 0.000001) ? widths[0]! : null;
}

function ratingFor(element: ElementInfo, context: AgentContext): string {
    if (element.fireRating?.trim() && !unavailable.test(element.fireRating)) return element.fireRating.trim();
    const parameters = parametersFor(element, context, 'fire rating');
    const values = [...new Set(parameters.map((parameter) => parameter.value.trim()).filter((value) => !unavailable.test(value)))];
    return values.length === 1 ? values[0]! : 'Unspecified';
}

function ratingIdentity(value: string): string {
    const match = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)$/i.exec(value);
    return match ? `${Number(match[1])} HR` : value.toLowerCase() === 'unspecified' ? 'Unspecified' : value.toUpperCase();
}

function coverage(elements: readonly ElementInfo[], context: AgentContext): string {
    const located = elements.filter((element) => context.locatableKeys.has(element.key)).length;
    return `${elements.length} matching element${elements.length === 1 ? '' : 's'} on page ${context.pageNumber}; ${located} can be highlighted${located < elements.length ? `, ${elements.length - located} have no mapped geometry in this drawing` : ''}.`;
}

function colorWalls(prompt: string, context: AgentContext): AgentResult {
    let walls = context.elements.filter((element) => categoryIs(element, 'wall'));
    const requestedRating = /\b(?:only|just)\b/i.test(prompt)
        ? /\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i.exec(prompt)
        : /\b(?:show|highlight)\s+(?:the\s+)?(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i.exec(prompt);
    if (requestedRating) walls = walls.filter((element) => ratingIdentity(ratingFor(element, context)) === `${Number(requestedRating[1])} HR`);
    if (!walls.length) return { message: `No ${requestedRating ? `${requestedRating[1]} HR ` : ''}wall records were found on page ${context.pageNumber}.`, highlight: null };
    const groups = new Map<string, { label: string; elements: ElementInfo[] }>();
    for (const element of walls) {
        const label = ratingFor(element, context);
        const key = ratingIdentity(label);
        const group = groups.get(key) ?? { label, elements: [] };
        group.elements.push(element);
        groups.set(key, group);
    }
    const colors = new Map<string, string>();
    const legend: AgentHighlight['legend'] = [];
    const sorted = [...groups].sort(([a], [b]) => a === 'Unspecified' ? 1 : b === 'Unspecified' ? -1 : a.localeCompare(b, undefined, { numeric: true }));
    sorted.forEach(([key, group], index) => {
        const color = key === 'Unspecified' ? COLORS.unknown : index < 6 ? `var(--color-agent-rating-${index + 1})` : `hsl(${Math.round(index * 137.508) % 360} 72% 54%)`;
        for (const element of group.elements) colors.set(element.key, color);
        legend.push({ label: group.label, color, count: group.elements.length });
    });
    return {
        message: `Walls are color coded by exported Fire Rating. ${coverage(walls, context)}${groups.has('Unspecified') ? ' Unspecified means no rating was exported; it does not mean non-rated.' : ''}`,
        highlight: { title: 'Walls by fire rating', colors, legend, elementKeys: new Set(colors.keys()) },
    };
}

function thresholdFrom(prompt: string): number | null {
    // A complete architectural length is tried before a standalone number/unit.
    const feet = /\d+(?:\.\d+)?\s*(?:'|′|’|feet|foot|ft)\s*(?:-\s*)?(?:(?:\d+\s+)?\d+(?:\.\d+|\s*\/\s*\d+)?\s*(?:"|″|inches|inch|in)?)?/i.exec(prompt);
    if (feet) return parseWidthInches(feet[0]);
    const explicit = /(?<![\d./-])(?:\d+[ -]+)?\d+(?:\.\d+|\s*\/\s*\d+)?\s*(?:inches|inch|in\b|"|″|millimeters?\b|millimetres?\b|mm\b|centimeters?\b|centimetres?\b|cm\b|meters?\b|metres?\b|m\b)/i.exec(prompt);
    if (explicit) return parseWidthInches(explicit[0]);
    const bare = /(?:\b(?:than|threshold|at|use|it|to|over|under|above|below|about|and)\s+|^\s*)(\d+(?:\.\d+)?)\s*(?:inches|inch|in\b)?/i.exec(prompt);
    return bare && Number(bare[1]) > 0 ? Number(bare[1]) : null;
}

function compareDoors(prompt: string, context: AgentContext): AgentResult {
    const threshold = thresholdFrom(prompt);
    if (threshold === null) return { message: 'What door-width threshold should I use? For example, “Compare doors at 36 inches.” I’ll use green below it, red above it, and a separate group for doors exactly at the threshold.' };
    const doors = context.elements.filter((element) => categoryIs(element, 'door'));
    if (!doors.length) return { message: `No door records were found on page ${context.pageNumber}.`, highlight: null };
    const label = `${numberText(threshold)} in`;
    const legend = [
        { label: `Below ${label}`, color: COLORS.safe, count: 0 },
        { label: `Above ${label}`, color: COLORS.alert, count: 0 },
        { label: `Exactly ${label}`, color: COLORS.equal, count: 0 },
        { label: 'Width unknown', color: COLORS.unknown, count: 0 },
    ];
    const colors = new Map<string, string>();
    for (const element of doors) {
        const width = doorWidth(element, context);
        const group = legend[width === null ? 3 : Math.abs(width - threshold) < 0.000001 ? 2 : width < threshold ? 0 : 1]!;
        group.count++;
        colors.set(element.key, group.color);
    }
    const unknown = legend[3]!.count;
    return {
        message: `Comparing exported door Width against ${label}: green below, red above, and a separate group exactly at the threshold. ${coverage(doors, context)}${unknown ? ` ${unknown} door${unknown === 1 ? ' has' : 's have'} no unambiguous width with known units and ${unknown === 1 ? 'is' : 'are'} marked unknown.` : ''}`,
        highlight: { title: `Door widths · ${label}`, colors, legend: legend.filter((group) => group.count > 0), elementKeys: new Set(colors.keys()) },
    };
}

function commentTime(comment: DrawingComment): number | null {
    for (const candidate of [comment.modifiedAt, comment.createdAt]) {
        const value = candidate ? Date.parse(candidate) : NaN;
        if (Number.isFinite(value)) return value;
    }
    return null;
}

function latestComments(context: AgentContext): AgentResult {
    if (context.commentsStatus === 'loading') return { message: 'Drawing comments are still loading. Ask again when loading finishes.' };
    if (context.commentsStatus === 'error') return { message: 'The drawing comments could not be read. I cannot confirm the latest comments; reopen the drawing and try again.' };
    const comments = context.comments.filter((comment) => comment.page === context.pageNumber && comment.text.trim());
    if (!comments.length) return { message: `There are no readable comments on page ${context.pageNumber}. Add a comment to the drawing, or open a PDF containing review comments, and ask again.`, comments: [] };
    const dated = comments.filter((comment) => commentTime(comment) !== null).sort((a, b) => commentTime(b)! - commentTime(a)!);
    const undated = comments.filter((comment) => commentTime(comment) === null);
    return {
        message: `${comments.length} comment${comments.length === 1 ? '' : 's'} on page ${context.pageNumber}. ${dated.length ? `Showing the latest ${Math.min(dated.length, 5)} dated comment${Math.min(dated.length, 5) === 1 ? '' : 's'} first, by modification or creation time.` : `Showing ${Math.min(undated.length, 5)} without recorded timestamps, so their recency cannot be established.`}${undated.length && dated.length ? ` Showing ${Math.min(undated.length, 5)} of ${undated.length} undated comment${undated.length === 1 ? '' : 's'} after dated comments; their recency is unknown.` : ''} Open a comment below for its drawing context.`,
        comments: [...dated.slice(0, 5), ...undated.slice(0, 5)],
    };
}

/** Local demo action router: no network, inferred dimensions, or invented comments. */
export function executeDrawingAgent(prompt: string, context: AgentContext, previousPrompt?: string): AgentResult {
    const text = prompt.trim();
    if (!text) return { message: 'Ask me to color walls by fire rating, compare door widths, or show the latest drawing comments.' };
    if (/\b(?:clear|reset|remove|hide)\b.*\b(?:highlight|color|colour|overlay)s?\b/i.test(text) || /^(?:clear|reset)(?:\s+(?:it|that|them))?[.!]?$/i.test(text)) return { message: 'Agent highlights cleared.', highlight: null };
    if (/\b(?:comments?|notes?|feedback|discussion|reviews?)\b/i.test(text)) return latestComments(context);
    if (/\bdoors?\b/i.test(text)) return compareDoors(text, context);
    if (/\bwalls?\b/i.test(text) || /\bfire\s*(?:rating|rated|resistance)\b/i.test(text)) return colorWalls(text, context);
    if (previousPrompt && /\bdoors?\b/i.test(previousPrompt) && thresholdFrom(text) !== null) return compareDoors(text, context);
    if (previousPrompt && /\bwalls?\b/i.test(previousPrompt) && /\b(?:only|just)\b.*\d+\s*(?:h|hr|hrs|hours?)\b/i.test(text)) return colorWalls(text, context);
    return { message: 'I can work with this drawing’s exported data. Try “Color walls by fire rating,” “Compare door widths at 36 inches,” or “Show the latest comments.”' };
}
