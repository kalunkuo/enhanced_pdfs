import { describe, expect, it } from 'vitest';
import { executeDrawingAgent, highlightElementKeys, highlightElementsByCategory, parseWidthInches, type AgentContext, type DrawingComment } from '../src/lib/drawingAgent';
import type { ElementInfo, ParameterInfo } from '../src/lib/types';
import { buildParameters } from '../src/lib/tables';

const element = (key: string, category = 'Doors', more: Partial<ElementInfo> = {}): ElementInfo => ({ key, category, name: key, elementId: Number(key.replace(/\D/g, '')) || 1, ...more });
const parameter = (value: string, more: Partial<ParameterInfo> = {}): ParameterInfo => ({ name: 'Width', scope: 'Instance', value, ...more });
const context = (more: Partial<AgentContext> = {}): AgentContext => ({ elements: [], parameters: new Map(), comments: [], pageNumber: 1, locatableKeys: new Set(), ...more });

describe('highlighting arbitrary local query results', () => {
    const elements = [element('e1', 'Columns'), element('e2', 'Walls'), element('e3', 'Walls'), element('e4', 'Furniture')];
    const c = context({ elements, locatableKeys: new Set(['e1', 'e2', 'e4', 'not-on-this-page']) });

    it('uses valid result identities once and separates metadata from mapped geometry', () => {
        const result = highlightElementKeys(c, ['e1', 'e1', 'e3', 'not-on-this-page', 'unknown'], { color: 'green', title: 'Query matches' });
        expect(result.highlight!.title).toBe('Query matches');
        expect([...result.highlight!.elementKeys]).toEqual(['e1']);
        expect([...result.highlight!.colors]).toEqual([['e1', '#22c55e']]);
        expect(result.highlight!.legend).toEqual([{ label: 'Columns', color: '#22c55e', count: 1 }]);
        expect(result.message).toContain('2 matching elements on page 1; 1 can be highlighted');
        expect(result.message).toContain('1 have no mapped geometry');
    });

    it('colors by supplied actual result groups across category boundaries', () => {
        const groups = [{ label: '2 HR', elementKeys: new Set(['e1', 'e2', 'unknown']) }, { label: 'Unspecified', elementKeys: new Set(['e3']) }];
        const result = highlightElementKeys(c, ['e1', 'e2', 'e3'], { groups, title: 'Fire Rating' });
        expect(result.highlight!.colors.get('e1')).toBe(result.highlight!.colors.get('e2'));
        expect(result.highlight!.legend).toEqual([{ label: '2 HR', color: result.highlight!.colors.get('e1'), count: 2 }]);
        expect(result.message).toContain('3 matching elements on page 1; 2 can be highlighted');
        expect([...groups[0]!.elementKeys]).toEqual(['e1', 'e2', 'unknown']);
    });

    it('keeps unmatched result members visible in a separate group without admitting extra keys', () => {
        const result = highlightElementKeys(c, ['e1', 'e2'], { color: 'orange', groups: [{ label: 'Requested value', elementKeys: new Set(['e1', 'e4']) }] });
        expect(new Set(result.highlight!.elementKeys)).toEqual(new Set(['e1', 'e2']));
        expect(result.highlight!.legend).toEqual(expect.arrayContaining([{ label: 'Requested value', color: '#f97316', count: 1 }, { label: 'Other matches', color: '#f97316', count: 1 }]));
        expect(result.highlight!.colors.has('e4')).toBe(false);
    });

    it('reports overlapping groups explicitly and never double-counts their overlay members', () => {
        const result = highlightElementKeys(c, ['e1', 'e2'], { groups: [{ label: 'A', elementKeys: new Set(['e1', 'e2']) }, { label: 'B', elementKeys: new Set(['e2']) }] });
        expect(result.highlight!.legend).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'A', count: 1 }), expect.objectContaining({ label: 'Multiple groups', count: 1 })]));
        expect(result.highlight!.legend.reduce((sum, group) => sum + group.count, 0)).toBe(2);
        expect(result.message).toContain('1 matching element belongs to multiple supplied result groups');
    });

    it('supports empty matches, metadata-only results, safe colors, and stable default grouping', () => {
        expect(highlightElementKeys(c, ['unknown'], {}).highlight).toBeNull();
        const metadata = highlightElementKeys(c, ['e3'], {});
        expect(metadata.highlight!.colors.size).toBe(0);
        expect(metadata.highlight!.legend).toEqual([]);
        expect(metadata.message).toContain('1 matching element on page 1; 0 can be highlighted');
        expect(() => highlightElementKeys(c, ['e1'], { color: 'cyan' as 'blue' })).toThrow('Unsupported category highlight color');
        const first = highlightElementKeys(c, ['e1', 'e2', 'e4'], {});
        const reordered = highlightElementKeys({ ...c, elements: [...elements].reverse() }, ['e4', 'e2', 'e1'], {});
        expect(first.highlight!.legend).toEqual(reordered.highlight!.legend);
        expect([...first.highlight!.colors]).toEqual([...reordered.highlight!.colors]);
    });
});

