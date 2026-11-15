import { createHostedAgentHandler } from '../server/hostedAgent.ts';

/**
 * Vercel serverless function: POST /api/agent, the same drawing agent the local Vite server runs.
 * Provider settings come from the project's environment variables (README, "Hosted agent API").
 */
export const config = { maxDuration: 60 };

export default createHostedAgentHandler();
