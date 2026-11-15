import { useEffect, useId, useRef, type ReactNode } from 'react';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** False blocks Escape and backdrop dismissal, for blocking work such as a file load. */
  dismissible?: boolean;
  /** Type style for the title; defaults to `type-h1`. */
  titleClassName?: string;
};

export function Dialog({ open, onClose, title, description, children, footer, className = '', dismissible = true, titleClassName = 'type-h1' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { returnFocus.current = document.activeElement as HTMLElement; dialog.showModal(); }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return <dialog ref={ref} className={`ui-dialog ${className}`.trim()} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={(event) => { if (!dismissible) event.preventDefault(); }} onClose={() => { onClose(); returnFocus.current?.focus(); }}>
    <div className="ui-dialog-content"><h2 id={titleId} className={titleClassName}>{title}</h2>{description && <p id={descriptionId} className="type-paragraph">{description}</p>}{children}</div>
    {footer && <div className="ui-dialog-footer">{footer}</div>}
  </dialog>;
}