describe('arbitrary category highlighting', () => {
    const elements = [element('c1', 'Columns'), element('c2', 'Structural Columns'), element('c3', 'Structural Columns'), element('f1', 'Furniture'), element('w1', 'Walls')];
    const c = context({ elements, locatableKeys: new Set(['c1', 'c2', 'f1', 'w1', 'out-of-scope']) });

    it('highlights only scoped and locatable matches while reporting metadata coverage separately', () => {
        const result = highlightElementsByCategory(c, ['Columns', 'Structural Columns'], 'red');
        expect([...result.highlight!.elementKeys]).toEqual(['c1', 'c2']);
        expect([...result.highlight!.colors]).toEqual([['c1', '#ef4444'], ['c2', '#ef4444']]);
        expect(result.highlight!.legend).toEqual([{ label: 'Columns', color: '#ef4444', count: 1 }, { label: 'Structural Columns', color: '#ef4444', count: 1 }]);
        expect(result.message).toContain('3 matching elements on page 1; 2 can be highlighted, 1 have no mapped geometry');
    });

    it('matches normalized whole categories and singular aliases without substring expansion', () => {
        expect([...highlightElementsByCategory(c, ['  sTRuctural   column  '], 'blue').highlight!.elementKeys]).toEqual(['c2']);
        expect([...highlightElementsByCategory(c, ['column'], 'blue').highlight!.elementKeys]).toEqual(['c1']);
        expect(highlightElementsByCategory(c, ['col'], 'blue').highlight).toBeNull();
        expect([...highlightElementsByCategory(c, ['Furniture'], 'pink').highlight!.elementKeys]).toEqual(['f1']);
    });

    it('supports all specified colors and stable category colors independent of element order', () => {
        for (const color of ['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink'] as const) {
            expect(highlightElementsByCategory(c, ['Columns'], color).highlight!.colors.get('c1')).toMatch(/^#[0-9a-f]{6}$/);
        }
        const first = highlightElementsByCategory(c, ['Columns', 'Furniture'], null).highlight!;
        const reordered = highlightElementsByCategory({ ...c, elements: [...elements].reverse() }, ['Furniture', 'Columns'], null).highlight!;
        expect([...first.colors]).toEqual([...reordered.colors]);
        expect(() => highlightElementsByCategory(c, ['Columns'], 'cyan' as 'blue')).toThrow('Unsupported category highlight color');
    });

    it('returns an empty overlay when all matched metadata lacks drawing geometry', () => {
        const result = highlightElementsByCategory({ ...c, locatableKeys: new Set() }, ['Structural Columns'], null);
        expect(result.highlight!.colors.size).toBe(0);
        expect(result.highlight!.elementKeys.size).toBe(0);
        expect(result.highlight!.legend).toEqual([]);
        expect(result.message).toContain('2 matching elements on page 1; 0 can be highlighted');
    });

    it('routes broad category nouns using the actual catalog, including qualified columns', () => {
        expect([...executeDrawingAgent('Highlight all columns blue', c).highlight!.elementKeys]).toEqual(['c1', 'c2']);
        expect([...executeDrawingAgent('Highlight structural columns green', c).highlight!.elementKeys]).toEqual(['c2']);
        expect([...executeDrawingAgent('Show all furniture in purple', c).highlight!.elementKeys]).toEqual(['f1']);
        const framing = context({ elements: [element('beam', 'Structural Framing')], locatableKeys: new Set(['beam']) });
        expect([...executeDrawingAgent('Highlight framing orange', framing).highlight!.elementKeys]).toEqual(['beam']);
    });

    it.each(['Highlight columns wider than 12 inches', 'Highlight columns > 12 inches', 'Highlight columns on level 2', 'Highlight columns with fire rating 2 HR', 'Highlight columns made of steel', 'Highlight doors taller than 80 inches', 'Highlight columns and doors wider than 36 inches'])('does not silently drop unsupported predicates from %s', (prompt) => {
        const result = executeDrawingAgent(prompt, { ...c, elements: [...elements, element('d1', 'Doors')] });
        expect(result).not.toHaveProperty('highlight');
        expect(result.message).toContain('without the property or size filter');
    });

    it('routes explicit wall colors separately from fire ratings and refuses conflicting colors', () => {
        expect(executeDrawingAgent('Color all walls yellow', c).highlight!.colors.get('w1')).toBe('#eab308');
        expect(executeDrawingAgent('Highlight columns red and blue', c)).not.toHaveProperty('highlight');
        expect(executeDrawingAgent('Highlight walls by fire rating', c).highlight!.title).toBe('Walls by fire rating');
    });
});

describe('door dimensions', () => {
    it.each([
        ['36 inches', undefined, 36],
        ['36"', undefined, 36],
        ['3\' - 6"', undefined, 42],
        ['3′ 6″', undefined, 42],
        ['0\' 4 7/8"', undefined, 4.875],
        ['3 ft', undefined, 36],
        ['35 1/2 in', undefined, 35.5],
        ['35-1/2 in', undefined, 35.5],
        ['914.4 mm', undefined, 36],
        ['91.44 cm', undefined, 36],
        ['0.9144 m', undefined, 36],
        ['914.4', 'autodesk.unit.unit:millimeters-1.0.1', 36],
        ['3', 'autodesk.unit.unit:feet-1.0.1', 36],
    ])('converts %s with unit %s', (value, unit, expected) => {
        expect(parseWidthInches(value!, unit)).toBeCloseTo(expected as number, 6);
    });

    it.each(['36', '36 unknown', '3\' 12"', '-36 in', '0 in', '1/0 in', 'bad 36 in', '36 in extra', '36" x 84"'])('leaves invalid or unitless %s unknown', (value) => {
        expect(parseWidthInches(value)).toBeNull();
    });

    it('separates below, above, equality and unknown without losing model keys', () => {
        const elements = [element('d1'), element('d2'), element('d3'), element('d4')];
        const result = executeDrawingAgent('Highlight doors wider than 36 inches, green below and red above', context({
            elements,
            parameters: new Map([['d1', [parameter('32 in')]], ['d2', [parameter('42 in')]], ['d3', [parameter('914.4 mm')]], ['d4', [parameter('36')]]]),
            locatableKeys: new Set(['d1', 'd2']),
        }));
        expect(result.highlight?.colors.get('d1')).toBe('var(--color-agent-safe)');
        expect(result.highlight?.colors.get('d2')).toBe('var(--color-agent-alert)');
        expect(result.highlight?.colors.get('d3')).toBe('var(--color-agent-equal)');
        expect(result.highlight?.colors.get('d4')).toBe('var(--color-agent-unknown)');
        expect(result.message).toContain('4 matching elements');
        expect(result.message).toContain('2 can be highlighted');
        expect(result.highlight?.legend.map((group) => group.count)).toEqual([1, 1, 1, 1]);
    });

    it('uses instance Width over type Width and never uses Rough Width or family names', () => {
        const elements = [element('d1', 'Doors', { typeKey: 'type1', name: '48-inch door' }), element('d2', 'Doors', { typeKey: 'type2' })];
        const result = executeDrawingAgent('Compare doors at 36 inches', context({ elements, parameters: new Map([
            ['d1', [parameter('32 in'), parameter('48 in', { name: 'Rough Width' })]],
            ['type1', [parameter('48 in', { scope: 'Type' })]],
            ['type2', [parameter('40 in', { scope: 'Type' })]],
        ]) }));
        expect(result.highlight?.colors.get('d1')).toBe('var(--color-agent-safe)');
        expect(result.highlight?.colors.get('d2')).toBe('var(--color-agent-alert)');
    });

    it('does not borrow type width when an instance width is blank or conflicting', () => {
        const result = executeDrawingAgent('Compare doors at 36 inches', context({
            elements: [element('d1', 'Doors', { typeKey: 'type1' }), element('d2')],
            parameters: new Map([['d1', [parameter('')]], ['type1', [parameter('32 in', { scope: 'Type' })]], ['d2', [parameter('32 in'), parameter('42 in')]]]),
        }));
        expect([...result.highlight!.colors.values()]).toEqual(['var(--color-agent-unknown)', 'var(--color-agent-unknown)']);
    });

    it('preserves value provenance and never applies display UnitId to raw InternalValue', () => {
        const parameters = buildParameters([
            { OwnerKey: 'd1', Name: 'Width', Scope: 'Instance', InternalValue: 3, UnitId: 'autodesk.unit.unit:millimeters-1.0.1' },
            { OwnerKey: 'd2', Name: 'Width', Scope: 'Instance', DisplayValue: '914.4', InternalValue: 3, UnitId: 'autodesk.unit.unit:millimeters-1.0.1' },
            { OwnerKey: 'd3', Name: 'Width', Scope: 'Instance', TextValue: '42 in' },
        ]);
        expect(parameters.get('d1')?.[0]?.valueSource).toBe('internal');
        expect(parameters.get('d2')?.[0]?.valueSource).toBe('display');
        expect(parameters.get('d3')?.[0]?.valueSource).toBe('text');
        const result = executeDrawingAgent('Compare doors at 36 inches', context({ elements: [element('d1'), element('d2'), element('d3')], parameters }));
        expect(result.highlight?.colors.get('d1')).toBe('var(--color-agent-unknown)');
        expect(result.highlight?.colors.get('d2')).toBe('var(--color-agent-equal)');
        expect(result.highlight?.colors.get('d3')).toBe('var(--color-agent-alert)');
    });

    it('requires a threshold and accepts a followup in conversation', () => {
        const c = context({ elements: [element('d1')], parameters: new Map([['d1', [parameter('40 in')]]]) });
        expect(executeDrawingAgent('Highlight doors wider than X inches', c).message).toContain('What door-width threshold');
        const followup = executeDrawingAgent('42 inches', c, 'Compare door widths');
        expect(followup.highlight?.title).toContain('42 in');
        expect(followup.highlight?.colors.get('d1')).toBe('var(--color-agent-safe)');
        expect(executeDrawingAgent('What about 42?', c, 'Compare door widths').highlight?.title).toContain('42 in');
        expect(executeDrawingAgent('And 48?', c, 'Compare door widths').highlight?.title).toContain('48 in');
    });

    it('accepts metric and architectural thresholds', () => {
        const c = context({ elements: [element('d1')], parameters: new Map([['d1', [parameter('42 in')]]]) });
        expect(executeDrawingAgent('Doors over 914.4 mm', c).highlight?.title).toContain('36 in');
        expect(executeDrawingAgent('Doors over 3\' 6"', c).highlight?.colors.get('d1')).toBe('var(--color-agent-equal)');
        expect(executeDrawingAgent('Doors over 35-1/2 inches', c).highlight?.title).toContain('35.5 in');
    });
});

describe('wall fire rating actions', () => {
    it('keeps unspecified separate from NR and preserves explicit rating labels', () => {
        const result = executeDrawingAgent('Color code walls based on fire rating', context({ elements: [
            element('w1', 'Walls', { fireRating: '2 HR' }), element('w2', 'Walls', { fireRating: '2 hours' }),
            element('w3', 'Walls', { fireRating: 'NR' }), element('w4', 'Walls'), element('d1', 'Doors', { fireRating: '2 HR' }),
        ] }));
        expect(result.highlight?.elementKeys.size).toBe(4);
        expect(result.highlight?.legend).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: '2 HR', count: 2 }), expect.objectContaining({ label: 'NR', count: 1 }), expect.objectContaining({ label: 'Unspecified', count: 1 }),
        ]));
        expect(result.highlight?.colors.get('w4')).toBe('var(--color-agent-unknown)');
        expect(result.highlight?.colors.get('w3')).not.toBe('var(--color-agent-unknown)');
        expect(result.message).toContain('does not mean non-rated');
    });

    it('reads type rating parameters and respects the upstream page scope', () => {
        const c = context({ elements: [element('w1', 'Walls', { typeKey: 't1' })], parameters: new Map([['t1', [parameter('1 HR', { name: 'Fire Rating', scope: 'Type' })]]]) });
        expect(executeDrawingAgent('Highlight walls by fire rating', c).highlight?.legend[0]?.label).toBe('1 HR');
        expect(executeDrawingAgent('Only 2 hr walls', c).highlight).toBeNull();
    });

    it('supports a rating followup and clear highlights', () => {
        const c = context({ elements: [element('w1', 'Walls', { fireRating: '2 HR' }), element('w2', 'Walls', { fireRating: '1 HR' })] });
        expect([...executeDrawingAgent('Only 2 HR', c, 'Color walls by fire rating').highlight!.elementKeys]).toEqual(['w1']);
        expect(executeDrawingAgent('Clear highlights', c)).toEqual({ message: 'Agent highlights cleared.', highlight: null });
    });
});

