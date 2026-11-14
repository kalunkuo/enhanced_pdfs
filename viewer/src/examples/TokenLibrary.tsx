import { useEffect, useMemo, useState } from 'react';
import { Panel } from '../components/ui';
import primitiveSource from '../styles/tokens/primitives.css?raw';
import semanticSource from '../styles/tokens/semantic.css?raw';
import componentSource from '../styles/tokens/components.css?raw';

type Tier = 'primitive' | 'semantic' | 'component';
type Token = { name: string; definition: string; tier: Tier };

function parseTokens(source: string, tier: Tier): Token[] {
  return [...source.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(([, name, definition]) => ({ name, definition: definition.trim(), tier }));
}

const tokens = [
  ...parseTokens(primitiveSource, 'primitive'),
  ...parseTokens(semanticSource, 'semantic'),
  ...parseTokens(componentSource, 'component')
];

const tierLabels: Record<Tier, string> = { primitive: 'Primitive', semantic: 'Semantic', component: 'Component' };
const palette = [
  { name: 'Canvas', token: '--color-canvas', dark: true },
  { name: 'Surface', token: '--color-surface', dark: true },
  { name: 'Raised', token: '--color-surface-raised', dark: true },
  { name: 'Text', token: '--color-text', dark: false },
  { name: 'Primary', token: '--color-primary', dark: false },
  { name: 'Secondary', token: '--color-secondary', dark: false },
  { name: 'Pink', token: '--color-tertiary-pink', dark: false },
  { name: 'Green', token: '--color-tertiary-green', dark: false },
  { name: 'Yellow', token: '--color-tertiary-yellow', dark: false }
];
const spacing = [1, 2, 3, 4, 6, 8];

function isColorToken(name: string) {
  return /color|background|foreground|accent|placeholder|focus-ring/.test(name) || /-border$/.test(name);
}

export function TokenLibrary() {
  const [tier, setTier] = useState<Tier>('primitive');
  const [query, setQuery] = useState('');
  const [resolved, setResolved] = useState<Record<string, string>>({});

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    setResolved(Object.fromEntries(tokens.map(token => [token.name, styles.getPropertyValue(token.name).trim()])));
  }, []);

  const visible = useMemo(() => tokens.filter(token => token.tier === tier && `${token.name} ${token.definition}`.toLowerCase().includes(query.trim().toLowerCase())), [tier, query]);

  return <section className="token-library" id="tokens" aria-labelledby="token-library-title">
    <div className="library-section-heading"><span className="ui-eyebrow">FOUNDATIONS</span><h2 id="token-library-title" className="type-h1">Design tokens</h2><p>Primitive values feed semantic roles, which feed component rules. The inventory below reads directly from the three token files.</p></div>
    <div className="token-specimens">
      <Panel className="gallery-card token-specimen" title="Palette" eyebrow="COLOR"><div className="gallery-content"><div className="token-palette">{palette.map(item => <div key={item.token} className="token-palette-item"><span className={`token-palette-swatch ${item.dark ? 'is-dark' : ''}`} style={{ background: `var(${item.token})` }} /><strong>{item.name}</strong><code>{item.token}</code><small>{resolved[item.token]}</small></div>)}</div></div></Panel>
      <Panel className="gallery-card token-specimen" title="Type scale" eyebrow="MANROPE"><div className="gallery-content gallery-type-specimen"><div className="type-title">Title / 36</div><div className="type-h1">Heading 1 / 28</div><div className="type-h2">Heading 2 / 24</div><div className="type-h3">Heading 3 / 18</div><p className="type-paragraph">Paragraph / 14 · A compact, readable foundation for document tools.</p><span className="token-label-sample">Label / 13</span><span className="token-caption-sample">Caption / 11</span></div></Panel>
      <Panel className="gallery-card token-specimen" title="Space and shape" eyebrow="MEASUREMENTS"><div className="gallery-content"><div className="token-space-list">{spacing.map(step => <div key={step} className="token-space-row"><code>space-{step}</code><span className="token-space-track"><span style={{ width: `var(--primitive-space-${step})` }} /></span><strong>{resolved[`--primitive-space-${step}`]}</strong></div>)}</div><div className="token-shape-row"><span className="token-radius-sample" /><span>Control radius <strong>{resolved['--radius-control']}</strong></span><span className="token-icon-sample" /><span>Icon button <strong>{resolved['--button-icon-size']}</strong></span></div></div></Panel>
      <Panel className="gallery-card token-specimen" title="Motion" eyebrow="TIMING"><div className="gallery-content"><div className="token-motion-list"><div><span className="token-motion-sample" />Button state <strong>{resolved['--duration-interaction']}</strong></div><div><span className="token-motion-sample token-motion-sample--menu" />Menu exit <strong>{resolved['--duration-menu-exit']}</strong></div><div><span className="token-motion-sample token-motion-sample--reveal" />Content reveal <strong>{resolved['--duration-content-reveal']}</strong></div></div><p className="gallery-note">Hover the bars to inspect timing. Menu rows stagger by {resolved['--duration-menu-stagger']}.</p></div></Panel>
    </div>
    <Panel className="gallery-card token-inventory" title="Token inventory" eyebrow="SOURCE OF TRUTH"><div className="gallery-content"><div className="token-inventory-controls"><div className="token-tabs" role="group" aria-label="Token tier">{(['primitive', 'semantic', 'component'] as const).map(item => <button key={item} type="button" className={tier === item ? 'is-active' : ''} aria-pressed={tier === item} onClick={() => { setTier(item); setQuery(''); }}>{tierLabels[item]} <span>{tokens.filter(token => token.tier === item).length}</span></button>)}</div><label className="token-search">Find in {tierLabels[tier].toLowerCase()} tokens<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Color, radius, menu…" /></label></div><div className="token-table-wrap" tabIndex={0} role="region" aria-label={`${tierLabels[tier]} token table`}><table className="token-table"><caption>{tierLabels[tier]} tokens</caption><thead><tr><th scope="col">Token</th><th scope="col">Live value</th><th scope="col">Definition</th></tr></thead><tbody>{visible.length ? visible.map(token => <tr key={token.name}><th scope="row"><code>{token.name}</code></th><td><span className="token-live-value">{isColorToken(token.name) && <span className="token-value-swatch" style={{ background: `var(${token.name})` }} />}{resolved[token.name] || token.definition}</span></td><td><code>{token.definition}</code></td></tr>) : <tr><td colSpan={3} className="token-empty">No tokens match this search.</td></tr>}</tbody></table></div></div></Panel>
  </section>;
}
