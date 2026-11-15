import { parquetWriteBuffer, type ColumnSource } from 'hyparquet-writer';
import { cloudRect } from './cloud';
import { linkedKeys } from './links';
import type { Annotation, AppearanceInfo, DrawingInfo, ElementInfo, Point } from './types';

/**
 * Review work done in the viewer, as Parquet tables for a Revit import. They sit beside the add-in's own
 * attachments (`drawings`, `elements`, `appearances`, `parameters`) and follow their conventions:
 * PascalCase columns, `ElementKey`/`DrawingId` join keys, ISO 8601 UTC strings, and a `SchemaVersion` column.
 *
 *  - `markups.parquet`: one row per annotation (shape, text, author, page and drawing, PDF-space geometry).
 *  - `markup-links.parquet`: one row per element a markup refers to, with the Revit identity already resolved.
 *  - `markup-replies.parquet`: one row per reply in a comment thread.
 *
 * Coordinates are PDF user-space points with the origin at the bottom left, the same space as the optional
 * `geometry.parquet` table, so a Revit import can map them through the sheet or view the page was printed from.
 * `annotations.json` stays the viewer's lossless copy; these tables are the import contract.
 */

export const MARKUP_SCHEMA_VERSION = 1;
export const MARKUPS_FILE = 'markups.parquet';
export const MARKUP_LINKS_FILE = 'markup-links.parquet';
export const MARKUP_REPLIES_FILE = 'markup-replies.parquet';
export const MARKUP_FILES = [MARKUPS_FILE, MARKUP_LINKS_FILE, MARKUP_REPLIES_FILE] as const;

/** Viewer kind → the closest Revit annotation family, as a hint for the importer. */
const REVIT_KIND: Record<Annotation['kind'], string> = {
    line: 'DetailLine', rect: 'DetailRectangle', ellipse: 'DetailEllipse', pen: 'DetailPolyline',
    highlight: 'FilledRegion', text: 'TextNote', comment: 'TextNote', signature: 'TextNote', cloud: 'RevisionCloud',
};

/** Where a page sits in PDF user space: its crop box origin and height. */
export interface PageFrame { cropX: number; cropY: number; cropH: number }

export interface MarkupSource {
    elements?: ReadonlyMap<string, ElementInfo>;
    drawings?: readonly DrawingInfo[];
    appearances?: readonly AppearanceInfo[];
}

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

export interface MarkupRow {
    MarkupId: string; Page: number; DrawingId: string | null; ViewId: bigint | null; ViewUniqueId: string | null;
    Kind: string; RevitKind: string; Text: string | null; Author: string | null; CreatedUtc: string | null; ModifiedUtc: string | null;
    Color: string | null; MinX: number; MinY: number; MaxX: number; MaxY: number; AnchorX: number; AnchorY: number;
    Points: string; ElementKey: string | null; LinkCount: number; ReplyCount: number; HasImage: boolean; SchemaVersion: number;
}

export interface MarkupLinkRow {
    MarkupId: string; Ordinal: number; ElementKey: string; Relation: 'Linked' | 'Contained' | 'Overlaps';
    DrawingId: string | null; ModelKey: string | null; UniqueId: string | null; ElementId: bigint | null; LinkInstanceId: bigint | null;
    Category: string | null; Resolved: boolean;
}

export interface MarkupReplyRow {
    MarkupId: string; ReplyId: string; Ordinal: number; Author: string; CreatedUtc: string; Text: string; HasImage: boolean;
}

export interface MarkupTables { markups: MarkupRow[]; links: MarkupLinkRow[]; replies: MarkupReplyRow[] }

const big = (text: string | undefined): bigint | null => (text && /^-?\d+$/.test(text) ? BigInt(text) : null);
const round = (n: number) => Math.round(n * 1000) / 1000;

