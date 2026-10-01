import api from '../utils/api';

// Agent Detail — the transparency page: real identity, real system prompt, real
// tools, live status, real ticket activity for one AiAgent (backend:
// GET /api/admin/agents/:id). Generic by design — works for any agent id, not
// hardcoded to Reese.

export interface AgentDetailIdentity {
  admin_user_id: string;
  email: string;
  display_name: string | null;
  is_ai_operated: boolean;
}

/** R9 — the real most-recent ticket a behaviour or scheduled task produced
 * or closed, Reese-only (`null` for every other agent). See
 * reeseBehaviourLastTicket.ts's header for exactly which real ticket type
 * backs each behaviour. */
export interface AgentDetailLastTicketRef {
  id: string;
  ticket_number: number | null;
  title: string;
  at: string;
}

/** Dashboard redesign, Slice 2a (2026-09-19) — the Work tab's honest status
 * filter, derived server-side from real fields (status/due_date/latest-
 * activity-actor), no schema change. See backend's ticketStatusBucket.ts
 * for the exact derivation and precedence order. */
export type AgentDetailTicketStatusBucket = 'overdue' | 'ready_to_verify' | 'needs_reply' | 'open';

export interface AgentDetailTicket {
  id: string;
  ticket_number: number | null;
  title: string;
  /** Task visibility (2026-08-26) — the real narrative already written at
   * ticket-creation time (e.g. "Signal: inactivity. Goal: ..."), verbatim.
   * Answers "what was this looking for, why did it fire" without any new
   * parsing — whatever the creating code actually wrote. */
  description: string | null;
  status: string;
  priority: string;
  type: string;
  created_at: string | null;
  updated_at: string | null;
  /** Dashboard redesign, Slice 2a — real column, previously fetched but
   * never surfaced in this response. */
  due_date: string | null;
  /** `null` for a terminal ticket (done/cancelled) — none of the 4 real
   * buckets honestly fits a closed ticket; the Work tab excludes these
   * from its action-focused view rather than mislabeling them. */
  status_bucket: AgentDetailTicketStatusBucket | null;
}

/** Task visibility (2026-08-26) — Ali, live, on Reese's real page: "which
 * tickets each [task] creates, so I can see which task is creating the
 * most tickets." Real tickets grouped by `type`, sub-grouped by real
 * `metadata.signal_type` only where it's actually present. */
export interface AgentDetailTicketTypeBreakdown {
  type: string;
  count: number;
  by_signal: Array<{ signal_type: string; count: number }>;
}

/** Task visibility (2026-08-26) — Ali, live: "I need to see what those
 * [tasks] are... what triggers them... I should be able to see that."
 * Sibling `AiAgent` rows sharing this agent's real `module` — its own
 * separately-registered recurring jobs (e.g. Reese's autonomous-outreach
 * sweep), never visible on this page before. */
export interface AgentDetailRelatedTask {
  id: string;
  agent_name: string;
  description: string | null;
  trigger_type: string | null;
  schedule: string | null;
  enabled: boolean;
  status: string;
  last_run_at: string | null;
  run_count: number;
  error_count: number;
  /** R9 — Reese-only; `null` for every other agent and for a cron behaviour
   * that has never produced a ticket. */
  last_ticket: AgentDetailLastTicketRef | null;
}

/** AI Employee Consolidation Program (2026-09-15/16) — "Capabilities &
 * Automations": the real legacy behaviors/tools this employee OWNS via the
 * program's real parent_agent_id ownership column, distinct from
 * AgentDetailRelatedTask's same-module inference above. */
export interface AgentDetailOwnedBehavior {
  id: string;
  agent_name: string;
  record_kind: 'employee' | 'behavior' | 'tool' | null;
  description: string | null;
  trigger_type: string | null;
  schedule: string | null;
  enabled: boolean;
  migration_status: 'legacy' | 'absorbed' | 'archived' | null;
}

/** One tool's own reads/produces, so the UI can show a per-tool drill-down
 * instead of only the flattened union below. */
export interface AgentDetailToolCapability {
  tool: string;
  reads: string[];
  produces: string[];
  documented: boolean;
}

/** What this agent reads / produces — derived from its real, live tools_granted
 * (+ real, live observed ticket types it creates), never hand-written free text.
 * See backend/src/services/reese/agentToolCapabilities.ts. */
export interface AgentDetailCapabilities {
  reads: string[];
  produces: string[];
  undocumented_tools: string[];
  produced_ticket_types: string[];
  by_tool: AgentDetailToolCapability[];
}

/** This agent's own real reports_to chain (org-chart hierarchy build,
 * 2026-08-19) — `null` only when the agent has no reports_to_type configured
 * at all (the common case for many non-ticket-creating agents); never a
 * fabricated empty shape when it is set. */
