/**
 * Small Markdown parser for drawing-agent replies. It produces a plain tree that the
 * panel renders as React elements, so model text never reaches innerHTML.
 * Supports paragraphs, ATX headings, nested lists, fenced code, block quotes, rules,
 * pipe tables, and inline strong/emphasis/strikethrough/code/links.
 */

export type MdInline =
    | { type: 'text'; text: string }
    | { type: 'strong' | 'em' | 'del'; children: MdInline[] }
    | { type: 'code'; text: string }
    | { type: 'link'; href: string; children: MdInline[] }
    | { type: 'br' };

export type MdAlign = 'left' | 'center' | 'right' | null;

export type MdBlock =
    | { type: 'paragraph'; children: MdInline[] }
    | { type: 'heading'; level: number; children: MdInline[] }
    | { type: 'list'; ordered: boolean; start: number; items: MdBlock[][] }
    | { type: 'code'; lang: string; text: string }
    | { type: 'quote'; children: MdBlock[] }
    | { type: 'rule' }
    | { type: 'table'; align: MdAlign[]; header: MdInline[][]; rows: MdInline[][][] };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const MAX_DEPTH = 8;

const blank = (line: string) => !line.trim();
const indentOf = (line: string) => line.length - line.trimStart().length;

function startsBlock(line: string): boolean {
    return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);
}

function splitRow(line: string): string[] {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    const cells: string[] = [];
    let cell = '';
    let inCode = false;
    for (let i = 0; i < row.length; i++) {
        const char = row[i]!;
        if (char === '\\' && row[i + 1] === '|') { cell += '|'; i++; continue; }
        if (char === '`') inCode = !inCode;
        if (char === '|' && !inCode) { cells.push(cell.trim()); cell = ''; continue; }
        cell += char;
    }
    cells.push(cell.trim());
    return cells;
}

function isTableStart(lines: string[], index: number): boolean {
    const head = lines[index];
    const separator = lines[index + 1];
    if (head === undefined || separator === undefined || !head.includes('|') || !TABLE_SEPARATOR.test(separator)) return false;
    return splitRow(head).length === splitRow(separator).length;
}

