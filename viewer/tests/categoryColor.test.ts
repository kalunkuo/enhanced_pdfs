import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SHADES, categoryColor, categoryShadeIndex } from '../src/lib/categoryColor';

const css = readFileSync(new URL('../src/styles/tokens/primitives.css', import.meta.url), 'utf8');
const hex = (name: string) => css.match(new RegExp(`--primitive-color-${name}:\\s*#([0-9a-f]{6})`, 'i'))![1]!;
const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const luminance = ([r, g, b]: number[]) => {
    const [R, G, B] = [r!, g!, b!].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * R! + 0.7152 * G! + 0.0722 * B!;
};
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };
const shadeRgb = (hue: string, white: number) => rgb(hex(hue === 'pink' ? 'pink-300' : `${hue}-500`)).map((v) => v * (1 - white / 100) + 255 * (white / 100));

describe('category pill colors', () => {
    it('stay readable (4.5:1) on both sidebar surfaces', () => {
        for (const surface of ['ink-900', 'ink-800']) for (const s of CATEGORY_SHADES) {
            expect(contrast(shadeRgb(s.hue, s.white), rgb(hex(surface))), `${s.hue} +${s.white}% on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
    });
    it('never uses the primary blue', () => {
        expect(CATEGORY_SHADES.every((s) => (s.hue as string) !== 'blue')).toBe(true);
    });
    it('gives the common categories different shades, and the same category the same shade', () => {
        const common = ['Walls', 'Floors', 'Furniture', 'Doors', 'Windows', 'Columns', 'Beams', 'Roofs'];
        expect(new Set(common.map(categoryShadeIndex)).size).toBe(common.length);
        expect(categoryColor('Walls')).toBe(categoryColor('Wall'));
        expect(categoryColor('Structural Columns')).toBe(categoryColor('Column'));
    });
});
