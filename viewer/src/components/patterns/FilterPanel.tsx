import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildFilterFields, EMPTY_FILTERS, filterValueLabel, hasActiveFilters, type FilterContext, type FilterState } from '../../lib/filters';
import type { ElementInfo, ParameterInfo } from '../../lib/types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

export interface FilterPanelProps {
    elements: readonly ElementInfo[];
    parameters: ReadonlyMap<string, readonly ParameterInfo[]>;
    value: FilterState;
    onChange: (next: FilterState) => void;
    matchedCount: number;
    locatableCount: number;
    appearanceCount: number;
    context?: FilterContext;
    pageNumber?: number;
    onFitMatches?: () => void;
}

/** The property/value lists are bounded; no control is created for each Parquet row. */
export function FilterPanel({ elements, parameters, value, onChange, matchedCount, locatableCount, appearanceCount, context, pageNumber, onFitMatches }: FilterPanelProps) {
    const fields = useMemo(() => buildFilterFields(elements, parameters, context), [elements, parameters, context]);
    const [fieldId, setFieldId] = useState('category');
    const [valueQuery, setValueQuery] = useState('');
    const field = fields.find((candidate) => candidate.id === fieldId) ?? fields[0];
    const matchingValues = field?.values.filter((option) => option.label.toLocaleLowerCase().includes(valueQuery.trim().toLocaleLowerCase())) ?? [];
    const shownValues = matchingValues.slice(0, 100);
    const active = Object.entries(value.facets).flatMap(([id, values]) => values.map((selected) => {
        const field = fields.find((candidate) => candidate.id === id);
        return { id, selected, label: field?.label ?? 'Property', selectedLabel: field?.values.find((option) => option.value === selected)?.label ?? filterValueLabel(selected) };
    }));

    const toggle = (id: string, selected: string) => {
        const current = value.facets[id] ?? [];
        const next = current.includes(selected) ? current.filter((item) => item !== selected) : [...current, selected];
        const facets = { ...value.facets };
        if (next.length) facets[id] = next;
        else delete facets[id];
        onChange({ ...value, facets });
    };

    const searching = Boolean(value.search || valueQuery);
    const resetSearch = () => {
        setValueQuery('');
        if (value.search) onChange({ ...value, search: '' });
    };
    const [fieldsOpen, setFieldsOpen] = useState(true);
    const fieldsId = useId();

    return (
        <section className="filter-panel" aria-label="BIM filters">
            <input className="search" type="search" aria-label="Search BIM elements and properties" placeholder="Search elements and properties"
                value={value.search} onChange={(event) => onChange({ ...value, search: event.target.value })} />
            <p className="filter-counts" role="status">{matchedCount} matching elements in document · {locatableCount} locatable {pageNumber ? `on page ${pageNumber}` : 'on current page'} · {appearanceCount} appearances {pageNumber ? `on page ${pageNumber}` : 'on current page'}</p>
            <div className="filter-actions">
                {onFitMatches && <Button variant="primary" className="filter-fit" onClick={onFitMatches} disabled={locatableCount === 0}>Fit filtered results</Button>}
                <Button className="filter-clear" disabled={!hasActiveFilters(value)} onClick={() => { onChange(EMPTY_FILTERS); setValueQuery(''); }}>Clear all filters</Button>
                <IconButton icon="reset" label="Reset search" title="Reset search" disabled={!searching} onClick={resetSearch} />
            </div>
            <div className="filter-chips">
                {active.map(({ id, selected, label, selectedLabel }) => (
                    <button className="filter-chip" key={`${id}/${selected}`} aria-label={`Remove ${label}: ${selectedLabel}`}
                        onClick={() => toggle(id, selected)}>{label}: {selectedLabel} ×</button>
                ))}
            </div>
            <div className="filter-fields">
                <button type="button" className="filter-fields-toggle" aria-expanded={fieldsOpen} aria-controls={fieldsId} onClick={() => setFieldsOpen((open) => !open)}>
                    <span>Filter properties</span><Icon className="filter-fields-chevron" name="chevronDown" />
                </button>
                <div id={fieldsId} className={`filter-fields-body ${fieldsOpen ? '' : 'is-collapsed'}`} aria-hidden={!fieldsOpen} inert={!fieldsOpen}>
                    <div>
                        <div className="filter-label">
                            <span id={`${fieldsId}-property`}>Property</span>
                            <PropertyCombobox labelledBy={`${fieldsId}-property`} options={fields} value={field?.id ?? ''}
                                onSelect={(id) => { setFieldId(id); setValueQuery(''); }} />
                        </div>
                        {field && <>
                            <input className="search" type="search" aria-label="Find filter value" placeholder={`Find ${field.label.toLocaleLowerCase()} values`}
                                value={valueQuery} onChange={(event) => setValueQuery(event.target.value)} />
                            <div className="filter-values" role="group" aria-label={`${field.label} values`}>
                                {shownValues.map((option) => {
                                    const pressed = value.facets[field.id]?.includes(option.value) ?? false;
                                    return (
                                        <button type="button" key={option.value} className="filter-option" aria-pressed={pressed}
                                            aria-label={`${field.label}: ${option.label}`} onClick={() => toggle(field.id, option.value)}>
                                            <span className="tick">{pressed && <Icon name="check" />}</span>
                                            <span className="filter-option-label">{option.label}</span><span className="filter-option-count">{option.count}</span>
                                        </button>
                                    );
                                })}
                                {!shownValues.length && <p className="muted">No values match.</p>}
                            </div>
                            {matchingValues.length > shownValues.length && <p className="muted filter-note">Showing {shownValues.length} of {matchingValues.length} values. Refine the search.</p>}
                        </>}
                    </div>
                </div>
            </div>
        </section>
    );
}

