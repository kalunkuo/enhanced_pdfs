import { describe, expect, it } from 'vitest';
import { agentConfigured, resolveAgentConfig, missingAgentSettings } from '../server/agentConfig';

describe('server agent provider selection', () => {
    it('preserves existing OpenAI configuration and its default model', () => {
        expect(resolveAgentConfig({ OPENAI_API_KEY: ' test-openai ', OPENAI_MODEL: ' chosen-model ' })).toEqual({ provider: 'openai', apiKey: 'test-openai', model: 'chosen-model' });
        expect(resolveAgentConfig({ OPENAI_API_KEY: 'test-openai' }).model).toBe('gpt-5.6-terra');
    });

    it('selects Bedrock from its settings without falling back to an OpenAI key', () => {
        const env = { AWS_BEARER_TOKEN_BEDROCK: ' test-bedrock ', AWS_REGION: ' us-east-1 ', BEDROCK_MODEL_ID: ' us.anthropic.claude-opus-5-5 ', OPENAI_API_KEY: 'other-key' };
        expect(resolveAgentConfig(env)).toEqual({ provider: 'bedrock', apiKey: 'test-bedrock', region: 'us-east-1', model: 'us.anthropic.claude-opus-5-5' });
        expect(resolveAgentConfig({ ...env, AGENT_PROVIDER: 'openai' }).apiKey).toBe('other-key');
        expect(resolveAgentConfig({ AGENT_PROVIDER: 'bedrock', OPENAI_API_KEY: 'other-key' })).toEqual({ provider: 'bedrock', apiKey: '', region: '', model: '' });
        expect(resolveAgentConfig({ BEDROCK_MODEL_ID: 'selected-later', OPENAI_API_KEY: 'other-key' }).provider).toBe('bedrock');
        expect(resolveAgentConfig({ AWS_REGION: 'us-east-1', OPENAI_API_KEY: 'test-openai' }).provider).toBe('openai');
    });

    it('requires complete regional Bedrock config and rejects endpoint injection', () => {
        const config = { provider: 'bedrock' as const, apiKey: 'test-bedrock', region: 'us-east-1', model: 'selected-model' };
        expect(agentConfigured(config)).toBe(true);
        for (const patch of [{ apiKey: '' }, { model: '' }, { region: '' }, { region: 'us-east-1.example.com' }, { region: 'us-east-1/redirect' }]) {
            expect(agentConfigured({ ...config, ...patch })).toBe(false);
        }
        expect(agentConfigured({ apiKey: 'old-openai-key', model: 'old-model' })).toBe(true);
    });

    it('reports an unsupported provider without echoing environment values', () => {
        expect(() => resolveAgentConfig({ AGENT_PROVIDER: 'bad-private-provider' })).toThrow('AGENT_PROVIDER must be openai or bedrock.');
    });
});

describe('missing agent settings', () => {
    it('names the environment variables a provider still needs, never their values', () => {
        expect(missingAgentSettings({ provider: 'bedrock', apiKey: '', region: 'eu', model: '' })).toEqual(['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION', 'BEDROCK_MODEL_ID']);
        expect(missingAgentSettings({ provider: 'bedrock', apiKey: 'private-token', region: 'us-east-1', model: '' })).toEqual(['BEDROCK_MODEL_ID']);
        expect(missingAgentSettings({ provider: 'bedrock', apiKey: 'private-token', region: 'us-east-1', model: 'us.anthropic.claude-opus-5-5' })).toEqual([]);
        expect(missingAgentSettings({ apiKey: '', model: 'gpt' })).toEqual(['OPENAI_API_KEY']);
        expect(missingAgentSettings({ provider: 'openai', apiKey: 'sk-private', model: ' ' })).toEqual(['OPENAI_MODEL']);
        expect(JSON.stringify(missingAgentSettings({ provider: 'bedrock', apiKey: 'private-token', region: '', model: '' }))).not.toContain('private');
    });
});
