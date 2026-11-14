import type { ElementInfo } from '../../lib/types';

export function HoverCard({ element, at }: { element: ElementInfo; at: { x: number; y: number } }) {
    return (
        <div className="hover-card" style={{ left: at.x + 14, top: at.y + 14 }}>
            <strong>{element.mark ?? element.name}</strong>
            <div className="muted">
                {element.category}
                {element.level ? ` · ${element.level}` : ''}
            </div>
            {element.fireRating && <div>Fire Rating: {element.fireRating}</div>}
            <div className="muted">ID {element.elementIdText ?? element.elementId} · click for all parameters</div>
            {element.placeholder && <span className="chip untied">Placeholder data</span>}
        </div>
    );
}
