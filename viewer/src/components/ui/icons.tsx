import type { ReactNode } from 'react';

const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const icon = (path: ReactNode) => () => <svg {...base} aria-hidden="true">{path}</svg>;

// A solid pointer reads larger than the outline icons around it, so it is drawn at 80% to match their size.
export const SelectIcon = icon(<path d="M6 3l12 9-5.5 1 3 6-2.5 1.2-3-6L6 18z" fill="currentColor" transform="translate(12 12) scale(0.8) translate(-12 -12)" />);
export const CommentIcon = icon(<><path d="M4 5h16v11H10l-4 3.5V16H4z" /><path d="M12 8v5M9.5 10.5h5" /></>);
/** Select similar: one solid square and the matching outlines it adds to the selection. */
export const SelectSimilarIcon = icon(<><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" fill="currentColor" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>);
/** Comment on the selection: a speech bubble tied to a small square. */
export const CommentOnSelectionIcon = icon(<><path d="M9 4h11v9h-5l-3 3v-3H9z" /><rect x="3.5" y="13.5" width="6.5" height="6.5" rx="1.5" fill="currentColor" /></>);
export const HighlightIcon = icon(<><path d="M14 4l6 6-8 8H7l-2 2H3v-2l2-2v-4z" /><path d="M3 21h8" strokeWidth={3} opacity={0.45} /></>);
export const DrawIcon = icon(<path d="M4 15c3-9 8-10 8-6 0 5-6 7-3 9 4 2 9-6 11-4" />);
export const TextBoxIcon = icon(<><rect x="4" y="4" width="16" height="16" rx="1.5" strokeDasharray="2.5 2" /><path d="M8.5 17l3.5-10 3.5 10M9.7 13.5h4.6" /></>);
export const SignatureIcon = icon(<><path d="M3 20c3 0 4-5 6-5s0 4 2 4 3-3 4-3 2 3 6 1" /><path d="M14 4l4 4-7 7H7v-4z" /></>);
export const MoreIcon = icon(<><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>);
export const LineIcon = icon(<path d="M5 19L19 5" />);
export const RectIcon = icon(<rect x="4" y="6" width="16" height="12" rx="1" />);
export const CircleIcon = icon(<circle cx="12" cy="12" r="8" />);
export const CloudIcon = icon(<path d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8.5 4.5 4.5 0 0 1 17.5 18z" />);
export const UploadIcon = icon(<path d="M12 16V4M7 9l5-5 5 5M4 20h16" />);
export const TrashIcon = icon(<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const MinusIcon = icon(<path d="M5 12h14" />);
export const FitIcon = icon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const SaveIcon = icon(<><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v6h7V3M8 21v-7h8v7" /></>);
export const PrintIcon = icon(<><path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="1.5" /><path d="M7 14h10v7H7z" /></>);
export const PrevPageIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 17V8M8 11.5l4-4 4 4" /></>);
export const NextPageIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v9M8 12.5l4 4 4-4" /></>);
export const HandIcon = icon(<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.7-2.3L4.5 15a1.6 1.6 0 0 1 2.4-2.1L8 14" />);
export const ChevronDownIcon = icon(<path d="M6 9l6 6 6-6" />);
export const CheckIcon = icon(<path d="M5 12l5 5 9-10" />);
