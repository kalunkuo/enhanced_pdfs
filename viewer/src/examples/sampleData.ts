import type { DataColumn, MetadataItem } from '../components/ui';
import type { ElementKey } from '../components/patterns/SampleDrawing';

export type SampleElement = { key: ElementKey; title: string; subtitle: string; id: string; status: 'verified' | 'possible' | 'missing'; properties: MetadataItem[]; specs: { name: string; value: string }[]; source: string };

export const elements: Record<ElementKey, SampleElement> = {
  wall: { key: 'wall', title: 'Exterior wall', subtitle: 'Basic Wall Â· 200mm concrete', id: '676281', status: 'verified', properties: [{ label: 'Category', value: 'Walls' }, { label: 'Drawing', value: 'L1 Â· First floor' }, { label: 'Model', value: 'Snowdon Towers' }, { label: 'Level', value: 'Level 1' }], specs: [{ name: 'Fire Rating', value: '2 HR' }, { name: 'Function', value: 'Exterior' }, { name: 'Width', value: '200 mm' }, { name: 'Structural', value: 'Yes' }], source: 'elements.parquet' },
  door: { key: 'door', title: 'Lobby door', subtitle: 'Single Flush Â· 900 Ã— 2100', id: '676315', status: 'possible', properties: [{ label: 'Category', value: 'Doors' }, { label: 'Drawing', value: 'L1 Â· First floor' }, { label: 'Model', value: 'Snowdon Towers' }, { label: 'Level', value: 'Level 1' }], specs: [{ name: 'Fire Rating', value: '1 HR' }, { name: 'Width', value: '900 mm' }, { name: 'Height', value: '2100 mm' }, { name: 'Mark', value: 'D-101' }], source: 'appearances.parquet' },
  window: { key: 'window', title: 'Meeting room window', subtitle: 'Fixed Window Â· 1800 Ã— 1200', id: '676420', status: 'missing', properties: [{ label: 'Category', value: 'Windows' }, { label: 'Drawing', value: 'L1 Â· First floor' }, { label: 'Model', value: 'Snowdon Towers' }, { label: 'Level', value: 'Level 1' }], specs: [{ name: 'Fire Rating', value: '' }, { name: 'Width', value: '1800 mm' }, { name: 'Height', value: '1200 mm' }, { name: 'Mark', value: 'W-07' }], source: 'No linked record' }
};

export const specColumns: DataColumn<{ name: string; value: string }>[] = [{ key: 'name', label: 'Parameter', render: row => row.name, sortValue: row => row.name }, { key: 'value', label: 'Value', render: row => row.value || 'Unspecified', sortValue: row => row.value }];

