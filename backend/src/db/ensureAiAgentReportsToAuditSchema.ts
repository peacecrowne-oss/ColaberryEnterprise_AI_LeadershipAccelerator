import { sequelize } from '../config/database';

// Reports-to editor (2026-09-30): Dhee, on the Agent Detail dashboard: "I should be able to
// change who Reese reports to. The functionality already exists - it's just not on this
// dashboard." Verified that belief was wrong — no real, HTTP-reachable mechanism to change
// `reports_to_type`/`reports_to_id` existed anywhere; only boot-time self-heal and disposable
// one-off scripts ever wrote those columns. Additive-only, idempotent, following
// ensureAiAgentAbacOverrideSchema.ts's exact shape: one statement per line, individually
// try/caught so a partial DB self-heals on the next boot, never alters or drops any existing
// column/table/constraint.
//
// `reports_to_set_at` / `reports_to_set_by` — null until an admin deliberately changes who an
// agent reports to through the real route (agentReportsToService.ts). Distinguishes "an
// operator chose this" from "this chain was only ever set by boot-time seed logic" — the same
// audit-trail pattern `abac_mode_override_set_at`/`_set_by` established for the one other
// governance-field write this repo already has, applied here for parity: a misconfigured
// reports-to chain can silently break the agent's own ticket creation
// (`enforceReportsToGate()`), so this write deserves the same real audit trail, not the
// sparser `autonomy_level_set_at`-only precedent.
export const AI_AGENT_REPORTS_TO_AUDIT_STATEMENTS: string[] = [
  `ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS reports_to_set_at TIMESTAMP`,
  `ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS reports_to_set_by VARCHAR(255)`,
];

export async function ensureAiAgentReportsToAuditSchema(): Promise<void> {
  for (const sql of AI_AGENT_REPORTS_TO_AUDIT_STATEMENTS) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] ai-agent reports_to audit schema stmt skipped:', err?.message);
    }
  }
  console.log('[DB] AiAgent reports_to audit schema ensured');
}
