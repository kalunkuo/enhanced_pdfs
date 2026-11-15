import type { AgentApiRequest, AgentApiResponse } from '../src/lib/agentApi';
import { agentProvider, type AgentServerConfig } from './agentConfig';
import { planBedrockAgentRequest } from './bedrockAgent';
import { planAgentRequest as planOpenAiRequest } from './openaiAgent';

/** The same bounded action plan reaches the browser regardless of the server's provider. */
export function planAgentRequest(request: AgentApiRequest, config: AgentServerConfig, options: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<AgentApiResponse> {
    return agentProvider(config) === 'bedrock' ? planBedrockAgentRequest(request, config, options) : planOpenAiRequest(request, config, options);
}
