import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { AppearanceInfo, DrawingInfo, ElementInfo, ParameterInfo, Point, Shape } from './types';

export type Row = Record<string, unknown>;

const str = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v));
const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));

/** geometry.parquet: DrawingId, ElementKey, MinX, MinY, MaxX, MaxY, Outline (JSON [[x,y],...]). PDF points, origin bottom-left. */
export function buildShapes(rows: readonly Row[], pageHeight: number): Shape[] {
    const shapes: Shape[] = [];
    for (const r of rows) {
        const key = str(r.ElementKey);
        if (!key) continue;
        const y0 = pageHeight - num(r.MaxY);
        const y1 = pageHeight - num(r.MinY);
        let outline: Point[] | undefined;
        const raw = str(r.Outline);
        if (raw) {
            try {
                const pts = JSON.parse(raw) as [number, number][];
                outline = pts.map(([x, y]) => [x, pageHeight - y] as const);
            } catch {
                outline = undefined;
            }
        }
        shapes.push({ elementKey: key, bbox: [num(r.MinX), y0, num(r.MaxX), y1], ...(outline ? { outline } : {}) });
    }
    return shapes;
}

export function buildElements(rows: readonly Row[]): Map<string, ElementInfo> {
    const out = new Map<string, ElementInfo>();
    for (const r of rows) {
        const key = str(r.ElementKey);
        if (!key) continue;
        out.set(key, {
            key,
            elementId: num(r.ElementId),
            elementIdText: str(r.ElementId),
            category: str(r.Category) ?? 'Element',
            name: str(r.Name) ?? key,
            family: str(r.Family),
            type: str(r.Type),
            level: str(r.Level),
            mark: str(r.Mark),
            fireRating: str(r.FireRating),
            wallFunction: str(r.WallFunction),
            typeKey: str(r.TypeKey),
            model: str(r.Model),
            modelKey: str(r.ModelKey),
            linkInstanceId: str(r.LinkInstanceId),
            fireRatingSource: str(r.FireRatingSource),
        });
    }
    return out;
}

export function buildParameters(rows: readonly Row[]): Map<string, ParameterInfo[]> {
    const out = new Map<string, ParameterInfo[]>();
    for (const r of rows) {
        const owner = str(r.OwnerKey);
        const name = str(r.Name);
        if (!owner || !name) continue;
        const value = str(r.DisplayValue) ?? str(r.TextValue) ??
            (r.IntegerValue != null ? String(r.IntegerValue) : r.InternalValue != null ? String(r.InternalValue) : r.ReferenceId != null ? String(r.ReferenceId) : '');
        const list = out.get(owner) ?? [];
        list.push({ name, scope: r.Scope === 'Type' ? 'Type' : 'Instance', value,
            parameterId: str(r.ParameterId), sharedGuid: str(r.SharedGuid), specId: str(r.SpecId), unitId: str(r.UnitId) });
        out.set(owner, list);
    }
    return out;
}

export function buildDrawings(rows: readonly Row[]): DrawingInfo[] {
    return rows.flatMap((row) => {
        const id = str(row.DrawingId);
        const page = Number(row.Page);
        if (!id || !Number.isInteger(page) || page < 1) return [];
        return [{ id, page, name: str(row.Name) ?? id,
            parentId: str(row.ParentDrawingId), viewId: str(row.ViewId), viewUniqueId: str(row.ViewUniqueId),
            kind: str(row.Kind), sheetNumber: str(row.SheetNumber), detailNumber: str(row.DetailNumber),
            model: str(row.Model), modelKey: str(row.ModelKey) }];
    });
}

export function buildAppearances(rows: readonly Row[]): AppearanceInfo[] {
    return rows.flatMap((row) => {
        const drawingId = str(row.DrawingId), elementKey = str(row.ElementKey);
        return drawingId && elementKey ? [{ drawingId, elementKey, source: str(row.Source) }] : [];
    });
}


/** Attachment bytes keyed by file name, e.g. "elements.parquet". */
export type Attachments = ReadonlyMap<string, Uint8Array>;

export async function readTables(attachments: Attachments, onTable?: (done: number, total: number) => void): Promise<{
    tables: Map<string, Row[]>;
    warnings: string[];
}> {
    const tables = new Map<string, Row[]>();
    const warnings: string[] = [];
    const parquet = [...attachments].filter(([name]) => name.endsWith('.parquet'));
    let done = 0;
    for (const [name, bytes] of parquet) {
        try {
            const copy = bytes.slice().buffer as ArrayBuffer;
            tables.set(name.replace(/\.parquet$/, ''), (await parquetReadObjects({ file: copy, compressors })) as Row[]);
        } catch (e) {
            warnings.push(`Could not read ${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
        onTable?.(++done, parquet.length);
    }
    return { tables, warnings };
}

/** Which page each drawing is on, from drawings.parquet. Empty when that table is missing. */
export function drawingPages(rows: readonly Row[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const r of rows) {
        const id = str(r.DrawingId);
        if (id) out.set(id, Math.max(1, num(r.Page)));
    }
    return out;
}

/** Geometry rows for one page. A row whose drawing is unknown is treated as page 1. */
export function geometryForPage(rows: readonly Row[], pages: ReadonlyMap<string, number>, page: number): Row[] {
    return rows.filter((r) => (pages.get(str(r.DrawingId) ?? '') ?? 1) === page);
}
