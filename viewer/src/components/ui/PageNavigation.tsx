import { IconButton } from './IconButton';

export type Page = { number: number; title: string; subtitle?: string };
export type PageNavigationProps = { page: number; total: number; onPageChange: (page: number) => void; disabled?: boolean };

export function PageNavigation({ page, total, onPageChange, disabled = false }: PageNavigationProps) {
  return <nav className="ui-page-navigation" aria-label="Document pages">
    <IconButton icon="left" label="Previous page" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)} />
    <output aria-live="polite" aria-atomic="true">{total > 0 ? <>{page} <span>/ {total}</span></> : 'No pages'}</output>
    <IconButton icon="right" label="Next page" disabled={disabled || page >= total} onClick={() => onPageChange(page + 1)} />
  </nav>;
}

export function PageList({ pages, current, onPageChange, filter = '' }: { pages: Page[]; current: number; onPageChange: (page: number) => void; filter?: string }) {
  const visible = pages.filter(page => `${page.number} ${page.title} ${page.subtitle || ''}`.toLowerCase().includes(filter.toLowerCase()));
  return <nav className="ui-page-list" aria-label="Page list">{visible.length ? visible.map(page => <button key={page.number} type="button" className={`ui-page-card ${page.number === current ? 'is-active' : ''}`} aria-current={page.number === current ? 'page' : undefined} onClick={() => onPageChange(page.number)}><span className="ui-page-thumbnail" aria-hidden="true"><span /></span><span><strong>{String(page.number).padStart(2, '0')} <em>{page.title}</em></strong><small>{page.subtitle}</small></span></button>) : <p className="ui-page-list-empty">No matching pages.</p>}</nav>;
}
