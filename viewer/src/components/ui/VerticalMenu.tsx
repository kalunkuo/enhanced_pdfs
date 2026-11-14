import { useId, useState } from 'react';
import { Icon, type IconName } from './Icon';

export type VerticalMenuItem = { id: string; label: string; icon: IconName; children?: VerticalMenuItem[] };
export function VerticalMenu({ label = 'Main menu', items, selected, onSelect, footer }: { label?: string; items: VerticalMenuItem[]; selected: string; onSelect: (id: string) => void; footer?: VerticalMenuItem }) {
  const [expanded, setExpanded] = useState<string[]>(items.filter(item => item.children?.some(child => child.id === selected)).map(item => item.id));
  const instanceId = useId();
  function toggle(id: string) { setExpanded(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); }
  function row(item: VerticalMenuItem, child = false) { return <button key={item.id} type="button" className={`ui-vertical-menu-item ${child ? 'is-child' : ''} ${selected === item.id ? 'is-active' : ''}`} aria-current={selected === item.id ? 'page' : undefined} aria-expanded={item.children ? expanded.includes(item.id) : undefined} aria-controls={item.children ? `${instanceId}-${item.id}` : undefined} onClick={() => item.children ? toggle(item.id) : onSelect(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{item.children && <Icon className="ui-vertical-menu-chevron" name="chevronDown" />}</button>; }
  return <nav className="ui-vertical-menu" aria-label={label}><span className="ui-vertical-menu-caption">{label}</span>{items.map(item => <div key={item.id}>{row(item)}{item.children && <div id={`${instanceId}-${item.id}`} className={`ui-vertical-menu-children ${expanded.includes(item.id) ? '' : 'is-collapsed'}`} aria-hidden={!expanded.includes(item.id)} inert={!expanded.includes(item.id)}><div>{item.children.map(child => row(child, true))}</div></div>}</div>)}{footer && <div className="ui-vertical-menu-footer">{row(footer)}</div>}</nav>;
}
