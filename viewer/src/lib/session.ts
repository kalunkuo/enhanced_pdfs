import type { FilterState } from './filters';
import { clampZoom, type ZoomMode } from './presentation';
import { safeImage } from './comments';
import { cleanLinks } from './links';
import { cleanImportedSource } from './annotationSource';
import { ANNOTATION_KINDS, cleanAuthor, cleanContained, cleanReplies } from './save';
import type { Annotation, AnnotationKind, Point } from './types';

/**
 * Browser-local session recovery. The open file and the review state survive a reload.
 *
 * Two IndexedDB records: `file` (written once per open: the original bytes and their
 * fingerprint) and `state` (rewritten as the review changes). State carries the fingerprint
 * of the file it belongs to and is discarded when it does not match, so markups are never
 * applied to a different drawing revision. Storage failures never block the viewer.
 */

export const SESSION_VERSION = 1;

export type SessionTab = 'agent' | 'properties' | 'elements' | 'notes';

export interface SessionState {
    version: typeof SESSION_VERSION;
    fingerprint: string;
    page: number;
    annotations: Annotation[];
    /** Imported inventory distinguishes intentional deletions from pre-upgrade recovery records. */
    importedAnnotationIds?: string[];
    /** Picked elements: one clicked element, or a multi-selection such as Select similar. */
    selectedKeys: string[];
    /** The selection is every element matching the filters (until something is picked). */
    filterSelected: boolean;
    selectedAnnotationId: string | null;
    filters: FilterState;
    zoomMode: ZoomMode;
    tab: SessionTab;
    drawKind: string;
    highlightColor: string;
}

export interface SessionFile {
    fingerprint: string;
    fileName: string;
    blob: Blob;
}

const DB_NAME = 'enhanced-pdf-viewer';
const STORE = 'session';
const FILE_KEY = 'file';
const STATE_KEY = 'state';

export async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable');
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await openDb();
    return new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = body(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
}

/** Replaces the remembered file and drops state that belonged to a previous file. */
export async function saveSessionFile(file: SessionFile): Promise<void> {
    await run('readwrite', (store) => {
        store.put(file, FILE_KEY);
        store.delete(STATE_KEY);
    });
}

export async function saveSessionState(state: SessionState): Promise<void> {
    await run('readwrite', (store) => store.put(state, STATE_KEY));
}

/** The remembered file and its state, or null when nothing usable is stored. */
export async function loadSession(): Promise<{ file: SessionFile; state: SessionState | null } | null> {
    const [file, rawState] = await Promise.all([
        run<unknown>('readonly', (store) => store.get(FILE_KEY)),
        run<unknown>('readonly', (store) => store.get(STATE_KEY)),
    ]);
    if (!isSessionFile(file)) return null;
    const state = parseSessionState(rawState);
    return { file, state: state?.fingerprint === file.fingerprint ? state : null };
}

export async function clearSession(): Promise<void> {
    await run('readwrite', (store) => store.clear());
}

function isSessionFile(value: unknown): value is SessionFile {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return typeof v.fingerprint === 'string' && typeof v.fileName === 'string' && v.blob instanceof Blob;
}

const KINDS = new Set<AnnotationKind>(ANNOTATION_KINDS);
const TABS = new Set<SessionTab>(['agent', 'properties', 'elements', 'notes']);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

function parseAnnotation(value: unknown): Annotation | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (typeof v.id !== 'string' || !isNum(v.page) || v.page < 1 || !KINDS.has(v.kind as AnnotationKind) || !isPoint(v.from) || !isPoint(v.to)) return null;
    const a: Annotation = { id: v.id, page: Math.floor(v.page), kind: v.kind as AnnotationKind, from: [v.from[0], v.from[1]], to: [v.to[0], v.to[1]] };
    if (Array.isArray(v.points) && v.points.every(isPoint)) a.points = v.points.map((p) => [p[0], p[1]] as const);
    if (typeof v.color === 'string') a.color = v.color;
    if (typeof v.text === 'string') a.text = v.text;
    const source = cleanImportedSource(v.source);
    if (source) a.source = source;
    // Comment threads and clouds: the same checks the viewer applies to annotations read back from a saved PDF.
    const author = cleanAuthor(v.author);
    if (author) a.author = author;
    if (isIsoDate(v.createdAt)) a.createdAt = v.createdAt;
    if (isIsoDate(v.modifiedAt)) a.modifiedAt = v.modifiedAt;
    const image = safeImage(v.image);
    if (image) a.image = image;
    const replies = cleanReplies(v.replies);
    if (replies.length) a.replies = replies;
    const contained = cleanContained(v.contained);
    if (contained.length) a.contained = contained;
    return cleanLinks(a, v);
}

function parseFilters(value: unknown): FilterState {
    const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const facets: Record<string, string[]> = {};
    if (v.facets && typeof v.facets === 'object') {
        for (const [id, values] of Object.entries(v.facets as Record<string, unknown>)) {
            if (Array.isArray(values)) {
                const kept = values.filter((x): x is string => typeof x === 'string');
                if (kept.length) facets[id] = kept;
            }
        }
    }
    return { search: str(v.search) ?? '', facets };
}

function parseZoomMode(value: unknown): ZoomMode {
    const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    if (v.kind === 'fit-page') return { kind: 'fit-page' };
    if (v.kind === 'value' && isNum(v.value) && v.value > 0) return { kind: 'value', value: clampZoom(v.value) };
    return { kind: 'fit-width' };
}

/** Validates stored state field by field; unreadable fields fall back to defaults. */
export function parseSessionState(value: unknown): SessionState | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (v.version !== SESSION_VERSION || typeof v.fingerprint !== 'string') return null;
    const annotations = Array.isArray(v.annotations) ? v.annotations.map(parseAnnotation).filter((a): a is Annotation => a !== null) : [];
    return {
        version: SESSION_VERSION,
        fingerprint: v.fingerprint,
        page: isNum(v.page) && v.page >= 1 ? Math.floor(v.page) : 1,
        annotations,
        ...(Array.isArray(v.importedAnnotationIds) ? { importedAnnotationIds: [...new Set(v.importedAnnotationIds.slice(0, 100_000).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 2000))] } : {}),
        // Records written before multi-selection kept one `selectedKey`.
        selectedKeys: Array.isArray(v.selectedKeys) ? [...new Set(v.selectedKeys.filter((k): k is string => typeof k === 'string'))] : str(v.selectedKey) ? [v.selectedKey as string] : [],
        filterSelected: v.filterSelected === true,
        selectedAnnotationId: str(v.selectedAnnotationId),
        filters: parseFilters(v.filters),
        zoomMode: parseZoomMode(v.zoomMode),
        tab: TABS.has(v.tab as SessionTab) ? (v.tab as SessionTab) : 'properties',
        drawKind: str(v.drawKind) ?? 'pen',
        highlightColor: str(v.highlightColor) ?? '',
    };
}

/** Next free numeric suffix for `a<n>` annotation IDs. */
export function nextAnnotationNumber(annotations: readonly Annotation[]): number {
    let max = annotations.length;
    for (const a of annotations) {
        const n = /^a(\d+)$/.exec(a.id)?.[1];
        if (n) max = Math.max(max, Number(n));
    }
    return max + 1;
}
