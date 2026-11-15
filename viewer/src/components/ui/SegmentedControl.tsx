import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export type SegmentedOption<T extends string> = { value: T; label: ReactNode };
export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
};

/**
 * Content-width options (label plus an inset each side) in a track only as wide as they need.
 * One indicator matches the selected option, sliding and resizing on the shared arc easing.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, className }: SegmentedControlProps<T>) {
  const track = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  // Label text changes resize the observed options; only the option set itself needs a re-subscribe.
  const optionKey = options.map((option) => option.value).join('|');

  useLayoutEffect(() => {
    const root = track.current;
    if (!root) return;
    const measure = () => {
      const tab = root.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) return setIndicator(null);
      const base = root.getBoundingClientRect().left;
      const t = tab.getBoundingClientRect();
      setIndicator((current) => {
        const next = { x: t.left - base, w: t.width };
        return current && Math.abs(current.x - next.x) < 0.5 && Math.abs(current.w - next.w) < 0.5 ? current : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll('.tab').forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [value, optionKey]);

  // Enable the slide only after the first placement, so the indicator does not travel in from the edge on mount.
  useLayoutEffect(() => {
    if (!indicator || ready) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [indicator, ready]);

  const style = indicator ? ({ '--indicator-x': `${indicator.x}px`, '--indicator-w': `${indicator.w}px` } as CSSProperties) : undefined;
  return (
    <div ref={track} className={['tabs', className].filter(Boolean).join(' ')} role="tablist" aria-label={label}
      data-indicator={indicator ? (ready ? 'ready' : 'placed') : undefined} style={style}>
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" className="tab" aria-selected={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
