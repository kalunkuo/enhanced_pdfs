import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { isAuthor, avatarColor, formatTimeAgo, initials, pdfDate, safeImage } from '../src/lib/comments';
import { buildAnnotatedPdf, parseAnnotations } from '../src/lib/save';
import type { Annotation } from '../src/lib/types';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe('formatTimeAgo', () => {
    it('reads naturally from "just now" up to days', () => {
        expect(formatTimeAgo(ago(5_000), NOW)).toBe('just now');
        expect(formatTimeAgo(ago(2 * MIN), NOW)).toBe('2 min ago');
        expect(formatTimeAgo(ago(59 * MIN), NOW)).toBe('59 min ago');
        expect(formatTimeAgo(ago(3 * 60 * MIN), NOW)).toBe('3 h ago');
        expect(formatTimeAgo(ago(2 * 24 * 60 * MIN), NOW)).toBe('2 d ago');
    });
    it('falls back to a date after a week, and to nothing for bad input', () => {
        expect(formatTimeAgo(ago(30 * 24 * 60 * MIN), NOW)).toMatch(/2026/);
        expect(formatTimeAgo(undefined, NOW)).toBe('');
        expect(formatTimeAgo('not a date', NOW)).toBe('');
    });
    it('treats a clock skewed into the future as just now', () => {
        expect(formatTimeAgo(new Date(NOW + 10 * MIN).toISOString(), NOW)).toBe('just now');
    });
});

describe('avatar helpers', () => {
    it('makes initials from one or several words', () => {
        expect(initials('yamchum')).toBe('Y');
        expect(initials('  yam   chum ')).toBe('YC');
        expect(initials('Ada Maria Lovelace')).toBe('AL');
        expect(initials('')).toBe('?');
    });
    it('gives the same color to the same name', () => {
        expect(avatarColor('Yam')).toBe(avatarColor('Yam'));
        expect(avatarColor('Yam')).toMatch(/^var\(--primitive-color-(green|red|pink|blue|yellow)-\d+\)$/);
    });
});

describe('safeImage', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    it('accepts raster data URLs only', () => {
        expect(safeImage(png)).toBe(png);
        expect(safeImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeUndefined();
        expect(safeImage('https://example.com/a.png')).toBeUndefined();
        expect(safeImage('javascript:alert(1)')).toBeUndefined();
        expect(safeImage(42)).toBeUndefined();
    });
});

describe('pdfDate', () => {
    it('formats UTC', () => {
        expect(pdfDate('2026-11-14T15:30:05Z')).toBe('D:20261114153005Z');
        expect(pdfDate('nope')).toBeUndefined();
    });
});

const comment: Annotation = {
    id: 'c1', page: 1, kind: 'comment', from: [100, 100], to: [100, 100], text: 'Check fire rating', elementKey: 'w1',
    author: { name: 'yamchum', photo: 'data:image/jpeg;base64,/9j/4AAQ=' }, createdAt: '2026-11-14T15:30:05Z', image: 'data:image/png;base64,iVBORw0KGgo=',
};
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

describe('comments in a saved file', () => {
    it('keep author, time and image through save and reload', () => {
        expect(parseAnnotations(enc({ annotations: [comment] }))).toEqual([comment]);
    });

    it('drop unsafe or malformed comment fields without dropping the comment', () => {
        const hostile = { ...comment, author: { name: 'x'.repeat(200), photo: 'https://evil.example/p.png' }, createdAt: 'yesterday-ish', image: 'data:image/svg+xml;base64,PHN2Zz4=' };
        const [clean] = parseAnnotations(enc({ annotations: [hostile] }));
        expect(clean!.text).toBe('Check fire rating');
        expect(clean!.author).toEqual({ name: 'x'.repeat(80) });
        expect(clean!.createdAt).toBeUndefined();
        expect(clean!.image).toBeUndefined();
    });

    it('write the author and date into the PDF annotation', async () => {
        const src = await PDFDocument.create();
        src.addPage([300, 300]);
        const out = await PDFDocument.load(await buildAnnotatedPdf(await src.save(), [comment], () => 'Tied to Wall 01'));
        const annot = out.getPage(0).node.Annots()!.lookup(0, PDFDict);
        expect(annot.lookup(PDFName.of('T'), PDFHexString).decodeText()).toBe('yamchum');
        expect(annot.lookup(PDFName.of('CreationDate'), PDFString).decodeText()).toBe('D:20261114153005Z');
        expect(annot.lookup(PDFName.of('Contents'), PDFHexString).decodeText()).toBe('Check fire rating');
    });
});

