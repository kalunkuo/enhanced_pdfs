import { useEffect, useState } from 'react';
import { IconButton } from './IconButton';

export type ZoomControlProps = { value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; disabled?: boolean };

export function ZoomControl({ value, onChange, min = 50, max = 180, step = 10, disabled = false }: ZoomControlProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return; }
    const next = Math.max(min, Math.min(max, Math.round(parsed / step) * step));
    setDraft(String(next)); onChange(next);
  };
  return <div className="ui-zoom-control" role="group" aria-label="Document zoom">
    <IconButton icon="minus" label="Zoom out" disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - step))} />
    <label className="ui-zoom-input"><span className="ui-sr-only">Zoom percentage</span><input type="number" value={draft} min={min} max={max} step={step} disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { commit(); event.currentTarget.blur(); } }} /><span aria-hidden="true">%</span></label>
    <IconButton icon="plus" label="Zoom in" disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + step))} />
  </div>;
}
