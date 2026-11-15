/** Sanitized provider failures are the only upstream errors returned by the HTTP boundary. */
export class AgentProviderError extends Error {
    constructor(message: string, public readonly status: number) {
        super(message);
        this.name = 'AgentProviderError';
    }
}
