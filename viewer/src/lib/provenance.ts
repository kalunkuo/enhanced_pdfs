import type { Attachments } from './tables';

/**
 * Provenance of the model data, from the exporter's `manifest.json` attachment: which model and
 * version the file came from, when, and whether the embedded tables are still the bytes the
 * exporter wrote. Hashes are checked in the browser with SubtleCrypto; nothing leaves the page.
 * Files exported before the manifest existed simply have no provenance, which is not an error.
 */

export const MANIFEST_FILE = 'manifest.json';

export interface ProvenanceTable {
    name: string;
    rows: number;
    /** The attachment is present and its SHA-256 equals the manifest's. */
    verified: boolean;
}

export interface Provenance {
    modelName: string;
    modelKey: string | null;
    /** Revit's saved-version GUID of the model at export time. */
    savedVersion: string | null;
    exportedUtc: string;
    revitVersion: string | null;
    generator: string | null;
    linkedModels: string[];
    tables: ProvenanceTable[];
    /** Every listed table is present and unchanged. */
    verified: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
const text = (value: unknown, max = 500): string | null => typeof value === 'string' && value.length <= max ? value : null;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Reads and checks the manifest. `provenance` is null when the file carries none. */
export async function readProvenance(attachments: Attachments): Promise<{ provenance: Provenance | null; warnings: string[] }> {
    const raw = attachments.get(MANIFEST_FILE);
    if (!raw) return { provenance: null, warnings: [] };
    let manifest: unknown;
    try { manifest = JSON.parse(new TextDecoder().decode(raw)); }
    catch { return { provenance: null, warnings: ['manifest.json is not valid JSON; the model data cannot be verified.'] }; }
    if (!record(manifest) || manifest.format !== 'enhanced-pdf' || !record(manifest.model) || !Array.isArray(manifest.tables) || manifest.tables.length > 64) {
        return { provenance: null, warnings: ['manifest.json has an unexpected format; the model data cannot be verified.'] };
    }
    const warnings: string[] = [];
    const tables: ProvenanceTable[] = [];
    for (const entry of manifest.tables) {
        if (!record(entry) || typeof entry.name !== 'string' || typeof entry.sha256 !== 'string') continue;
        const bytes = attachments.get(entry.name);
        const rows = typeof entry.rows === 'number' ? entry.rows : 0;
        if (!bytes) {
            tables.push({ name: entry.name, rows, verified: false });
            warnings.push(`${entry.name} is listed in manifest.json but missing from the file.`);
            continue;
        }
        const verified = (await sha256Hex(bytes)) === entry.sha256.toLowerCase() && (typeof entry.bytes !== 'number' || entry.bytes === bytes.length);
        tables.push({ name: entry.name, rows, verified });
        if (!verified) warnings.push(`${entry.name} differs from the exporter's manifest: the model data may have been altered after export.`);
    }
    const generator = record(manifest.generator) ? manifest.generator : {};
    const linked = Array.isArray(manifest.linkedModels)
        ? manifest.linkedModels.map((model) => (record(model) ? text(model.name) : null)).filter((name): name is string => !!name).slice(0, 50)
        : [];
    return {
        provenance: {
            modelName: text(manifest.model.name) ?? 'Unknown model',
            modelKey: text(manifest.model.modelKey),
            savedVersion: text(manifest.model.savedVersion),
            exportedUtc: text(manifest.exportedUtc, 80) ?? '',
            revitVersion: text(generator.revitVersion, 40),
            generator: text(generator.name, 120),
            linkedModels: linked,
            tables,
            verified: tables.length > 0 && tables.every((table) => table.verified),
        },
        warnings,
    };
}

/** "15 Nov 2026, 04:26 UTC" for the chip; the raw string when it is not a date. */
export function formatExportTime(exportedUtc: string): string {
    const time = new Date(exportedUtc);
    if (Number.isNaN(time.getTime())) return exportedUtc;
    return `${time.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
}
