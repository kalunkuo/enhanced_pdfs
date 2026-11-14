/**
 * Print a PDF through the browser's own PDF viewer, so the print dialog offers its usual page range.
 * Falls back to opening the PDF in a new tab if the browser cannot print from a frame.
 */
export function printPdf(bytes: Uint8Array): void {
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    const cleanup = () => {
        frame.remove();
        URL.revokeObjectURL(url);
    };
    frame.onload = () => {
        try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            setTimeout(cleanup, 60_000); // keep the document alive while the dialog is open
        } catch {
            window.open(url, '_blank');
            setTimeout(cleanup, 60_000);
        }
    };
    frame.src = url;
    document.body.append(frame);
}

/** Save bytes as a file download. */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "plan.pdf" -> "plan-annotated.pdf"; an already annotated name is kept. */
export function annotatedName(fileName: string): string {
    const base = fileName.replace(/\.pdf$/i, '');
    return `${base.endsWith('-annotated') ? base : `${base}-annotated`}.pdf`;
}
