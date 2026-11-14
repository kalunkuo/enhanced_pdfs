import { cloneElement, useId, useState, type ReactElement } from 'react';

type Describable = { 'aria-describedby'?: string };
export function Tooltip({ content, children }: { content: string; children: ReactElement<Describable> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const describedBy = [children.props['aria-describedby'], id].filter(Boolean).join(' ');
  return <span className="ui-tooltip-host" data-open={open} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocusCapture={() => setOpen(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>{cloneElement(children, { 'aria-describedby': describedBy })}<span className="ui-tooltip" id={id} role="tooltip">{content}</span></span>;
}
