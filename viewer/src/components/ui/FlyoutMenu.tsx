import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';

export type FlyoutItem = { id: string; label: string; icon?: IconName; onSelect: () => void; separatorBefore?: boolean; disabled?: boolean };
export type FlyoutMenuProps = { label: string; items: FlyoutItem[]; icon?: IconName; align?: 'start' | 'end' };
type Phase = 'closed' | 'opening' | 'open' | 'closing';

function duration(token: string) { return matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || 0; }

export function FlyoutMenu({ label, items, icon = 'more', align = 'end' }: FlyoutMenuProps) {
  const [phase, setPhase] = useState<Phase>('closed');
  const menuId = useId();
  const [interactive, setInteractive] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const frame = useRef<number | null>(null);
  const mounted = phase !== 'closed';

  function clearScheduled() { timers.current.forEach(clearTimeout); timers.current = []; if (frame.current !== null) cancelAnimationFrame(frame.current); }
  function close(restoreFocus = false) {
    if (phase === 'closed' || phase === 'closing') return;
    clearScheduled(); setInteractive(false); setPhase('closing');
    if (restoreFocus) triggerRef.current?.focus();
    timers.current.push(window.setTimeout(() => setPhase('closed'), duration('--menu-exit-duration')));
  }
  function open() { clearScheduled(); setInteractive(false); setPhase('opening'); }

  useLayoutEffect(() => {
    if (phase !== 'opening' || !menuRef.current || !triggerRef.current) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    const x = trigger.offsetLeft + trigger.offsetWidth / 2 - menu.offsetLeft;
    const y = trigger.offsetTop + trigger.offsetHeight / 2 - menu.offsetTop;
    menu.style.setProperty('--flyout-origin-x', `${x}px`);
    menu.style.setProperty('--flyout-origin-y', `${y}px`);
    menu.getBoundingClientRect();
    frame.current = requestAnimationFrame(() => setPhase('open'));
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    const revealTimer = window.setTimeout(() => {
      setInteractive(true);
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }, duration('--menu-options-transition-duration'));
    timers.current.push(revealTimer);
    return () => window.clearTimeout(revealTimer);
  }, [phase]);

  useEffect(() => {
    if (!mounted) return;
    const onPointer = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [mounted, phase]);

  useEffect(() => () => clearScheduled(), []);
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); controls[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); controls.at(-1)?.focus(); }
  }

  return <span className={`ui-flyout-anchor ui-flyout-anchor--${align}`}>
    <IconButton ref={triggerRef} icon={icon} label={label} aria-haspopup="menu" aria-controls={mounted ? menuId : undefined} aria-expanded={phase === 'opening' || phase === 'open'} onClick={() => phase === 'open' || phase === 'opening' ? close(true) : open()} />
    {mounted && <div id={menuId} ref={menuRef} className="ui-flyout" role="menu" aria-label={label} aria-hidden={phase === 'closing'} data-state={phase} data-interactive={interactive} onKeyDown={onKeyDown}>
      <div className="ui-flyout-items">{items.map((item, index) => <div key={item.id} className="ui-flyout-row" style={{ '--row-index': index } as React.CSSProperties}>{item.separatorBefore && <div className="ui-flyout-separator" role="separator" />}<button type="button" role="menuitem" disabled={item.disabled} tabIndex={interactive ? 0 : -1} onClick={() => { close(true); item.onSelect(); }}>{item.icon && <Icon name={item.icon} />}<span>{item.label}</span></button></div>)}</div>
    </div>}
  </span>;
}
