import { elementLabel } from '../../lib/elementLabel';
import type { ElementInfo } from '../../lib/types';

export function HoverCard({ element, at }: { element: ElementInfo; at: { x: number; y: number } }) {
    return (
        <div className="hover-card" style={{ left: at.x + 14, top: at.y + 14 }}>
            <strong>{elementLabel(element)}</strong>
            {element.level && <div className="muted">{element.level}</div>}
            {element.fireRating && <div>Fire Rating: {element.fireRating}</div>}
            <div className="muted">Click for all parameters</div>
            {element.placeholder && <span className="chip untied">Placeholder data</span>}
        </div>
    );
}
