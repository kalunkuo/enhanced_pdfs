import type { ReactNode } from 'react';

/** `key` is required when `label` is not a string. */
export type MetadataItem = { label: ReactNode; value?: ReactNode; key?: string };
export function MetadataRows({ items, provisional = false, emptyLabel = 'Unspecified' }: { items: MetadataItem[]; provisional?: boolean; emptyLabel?: string }) {
  return <dl className={`ui-metadata-rows ${provisional ? 'is-provisional' : ''}`} aria-label={provisional ? 'Provisional metadata' : undefined}>{items.map(item => <div className="ui-metadata-row" key={item.key ?? String(item.label)}><dt>{item.label}</dt><dd>{item.value === null || item.value === undefined || item.value === '' ? emptyLabel : item.value}</dd></div>)}</dl>;
}
