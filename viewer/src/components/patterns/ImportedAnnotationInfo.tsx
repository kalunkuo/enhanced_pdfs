import { elementLabel } from '../../lib/elementLabel';
import type { Annotation, ElementInfo } from '../../lib/types';

const NAMES: Record<string, string> = { Text: 'PDF comment', FreeText: 'PDF text box', Square: 'PDF rectangle', Circle: 'PDF ellipse', Polygon: 'PDF polygon / cloud', PolyLine: 'PDF polyline', Line: 'PDF line / arrow', Ink: 'PDF drawing', Highlight: 'PDF highlight' };

export function ImportedAnnotationInfo({ annotation, elements, onLink, onOpen }: {
    annotation: Annotation; elements: ReadonlyMap<string, ElementInfo>;
    onLink: (id: string, keys: readonly string[]) => void; onOpen: (key: string) => void;
}) {
    const source = annotation.source;
    if (!source) return null;
    const accepted = source.linkState === 'linked';
    const suggested = source.linkState === 'suggested' ? [...new Set(source.suggestedElementKeys ?? [])].filter((key) => elements.has(key)) : [];
    const candidates = accepted ? [] : [...new Set(source.candidateKeys ?? [])].filter((key) => elements.has(key));
    const references = (source.referencedElementKeys ?? []).filter((key) => elements.has(key));
    const label = (key: string) => elementLabel(elements.get(key)!);
    const status = accepted
        ? source.linkMethod === 'plugin' ? 'Already linked by the PDF plugin' : source.linkMethod === 'manual' ? 'Upgrade accepted. This comment is linked to drawing objects' : 'This comment is linked to drawing objects'
        : source.linkState === 'suggested' ? suggested.length ? 'Review the proposed object links, then accept the upgrade' : 'The proposed objects are unavailable in this drawing'
        : source.linkState === 'pending' ? 'Waiting for drawing geometry'
        : source.linkState === 'ambiguous' ? 'Review the suggested objects and accept the links you want'
        : source.linkState === 'metadata-only' ? references.length ? 'Text references found; no mapped geometry at this markup' : 'No mapped drawing geometry is available for this markup'
        : 'No drawing object matched this markup';
    return <section className="imported-annotation-info" aria-label="Imported markup details">
        <div className="imported-annotation-heading"><strong>{accepted ? 'Smart comment' : NAMES[source.subtype] ?? `PDF ${source.subtype}`}</strong><span className={`imported-link-status is-${source.linkState}`}>{accepted ? source.linkMethod === 'manual' ? 'Accepted' : 'Linked' : suggested.length ? 'Upgrade available' : source.linkState === 'pending' ? 'Matching' : 'Needs review'}</span></div>
        <p>{status}.</p>
        {!!suggested.length && <div className="imported-suggestions" aria-label="Proposed object links">
            <strong>Proposed {suggested.length === 1 ? 'object link' : `${suggested.length} object links`}</strong>
            {source.shape === 'area' && <p className="muted">Suggested from the markup area and the objects’ printed extents.</p>}
            <ul className="imported-proposed-objects">{suggested.map((key) => <li key={key}><button type="button" className="btn" onClick={() => onOpen(key)} aria-label={`Inspect proposed ${label(key)}`}>{label(key)}<span className="muted">Inspect</span></button></li>)}</ul>
            <button type="button" className="btn primary" onClick={() => onLink(annotation.id, suggested)}>Accept upgrade</button>
        </div>}
        {!!candidates.length && <div className="imported-candidates">
            <span className="muted">Choose the object links to accept:</span>
            {candidates.slice(0, 12).map((key) => <button type="button" key={key} className="btn" onClick={() => onLink(annotation.id, [key])}>Accept link to {label(key)}</button>)}
            {candidates.length > 12 && <span className="muted">{candidates.length - 12} more suggestions. Use the object tag to search all objects.</span>}
            {source.shape === 'area' && candidates.length > 1 && <button type="button" className="btn" onClick={() => onLink(annotation.id, candidates)}>Accept all {candidates.length} suggested links</button>}
        </div>}
        {!!references.length && <div className="imported-references"><span className="muted">Mentioned in the comment, separate from drawing links:</span>{references.slice(0, 20).map((key) => <button type="button" className="btn" key={key} onClick={() => onOpen(key)}>{label(key)} · text reference</button>)}</div>}
        <p className="imported-preservation-note">The original PDF markup stays in place. Accepted links and replies are saved with this review.</p>
    </section>;
}
