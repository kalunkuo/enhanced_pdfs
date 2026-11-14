import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { NativeTagIndex } from './nativeTypes';

export type Point = readonly [number, number];

/** Page coordinates: PDF points, origin top-left, y down. */
export interface Shape {
    elementKey: string;
    /** Optional legacy attachment context; native paths retain their own drawing ID. */
    drawingId?: string;
    bbox: readonly [minX: number, minY: number, maxX: number, maxY: number];
    outline?: readonly Point[];
}

export interface ElementInfo {
    key: string;
    elementId: number;
    /** Exact source ID, including Int64 values beyond JavaScript's safe integer range. */
    elementIdText?: string;
    category: string;
    name: string;
    family?: string;
    type?: string;
    level?: string;
    mark?: string;
    fireRating?: string;
    wallFunction?: string;
    typeKey?: string;
    model?: string;
    modelKey?: string;
    linkInstanceId?: string;
    fireRatingSource?: string;
    /** Made-up data standing in for Revit values that are not exported yet. */
    placeholder?: boolean;
}

export interface ParameterInfo {
    name: string;
    scope: 'Instance' | 'Type';
    value: string;
    parameterId?: string;
    sharedGuid?: string;
    specId?: string;
    unitId?: string;
}

export interface DrawingInfo {
    id: string;
    parentId?: string;
    viewId?: string;
    viewUniqueId?: string;
    page: number;
    name: string;
    kind?: string;
    sheetNumber?: string;
    detailNumber?: string;
    model?: string;
    modelKey?: string;
}

export interface AppearanceInfo {
    drawingId: string;
    elementKey: string;
    source?: string;
}

/** One page, ready to draw and hit-test. Shapes are in page coordinates. */
export interface PageData {
    number: number;
    width: number;
    height: number;
    shapes: Shape[];
    nativeTags?: NativeTagIndex;
    /** Metadata members on this page, including members without native drawing ink. */
    elementKeys?: ReadonlySet<string>;
    geometrySource?: 'native' | 'legacy' | 'none';
}

export interface EnhancedPdf {
    fileName: string;
    /** The original file, kept so it can be saved with annotations added. */
    bytes: Uint8Array;
    pdf: PDFDocumentProxy;
    pageCount: number;
    /** Actual exported element records. Opening a page never invents new BIM records. */
    elements: Map<string, ElementInfo>;
    /** Parameters keyed by ElementKey (instance) or TypeKey (type). */
    parameters: Map<string, ParameterInfo[]>;
    drawings?: DrawingInfo[];
    appearances?: AppearanceInfo[];
    /** Annotations this viewer saved into the file earlier. */
    savedAnnotations: Annotation[];
    /** Human-readable notes about missing or unreadable tables. */
    warnings: string[];
    /** Release the PDF worker when this document is replaced or the viewer unmounts. */
    dispose?: () => Promise<void>;
    /** Loads (and caches) one page, 1-based. */
    page: (n: number) => Promise<PageData>;
}

export type AnnotationKind = 'line' | 'rect' | 'ellipse' | 'pen' | 'highlight' | 'text' | 'comment' | 'signature';

/** A reply in a comment thread. */
export interface Reply {
    id: string;
    author: { name: string; photo?: string };
    /** ISO 8601. */
    createdAt: string;
    text: string;
    /** An image attached to the reply, as a data URL. */
    image?: string;
}

export interface Annotation {
    id: string;
    /** 1-based page number. */
    page: number;
    kind: AnnotationKind;
    /** Page coordinates. For line: start and end. For rect/ellipse: opposite corners. For comment/signature: a single point. For text: `from` is the box, `to` the leader tip (equal when there is no leader). */
    from: Point;
    to: Point;
    /** Freehand path, for `pen`. */
    points?: Point[];
    /** Highlight fill color. */
    color?: string;
    text?: string;
    /** Who wrote a comment. `photo` is a small image data URL. */
    author?: { name: string; photo?: string };
    /** When a comment was written, ISO 8601. */
    createdAt?: string;
    /** An image attached to a comment, as a data URL. */
    image?: string;
    /** Replies to a comment, oldest first. */
    replies?: Reply[];
    /** Set when the annotation is tied to an element. Absent means untied. */
    elementKey?: string;
}
