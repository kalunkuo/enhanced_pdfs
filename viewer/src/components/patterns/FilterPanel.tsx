import { useMemo, useState } from 'react';
import { buildFilterFields, EMPTY_FILTERS, filterValueLabel, hasActiveFilters, type FilterState } from '../../lib/filters';
import type { ElementInfo, ParameterInfo } from '../../lib/types';

export interface FilterPanelProps {
    elements: readonly ElementInfo[];
    parameters: ReadonlyMap<string, readonly ParameterInfo[]>;
    value: FilterState;
    onChange: (next: FilterState) => void;
    matchedCount: number;
    locatableCount: number;
    appearanceCount: number;
}

/** The property/value lists are bounded; no control is created for each Parquet row. */
export function FilterPanel({ elements, parameters, value, onChange, matchedCount, locatableCount, appearanceCount }: FilterPanelProps) {
    const fields = useMemo(() => buildFilterFields(elements, parameters), [elements, parameters]);
    const [fieldId, setFieldId] = useState('category');
    const [propertyQuery, setPropertyQuery] = useState('');
    const [valueQuery, setValueQuery] = useState('');
    const matchingFields = fields.filter((field) => field.label.toLocaleLowerCase().includes(propertyQuery.trim().toLocaleLowerCase()));
    const shownFields = matchingFields.slice(0, 150);
    const field = shownFields.find((candidate) => candidate.id === fieldId) ?? shownFields[0];
    const matchingValues = field?.values.filter((option) => option.label.toLocaleLowerCase().includes(valueQuery.trim().toLocaleLowerCase())) ?? [];
    const shownValues = matchingValues.slice(0, 100);
    const active = Object.entries(value.facets).flatMap(([id, values]) => values.map((selected) => ({ id, selected, label: fields.find((candidate) => candidate.id === id)?.label ?? 'Property' })));

    const toggle = (id: string, selected: string) => {
        const current = value.facets[id] ?? [];
        const next = current.includes(selected) ? current.filter((item) => item !== selected) : [...current, selected];
        const facets = { ...value.facets };
        if (next.length) facets[id] = next;
        else delete facets[id];
        onChange({ ...value, facets });
    };

    return (
        <section className="filter-panel" aria-label="BIM filters">
            <input className="search" type="search" aria-label="Search BIM elements and properties" placeholder="Search elements and properties"
                value={value.search} onChange={(event) => onChange({ ...value, search: event.target.value })} />
            <p className="filter-counts" role="status">{matchedCount} matching elements · {locatableCount} locatable · {appearanceCount} appearances</p>
            <div className="filter-chips">
                {active.map(({ id, selected, label }) => (
                    <button className="filter-chip" key={`${id}/${selected}`} aria-label={`Remove ${label}: ${filterValueLabel(selected)}`}
                        onClick={() => toggle(id, selected)}>{label}: {filterValueLabel(selected)} ×</button>
                ))}
                {hasActiveFilters(value) && <button className="filter-clear" onClick={() => { onChange(EMPTY_FILTERS); setValueQuery(''); }}>Clear all filters</button>}
            </div>
            <details className="filter-fields" open>
                <summary>Filter properties</summary>
                <input className="search" type="search" aria-label="Find filter property" placeholder="Find a property"
                    value={propertyQuery} onChange={(event) => { setPropertyQuery(event.target.value); setValueQuery(''); }} />
                <label className="filter-label">Property
                    <select aria-label="Filter property" value={field?.id ?? ''} onChange={(event) => { setFieldId(event.target.value); setValueQuery(''); }}>
                        {!shownFields.length && <option value="">No properties match</option>}
                        {shownFields.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                </label>
                {matchingFields.length > shownFields.length && <p className="muted">Showing {shownFields.length} of {matchingFields.length} properties. Refine the search.</p>}
                {field && <>
                    <input className="search" type="search" aria-label="Find filter value" placeholder={`Find ${field.label.toLocaleLowerCase()} values`}
                        value={valueQuery} onChange={(event) => setValueQuery(event.target.value)} />
                    <div className="filter-values" role="group" aria-label={`${field.label} values`}>
                        {shownValues.map((option) => (
                            <label key={option.value} className="filter-option">
                                <input type="checkbox" aria-label={`${field.label}: ${option.label}`} checked={value.facets[field.id]?.includes(option.value) ?? false}
                                    onChange={() => toggle(field.id, option.value)} />
                                <span>{option.label}</span><span className="muted">{option.count}</span>
                            </label>
                        ))}
                        {!shownValues.length && <p className="muted">No values match.</p>}
                    </div>
                    {matchingValues.length > shownValues.length && <p className="muted">Showing {shownValues.length} of {matchingValues.length} values. Refine the search.</p>}
                </>}
            </details>
        </section>
    );
}