describe('replies', () => {
    const reply = { id: 'r1', author: { name: 'Carlos' }, createdAt: '2026-11-14T16:00:00Z', text: 'Agreed, will confirm.' };
    const withReplies: Annotation = { ...comment, replies: [reply, { ...reply, id: 'r2', text: 'Done.' }] };

    it('keep their order and content through save and reload', () => {
        expect(parseAnnotations(enc({ annotations: [withReplies] }))).toEqual([withReplies]);
    });

    it('drop malformed replies but keep the comment and the good replies', () => {
        const hostile = {
            ...comment,
            replies: [
                reply,
                { ...reply, id: 'bad1', text: '   ' },
                { ...reply, id: 'bad2', author: { name: '' } },
                { ...reply, id: 'bad3', createdAt: 'whenever' },
                { ...reply, id: 'bad4', image: 'https://evil.example/x.png', text: 'has a bad image' },
                'not an object',
            ],
        };
        const [clean] = parseAnnotations(enc({ annotations: [hostile] }));
        expect(clean!.replies!.map((r) => r.id)).toEqual(['r1', 'bad4']);
        expect(clean!.replies![1]!.image).toBeUndefined();
    });

    it('caps how many replies a file can bring in', () => {
        const many = Array.from({ length: 800 }, (_, i) => ({ ...reply, id: `r${i}` }));
        const [clean] = parseAnnotations(enc({ annotations: [{ ...comment, replies: many }] }));
        expect(clean!.replies).toHaveLength(500);
    });

    it('are written as standard reply annotations pointing at the comment, and are not duplicated on a second save', async () => {
        const src = await PDFDocument.create();
        src.addPage([300, 300]);
        const first = await buildAnnotatedPdf(await src.save(), [withReplies], () => 'Tied to Wall 01');
        const second = await buildAnnotatedPdf(first, [withReplies], () => 'Tied to Wall 01');

        for (const bytes of [first, second]) {
            const annots = (await PDFDocument.load(bytes)).getPage(0).node.Annots()!;
            expect(annots.size()).toBe(3); // the comment and its two replies, never more
            const dicts = annots.asArray().map((_, i) => annots.lookup(i, PDFDict));
            const parentIndex = dicts.findIndex((d) => !d.has(PDFName.of('IRT')));
            const replies = dicts.filter((d) => d.has(PDFName.of('IRT')));
            expect(replies).toHaveLength(2);
            for (const r of replies) {
                expect(r.get(PDFName.of('IRT'))!.toString()).toBe(annots.get(parentIndex)!.toString());
                expect((r.get(PDFName.of('RT')) as PDFName).decodeText()).toBe('R');
                expect(r.lookup(PDFName.of('T'), PDFHexString).decodeText()).toBe('Carlos');
            }
            expect(replies.map((r) => r.lookup(PDFName.of('Contents'), PDFHexString).decodeText())).toEqual(['Agreed, will confirm.', 'Done.']);
        }
    });
});

import { formatExactDate, withAuthorship } from '../src/lib/comments';

describe('formatExactDate', () => {
    it('gives a readable date and time, and nothing for bad input', () => {
        expect(formatExactDate('2026-11-14T15:30:00Z', 'en-US')).toMatch(/Nov 14, 2026/);
        expect(formatExactDate('nope')).toBe('');
        expect(formatExactDate(undefined)).toBe('');
    });
});

describe('withAuthorship', () => {
    const NOW_ISO = '2026-11-14T15:30:00Z';
    it('stamps a new markup with the profile name, photo and time', () => {
        const out = withAuthorship({ id: 'a' } as { id: string; author?: { name: string; photo?: string }; createdAt?: string }, { name: ' Yam ', photo: 'data:image/png;base64,AA==' }, NOW_ISO);
        expect(out).toEqual({ id: 'a', createdAt: NOW_ISO, author: { name: 'Yam', photo: 'data:image/png;base64,AA==' } });
    });
    it('records the time but no author when the profile has no name yet', () => {
        const out = withAuthorship({ id: 'a' } as { id: string; author?: { name: string }; createdAt?: string }, { name: '  ' }, NOW_ISO);
        expect(out).toEqual({ id: 'a', createdAt: NOW_ISO });
        expect('author' in out).toBe(false);
    });
    it('never overwrites an author or time that is already there', () => {
        const out = withAuthorship({ author: { name: 'Carlos' }, createdAt: '2020-01-01T00:00:00Z' }, { name: 'Yam' }, NOW_ISO);
        expect(out).toEqual({ author: { name: 'Carlos' }, createdAt: '2020-01-01T00:00:00Z' });
    });
});

describe('isAuthor', () => {
    it('matches the profile name regardless of case and spacing', () => {
        expect(isAuthor({ name: 'Yam Chum' }, { name: ' yam chum ' })).toBe(true);
    });
    it('is false for someone else, an unknown author, or an empty profile name', () => {
        expect(isAuthor({ name: 'Ada' }, { name: 'Yam' })).toBe(false);
        expect(isAuthor(undefined, { name: 'Yam' })).toBe(false);
        expect(isAuthor({ name: '' }, { name: '' })).toBe(false);
    });
});
