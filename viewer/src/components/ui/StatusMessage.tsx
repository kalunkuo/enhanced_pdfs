import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type StatusTone = 'info' | 'success' | 'warning' | 'error';
export type StatusMessageProps = {
  tone: StatusTone;
  variant?: 'inline' | 'banner' | 'toast';
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
  autoDismissMs?: number;
};

const toneIcons: Record<StatusTone, IconName> = { info: 'geometry', success: 'check', warning: 'warning', error: 'error' };

export function StatusMessage({ tone, variant = 'inline', title, children, onDismiss, autoDismissMs }: StatusMessageProps) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!autoDismissMs || !dismissRef.current || tone === 'error') return;
    const timer = window.setTimeout(() => dismissRef.current?.(), autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [autoDismissMs, tone]);
  return <div className={`ui-status ui-status--${tone} ui-status--${variant}`} role={tone === 'error' ? 'alert' : 'status'}><Icon name={toneIcons[tone]} /><div>{title && <strong>{title}</strong>}{children && <div className="ui-status-description">{children}</div>}</div>{onDismiss && <button className="ui-status-dismiss" type="button" aria-label="Dismiss message" onClick={onDismiss}><Icon name="close" /></button>}</div>;
}
