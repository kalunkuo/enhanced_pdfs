/** Viewer actions selected by the drawing agent and carried out by the host UI. */
export type AgentHostAction =
    | { type: 'select' | 'focus'; elementKeys: string[] }
    | { type: 'add_comment'; text: string; elementKeys: string[] }
    | { type: 'reply_comment'; commentId: string; text: string }
    | { type: 'open_comment'; commentId: string }
    | { type: 'viewer_action'; action: 'clear_selection' | 'fit_page' | 'fit_width' | 'zoom_in' | 'zoom_out' | 'go_to_page' | 'download_pdf'; page: number | null };

export interface AgentHostResult { message: string; id?: string }
export type AgentHostCallback = (action: AgentHostAction) => AgentHostResult | Promise<AgentHostResult>;
