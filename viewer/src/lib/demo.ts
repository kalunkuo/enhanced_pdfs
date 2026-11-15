/**
 * The bundled demo drawing: Snowdon Towers sheet A101, a real export from the Revit add-in
 * (public/demo/a101-first-floor-plan.pdf). Opening the viewer at `/demo` (or `#demo` where the
 * host cannot route paths) loads it instead of the remembered file, so a demo always starts
 * from the same drawing without an upload step.
 */

export interface DemoFile {
    url: string;
    fileName: string;
}

const base = import.meta.env.BASE_URL || '/';

export const DEMO_FILE: DemoFile = {
    url: `${base.endsWith('/') ? base : `${base}/`}demo/a101-first-floor-plan.pdf`,
    fileName: 'A101 - First Floor Plan.pdf',
};

/** The demo file to open for this location, or null when the viewer should start as usual. */
export function demoFileFromLocation(location: { pathname: string; hash: string }): DemoFile | null {
    const path = location.pathname.replace(/\/+$/, '');
    const hash = location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');
    return path === '/demo' || path.endsWith('/demo') || hash === 'demo' ? DEMO_FILE : null;
}
