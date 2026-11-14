import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { avatarColor, formatTimeAgo, initials, pdfDate, safeImage } from '../src/lib/comments';
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
        expect(avatarColor('Yam')).toMatch(/^hsl\(\d+ 65% 45%\)$/);
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
