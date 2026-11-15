import { useState, type ReactNode } from 'react';

export type DataColumn<Row> = {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
  sortValue?: (row: Row) => string | number;
  align?: 'left' | 'right';
};

export type DataTableProps<Row> = {
  caption: string;
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  emptyMessage?: string;
  compact?: boolean;
};

export function DataTable<Row>({ caption, columns, rows, rowKey, loading = false, emptyMessage = 'No records available.', compact = false }: DataTableProps<Row>) {
  const [sort, setSort] = useState<{ key: string; direction: 'ascending' | 'descending' } | null>(null);
  const sortColumn = columns.find(column => column.key === sort?.key);
  const visibleRows = [...rows];
  if (sort && sortColumn?.sortValue) visibleRows.sort((a, b) => {
    const first = sortColumn.sortValue!(a);
    const second = sortColumn.sortValue!(b);
    const order = typeof first === 'number' && typeof second === 'number' ? first - second : String(first).localeCompare(String(second), undefined, { numeric: true });
    return sort.direction === 'ascending' ? order : -order;
  });
  function toggleSort(key: string) { setSort(current => current?.key === key ? { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' } : { key, direction: 'ascending' }); }

  return <div className="ui-table-scroll" tabIndex={0} role="region" aria-label={`${caption} table`}>
    <table className={`ui-data-table ${compact ? 'ui-data-table--compact' : ''}`}>
      <caption>{caption}</caption>
      <thead><tr>{columns.map(column => <th key={column.key} scope="col" aria-sort={sort?.key === column.key ? sort.direction : undefined} className={column.align === 'right' ? 'is-right' : ''}>{column.sortValue ? <button type="button" className="ui-sort-button" onClick={() => toggleSort(column.key)}>{column.label}<span aria-hidden="true">↕</span></button> : column.label}</th>)}</tr></thead>
      <tbody>{loading || !visibleRows.length ? <tr><td colSpan={columns.length} className="ui-table-empty">{loading ? 'Loading records…' : emptyMessage}</td></tr> : visibleRows.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.key} className={column.align === 'right' ? 'is-right' : ''}>{column.render(row)}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}
