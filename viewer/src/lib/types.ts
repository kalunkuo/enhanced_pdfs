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
    /** Preserve raw-value provenance: InternalValue uses Revit's internal units, not UnitId's display units. */
    valueSource?: 'display' | 'text' | 'integer' | 'internal' | 'reference';
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
    /** Source PDF annotations imported without changing their original appearance. */
    importedAnnotationCount?: number;
    /** Exact PDF references of existing viewer-rendered copies; foreign ep-* annotations are excluded. */
    viewerOwnedAnnotationRefs?: ReadonlySet<string>;
    /** Human-readable notes about missing or unreadable tables. */
    warnings: string[];
    /** Release the PDF worker when this document is replaced or the viewer unmounts. */
    dispose?: () => Promise<void>;
    /** Loads (and caches) one page, 1-based. */
    page: (n: number) => Promise<PageData>;
}

export type AnnotationKind = 'line' | 'rect' | 'ellipse' | 'pen' | 'highlight' | 'text' | 'comment' | 'signature' | 'cloud';

/** An element a revision cloud covers. `fully` is false when the element only overlaps the cloud. */
export interface ContainedElement {
    key: string;
    fully: boolean;
}

/** A reply in a comment thread. */
export interface Reply {
    id: string;
    author: { name: string; photo?: string };
    /** ISO 8601. */
    createdAt: string;
    text: string;
    /** An image attached to the reply, as a data URL. */
    image?: string;
    /** Reference to an existing standard PDF reply, retained during save. */
    source?: { ref: string; name?: string; renderId?: string };
}

/** Provenance for a standard PDF markup; its original graphics stay in the PDF. */
export interface ImportedAnnotationSource {
    /** PDF.js-style indirect reference (e.g. 123R), or direct:<original annotation index>. */
    ref: string;
    /** PDF.js rendering ID, when it differs from a direct source dictionary identity. */
    renderId?: string;
    name?: string;
    subtype: string;
    /** Scale-1 PDF.js viewport bounds and matching anchor, including page crop/rotation. */
    bounds: readonly [number, number, number, number];
    anchor: Point;
    shape: 'area' | 'point' | 'arrow';
    drawingId?: string;
    linkState: 'pending' | 'linked' | 'unlinked' | 'ambiguous' | 'metadata-only';
    linkMethod?: 'plugin' | 'geometry' | 'manual';
    candidateKeys?: string[];
    referencedElementKeys?: string[];
}

export interface Annotation {
    id: string;
    /** Imported markups are editable review records over the unchanged source PDF appearance. */
    source?: ImportedAnnotationSource;
    /** When a saved review comment was last edited, if recorded. */
    modifiedAt?: string;
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
    /** For a revision cloud: the elements it covered when it was drawn or moved, fully inside ones first. */
    contained?: ContainedElement[];
    /** Set when the annotation is tied to an element. Absent means untied. With several links, the first of `elementKeys`. */
    elementKey?: string;
    /** Every linked element, when there are two or more (a comment on a multi-selection). Read through `linkedKeys`. */
    elementKeys?: string[];
}