describe('comment context', () => {
    const comment = (id: string, more: Partial<DrawingComment> = {}): DrawingComment => ({ id, page: 1, text: `Comment ${id}`, source: 'pdf', ...more });

    it('sorts recorded modification/creation times and isolates undated entries', () => {
        const c = context({ comments: [
            comment('unknown'), comment('old', { createdAt: '2026-01-01T00:00:00Z' }), comment('new', { createdAt: '2026-01-02T00:00:00Z' }),
            comment('edited', { createdAt: '2025-01-01T00:00:00Z', modifiedAt: '2026-01-03T00:00:00Z' }),
            comment('other-page', { page: 2, createdAt: '2026-12-31T00:00:00Z' }), comment('blank', { text: '  ' }),
        ] });
        const result = executeDrawingAgent('Give me context of the latest comments', c);
        expect(result.comments?.map((entry) => entry.id)).toEqual(['edited', 'new', 'old', 'unknown']);
        expect(result.message).toContain('4 comments on page 1');
        expect(result.message).toContain('recency is unknown');
        expect(c.comments[0]?.id).toBe('unknown');
    });

    it('does not call array order recency when timestamps are missing', () => {
        const result = executeDrawingAgent('Show latest comments', context({ comments: [comment('a'), comment('b', { modifiedAt: 'bad date' })] }));
        expect(result.message).toContain('recency cannot be established');
        expect(result.comments).toHaveLength(2);
    });

    it('reports loading and errors without claiming no comments', () => {
        expect(executeDrawingAgent('Latest comments', context({ commentsStatus: 'loading' })).message).toContain('still loading');
        expect(executeDrawingAgent('Latest comments', context({ commentsStatus: 'error' })).message).toContain('could not be read');
        expect(executeDrawingAgent('Latest comments', context()).comments).toEqual([]);
    });

    it('keeps the current color overlay during a comments query or unsupported request', () => {
        expect(executeDrawingAgent('Show comments', context())).not.toHaveProperty('highlight');
        expect(executeDrawingAgent('What is the weather?', context())).not.toHaveProperty('highlight');
    });
});
