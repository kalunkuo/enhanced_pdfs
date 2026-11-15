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

/**
 * Environment variable names the selected provider still needs; empty once the provider is configured.
 * Names only, never values: the list goes to the browser so a deployment can see what it lacks.
 */
export function missingAgentSettings(config: AgentServerConfig): string[] {
    const model = config.model.trim();
    const modelOk = !!model && model.length <= 2048;
    if (agentProvider(config) === 'bedrock') {
        return [
            ...(config.apiKey.trim() ? [] : ['AWS_BEARER_TOKEN_BEDROCK']),
            ...(validBedrockRegion(config.region?.trim() ?? '') ? [] : ['AWS_REGION']),
            ...(modelOk ? [] : ['BEDROCK_MODEL_ID']),
        ];
    }
    return [...(config.apiKey.trim() ? [] : ['OPENAI_API_KEY']), ...(modelOk ? [] : ['OPENAI_MODEL'])];
}

export const agentConfigured = (config: AgentServerConfig): boolean => missingAgentSettings(config).length === 0;

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
