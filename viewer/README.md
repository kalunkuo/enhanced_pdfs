# Enhanced PDF viewer

React and TypeScript application for viewing and annotating PDFs, including enhanced PDFs with attached Parquet specifications. The viewer reads native PDF geometry for element selection, supports the optional demo geometry table, and can save annotations back to a PDF. See [AGENTS.md](AGENTS.md) for the data and geometry contracts.

```sh
cd viewer
bun install
bun run dev
bun run typecheck
bun run test
```

The development server defaults to <http://localhost:5313/>. The application opens the functional viewer. **Open demo** loads the synthetic enhanced PDF from `public/demo/`; its metadata is illustrative.

The visual system lives in `src/styles/tokens/`, `src/components/ui/`, and `docs/design-system.md`. Reusable controls are exported from `src/components/ui/index.ts`. `src/components/patterns/` contains the viewer compositions that connect those controls to PDF, Parquet, and annotation state. The former design-library test screen has been removed.
