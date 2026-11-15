import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { agentApiPlugin } from './server/agentMiddleware';

// Per-worktree port: DEV_PORT=5314 bun run dev
export default defineConfig(({ mode }) => {
    // OPENAI_* stays in the server config. Only VITE_* may enter client code.
    const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'OPENAI_');
    return {
        plugins: [react(), agentApiPlugin({ apiKey: env.OPENAI_API_KEY ?? '', model: env.OPENAI_MODEL?.trim() || 'gpt-5.6-terra' })],
        server: { port: Number(process.env.DEV_PORT) || 5313, strictPort: true },
        test: { include: ['tests/**/*.test.ts'] },
    };
});
