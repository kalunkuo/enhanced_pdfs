import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from '../src/lib/markdown';

const text = (value: string) => ({ type: 'text', text: value });

describe('agent markdown', () => {
    it('parses inline emphasis, code, and links', () => {
        expect(parseInline('**Walls** have *ratings* and `1 HR` ~~old~~')).toEqual([
            { type: 'strong', children: [text('Walls')] }, text(' have '),
            { type: 'em', children: [text('ratings')] }, text(' and '),
            { type: 'code', text: '1 HR' }, text(' '),
            { type: 'del', children: [text('old')] },
        ]);
        expect(parseInline('See [docs](https://example.com/a) or https://example.com/b.')).toEqual([
            text('See '), { type: 'link', href: 'https://example.com/a', children: [text('docs')] },
            text(' or '), { type: 'link', href: 'https://example.com/b', children: [text('https://example.com/b')] }, text('.'),
        ]);
    });

    it('keeps literal text for snake_case, lone asterisks, escapes, and unsafe links', () => {
        expect(parseInline('fire_rating_value and 2 * 3')).toEqual([text('fire_rating_value and 2 * 3')]);
        expect(parseInline('\\*not em\\*')).toEqual([text('*not em*')]);
        expect(parseInline('[x](javascript:alert(1))')).toEqual([text('[x](javascript:alert(1))')]);
        expect(safeHref('javascript:alert(1)')).toBeNull();
        expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
        expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([text('<img src=x onerror=alert(1)>')]);
    });

    it('turns soft line breaks into breaks within a paragraph', () => {
        expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([
            { type: 'paragraph', children: [text('one'), { type: 'br' }, text('two')] },
            { type: 'paragraph', children: [text('three')] },
        ]);
    });

    it('parses headings, rules, quotes, and fenced code', () => {
        expect(parseMarkdown('## Summary\n---\n> quoted\n```ts\nconst a = 1;\n\nlet b;\n```')).toEqual([
            { type: 'heading', level: 2, children: [text('Summary')] },
            { type: 'rule' },
            { type: 'quote', children: [{ type: 'paragraph', children: [text('quoted')] }] },
            { type: 'code', lang: 'ts', text: 'const a = 1;\n\nlet b;' },
        ]);
    });

    it('parses ordered, unordered, and nested lists', () => {
        const [list] = parseMarkdown('3. First\n4. Second\n   - nested **a**\n   - nested b\n5. Third');
        expect(list).toMatchObject({ type: 'list', ordered: true, start: 3 });
        if (list?.type !== 'list') throw new Error('expected list');
        expect(list.items).toHaveLength(3);
        expect(list.items[1]).toEqual([
            { type: 'paragraph', children: [text('Second')] },
            { type: 'list', ordered: false, start: 1, items: [
                [{ type: 'paragraph', children: [text('nested '), { type: 'strong', children: [text('a')] }] }],
                [{ type: 'paragraph', children: [text('nested b')] }],
            ] },
        ]);
        expect(parseMarkdown('- a\n- b\n\nAfter')).toEqual([
            { type: 'list', ordered: false, start: 1, items: [[{ type: 'paragraph', children: [text('a')] }], [{ type: 'paragraph', children: [text('b')] }]] },
            { type: 'paragraph', children: [text('After')] },
        ]);
    });

    it('parses pipe tables with alignment and escaped pipes', () => {
        expect(parseMarkdown('| Rating | Count |\n| :--- | ---: |\n| 1 HR | 12 |\n| `a|b` \\| c | 3 |')).toEqual([{
            type: 'table', align: ['left', 'right'],
            header: [[text('Rating')], [text('Count')]],
            rows: [
                [[text('1 HR')], [text('12')]],
                [[{ type: 'code', text: 'a|b' }, text(' | c')], [text('3')]],
            ],
        }]);
    });

    it('treats a pipe without a separator row as paragraph text', () => {
        expect(parseMarkdown('a | b')).toEqual([{ type: 'paragraph', children: [text('a | b')] }]);
    });
});
