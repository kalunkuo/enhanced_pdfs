import { useEffect, useRef, useState } from 'react';

export type ProgressBarProps = {
  /** Reported progress, 0 to 1. */
  value: number;
  label: string;
  /** Visible status under the track, such as the current step. */
  detail?: string;
  /**
   * Where the current step ends, 0 to 1. While reports stall, the fill creeps toward this
   * (never reaching it), so the bar keeps moving instead of stopping between reports.
   */
  ceiling?: number;
  /** Called once when the visible fill reaches 100%. */
  onComplete?: () => void;
};

// Time constants: the fill closes 63% of the gap to its goal every FOLLOW_MS; the creep closes the gap to the ceiling every CREEP_MS.
const FOLLOW_MS = 220;
const CREEP_MS = 2400;
const SETTLED = 0.0005;

/** Determinate progress: a raised track with a fill that eases continuously toward the reported value, and a percentage readout. */
export function ProgressBar({ value, label, detail, ceiling, onComplete }: ProgressBarProps) {
  const target = clamp(value);
  const limit = Math.max(target, clamp(ceiling ?? target));
  const [shown, setShown] = useState(target);
  const goal = useRef({ target, limit });
  goal.current = { target, limit };
  const state = useRef({ shown: target, creep: target });
  const complete = useRef(onComplete);
  complete.current = onComplete;

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const { target: t, limit: l } = goal.current;
      const s = state.current;
      s.creep = Math.max(s.creep, t);
      if (l > s.creep) s.creep += (l - s.creep) * (1 - Math.exp(-dt / CREEP_MS));
      const want = Math.max(t, s.creep);
      s.shown = reduced ? want : s.shown + (want - s.shown) * (1 - Math.exp(-dt / FOLLOW_MS));
      if (Math.abs(want - s.shown) < SETTLED) s.shown = want;
      setShown(s.shown);
      if (s.shown >= 1) return complete.current?.();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const percent = Math.round(shown * 100);
  return <div className="ui-progress">
    <div className="ui-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={detail ? `${percent}%, ${detail}` : `${percent}%`}>
      <div className="ui-progress-fill" style={{ transform: `scaleX(${shown})` }} />
    </div>
    <div className="ui-progress-meta"><span>{detail}</span><span className="ui-progress-value">{percent}%</span></div>
  </div>;
}

const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
