import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ variant, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; children: ReactNode }) {
    return <button className={`btn ${variant ?? ''}`} {...rest}>{children}</button>;
}

export function IconButton({ label, pressed, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; pressed?: boolean; children: ReactNode }) {
    return (
        <button className="icon-btn" aria-label={label} title={label} aria-pressed={pressed} {...rest}>
            {children}
        </button>
    );
}
