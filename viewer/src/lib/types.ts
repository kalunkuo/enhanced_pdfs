import type { PDFDocumentProxy } from 'pdfjs-dist';

export type Point = readonly [number, number];

/** Page coordinates: PDF points, origin top-left, y down. */
export interface Shape {
    elementKey: string;
    bbox: readonly [minX: number, minY: number, maxX: number, maxY: number];
    outline?: readonly Point[];
}

export interface ElementInfo {
    key: string;
    elementId: number;
    category: string;
    name: string;
    family?: string;
    type?: string;
    level?: string;
    mark?: string;
    fireRating?: string;
    wallFunction?: string;
    typeKey?: string;
    /** Made-up data standing in for Revit values that are not exported yet. */
    placeholder?: boolean;
}

export interface ParameterInfo {
    name: string;
    scope: 'Instance' | 'Type';
    value: string;
}

/** One page, ready to draw and hit-test. Shapes are in page coordinates. */
export interface PageData {
    number: number;
    width: number;
    height: number;
    shapes: Shape[];
}

export interface EnhancedPdf {
    fileName: string;
    /** The original file, kept so it can be saved with annotations added. */
    bytes: Uint8Array;
    pdf: PDFDocumentProxy;
    pageCount: number;
    /** Elements and parameters; placeholders are added as pages are loaded. */
    elements: Map<string, ElementInfo>;
    /** Parameters keyed by ElementKey (instance) or TypeKey (type). */
    parameters: Map<string, ParameterInfo[]>;
    /** Annotations this viewer saved into the file earlier. */
    savedAnnotations: Annotation[];
    /** Human-readable notes about missing or unreadable tables. */
    warnings: string[];
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
    /** Page coordinates. For line: start and end. For rect/ellipse: opposite corners. For text/comment: a single point. */
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