export interface AgentDetailReportsTo {
  trail: string[];
  resolved_human: { id: string; name: string; email: string } | null;
  /** The direct next hop, when it's another agent — real id/name so the UI
   * can link straight to that agent's own detail page. `null` when this
   * agent reports directly to a human, or the configured target doesn't
   * resolve to a real agent row. */
  immediate_agent: { id: string; name: string } | null;
}

/** Trust Contract, "Instant" dimension (2026-08-24) — grounded in Ram
 * Katamaraja's *Trust Before Intelligence* INPACT(tm) framework, per Ali's
 * explicit ask. Every field is a real, pre-existing `AiAgent` column that was
 * never surfaced on this page before. `null`/`0` for an agent invoked outside
 * the generic scheduler wrapper (e.g. Reese, InboxCaseEngine) is honest, not
 * a fabricated "no data yet" placeholder. */
export interface AgentDetailTrustContract {
  trigger_type: string | null;
  schedule: string | null;
  status: string;
  last_run_at: string | null;
  run_count: number;
  error_count: number;
  avg_duration_ms: number | null;
  last_error: string | null;
  last_error_at: string | null;
  /** Trust Contract fix (2026-08-24) — the real, unlimited "most recent ticket
   * touched" timestamp, for agents (Reese, InboxCaseEngine) `last_run_at`
   * never covers since they're event-driven, not cron-tracked. `null` only
   * when the agent genuinely has zero ticket history. */
  last_activity_at: string | null;
}

/** Trust Contract Phase 1 (2026-08-26) — a real, observed change to this
 * agent's `persona_version`. `[]` for an agent whose version has never
 * changed since this table started tracking — the common case on day one,
 * never fabricated history reaching further back than real data exists. */
export interface AgentDetailPersonaVersionHistoryRow {
  id: string;
  persona_version: string;
  previous_version: string | null;
  source: string;
  created_at: string;
}

/** Trust Contract Phase 1 (2026-08-26) — real, queryable `ai_events` cost for
 * this agent over the last 30 days, the same number the Trust Command Center
 * itself would show. `null` when this agent has zero cost-tracked events in
 * the window — not an error, just genuinely nothing to report yet. */
export interface AgentDetailCostSummary {
  cost_usd: number;
  runs: number;
}

/** Trust Contract Phase 1 (2026-08-26) — real `authorizeAgentAction()`
 * verdicts for this agent over the last 30 days. Makes the "declared
 * autonomy_level vs. what's actually enforced" gap visible: `enforced_count`
 * is the subset of decisions made under real `abac_enforcement=enforce`
 * mode, not shadow. */
export interface AgentDetailAuthorizationSummary {
  window_days: number;
  total: number;
  allow: number;
  approval: number;
  block: number;
  enforced_count: number;
}

