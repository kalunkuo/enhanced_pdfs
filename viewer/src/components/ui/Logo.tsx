/**
 * The "BIMprint." wordmark. Colors and size come from the `--logo-*` component tokens:
 * "BIM" is primary blue, "print" is primary text (white), and the trailing period is a secondary-red square.
 */
export function Logo({ className }: { className?: string }) {
    return (
        <span className={className ? `ui-logo ${className}` : 'ui-logo'} role="img" aria-label="BIMprint" title="BIMprint">
            <span className="ui-logo-accent" aria-hidden="true">BIM</span>
            <span aria-hidden="true">print</span>
            <span className="ui-logo-dot" aria-hidden="true" />
        </span>
    );
}
