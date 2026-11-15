export type AgentProvider = 'openai' | 'bedrock';

/** Server-only provider configuration. Never serialize or pass credentials to the browser. */
export interface AgentServerConfig {
    /** Older callers omit provider and continue to use OpenAI. */
    provider?: AgentProvider;
    apiKey: string;
    model: string;
    region?: string;
}

export const agentProvider = (config: AgentServerConfig): AgentProvider => config.provider ?? 'openai';
export const validBedrockRegion = (region: string): boolean => /^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region);

export function agentConfigured(config: AgentServerConfig): boolean {
    return !!config.apiKey.trim() && !!config.model.trim() && config.model.trim().length <= 2048 &&
        (agentProvider(config) !== 'bedrock' || validBedrockRegion(config.region?.trim() ?? ''));
}

/** Explicit selection wins; existing OpenAI setups keep working without a new setting. */
export function resolveAgentConfig(env: Record<string, string | undefined>): AgentServerConfig {
    const selected = env.AGENT_PROVIDER?.trim().toLowerCase();
    if (selected && selected !== 'openai' && selected !== 'bedrock') throw new Error('AGENT_PROVIDER must be openai or bedrock.');
    const provider = selected || (env.AWS_BEARER_TOKEN_BEDROCK?.trim() || env.BEDROCK_MODEL_ID?.trim() ? 'bedrock' : 'openai');
    if (provider === 'bedrock') return {
        provider, apiKey: env.AWS_BEARER_TOKEN_BEDROCK?.trim() ?? '',
        region: env.AWS_REGION?.trim() ?? '', model: env.BEDROCK_MODEL_ID?.trim() ?? '',
    };
    return { provider: 'openai', apiKey: env.OPENAI_API_KEY?.trim() ?? '', model: env.OPENAI_MODEL?.trim() || 'gpt-5.6-terra' };
}