export interface AgentDetail {
  agent: {
    id: string;
    agent_name: string;
    agent_type: string;
    category: string | null;
    description: string | null;
    system_prompt: string | null;
    tools_granted: string[] | null;
    persona_version: string | null;
    enabled: boolean;
    created_at: string | null;
    /** AI Workforce Reset, Phase C (2026-08-24) — Permitted dimension of the
     * Trust Contract; `null` until this agent is reactivated through that flow. */
    autonomy_level: 'observe' | 'suggest' | 'act_audited' | 'communicate' | null;
    /** Trust & Control slice 2 (2026-09-03) — real platform-configuration
     * facts, not shown anywhere else on this page. `scope` is deliberately
     * not included: a reserved, always-empty JSONB column today. The 3
     * execution limits are honestly nullable — a real agent
     * (CoryStrategicAgent) has `null` here despite the backend model's own
     * class declaring them non-nullable; the real enforcement code
     * (agentPermissionService.ts) falls back to a default when null, and
     * the UI discloses that rather than rendering a fabricated number or a
     * confusing blank. */
    department: string | null;
    module: string | null;
    source_file: string | null;
    max_runs_per_hour: number | null;
    max_writes_per_execution: number | null;
    max_proposals_per_run: number | null;
    autonomy_level_set_at: string | null;
    /** Fleet-wide autonomy-level auto-classification, Phase 2 — 'auto'
     * (agentCapabilityClassifier.ts set this from real granted tools) vs
     * 'manual' (a human set it via the reactivation flow) vs null (neither
     * has ever touched this agent). */
    autonomy_level_source: 'auto' | 'manual' | null;
    /** Reports-to editor (2026-09-30) — the raw hierarchy columns, alongside the
     * already-resolved display chain in this page's own top-level `reports_to` field.
     * Needed because the derived chain alone can't distinguish "no reports_to
     * configured" from "reports_to_type is set but the target is dangling" — a real
     * editor needs the raw value to prefill correctly in either case. */
    reports_to_type: 'human' | 'agent' | null;
    reports_to_id: string | null;
    /** Real-enforcement scoping, Phase 3 (2026-09-20) — the per-agent shadow/enforce
     * switch. `abac_mode_override` null means "follow the global default" (the real,
     * untouched state until an admin deliberately sets one). `abac_effective_mode` and
     * `abac_global_default` are computed server-side — never re-derive them here. */
    abac_mode_override: 'shadow' | 'enforce' | null;
    abac_mode_override_set_at: string | null;
    abac_mode_override_set_by: string | null;
    abac_effective_mode: 'off' | 'shadow' | 'enforce';
    abac_global_default: 'off' | 'shadow' | 'enforce';
  };
  identity: AgentDetailIdentity | null;
  live_status: 'online' | 'away' | 'offline' | 'unknown';
  /** The agent's TRUE open-ticket count (Ticket Count Sync fix, 2026-08-21) —
   * computed server-side via the same shared query the org chart's badges use,
   * NOT derived from `tickets` below (which is capped at 50, most-recent-first,
   * and can undercount for a high-volume agent). Use this field for any
   * "how many open tickets does this agent have" display. */
  open_ticket_count: number;
  /** Agent Detail redesign, Track A1 (2026-09-21) — the Overview hero's honest
   * "Completed (30d)" tile: real `done` tickets last touched in the last 30
   * days. Not "verified" — nothing in this codebase verifies a ticket's
   * outcome today; see the backend's `countCompletedTicketsForAgent()`. */
  completed_ticket_count_30d: number;
  /** Agent Detail polish round 5 (2026-09-30) — Results & Reports' real
   * "Verified resolution" stat. `verified_resolution_count` counts only
   * tickets with a real WorkLedgerEvent (result: 'success') AND real linked
   * evidence, the same honest gate `generateTicketSummary()` already
   * enforces per-ticket — never a bare `done` status flag. See the
   * backend's `countVerifiedResolutionsForAgent()`.
   * `owned_ticket_count_all_time` is every ticket ever assigned to or
   * created by this agent, no status filter — the real denominator. */
  verified_resolution_count: number;
  owned_ticket_count_all_time: number;
  /** The single most recently verified ticket's real id, for fetching its own
   * real outcome sentence via getTicketSummary() — null when nothing is
   * verified yet. */
  most_recent_verified_ticket_id: string | null;
  tickets: AgentDetailTicket[];
  ticket_breakdown: AgentDetailTicketTypeBreakdown[];
  related_tasks: AgentDetailRelatedTask[];
  owned_behaviors: AgentDetailOwnedBehavior[];
  persona_version_history: AgentDetailPersonaVersionHistoryRow[];
  cost_summary: AgentDetailCostSummary | null;
  authorization_summary: AgentDetailAuthorizationSummary;
  capabilities: AgentDetailCapabilities;
  /** UI follow-up to the fleet-wide autonomy-classification work (2026-09-15)
   * — Ali: "why give the user the ability to change it... we might as well
   * set the default and color coordinate it and have a popup that explains
   * why it has been given this autonomy level." Computed fresh server-side
   * against this agent's CURRENT tools_granted on every load — never a
   * stored/stale value. When `level` here differs from `agent.autonomy_level`,
   * a human's manual choice no longer matches what the agent's real granted
   * tools would earn today. */
  autonomy_explanation: { level: 'observe' | 'suggest' | 'act_audited' | 'communicate'; reason: string; matched_tool: string | null };
  reports_to: AgentDetailReportsTo | null;
  trust_contract: AgentDetailTrustContract;
  goals: AgentGoalsDimension[];
  goals_overall: number;
  /** Reese Product Phase 1, R7 — truthful employee facts. `null` for every
   * agent except Reese: no fabricated availability/work-state for an agent
   * this phase never reviewed. */
  employee_facts: AgentDetailEmployeeFacts | null;
}

export type ReeseBehaviourKey =
  | 'reactive_dm_reply'
  | 'autonomous_outreach_sweep'
  | 'outreach_follow_ups'
  | 'welcome_dms'
  | 'student_support_supersession_resolver'
  | 'presence_heartbeat'
  | 'health_assessment';

