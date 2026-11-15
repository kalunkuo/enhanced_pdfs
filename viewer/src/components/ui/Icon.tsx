import type { ReactNode, SVGProps } from 'react';

export type IconName = 'open' | 'search' | 'select' | 'pan' | 'annotate' | 'layers' | 'more' | 'left' | 'right' | 'plus' | 'minus' | 'check' | 'info' | 'warning' | 'error' | 'close' | 'copy' | 'home' | 'database' | 'geometry' | 'help' | 'chevronDown' | 'document' | 'reset' | 'upload' | 'download' | 'export';

const artwork: Record<IconName, ReactNode> = {
  open: <><path d="M3 7.5V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2" /><path d="M3 9h18l-2 11H5L3 9Z" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  select: <path d="M4 3v17l4.5-4.5 3.5 5 2.5-1.5-3.5-5L17 12 4 3Z" />,
  pan: <path d="M7 13V7a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v5c0 3-2 6-5.5 6H11c-2 0-3.5-1-4.5-2.5L4 15a1.7 1.7 0 0 1 3-2Z" />,
  annotate: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m14 7 3 3" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  plus: <path d="M5 12h14M12 5v14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m4 12 5 5L20 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
  warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3h.01" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="m8 8 8 8m0-8-8 8" /></>,
  close: <path d="M5 5 19 19M19 5 5 19" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V4H4v12h4" /></>,
  home: <><path d="m3 10 9-7 9 7v10H3V10Z" /><path d="M9 20v-7h6v7" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 2 16 2 16 0V5M4 12c0 2 16 2 16 0" /></>,
  geometry: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1.2 1-1.7 1.5-1.7 3M12 17h.01" /></>,
  chevronDown: <path d="m7 10 5 5 5-5" />,
  document: <><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 12h6M9 16h6" /></>,
  reset: <path d="M4 11a8 8 0 1 1 2 6M4 5v6h6" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  export: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></>
};

export function Icon({ name, size = 16, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{artwork[name]}</svg>;
}
