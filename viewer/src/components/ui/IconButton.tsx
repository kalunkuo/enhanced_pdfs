import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  icon?: IconName;
  label: string;
  pressed?: boolean;
  children?: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, pressed, children, className = '', type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={`icon-button ${className}`.trim()} aria-label={label} aria-pressed={pressed} {...props}>{children ?? (icon ? <Icon name={icon} /> : null)}</button>;
});
