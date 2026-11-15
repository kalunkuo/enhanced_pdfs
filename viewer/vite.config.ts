import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { agentApiPlugin } from './server/agentMiddleware';
import { resolveAgentConfig } from './server/agentConfig';

// Per-worktree port: DEV_PORT=5314 bun run dev
export default defineConfig(({ mode }) => {
    // These settings stay in the server config. Only VITE_* may enter client code.
    const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), ['OPENAI_', 'AGENT_PROVIDER', 'AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION', 'BEDROCK_MODEL_ID']);
    return {
        plugins: [react(), agentApiPlugin(resolveAgentConfig(env))],
        server: { port: Number(process.env.DEV_PORT) || 5313, strictPort: true },
        test: { include: ['tests/**/*.test.ts'] },
    };
});
