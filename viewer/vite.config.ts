import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Per-worktree port: DEV_PORT=5314 bun run dev
export default defineConfig({
    plugins: [react()],
    server: { port: Number(process.env.DEV_PORT) || 5313, strictPort: true },
    test: { include: ['tests/**/*.test.ts'] },
});
