import type { ReactNode } from 'react';

export type MetadataItem = { label: string; value?: ReactNode; key?: string };
export function MetadataRows({ items, provisional = false, emptyLabel = 'Unspecified' }: { items: MetadataItem[]; provisional?: boolean; emptyLabel?: string }) {
  return <dl className={`ui-metadata-rows ${provisional ? 'is-provisional' : ''}`} aria-label={provisional ? 'Provisional metadata' : undefined}>{items.map(item => <div className="ui-metadata-row" key={item.key || item.label}><dt>{item.label}</dt><dd>{item.value === null || item.value === undefined || item.value === '' ? emptyLabel : item.value}</dd></div>)}</dl>;
}
