import type { CSSProperties } from 'react';

export type ElementKey = 'wall' | 'door' | 'window';
export const pages = [{ number: 1, title: 'First floor plan', subtitle: 'A101 · Architectural' }, { number: 2, title: 'Level 1 details', subtitle: 'A102 · Architectural' }, { number: 3, title: 'Door schedule', subtitle: 'A601 · Schedule' }];
const targets: { key: ElementKey; label: string; x: string; y: string; w: string; h: string }[] = [
  { key: 'wall', label: 'Exterior wall, element 676281', x: '8%', y: '42%', w: '82%', h: '3%' },
  { key: 'door', label: 'Lobby door, element 676315', x: '18%', y: '42%', w: '16%', h: '4%' },
  { key: 'window', label: 'Meeting room window, element 676420', x: '54%', y: '10%', w: '20%', h: '4%' }
];

export function SampleDrawing({ page, selected, onSelect, tool, highlights, markers, onAnnotate }: { page: number; selected: ElementKey | null; onSelect: (key: ElementKey) => void; tool: 'select' | 'pan' | 'annotate'; highlights: boolean; markers: { x: number; y: number }[]; onAnnotate: (x: number, y: number) => void }) {
  const current = pages[page - 1];
  return <article className="drawing-sheet" aria-label={current.title}>
    <header className="sheet-top"><strong>ANKITECTURE <small>STUDIO</small></strong><span>CONSTRUCTION DOCUMENTS / 2025.04</span></header>
    <div className="sheet-grid"><div className="sheet-copy"><span>0{page} / {page === 1 ? 'GROUND LEVEL' : page === 2 ? 'DETAILS' : 'SCHEDULE'}</span><h1>{current.title}<b>.</b></h1><p>Snowdon Towers / Architectural<br />Level 1 · East wing</p><div className="sheet-legend">Existing wall<br />Structural wall</div></div>
      {page === 1 ? <div className={`sheet-plan ${tool === 'annotate' ? 'is-annotating' : ''}`} onClick={event => { if (tool !== 'annotate') return; const rect = event.currentTarget.getBoundingClientRect(); onAnnotate((event.clientX - rect.left) / rect.width * 100, (event.clientY - rect.top) / rect.height * 100); }}>
        <svg viewBox="0 0 560 610" aria-hidden="true"><defs><pattern id="planGrid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#dde1e0" strokeWidth=".5" /></pattern></defs><rect width="560" height="610" fill="url(#planGrid)" /><g fill="none" stroke="#202627" strokeWidth="7"><path d="M62 74h408v462H62zM62 288h408M270 74v214M270 288v248M62 392h208M365 288v248" /></g><g fill="none" stroke="#788280" strokeWidth="1.5"><path d="M128 288v-57a57 57 0 0 0-57 57M270 178h58a58 58 0 0 1-58 58M365 370h-60a60 60 0 0 0 60 60M365 455h55a55 55 0 0 1-55 55" /><path d="M98 74v72M98 146h96M194 74v72M312 74v72M312 146h102M414 74v72" /></g><g fill="#202627" fontFamily="Arial,sans-serif" fontSize="13" textAnchor="middle"><text x="165" y="183">LOBBY</text><text x="366" y="193">MEETING 01</text><text x="165" y="357">CORRIDOR</text><text x="164" y="476">OFFICE 01</text><text x="415" y="365">STAIR 01</text><text x="416" y="478">OFFICE 02</text></g></svg>
        {highlights && tool === 'select' && targets.map(target => <button key={target.key} type="button" className={`geometry-hit ${selected === target.key ? 'is-selected' : ''}`} aria-label={`Select ${target.label}`} style={{ '--x': target.x, '--y': target.y, '--w': target.w, '--h': target.h } as CSSProperties} onClick={event => { event.stopPropagation(); onSelect(target.key); }}>{selected === target.key && <span className="selection-handle" />}</button>)}
        {markers.map((marker, index) => <span key={index} className="annotation-marker" style={{ left: `${marker.x}%`, top: `${marker.y}%` }}>{index + 1}</span>)}
      </div> : page === 2 ? <div className="sheet-alt sheet-detail"><span>WALL SECTION · DETAIL 01</span><div className="detail-block" /><p>200 CONCRETE WALL<br />INSULATION / FINISH</p></div> : <div className="sheet-alt sheet-schedule"><strong>DOOR SCHEDULE / LEVEL 1</strong><table><thead><tr><th>MARK</th><th>TYPE</th><th>WIDTH</th><th>RATING</th></tr></thead><tbody><tr><td>D-101</td><td>Single flush</td><td>900</td><td>1 HR</td></tr><tr><td>D-102</td><td>Double flush</td><td>1600</td><td>2 HR</td></tr><tr><td>D-103</td><td>Single glass</td><td>800</td><td>—</td></tr></tbody></table></div>}
    </div><footer className="sheet-bottom"><span>{current.subtitle.toUpperCase()}</span><span>{page === 3 ? 'NTS' : page === 2 ? '1 : 20' : '1 : 100'}</span><span>0{page} / 03</span></footer>
  </article>;
}
