import type { HTMLAttributes, ReactNode } from 'react';

export type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'aside';
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  state?: 'ready' | 'empty' | 'loading' | 'error';
  stateMessage?: string;
};

export function Panel({ as: Element = 'section', title, eyebrow, actions, footer, state = 'ready', stateMessage, className = '', children, ...props }: PanelProps) {
  return <Element className={`ui-panel ${className}`.trim()} aria-busy={state === 'loading' || undefined} {...props}>
    {(title || eyebrow || actions) && <header className="ui-panel-header"><div>{eyebrow && <span className="ui-eyebrow">{eyebrow}</span>}{title && <h2 className="type-h3">{title}</h2>}</div>{actions}</header>}
    <div className="ui-panel-body">{state === 'ready' ? children : <div className={`ui-panel-state ui-panel-state--${state}`} role={state === 'error' ? 'alert' : 'status'}>{stateMessage || (state === 'loading' ? 'Loading…' : state === 'empty' ? 'Nothing to show yet.' : 'Unable to load this panel.')}</div>}</div>
    {footer && <footer className="ui-panel-footer">{footer}</footer>}
  </Element>;
}
