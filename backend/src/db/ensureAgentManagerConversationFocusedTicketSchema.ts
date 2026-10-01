import { sequelize } from '../config/database';

// Reese manager-directed growth mission, Phase 2 (2026-09-30) — the real root cause behind
// "Discuss with Reese on a specific case" producing "I cannot access the conversation
// details": the ticket's own id was discarded before it ever reached the backend (see
// request.md/execution-contract.md for the full, re-verified trace). This column is the
// durable half of the fix — which real case a conversation is currently focused on, so
// follow-up questions ("why?", "when?") keep using the same case without re-supplying it.
//
// Additive only: one new nullable column on the existing agent_manager_conversations table,
// following ensureAgentManagerConversationIntentSchema.ts's exact template (ALTER TABLE ...
// ADD COLUMN IF NOT EXISTS, individually try/caught, self-heals on next boot). Never alters
// or drops any existing column/table/constraint, never touches
// pending_reliability_confirmation or pending_intent_confirmation.
//
// `focused_ticket_id` — null means "this conversation has no bound case" (the existing,
// unchanged, manager-wide-question behavior). Non-null means a manager explicitly chose to
// discuss that specific ticket (via "Discuss with Reese" on a case, never inferred from free
// text alone) — switching to a different case is itself an explicit action that overwrites
// this value, never a silent side effect of mentioning a different ticket number in passing.
export const AGENT_MANAGER_CONVERSATION_FOCUSED_TICKET_STATEMENTS: string[] = [
  `ALTER TABLE agent_manager_conversations ADD COLUMN IF NOT EXISTS focused_ticket_id UUID`,
];

export async function ensureAgentManagerConversationFocusedTicketSchema(): Promise<void> {
  for (const sql of AGENT_MANAGER_CONVERSATION_FOCUSED_TICKET_STATEMENTS) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] agent-manager-conversation focused-ticket schema stmt skipped:', err?.message);
    }
  }
  console.log('[DB] Agent manager conversation focused-ticket schema ensured');
}
