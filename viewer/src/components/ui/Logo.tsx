/**
 * The "ePDF." wordmark. Colors and size come from the `--logo-*` component tokens:
 * the "e" is primary blue and the trailing period is a secondary-red square.
 */
export function Logo({ className }: { className?: string }) {
    return (
        <span className={className ? `ui-logo ${className}` : 'ui-logo'} role="img" aria-label="ePDF" title="Enhanced PDF">
            <span className="ui-logo-e" aria-hidden="true">e</span>
            <span aria-hidden="true">PDF</span>
            <span className="ui-logo-dot" aria-hidden="true" />
        </span>
    );
}
