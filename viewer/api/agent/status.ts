import { createHostedAgentHandler } from '../../server/hostedAgent';

/** Vercel serverless function: GET /api/agent/status reports whether a provider is configured, never its key. */
export const config = { maxDuration: 10 };

export default createHostedAgentHandler();
