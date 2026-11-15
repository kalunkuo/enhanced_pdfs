/** Sanitized provider failures are the only upstream errors returned by the HTTP boundary. */
export class AgentProviderError extends Error {
    public readonly status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = 'AgentProviderError';
    }
}
