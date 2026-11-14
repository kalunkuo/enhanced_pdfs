import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
};

export function ActionButton({ children, variant = 'primary', loading = false, className = '', disabled, type = 'button', ...props }: ActionButtonProps) {
  return <button type={type} className={`ui-action-button ui-action-button--${variant} ${className}`.trim()} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>{loading ? 'Working…' : children}</button>;
}
