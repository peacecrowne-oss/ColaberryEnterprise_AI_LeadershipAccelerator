import api from '../utils/api';

// AI Agent Dashboard redesign, Checkpoint C (2026-09-02) — first frontend
// caller of the real, already-live GET/POST /api/admin/agents/:id/conversation
// (agentManagerConversationService.ts). Sending a message is a real
// GPT-4o-mini round trip; both turns persist. No per-message cost/model/
// duration/trace fields exist on AgentManagerMessage today — that data only
// lives in ai_events, with no FK back to a specific message row, so the UI
// must not fabricate per-reply technical detail that isn't really there.

export interface ConversationMessage {
  id: string;
  role: 'manager' | 'agent';
  content: string;
  createdAt: string;
}

export interface Conversation {
  conversationId: string;
  agentId: string;
  messages: ConversationMessage[];
  /** Reese manager-directed growth mission, Phase 2 (2026-09-30) — the real case this
   * conversation is currently bound to, or null for a manager-wide conversation. Set only
   * by an explicit "Discuss with Reese" action on a real ticket, never inferred from text. */
  focusedTicketId: string | null;
}

export async function getConversation(agentId: string): Promise<Conversation> {
  const res = await api.get<Conversation>(`/api/admin/agents/${agentId}/conversation`);
  return res.data;
}

// Reese manager-directed growth mission, Phase 2 (2026-09-30) — `ticketId`, when present,
// binds (or explicitly switches) the conversation's focus to that real case; omit it to reuse
// whatever case is already bound (manager-wide questions never need to pass this at all).
export async function sendMessage(agentId: string, message: string, ticketId?: string): Promise<Conversation> {
  const res = await api.post<Conversation>(`/api/admin/agents/${agentId}/conversation/messages`, { message, ticket_id: ticketId });
  return res.data;
}