/** The geometry that defines a markup, in page space (top-left origin), before the PDF transform. */
function shapePoints(a: Annotation, b: Bounds): Point[] {
    const corners = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    switch (a.kind) {
        case 'line': return [a.from, a.to];
        case 'pen': return a.points?.length ? a.points : [a.from, a.to];
        case 'cloud': return corners(...cloudRect(a));
        case 'rect': case 'ellipse': case 'highlight': return corners(b.x0, b.y0, b.x1, b.y1);
        // Text: where the text starts, then the leader tip (the same point when there is no leader).
        case 'text': return [a.from, a.to];
        case 'comment': case 'signature': return [a.from];
    }
}

/** UniqueId is the last segment of an ElementKey (`{ModelKey}/{link path or host}/{UniqueId}`). */
function uniqueIdOf(key: string): string | null {
    const parts = key.split('/');
    return parts.length >= 3 ? parts[parts.length - 1]! || null : null;
}

/**
 * Build the rows. `frames` gives each page's crop box; `bounds` is the save module's drawn extent of a markup
 * (page space), so the Parquet extent matches the visible PDF annotation.
 */
export function buildMarkupTables(
    annotations: readonly Annotation[], frames: ReadonlyMap<number, PageFrame>, bounds: (a: Annotation) => Bounds, source: MarkupSource = {},
): MarkupTables {
    const drawings = source.drawings ?? [];
    const rootByPage = new Map<number, DrawingInfo>();
    for (const d of drawings) if (!d.parentId && !rootByPage.has(d.page)) rootByPage.set(d.page, d);
    // Which drawings each element appears in, so a link names the viewport on the markup's own page.
    const drawingsOf = new Map<string, string[]>();
    for (const ap of source.appearances ?? []) drawingsOf.set(ap.elementKey, [...(drawingsOf.get(ap.elementKey) ?? []), ap.drawingId]);
    const byId = new Map(drawings.map((d) => [d.id, d]));
    const drawingOnPage = (key: string, page: number): string | null => {
        const onPage = (drawingsOf.get(key) ?? []).map((id) => byId.get(id)).filter((d): d is DrawingInfo => d?.page === page);
        // A viewport (child drawing) is more specific than the sheet it is placed on.
        return (onPage.find((d) => d.parentId) ?? onPage[0])?.id ?? null;
    };

    const out: MarkupTables = { markups: [], links: [], replies: [] };
    for (const a of annotations) {
        const frame = frames.get(a.page);
        if (!frame) continue;
        const X = (x: number) => round(frame.cropX + x);
        const Y = (y: number) => round(frame.cropY + frame.cropH - y);
        const b = bounds(a);
        const root = rootByPage.get(a.page);
        const keys = linkedKeys(a);
        const contained = a.kind === 'cloud' ? a.contained ?? [] : [];

        out.markups.push({
            MarkupId: a.id, Page: a.page, DrawingId: root?.id ?? null, ViewId: big(root?.viewId), ViewUniqueId: root?.viewUniqueId ?? null,
            Kind: a.kind, RevitKind: REVIT_KIND[a.kind], Text: a.text?.trim() ? a.text : null, Author: a.author?.name ?? null,
            CreatedUtc: a.createdAt ?? null, ModifiedUtc: a.modifiedAt ?? null, Color: a.kind === 'highlight' ? a.color ?? null : null,
            MinX: X(b.x0), MinY: Y(b.y1), MaxX: X(b.x1), MaxY: Y(b.y0), AnchorX: X(a.from[0]), AnchorY: Y(a.from[1]),
            Points: JSON.stringify(shapePoints(a, b).map((p) => [X(p[0]), Y(p[1])])),
            ElementKey: keys[0] ?? null, LinkCount: keys.length + contained.length, ReplyCount: a.replies?.length ?? 0,
            HasImage: a.image !== undefined, SchemaVersion: MARKUP_SCHEMA_VERSION,
        });

        const refs: { key: string; relation: MarkupLinkRow['Relation'] }[] = [
            ...keys.map((key) => ({ key, relation: 'Linked' as const })),
            ...contained.map((c) => ({ key: c.key, relation: c.fully ? 'Contained' as const : 'Overlaps' as const })),
        ];
        refs.forEach(({ key, relation }, i) => {
            const el = source.elements?.get(key);
            out.links.push({
                MarkupId: a.id, Ordinal: i, ElementKey: key, Relation: relation, DrawingId: drawingOnPage(key, a.page),
                ModelKey: el?.modelKey ?? null, UniqueId: el ? uniqueIdOf(key) : null,
                ElementId: el ? big(el.elementIdText ?? String(el.elementId)) : null, LinkInstanceId: big(el?.linkInstanceId),
                Category: el?.category ?? null, Resolved: el !== undefined,
            });
        });

        (a.replies ?? []).forEach((r, i) => out.replies.push({
            MarkupId: a.id, ReplyId: r.id, Ordinal: i, Author: r.author.name, CreatedUtc: r.createdAt, Text: r.text, HasImage: r.image !== undefined,
        }));
    }
    return out;
}

