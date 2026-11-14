import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ActionButton } from './ActionButton';
import { IconButton as DesignIconButton } from './IconButton';

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost';
  children: ReactNode;
};

/** Keeps the viewer's existing button API while using the shared design-system control. */
export function Button({ variant, children, ...props }: AppButtonProps) {
  return <ActionButton variant={variant ?? 'secondary'} {...props}>{children}</ActionButton>;
}

type AppIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  pressed?: boolean;
  children: ReactNode;
};

export function IconButton({ label, pressed, children, ...props }: AppIconButtonProps) {
  return <DesignIconButton label={label} title={label} pressed={pressed} {...props}>{children}</DesignIconButton>;
}
