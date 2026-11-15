import { cloneElement, useId, type ReactElement } from 'react';

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean };
export type FieldProps = {
  label: string;
  children: ReactElement<ControlProps>;
  id?: string;
  hint?: string;
  error?: string;
  className?: string;
};

export function Field({ label, children, id, hint, error, className = '' }: FieldProps) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const descriptionId = `${controlId}-description`;
  const describedBy = [children.props['aria-describedby'], (hint || error) && descriptionId].filter(Boolean).join(' ') || undefined;
  return <div className={`ui-field ${className}`.trim()}>
    <label htmlFor={controlId}>{label}</label>
    {cloneElement(children, { id: controlId, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) || undefined })}
    {(hint || error) && <div id={descriptionId} className={`ui-field-message ${error ? 'ui-field-message--error' : ''}`}>{error || hint}</div>}
  </div>;
}
