import { describe, expect, it } from 'vitest';
import { DEMO_FILE, demoFileFromLocation } from '../src/lib/demo';

describe('demoFileFromLocation', () => {
    it('opens the demo drawing for /demo, with or without a trailing slash or base path', () => {
        expect(demoFileFromLocation({ pathname: '/demo', hash: '' })).toEqual(DEMO_FILE);
        expect(demoFileFromLocation({ pathname: '/demo/', hash: '' })).toEqual(DEMO_FILE);
        expect(demoFileFromLocation({ pathname: '/viewer/demo', hash: '' })).toEqual(DEMO_FILE);
    });

    it('opens the demo drawing for #demo on hosts that cannot route paths', () => {
        expect(demoFileFromLocation({ pathname: '/', hash: '#demo' })).toEqual(DEMO_FILE);
        expect(demoFileFromLocation({ pathname: '/', hash: '#/demo/' })).toEqual(DEMO_FILE);
    });

    it('leaves every other location alone', () => {
        expect(demoFileFromLocation({ pathname: '/', hash: '' })).toBeNull();
        expect(demoFileFromLocation({ pathname: '/demos', hash: '' })).toBeNull();
        expect(demoFileFromLocation({ pathname: '/demo-enhanced.pdf', hash: '' })).toBeNull();
        expect(demoFileFromLocation({ pathname: '/', hash: '#demonstration' })).toBeNull();
    });

    it('points at the bundled Snowdon Towers A101 export', () => {
        expect(DEMO_FILE.url.endsWith('/demo/a101-first-floor-plan.pdf')).toBe(true);
        expect(DEMO_FILE.url.startsWith('/')).toBe(true);
        expect(DEMO_FILE.fileName).toBe('A101 - First Floor Plan.pdf');
    });
});