type PropertyOption = { id: string; label: string };

const MAX_SHOWN_PROPERTIES = 150;

/**
 * Property picker: a text field that filters a listbox drawn with the flyout-menu tokens (ARIA combobox pattern).
 * Focus stays in the input; arrow keys move the active option, Enter picks it, Escape restores the current property.
 */
function PropertyCombobox({ options, value, onSelect, labelledBy }: { options: readonly PropertyOption[]; value: string; onSelect: (id: string) => void; labelledBy: string }) {
    const [open, setOpen] = useState(false);
    /** null until the user types after opening, so the full list shows first. */
    const [query, setQuery] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(-1);
    const listId = useId();
    const anchorRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const current = options.find((option) => option.id === value);
    const needle = (query ?? '').trim().toLocaleLowerCase();
    const matching = needle ? options.filter((option) => option.label.toLocaleLowerCase().includes(needle)) : options;
    const shown = matching.slice(0, MAX_SHOWN_PROPERTIES);
    const active = open ? shown[activeIndex] : undefined;

    const close = () => { setOpen(false); setQuery(null); setActiveIndex(-1); };
    const openList = () => {
        if (open || !options.length) return;
        const selected = options.findIndex((option) => option.id === value);
        setQuery(null);
        setActiveIndex(selected >= 0 && selected < MAX_SHOWN_PROPERTIES ? selected : 0);
        setOpen(true);
    };
    const commit = (option: PropertyOption) => { onSelect(option.id); close(); };

    useEffect(() => {
        if (!open) return;
        const onPointer = (event: PointerEvent) => { if (!anchorRef.current?.contains(event.target as Node)) close(); };
        document.addEventListener('pointerdown', onPointer);
        return () => document.removeEventListener('pointerdown', onPointer);
    }, [open]);

    useEffect(() => {
        if (open && activeIndex >= 0) listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [open, activeIndex]);

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const move = (delta: number) => {
            event.preventDefault();
            if (!open) { openList(); return; }
            if (shown.length) setActiveIndex((index) => (index + delta + shown.length) % shown.length);
        };
        if (event.key === 'ArrowDown') move(1);
        else if (event.key === 'ArrowUp') move(-1);
        else if (event.key === 'Enter' && active) { event.preventDefault(); commit(active); }
        else if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
        else if (event.key === 'Tab') close();
    };

    return (
        <div className="property-menu" ref={anchorRef}>
            <div className="property-menu-field">
                <input ref={inputRef} className="property-menu-input" type="text" role="combobox" aria-labelledby={labelledBy} aria-autocomplete="list"
                    aria-expanded={open} aria-controls={listId} aria-activedescendant={active ? `${listId}-${activeIndex}` : undefined}
                    placeholder={options.length ? 'Find a property' : 'No properties'} disabled={!options.length} autoComplete="off" spellCheck={false}
                    value={open && query !== null ? query : current?.label ?? ''}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={openList}
                    onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
                    onKeyDown={onKeyDown} />
                <button type="button" className="property-menu-toggle" tabIndex={-1} aria-label={open ? 'Hide properties' : 'Show properties'} disabled={!options.length}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => { inputRef.current?.focus(); if (open) close(); else openList(); }}>
                    <Icon name="chevronDown" />
                </button>
            </div>
            {open && (
                <div id={listId} ref={listRef} className="property-menu-list" role="listbox" aria-labelledby={labelledBy}>
                    {shown.map((option, index) => (
                        <button type="button" key={option.id} id={`${listId}-${index}`} data-index={index} role="option" aria-selected={option.id === value} tabIndex={-1}
                            className={index === activeIndex ? 'is-active' : undefined}
                            style={{ '--menu-row-index': Math.min(index, 10) } as React.CSSProperties}
                            onPointerDown={(event) => event.preventDefault()}
                            onPointerMove={() => setActiveIndex(index)}
                            onClick={() => commit(option)}>
                            <span className="tick">{option.id === value && <Icon name="check" />}</span><span>{option.label}</span>
                        </button>
                    ))}
                    {!shown.length && <p className="property-menu-note">No properties match.</p>}
                    {matching.length > shown.length && <p className="property-menu-note">Showing {shown.length} of {matching.length} properties. Keep typing to narrow.</p>}
                </div>
            )}
        </div>
    );
}
