import { elementLabel } from '../../lib/elementLabel';
import type { Annotation, ElementInfo } from '../../lib/types';

const NAMES: Record<string, string> = { Text: 'PDF comment', FreeText: 'PDF text box', Square: 'PDF rectangle', Circle: 'PDF ellipse', Polygon: 'PDF polygon / cloud', PolyLine: 'PDF polyline', Line: 'PDF line / arrow', Ink: 'PDF drawing', Highlight: 'PDF highlight' };

export function ImportedAnnotationInfo({ annotation, elements, onLink, onOpen }: {
    annotation: Annotation; elements: ReadonlyMap<string, ElementInfo>;
    onLink: (id: string, keys: readonly string[]) => void; onOpen: (key: string) => void;
}) {
    const source = annotation.source;
    if (!source) return null;
    const candidates = (source.candidateKeys ?? []).filter((key) => elements.has(key));
    const references = (source.referencedElementKeys ?? []).filter((key) => elements.has(key));
    const label = (key: string) => elementLabel(elements.get(key)!);
    const status = source.linkState === 'linked'
        ? source.linkMethod === 'plugin' ? 'Linked by the PDF plugin' : source.linkMethod === 'manual' ? 'Linked in this review' : 'Matched from drawing geometry'
        : source.linkState === 'pending' ? 'Waiting for drawing geometry'
        : source.linkState === 'ambiguous' ? 'Review suggested objects before linking'
        : source.linkState === 'metadata-only' ? references.length ? 'Text references found; no mapped geometry at this markup' : 'No mapped drawing geometry is available for this markup'
        : 'No drawing object matched this markup';
    return <section className="imported-annotation-info" aria-label="Imported markup details">
        <div className="imported-annotation-heading"><strong>{NAMES[source.subtype] ?? `PDF ${source.subtype}`}</strong><span className={`imported-link-status is-${source.linkState}`}>{source.linkState === 'linked' ? 'Linked' : source.linkState === 'pending' ? 'Matching' : 'Needs review'}</span></div>
        <p>{status}.</p>
        {source.linkState === 'linked' && source.linkMethod === 'geometry' && source.shape === 'area' && <p className="muted">Matched by the markup area and the objects’ printed extents. Review the links below.</p>}
        {!!candidates.length && <div className="imported-candidates">
            <span className="muted">Choose an object:</span>
            {candidates.slice(0, 12).map((key) => <button type="button" key={key} className="btn" onClick={() => onLink(annotation.id, [key])}>Link to {label(key)}</button>)}
            {candidates.length > 12 && <span className="muted">{candidates.length - 12} more suggestions. Use the object tag to search all objects.</span>}
            {source.shape === 'area' && candidates.length > 1 && <button type="button" className="btn" onClick={() => onLink(annotation.id, candidates)}>Link all {candidates.length} suggested objects</button>}
        </div>}
        {!!references.length && <div className="imported-references"><span className="muted">Mentioned in the comment, separate from drawing links:</span>{references.slice(0, 20).map((key) => <button type="button" className="btn" key={key} onClick={() => onOpen(key)}>{label(key)} · text reference</button>)}</div>}
        <p className="imported-preservation-note">The original PDF markup stays in place. Object links and replies are saved with this review.</p>
    </section>;
}