type Column<R> = [name: keyof R & string, type: NonNullable<ColumnSource['type']>, nullable: boolean];

const MARKUP_COLUMNS: Column<MarkupRow>[] = [
    ['MarkupId', 'STRING', false], ['Page', 'INT32', false], ['DrawingId', 'STRING', true], ['ViewId', 'INT64', true], ['ViewUniqueId', 'STRING', true],
    ['Kind', 'STRING', false], ['RevitKind', 'STRING', false], ['Text', 'STRING', true], ['Author', 'STRING', true],
    ['CreatedUtc', 'STRING', true], ['ModifiedUtc', 'STRING', true], ['Color', 'STRING', true],
    ['MinX', 'DOUBLE', false], ['MinY', 'DOUBLE', false], ['MaxX', 'DOUBLE', false], ['MaxY', 'DOUBLE', false],
    ['AnchorX', 'DOUBLE', false], ['AnchorY', 'DOUBLE', false], ['Points', 'STRING', false], ['ElementKey', 'STRING', true],
    ['LinkCount', 'INT32', false], ['ReplyCount', 'INT32', false], ['HasImage', 'BOOLEAN', false], ['SchemaVersion', 'INT32', false],
];
const LINK_COLUMNS: Column<MarkupLinkRow>[] = [
    ['MarkupId', 'STRING', false], ['Ordinal', 'INT32', false], ['ElementKey', 'STRING', false], ['Relation', 'STRING', false],
    ['DrawingId', 'STRING', true], ['ModelKey', 'STRING', true], ['UniqueId', 'STRING', true], ['ElementId', 'INT64', true],
    ['LinkInstanceId', 'INT64', true], ['Category', 'STRING', true], ['Resolved', 'BOOLEAN', false],
];
const REPLY_COLUMNS: Column<MarkupReplyRow>[] = [
    ['MarkupId', 'STRING', false], ['ReplyId', 'STRING', false], ['Ordinal', 'INT32', false], ['Author', 'STRING', false],
    ['CreatedUtc', 'STRING', false], ['Text', 'STRING', false], ['HasImage', 'BOOLEAN', false],
];

function toParquet<R>(rows: readonly R[], columns: Column<R>[]): Uint8Array {
    const buffer = parquetWriteBuffer({
        columnData: columns.map(([name, type, nullable]) => ({ name, type, nullable, data: rows.map((r) => r[name]) as ColumnSource['data'] })),
        kvMetadata: [{ key: 'enhanced-pdf.schema', value: String(MARKUP_SCHEMA_VERSION) }],
        createdBy: 'Enhanced PDF Viewer',
    });
    return new Uint8Array(buffer);
}

/** The three files to attach, keyed by attachment name. Empty when there are no markups. */
export function markupParquetFiles(tables: MarkupTables): Map<string, Uint8Array> {
    if (!tables.markups.length) return new Map();
    return new Map([
        [MARKUPS_FILE, toParquet(tables.markups, MARKUP_COLUMNS)],
        [MARKUP_LINKS_FILE, toParquet(tables.links, LINK_COLUMNS)],
        [MARKUP_REPLIES_FILE, toParquet(tables.replies, REPLY_COLUMNS)],
    ]);
}
