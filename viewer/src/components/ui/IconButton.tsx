import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  icon: IconName;
  label: string;
  pressed?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, pressed, className = '', type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={`icon-button ${className}`.trim()} aria-label={label} aria-pressed={pressed} {...props}><Icon name={icon} /></button>;
});