export function parseMarkdown(source: string, depth = 0): MdBlock[] {
    const lines = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    const blocks: MdBlock[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        if (blank(line)) { i++; continue; }

        const fence = FENCE.exec(line);
        if (fence) {
            const marker = fence[1]!;
            const body: string[] = [];
            i++;
            while (i < lines.length && !new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(lines[i]!)) body.push(lines[i++]!);
            i++;
            blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') });
            continue;
        }

        const heading = HEADING.exec(line);
        if (heading) {
            blocks.push({ type: 'heading', level: heading[1]!.length, children: parseInline(heading[2] ?? '') });
            i++;
            continue;
        }

        if (RULE.test(line)) { blocks.push({ type: 'rule' }); i++; continue; }

        if (QUOTE.test(line)) {
            const body: string[] = [];
            while (i < lines.length && !blank(lines[i]!) && (QUOTE.test(lines[i]!) || !startsBlock(lines[i]!))) body.push(lines[i++]!.replace(QUOTE, ''));
            blocks.push({ type: 'quote', children: depth < MAX_DEPTH ? parseMarkdown(body.join('\n'), depth + 1) : [{ type: 'paragraph', children: parseInline(body.join('\n')) }] });
            continue;
        }

        const item = LIST_ITEM.exec(line);
        if (item) {
            const baseIndent = item[1]!.length;
            const ordered = /\d/.test(item[2]!);
            const delimiter = item[2]!.slice(-1);
            const start = ordered ? Number.parseInt(item[2]!, 10) : 1;
            const items: string[][] = [];
            while (i < lines.length) {
                const current = lines[i]!;
                const next = LIST_ITEM.exec(current);
                const sameList = next && next[1]!.length === baseIndent && /\d/.test(next[2]!) === ordered && next[2]!.slice(-1) === delimiter;
                if (sameList) {
                    items.push([next[3] ?? '']);
                    i++;
                    continue;
                }
                if (blank(current)) {
                    // A blank line keeps the list open only when indented content follows.
                    let ahead = i + 1;
                    while (ahead < lines.length && blank(lines[ahead]!)) ahead++;
                    const following = lines[ahead];
                    const followingItem = following === undefined ? null : LIST_ITEM.exec(following);
                    const continues = following !== undefined && (indentOf(following) > baseIndent
                        || followingItem && followingItem[1]!.length === baseIndent && /\d/.test(followingItem[2]!) === ordered && followingItem[2]!.slice(-1) === delimiter);
                    if (!continues) break;
                    items.at(-1)!.push('');
                    i++;
                    continue;
                }
                if (indentOf(current) > baseIndent) {
                    items.at(-1)!.push(current.slice(Math.min(indentOf(current), baseIndent + item[2]!.length + 1)));
                    i++;
                    continue;
                }
                if (!startsBlock(current) && !isTableStart(lines, i) && items.at(-1)!.at(-1)) {
                    items.at(-1)!.push(current.trim()); // lazy paragraph continuation
                    i++;
                    continue;
                }
                break;
            }
            blocks.push({
                type: 'list', ordered, start,
                items: items.map((body) => depth < MAX_DEPTH ? parseMarkdown(body.join('\n'), depth + 1) : [{ type: 'paragraph', children: parseInline(body.join('\n')) }]),
            });
            continue;
        }

        if (isTableStart(lines, i)) {
            const header = splitRow(line);
            const align = splitRow(lines[i + 1]!).map((cell): MdAlign => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null);
            i += 2;
            const rows: MdInline[][][] = [];
            while (i < lines.length && !blank(lines[i]!) && lines[i]!.includes('|')) {
                const cells = splitRow(lines[i++]!);
                rows.push(header.map((_, column) => parseInline(cells[column] ?? '')));
            }
            blocks.push({ type: 'table', align, header: header.map((cell) => parseInline(cell)), rows });
            continue;
        }

        const body: string[] = [line.trim()];
        i++;
        while (i < lines.length && !blank(lines[i]!) && !startsBlock(lines[i]!) && !isTableStart(lines, i)) body.push(lines[i++]!.trim());
        blocks.push({ type: 'paragraph', children: parseInline(body.join('\n')) });
    }
    return blocks;
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~>]/;
const WORD = /[\p{L}\p{N}]/u;
const URL = /^https?:\/\/[^\s<>"]*[^\s<>"'.,;:!?)\]}*_]/;

/** Allow only web and mail links; anything else stays visible as text. */
export function safeHref(raw: string): string | null {
    const href = raw.trim().replace(/^<|>$/g, '');
    return /^(?:https?:\/\/|mailto:)/i.test(href) && !/[\s<>"]/.test(href) ? href : null;
}

function pushText(out: MdInline[], text: string) {
    if (!text) return;
    const last = out.at(-1);
    if (last?.type === 'text') last.text += text;
    else out.push({ type: 'text', text });
}

function findClosing(text: string, from: number, marker: string): number {
    for (let i = from; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '`') {
            const close = text.indexOf('`', i + 1);
            if (close > 0) { i = close; continue; }
        }
        if (!text.startsWith(marker, i) || /\s/.test(text[i - 1] ?? ' ')) continue;
        if (marker.length === 1 && text[i + 1] === marker) { i++; continue; }
        if (marker[0] === '_' && WORD.test(text[i + marker.length] ?? '')) continue;
        return i;
    }
    return -1;
}

export function parseInline(text: string, depth = 0): MdInline[] {
    const out: MdInline[] = [];
    let i = 0;
    while (i < text.length) {
        const char = text[i]!;

        if (char === '\\' && ESCAPABLE.test(text[i + 1] ?? '')) { pushText(out, text[i + 1]!); i += 2; continue; }
        if (char === '\n') { out.push({ type: 'br' }); i++; continue; }

        if (char === '`') {
            const run = /^`+/.exec(text.slice(i))![0];
            const close = text.indexOf(run, i + run.length);
            if (close > 0) {
                const code = text.slice(i + run.length, close).replace(/\n/g, ' ');
                out.push({ type: 'code', text: /^ .* $/.test(code) && code.trim() ? code.slice(1, -1) : code });
                i = close + run.length;
                continue;
            }
            pushText(out, run);
            i += run.length;
            continue;
        }

        if (char === '[' && depth < MAX_DEPTH) {
            const label = findBracket(text, i);
            if (label > 0 && text[label + 1] === '(') {
                const end = text.indexOf(')', label + 2);
                const href = end > 0 ? safeHref(text.slice(label + 2, end).split(/\s+"/)[0]!) : null;
                if (href) {
                    out.push({ type: 'link', href, children: parseInline(text.slice(i + 1, label), depth + 1) });
                    i = end + 1;
                    continue;
                }
            }
        }

        if ((char === 'h' || char === 'H') && !WORD.test(text[i - 1] ?? '')) {
            const url = URL.exec(text.slice(i));
            if (url) {
                out.push({ type: 'link', href: url[0], children: [{ type: 'text', text: url[0] }] });
                i += url[0].length;
                continue;
            }
        }

        if ((char === '*' || char === '_' || char === '~') && depth < MAX_DEPTH) {
            const double = text[i + 1] === char;
            const marker = char === '~' ? (double ? '~~' : '') : double ? char + char : char;
            const opensWord = char !== '_' || !WORD.test(text[i - 1] ?? '');
            if (marker && opensWord && text[i + marker.length] && !/\s/.test(text[i + marker.length]!)) {
                const close = findClosing(text, i + marker.length + 1, marker);
                if (close > 0) {
                    const children = parseInline(text.slice(i + marker.length, close), depth + 1);
                    out.push({ type: char === '~' ? 'del' : marker.length === 2 ? 'strong' : 'em', children });
                    i = close + marker.length;
                    continue;
                }
            }
            // Leave an unmatched run intact so "**" does not become nested emphasis.
            const run = /^([*_~])\1*/.exec(text.slice(i))![0];
            pushText(out, run);
            i += run.length;
            continue;
        }

        pushText(out, char);
        i++;
    }
    return out;
}

function findBracket(text: string, open: number): number {
    let level = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '[') level++;
        else if (text[i] === ']' && --level === 0) return i;
        else if (text[i] === '\n' && text[i + 1] === '\n') return -1;
    }
    return -1;
}
