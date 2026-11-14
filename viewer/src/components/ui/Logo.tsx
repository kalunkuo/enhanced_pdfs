import logoUrl from '../../assets/enhanced-pdf-logo.svg';

/** The Enhanced PDF mark. To change the logo, replace src/assets/enhanced-pdf-logo.svg. */
export function Logo({ size = 28 }: { size?: number }) {
    return <img className="logo" src={logoUrl} width={size} height={size} alt="Enhanced PDF" title="Enhanced PDF" draggable={false} />;
}