export interface AgentDetailEmployeeFactsBehaviour {
  key: ReeseBehaviourKey;
  name: string;
  enabled: boolean;
  population: string;
  kill_switch: string;
  /** Real tool/side-effect names from Capabilities this behaviour uses. */
  tools: string[];
  /** The matching "Scheduled work" row's agent_name, for a same-page link —
   * `null` for the 3 behaviours controlled on this card directly. */
  scheduled_work_ref: string | null;
  /** R9 — the real most-recent ticket this behaviour produced or closed;
   * `null` for a behaviour that structurally never produces one or
   * genuinely has none yet. */
  last_ticket: AgentDetailLastTicketRef | null;
  /** Phase 1 workspace mission, R11 — whether this behaviour's execution is
   * decided by the model, a fixed rule, or a human. */
  trigger_mode: 'model_selected' | 'rule_triggered' | 'human_directed';
  /** Phase 1 workspace mission, R11 — callable/configured/authorized/enabled/
   * healthy as distinct facts, instead of collapsing them into `enabled`
   * above. `healthy` is `null` when no per-behaviour run signal exists. */
  status: {
    callable: boolean;
    configured: boolean;
    authorized: boolean;
    enabled: boolean;
    healthy: boolean | null;
  };
}

export interface AgentDetailEmployeeFacts {
  availability: 'available' | 'unavailable';
  work_state: 'idle' | 'working_on_ticket' | 'blocked' | 'waiting_on_person';
  work_state_detail: string | null;
  last_meaningful_action: { at: string; description: string } | null;
  charter_version: number | null;
  charter_effective_at: string | null;
  manager_chain_note: string;
  behaviours: AgentDetailEmployeeFactsBehaviour[];
}

/** AI Workforce Management, Checkpoint E (Trust Before Intelligence
 * Workspace) — real GOALS™ dimensions (Colaberry's own operational-
 * excellence framework, from Ram Katamaraja's "Trust Before Intelligence"
 * book, ch. 7: Governance/Observability/Availability/Lexicon/Solid), scored
 * 0-5 each. `source: 'fixed'` means the dimension is structural (a real
 * declared permission tier or category), not freshly measured on this
 * call — disclosed honestly rather than presented as a live reading. This
 * type existed on the backend since 2026-09-01 with zero frontend
 * consumers until the Trust & Control redesign surfaced it. */
export interface AgentGoalsDimension {
  key: 'governance' | 'observability' | 'availability' | 'lexicon' | 'solid';
  label: string;
  score: number;
  source: 'live' | 'fixed';
  evidence: string;
}

export async function getAgentDetail(agentId: string): Promise<AgentDetail> {
  const res = await api.get<AgentDetail>(`/api/admin/agents/${agentId}`);
  return res.data;
}

export interface SetReeseBehaviourSwitchResult {
  key: ReeseBehaviourKey;
  enabled: boolean;
  alsoChanged: ReeseBehaviourKey[];
}

export async function setReeseBehaviourSwitch(
  agentId: string,
  key: ReeseBehaviourKey,
  enabled: boolean,
): Promise<SetReeseBehaviourSwitchResult> {
  const res = await api.patch<SetReeseBehaviourSwitchResult>(`/api/admin/agents/${agentId}/behaviours/${key}`, { enabled });
  return res.data;
}

export interface SetAgentAbacOverrideResult {
  agentId: string;
  agentName: string;
  found: boolean;
  updated: boolean;
  override: 'shadow' | 'enforce' | null;
  setAt: string | null;
  setBy: string | null;
  error: string | null;
}

// Real-enforcement scoping, Phase 3 (2026-09-20) — the per-agent switch Ali asked for.
// `override: null` is a real, first-class request ("follow the global default again"), not
// just on/off.
export async function setAgentAbacOverride(
  agentId: string,
  override: 'shadow' | 'enforce' | null,
): Promise<SetAgentAbacOverrideResult> {
  const res = await api.patch<{ result: SetAgentAbacOverrideResult }>(
    `/api/admin/workforce/agents/${agentId}/abac-override`,
    { override },
  );
  return res.data.result;
}

export interface SetAgentReportsToResult {
  agentId: string;
  agentName: string;
  found: boolean;
  updated: boolean;
  reports_to: AgentDetailReportsTo | null;
  setAt: string | null;
  setBy: string | null;
  error: string | null;
}

// Reports-to editor (2026-09-30) — Dhee: "I should be able to change who Reese reports to."
// `reports_to_type`/`reports_to_id` are both required; the server dry-runs the chain through
// the real resolver before persisting, and rejects (400, caught by the caller) a target that
// doesn't resolve to a real human.
export async function setAgentReportsTo(
  agentId: string,
  reportsToType: 'human' | 'agent',
  reportsToId: string,
): Promise<SetAgentReportsToResult> {
  const res = await api.patch<{ result: SetAgentReportsToResult }>(
    `/api/admin/workforce/agents/${agentId}/reports-to`,
    { reports_to_type: reportsToType, reports_to_id: reportsToId },
  );
  return res.data.result;
}
