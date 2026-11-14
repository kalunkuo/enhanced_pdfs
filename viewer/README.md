# Enhanced PDF design library

This React and TypeScript library displays the design tokens and reusable viewer components together. The viewer demo is a secondary context example.

```powershell
cd viewer
npm.cmd install
npm.cmd run dev -- --port 8765
```

Open <http://localhost:8765/>. The design library opens first: inspect the palette, type, spacing, shape, motion, searchable token inventory, and component specimens on one page. Use **Open viewer demo** only if you want to see controls in context. Run `npm.cmd run build` to type-check and build the production bundle.

Reusable controls live in `src/components/ui/` and are exported from `src/components/ui/index.ts`. `src/examples/TokenLibrary.tsx` reads the three token tiers; `src/examples/ComponentGallery.tsx` displays the components. See `AGENTS.md` and `docs/component-standards/` before adding a component.

The drawing and metadata are illustrative. Opening a local PDF previews it in the browser. The prototype does not parse Parquet attachments, map real PDF geometry, or write changes to a PDF. Comments last for the current browser session.
