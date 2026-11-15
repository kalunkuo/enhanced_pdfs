import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatExportTime, readProvenance, sha256Hex } from '../src/lib/provenance';

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value);
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

function manifest(tables: { name: string; data: Uint8Array; rows?: number }[], extra: Record<string, unknown> = {}) {
    return bytes(JSON.stringify({
        format: 'enhanced-pdf', schemaVersion: 1,
        generator: { name: 'EnhancedPdfs Revit add-in', version: '1.0.0', revitVersion: '2025' },
        exportedUtc: '2026-11-15T04:26:25.8468198+00:00',
        model: { name: 'Snowdon Towers Sample Architectural', modelKey: 'model-key', savedVersion: 'saved-guid', hasUnsavedChanges: false },
        linkedModels: [{ modelKey: 'link-key', name: 'Snowdon Towers Sample Structural' }],
        pages: [{ page: 1, drawingId: 'd1', name: 'First Floor Plan', kind: 'DrawingSheet', sheetNumber: 'A101' }],
        tables: tables.map(({ name, data, rows }) => ({ name, rows: rows ?? 1, bytes: data.length, sha256: hash(data) })),
        ...extra,
    }));
}

describe('readProvenance', () => {
    const elements = bytes('elements-parquet-bytes');
    const drawings = bytes('drawings-parquet-bytes');

    it('verifies every listed table against its hash and reports the model', async () => {
        const attachments = new Map([['elements.parquet', elements], ['drawings.parquet', drawings], ['manifest.json', manifest([{ name: 'elements.parquet', data: elements, rows: 1204 }, { name: 'drawings.parquet', data: drawings, rows: 3 }])]]);
        const { provenance, warnings } = await readProvenance(attachments);
        expect(warnings).toEqual([]);
        expect(provenance).toMatchObject({ modelName: 'Snowdon Towers Sample Architectural', savedVersion: 'saved-guid', revitVersion: '2025', linkedModels: ['Snowdon Towers Sample Structural'], verified: true });
        expect(provenance?.tables).toEqual([{ name: 'elements.parquet', rows: 1204, verified: true }, { name: 'drawings.parquet', rows: 3, verified: true }]);
    });

    it('flags a table whose bytes changed after export, and a missing one', async () => {
        const altered = bytes('elements-parquet-bytes!');
        const attachments = new Map([['elements.parquet', altered], ['manifest.json', manifest([{ name: 'elements.parquet', data: elements }, { name: 'drawings.parquet', data: drawings }])]]);
        const { provenance, warnings } = await readProvenance(attachments);
        expect(provenance?.verified).toBe(false);
        expect(provenance?.tables).toEqual([{ name: 'elements.parquet', rows: 1, verified: false }, { name: 'drawings.parquet', rows: 1, verified: false }]);
        expect(warnings).toEqual([
            "elements.parquet differs from the exporter's manifest: the model data may have been altered after export.",
            'drawings.parquet is listed in manifest.json but missing from the file.',
        ]);
    });

    it('treats a file without a manifest as plain, and a broken manifest as unverifiable', async () => {
        expect(await readProvenance(new Map([['elements.parquet', elements]]))).toEqual({ provenance: null, warnings: [] });
        expect((await readProvenance(new Map([['manifest.json', bytes('{not json')]]))).warnings[0]).toContain('not valid JSON');
        expect((await readProvenance(new Map([['manifest.json', bytes('{"format":"other"}')]]))).warnings[0]).toContain('unexpected format');
    });

    it('hashes with SHA-256 like the exporter and formats the export time for the chip', async () => {
        expect(await sha256Hex(elements)).toBe(hash(elements));
        expect(formatExportTime('2026-11-15T04:26:25.8468198+00:00')).toBe('15 Nov 2026, 04:26 UTC');
        expect(formatExportTime('not a date')).toBe('not a date');
    });
});
