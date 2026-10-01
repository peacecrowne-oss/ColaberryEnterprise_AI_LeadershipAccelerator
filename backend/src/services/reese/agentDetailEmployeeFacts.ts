import type { PersonaVersionHistoryRow } from '../agentPersonaVersionHistoryService';
import type { AgentAuthorizationSummary } from '../agentAuthorizationService';
import type { AgentGoalsDimension } from '../agentGoalsDimensionsService';
import type { CommunityPresenceStatus } from '../../models/CommunityMember';
import RoomMessage from '../../models/RoomMessage';
import { getRoleCharter } from '../agentRoleCharterService';
import { REESE_BEHAVIOURS } from '../../scripts/lib/reeseBehaviourInventory';
import type { LastTicketRef } from './reeseBehaviourLastTicket';
import type { AgentDetailTicket, AgentDetailTicketBreakdown } from './agentDetailTicketTypes';
import {
  type ReeseBehaviourKey,
  BEHAVIOUR_KEY_BY_NAME,
  BEHAVIOUR_TOOLS,
  CRON_REGISTRY_NAMES,
  welcomeEnabledFromAgent,
} from './reeseBehaviourMetadata';
import {
  type ReeseTriggerMode,
  type ReeseBehaviourStatusFacts,
  getTriggerMode,
  computeStatusFacts,
} from './reeseBehaviourTriggerMode';

// R9 — re-exported so reeseBehaviourSwitchService.ts's existing import path
// (`from './agentDetailEmployeeFacts'`) keeps working unchanged after the
// R9 extraction into reeseBehaviourMetadata.ts.
export type { ReeseBehaviourKey } from './reeseBehaviourMetadata';
export { BEHAVIOUR_KEY_BY_NAME } from './reeseBehaviourMetadata';

// Reese Product Phase 1, R7 — agentDetailService.ts was 565 lines, over this
// repo's 500-line hard ceiling (CLAUDE.md's Modular Composition Rule). Its
// read models (the AgentDetailResult shape and everything it documents) are
// extracted here, unchanged, so the next addition to either file has real
// room under the ceiling instead of compounding an already-oversize file.
// Zero behaviour change: agentDetailService.ts imports this type back and
// its own existing test suite passes untouched.
//
// This file also carries the NEW truthful-employee fields this phase adds
// (EmployeeFacts, getReeseEmployeeFacts) — Reese-only by construction (see
// its own header below), never called for any other agent.
export interface AgentDetailResult {
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
    created_at: Date | null;
    /** AI Workforce Reset, Phase C (2026-08-24) — the Permitted dimension of
     * the Trust Contract: docs/ai-governance/abac-design.md's 4-level
     * ladder, `null` for an agent never yet reactivated through that flow.
     * Purely declarative — not enforced anywhere yet. */
    autonomy_level: 'observe' | 'suggest' | 'act_audited' | 'communicate' | null;
    /** AI Agent Dashboard redesign, Trust & Control slice 2 (2026-09-03) —
     * real AiAgent columns never surfaced by this endpoint before: which of
     * the 18 real `departments` slugs this agent is classified under (`null`
     * when unclassified/cross-cutting, never forced), which registry
     * module/source file it was seeded from, its 3 execution-limit
     * ceilings (agentPermissionService.ts's real enforcement, not display-
     * only), and whether its autonomy_level was ever deliberately set by an
     * operator vs. sitting on the untouched migration default (`null` set-
     * at means the latter). `scope` (JSONB) is deliberately NOT included —
     * confirmed via AiAgent.ts's own header comment to be a reserved,
     * always-empty column today; surfacing a perpetually-empty field would
     * misrepresent it as meaningful.
     *
     * The 3 execution limits are `number | null`, not `number` — a real,
     * live-caught bug: AiAgent.ts's own class declares them non-nullable
     * (`declare max_runs_per_hour: number`), but a real agent
     * (CoryStrategicAgent, an on-demand type never touched by the normal
     * registry-seed default-assignment path) genuinely has `null` in the
     * database for all 3, confirmed via a direct query before writing this.
     * `agentPermissionService.ts`'s own checkRunLimit()/checkWriteLimit()/
     * checkProposalLimit() already treat a null column as "use the real
     * default" (`agent.max_runs_per_hour || DEFAULT_MAX_RUNS_PER_HOUR`) —
     * this endpoint passes the real stored value through honestly rather
     * than silently substituting that default, so the UI can disclose
     * which is true instead of rendering a blank. The AiAgent.ts type
     * itself is a separate, pre-existing inconsistency, flagged but not
     * fixed here — out of this checkpoint's scope. */
    department: string | null;
    module: string | null;
    source_file: string | null;
    max_runs_per_hour: number | null;
    max_writes_per_execution: number | null;
    max_proposals_per_run: number | null;
    autonomy_level_set_at: Date | null;
    autonomy_level_source: 'auto' | 'manual' | null;
    /** Reports-to editor (2026-09-30) — the raw hierarchy columns, exposed alongside the
     * already-resolved display chain (the page's own top-level `reports_to` field) so a
     * write path can prefill from the real current value instead of guessing it from a
     * derived chain that goes `null` on a dangling target even when `reports_to_type` is
     * still set. */
    reports_to_type: 'human' | 'agent' | null;
    reports_to_id: string | null;
    /** Real-enforcement scoping, Phase 3 (2026-09-20) — the per-agent shadow/enforce
     * switch Ali asked for. `abac_mode_override` is `null` for the real, untouched
     * default (every agent until an admin deliberately sets one); `abac_effective_mode`
     * and `abac_global_default` are computed server-side via the SAME resolution logic
     * authorizeAgentAction() itself uses, so this page can never drift from what
     * actually governs this agent's real calls. */
    abac_mode_override: 'shadow' | 'enforce' | null;
    abac_mode_override_set_at: Date | null;
    abac_mode_override_set_by: string | null;
    abac_effective_mode: 'off' | 'shadow' | 'enforce';
    abac_global_default: 'off' | 'shadow' | 'enforce';
  };
  identity: {
    admin_user_id: string;
    email: string;
    display_name: string | null;
    is_ai_operated: boolean;
  } | null;
  live_status: CommunityPresenceStatus | 'unknown';
  /** The agent's TRUE open-ticket count (Ticket Count Sync fix, 2026-08-21, session
   * CC-20260818-x4nk continued) — computed via the shared `countOpenTicketsForAgent()`
   * (the SAME query `orgChartService.ts`'s Leadership/Staff card badges and
   * `liveAgentsService.ts`'s Live Agents grid use), NOT derived from the `tickets`
   * array below. `tickets` is capped at `MAX_TICKETS` (most-recent-first) for display,
   * so for any agent whose true ticket volume exceeds that cap, `tickets.filter(open
   * status).length` would undercount — this field is the honest, uncapped answer. `0`
   * when there's no linked `adminUser`, matching `tickets`' own fallback below. */
  open_ticket_count: number;
  /** Agent Detail redesign, Track A1 (2026-09-21) — the Overview hero's honest
   * "Completed (30d)" tile: `done` tickets last touched (`updated_at`) within
   * the last 30 days, via `countCompletedTicketsForAgent()`. `0` when there's
   * no linked `adminUser`, matching `open_ticket_count`'s own fallback. Not
   * "verified" — nothing in this codebase verifies a ticket's outcome today,
   * see that function's own header comment. */
  completed_ticket_count_30d: number;
  /** Agent Detail polish round 5 (2026-09-30) — Results & Reports' real
   * "Verified resolution" stat, via `countVerifiedResolutionsForAgent()`.
   * `verified_resolution_count` counts only tickets with a real
   * WorkLedgerEvent (result: 'success') AND real linked evidence — the same
   * honest gate `generateTicketSummary()` already enforces per-ticket.
   * `owned_ticket_count_all_time` has no status filter — every ticket ever
   * assigned to or created by this agent. `most_recent_verified_ticket_id`
   * is the single most recently verified ticket's real id, or null. All
   * three are 0/0/null when there's no linked `adminUser`. */
  verified_resolution_count: number;
  owned_ticket_count_all_time: number;
  most_recent_verified_ticket_id: string | null;
  /** Dara v2 Phase 6 ("open-ticket accountability") — the oldest still-open
   * ticket's real age, via the shared `getOldestOpenTicketAge()` (same
   * match-list/open-status query as `open_ticket_count` above). Null when
   * there's no linked `adminUser` OR the agent genuinely has zero open
   * tickets — never a fabricated age. Read-only/informational: nothing in
   * this codebase uses this to auto-close anything. */
  oldest_open_ticket_age_days: number | null;
  /** Types extracted to agentDetailTicketTypes.ts (Dashboard redesign, Slice
   * 2a) — this file hit the 500-line hard ceiling; pure type split. */
  tickets: AgentDetailTicket[];
  ticket_breakdown: AgentDetailTicketBreakdown[];
  /** Task visibility (2026-08-26) — Ali, live: "I need to see what those
   * [tasks] are... what triggers them... I should be able to see that."
   * Reese's real recurring behaviors (autonomous outreach sweep, follow-up
   * sweep, etc.) are each registered as their OWN `AiAgent` row sharing this
   * agent's `module` (see agentRegistrySeed.ts's real 'reese' entries) —
   * never visible before because the detail page only ever showed the ONE
   * row it was loaded for. Sibling rows only, by real shared `module`; `[]`
   * when this agent has no `module` set (most agents), never guessed. */
  related_tasks: Array<{
    id: string;
    agent_name: string;
    description: string | null;
    trigger_type: string | null;
    schedule: string | null;
    enabled: boolean;
    status: string;
    last_run_at: Date | null;
    run_count: number;
    error_count: number;
    /** R9 — Ali, live: "I'd also like to see the last time the tool and
     * scheduled work was used/run and the ticket." Reese-only, via
     * computeLastTicketPerBehaviour() in reeseBehaviourLastTicket.ts; `null`
     * for every other agent (this field is never populated outside the
     * Reese branch in agentDetailService.ts) and for a Reese cron behaviour
     * that has never produced a ticket. */
    last_ticket: LastTicketRef | null;
  }>;
  /** AI Employee Consolidation Program (2026-09-15/16) — "Capabilities &
   * Automations": the real legacy behaviors/tools this employee OWNS, via
   * the program's real `parent_agent_id` ownership column
   * (ensureAiAgentConsolidationSchema.ts), not `related_tasks`' same-module
   * inference above. An employee's Agent Detail page is meant to show these
   * as owned automations, never as peer employees (mission Section 13). `[]`
   * for any agent nothing has been absorbed under yet — the entire fleet on
   * day one except Dara. */
  owned_behaviors: Array<{
    id: string;
    agent_name: string;
    record_kind: 'employee' | 'behavior' | 'tool' | null;
    description: string | null;
    trigger_type: string | null;
    schedule: string | null;
    enabled: boolean;
    migration_status: 'legacy' | 'absorbed' | 'archived' | null;
  }>;
  /** Trust Contract Phase 1 (2026-08-26) — real changes to this agent's
   * `persona_version`, most-recent first. `[]` for an agent whose version has
   * never changed since this table started tracking (2026-08-26) — the
   * common case for the whole existing fleet on day one — never fabricated
   * history reaching further back than real data exists. */
  persona_version_history: PersonaVersionHistoryRow[];
  /** Trust Contract Phase 1 (2026-08-26) — real, queryable `ai_events` cost
   * for this agent over the last 30 days (reuses trustMetricsService.ts's
   * own per-agent cost query — the same number the Trust Command Center
   * itself would show, never a second, drifting calculation). `null` when
   * this agent has zero cost-tracked events in the window — an agent that
   * genuinely hasn't made a tracked LLM call, not an error. */
  cost_summary: { cost_usd: number; runs: number } | null;
  /** Trust Contract Phase 1 (2026-08-26) — real `authorizeAgentAction()`
   * verdicts for this agent over the last 30 days: how many were allowed
   * outright, how many required approval, how many would have been blocked
   * — and how many of those were under real `enforce` mode vs. shadow. This
   * is the "declared autonomy_level vs. what's actually enforced" gap made
   * visible, using the real ABAC chokepoint's own trail, never a fabricated
   * trust score. */
  authorization_summary: AgentAuthorizationSummary;
  /** What this agent reads / produces — Agent Detail transparency, part 2
   * (2026-08-18). Derived from the agent's real, live `tools_granted` (declared
   * capability, via deriveAgentCapabilities()) UNIONED with the real, live
   * DISTINCT ticket types it has actually created (observed behavior, via an
   * unlimited grouped query — not the capped/ordered `tickets` list above).
   * Doubly grounded, never hand-written prose: change tools_granted or what the
   * agent actually creates, and this self-corrects with zero code change. */
  capabilities: {
    reads: string[];
    produces: string[];
    undocumented_tools: string[];
    produced_ticket_types: string[];
    /** Per-tool breakdown of the same reads/produces facts, in tools_granted
     * order — lets AgentDetailPage show which tool a given fact came from
     * instead of only the flattened union above (2026-08-23 drill-down ask). */
    by_tool: Array<{ tool: string; reads: string[]; produces: string[]; documented: boolean }>;
  };
  /** Fleet-wide autonomy-level auto-classification, UI follow-up (2026-09-15)
   * — Ali, on Reese's page: "why give the user the ability to change it...
   * we might as well set the default and color coordinate it and have a
   * popup that explains why it has been given this autonomy level." This is
   * that explanation: `classifyAgentAutonomyLevel()` (the same pure,
   * dependency-free function the fleet backfill script and the ongoing-sync
   * service both call) run fresh against this agent's CURRENT
   * `tools_granted`, every request. Never stored — recomputing live means it
   * self-corrects the instant `tools_granted` changes, and doubles as
   * staleness detection for a manually-set level: if `level` here disagrees
   * with `agent.autonomy_level`, the frontend can show that a human's choice
   * no longer matches what the agent's real granted tools would earn. */
  autonomy_explanation: {
    level: 'observe' | 'suggest' | 'act_audited' | 'communicate';
    reason: string;
    matched_tool: string | null;
  };
  /** This agent's own real reports_to chain (org-chart hierarchy build,
   * 2026-08-19) — the "Reports to" section on AgentDetailPage. `null` only
   * when the agent has no `reports_to_type` configured at all (the common
   * case for the many non-ticket-creating AiAgent rows this endpoint can
   * still be called on); never fabricated. Reuses
   * ticketCreatorReportsToResolver.ts's resolveReportsToChainWithTrail() —
   * the SAME chain-walk ticketService.createTicket() gates on. */
  reports_to: {
    trail: string[];
    resolved_human: { id: string; name: string; email: string } | null;
    /** The DIRECT next hop, when it's another agent (AI Staff -> AI
     * Leadership) — real id + name so AgentDetailPage can link straight to
     * that agent's own detail page (Ali, 2026-08-23: "I'd like to have a
     * link to the agent they report to"). `null` when this agent reports
     * directly to a human (resolved_human already covers that case), or
     * when the configured reports_to_id doesn't resolve to a real agent row
     * (disclosed honestly, never a dead link). */
    immediate_agent: { id: string; name: string } | null;
  } | null;
  /** Trust Contract (2026-08-24) — Ali, live: "All Agents should have a trust
   * contract based on [Trust Before Intelligence]." Grounded in that book's
   * real INPACT(tm) framework, not an invented shape: this field is the
   * "Instant" dimension (is this agent actually running, on schedule,
   * reliably) — every value is a real, pre-existing `AiAgent` column that was
   * never surfaced anywhere before this. The Permitted (tools_granted),
   * Transparent (reports_to), and Contextual (capabilities.reads) dimensions
   * already exist as their own top-level fields above; the frontend groups
   * all four under one Trust Contract section rather than this endpoint
   * duplicating them here. Never fabricated: an agent invoked outside the
   * generic runAgent() scheduler wrapper (e.g. Reese, InboxCaseEngine — real,
   * high-volume identity-only registrations, not cron-tracked) honestly shows
   * null/zero rather than a guessed value. */
  trust_contract: {
    trigger_type: string | null;
    schedule: string | null;
    status: string;
    last_run_at: Date | null;
    run_count: number;
    error_count: number;
    avg_duration_ms: number | null;
    last_error: string | null;
    last_error_at: Date | null;
    /** Trust Contract fix (2026-08-24) — Ali, live: "Reese has several tickets
     * that have been opened... but this says it's never been run." For an
     * event-driven agent, `last_run_at` stays honestly null forever (it is
     * never invoked through the cron scheduler wrapper that stamps that
     * column) — that's correct, not a bug. The bug was the UI having no other
     * signal to show, so it read as "never run" next to a ticket table full of
     * recent activity. This is that other real signal: the most recent
     * `updated_at` across ALL of this agent's tickets (any status, unlimited —
     * not the capped `tickets` array), via `getLastTicketActivityForAgent()`.
     * `null` only when the agent genuinely has zero ticket history either. */
    last_activity_at: Date | null;
  };
  /** AI Workforce Management, Checkpoint E (Trust Before Intelligence
   * Workspace) — the live GOALS dimension score (governance/observability/
   * availability/lexicon/solid), generically computed for ANY real agent
   * via agentGoalsDimensionsService.ts. This is a parallel, additive
   * implementation of the same real scoring pattern
   * trustMetricsService.ts's roster-keyed getAgentDetail(slug) already
   * proved for the 12 Workforce OS agents — reusing the pattern, not the
   * synthetic roster rows, per TARGET_ARCHITECTURE.md's own guiding
   * constraint. Never fabricated: governance/lexicon are structurally
   * 'fixed' (real permission tier / real AiAgent.category), observability/
   * availability/solid are 'live' (computed fresh from this agent's own
   * AiAgentActivityLog rows on every call). */
  goals: AgentGoalsDimension[];
  goals_overall: number;
  /** Reese Product Phase 1, R7 — truthful employee facts, Reese-only today
   * (see getReeseEmployeeFacts() below). `null` for every other agent: no
   * fabricated availability/work-state for an agent this phase never
   * reviewed. */
  employee_facts: EmployeeFacts | null;
}

/** Reese Product Phase 1, R7/R9. */
export interface EmployeeFactsBehaviourRow {
  key: ReeseBehaviourKey;
  name: string;
  enabled: boolean;
  population: string;
  kill_switch: string;
  /** Real tool/side-effect names from TOOL_INVENTORY.md this behaviour uses
   * -- the correlation to the Capabilities section above it on the same
   * page. `[]` when none apply. */
  tools: string[];
  /** The exact sibling `agent_name` this behaviour's switch lives on in the
   * "Scheduled work" section below -- `null` for the 3 behaviours controlled
   * on Reese's own row instead (reactive_dm_reply, health_assessment,
   * welcome_dms have no Scheduled work entry of their own). */
  scheduled_work_ref: string | null;
  /** R9 — Ali, live: "I'd also like to see a link to the last ticket or
   * time this process run." The real most-recent ticket this behaviour's
   * own service produced or closed (see reeseBehaviourLastTicket.ts's
   * header for the exact type-per-behaviour grounding); `null` for a
   * behaviour that structurally never produces a ticket (welcome_dms,
   * presence_heartbeat, health_assessment) or genuinely has none yet. */
  last_ticket: LastTicketRef | null;
  /** Phase 1 workspace mission, R11 — whether this behaviour's execution is
   * decided by the model, a fixed rule, or a human. See
   * reeseBehaviourTriggerMode.ts for the real, hand-verified classification. */
  trigger_mode: ReeseTriggerMode;
  /** Phase 1 workspace mission, R11 — callable/configured/authorized/enabled/
   * healthy as distinct facts, instead of collapsing them into `enabled`
   * above. See reeseBehaviourTriggerMode.ts for what each one honestly
   * means today. */
  status: ReeseBehaviourStatusFacts;
}

export interface EmployeeFacts {
  /** True only when the agent's own row is enabled AND every real behaviour
   * controller that gates on it is enabled — never just "the row exists". */
  availability: 'available' | 'unavailable';
  work_state: 'idle' | 'working_on_ticket' | 'blocked' | 'waiting_on_person';
  work_state_detail: string | null;
  /** Her latest real room_messages row or ticket change, whichever is more
   * recent — never a heartbeat tick (REESE_STANDARD_AUDIT.md gap #10: the
   * presence heartbeat is content-free by design). `null` only when there is
   * genuinely no recorded activity yet. */
  last_meaningful_action: { at: Date; description: string } | null;
  charter_version: number | null;
  charter_effective_at: Date | null;
  manager_chain_note: string;
  behaviours: EmployeeFactsBehaviourRow[];
}

/**
 * Reese Product Phase 1, R7 — truthful availability, work state, last
 * meaningful action, charter version, manager chain, and every behaviour's
 * real switch state. Reese-only by construction: reads only Reese's own
 * room messages and charter, and the AiAgent rows the caller already fetched
 * (`ctx.relatedTasks` — Reese's own module-sibling registry rows,
 * agentDetailService.ts's existing `relatedTaskRows` query, not a second
 * query of its own). Called from agentDetailService.ts only when
 * `agent.agent_name === 'Reese'`, never for any other agent.
 */
export async function getReeseEmployeeFacts(
  agent: { id: string; agent_name: string; enabled: boolean; config?: Record<string, unknown> | null },
  ctx: {
    lastTicketActivityAt: Date | null;
    openTicketCount: number;
    reportsTo: AgentDetailResult['reports_to'];
    /** Reese's own enrollment id, already resolved by agentDetailService.ts
     * while computing live_status — reused here rather than a second lookup. */
    reeseEnrollmentId: string | null;
    /** Sibling AiAgent rows sharing Reese's `module` — the same
     * `relatedTaskRows` agentDetailService.ts already queries once.
     * `run_count`/`error_count` (R11) were already fetched by that same
     * query and are reused here for the `healthy` status fact — no new
     * query. */
    relatedTasks: Array<{ agent_name: string; enabled: boolean; run_count: number; error_count: number }>;
    /** R9 — the real most-recent ticket per behaviour, computed once by
     * agentDetailService.ts (computeLastTicketPerBehaviour(), zero extra
     * queries) and passed through rather than re-derived here. */
    lastTicketByBehaviour: Partial<Record<ReeseBehaviourKey, LastTicketRef>>;
  },
): Promise<EmployeeFacts> {
  // Reese's own row enabled flag, from THIS request's already-loaded agent —
  // not a second, potentially-inconsistent read.
  const reeseEnabled = agent.enabled;

  const cronEnabled = new Map(ctx.relatedTasks.map((r) => [r.agent_name, r.enabled]));
  const cronRunStats = new Map(ctx.relatedTasks.map((r) => [r.agent_name, { runCount: r.run_count, errorCount: r.error_count }]));

  const behaviours: EmployeeFactsBehaviourRow[] = REESE_BEHAVIOURS.map((b) => {
    const cronRegistryName = CRON_REGISTRY_NAMES[b.name];
    const key = BEHAVIOUR_KEY_BY_NAME[b.name];
    let enabled: boolean;
    if (b.name === 'Reactive DM reply' || b.name === 'Health assessment') {
      enabled = reeseEnabled;
    } else if (b.name === 'Welcome DMs') {
      enabled = reeseEnabled && welcomeEnabledFromAgent(agent);
    } else if (cronRegistryName) {
      enabled = cronEnabled.get(cronRegistryName) ?? false;
    } else {
      enabled = false;
    }
    const runStats = cronRegistryName ? cronRunStats.get(cronRegistryName) : undefined;
    // "Configured" (R11): a real cron schedule for the 4 registry behaviours
    // (their sibling row exists in relatedTasks at all), or a real,
    // non-empty tool list for the other 3 -- never a bare `true`.
    const configured = cronRegistryName ? cronEnabled.has(cronRegistryName) : BEHAVIOUR_TOOLS[key].length > 0;
    return {
      key,
      name: b.name,
      enabled,
      population: b.population,
      kill_switch: b.killSwitch,
      tools: BEHAVIOUR_TOOLS[key],
      scheduled_work_ref: cronRegistryName ?? null,
      last_ticket: ctx.lastTicketByBehaviour[key] ?? null,
      trigger_mode: getTriggerMode(key),
      status: computeStatusFacts(key, {
        enabled,
        configured,
        cronRunCount: runStats?.runCount ?? null,
        cronErrorCount: runStats?.errorCount ?? null,
      }),
    };
  });

  // Availability is truthful, not the presence heartbeat: unavailable when
  // her own row is off OR every real behaviour is switched off.
  const availability: EmployeeFacts['availability'] =
    agent.enabled && behaviours.some((b) => b.enabled) ? 'available' : 'unavailable';

  // Last meaningful action — her latest real room_messages row (never the
  // heartbeat), compared against the latest ticket activity, whichever is
  // more recent. Fails safe to null, never throws (a lookup failure here
  // must not break the whole Agent Detail response).
  let lastMessage: { at: Date; description: string } | null = null;
  try {
    if (ctx.reeseEnrollmentId) {
      const latest = await RoomMessage.findOne({
        where: { enrollment_id: ctx.reeseEnrollmentId, deleted_at: null },
        order: [['created_at', 'DESC']],
      });
      if (latest) lastMessage = { at: latest.created_at, description: `Sent a DM: "${String(latest.content).slice(0, 140)}"` };
    }
  } catch {
    lastMessage = null;
  }

  const lastTicket = ctx.lastTicketActivityAt
    ? { at: ctx.lastTicketActivityAt, description: 'Ticket activity (see linked tickets)' }
    : null;

  const lastMeaningfulAction =
    lastMessage && lastTicket
      ? (lastMessage.at > lastTicket.at ? lastMessage : lastTicket)
      : lastMessage || lastTicket;

  const workState: EmployeeFacts['work_state'] = ctx.openTicketCount > 0 ? 'working_on_ticket' : 'idle';
  const workStateDetail = ctx.openTicketCount > 0 ? `${ctx.openTicketCount} open ticket(s)` : null;

  const charterView = await getRoleCharter(agent.id);
  const charterVersion = charterView?.charter?.version ?? null;
  const charterEffectiveAt = charterView?.charter?.effectiveAt ?? null;

  let managerChainNote: string;
  if (ctx.reportsTo?.resolved_human) {
    managerChainNote = `Reports to: ${ctx.reportsTo.resolved_human.name}`;
  } else if (ctx.reportsTo?.immediate_agent) {
    managerChainNote = `Reports to: ${ctx.reportsTo.immediate_agent.name} (does not resolve to a human)`;
  } else {
    managerChainNote = 'No manager chain configured';
  }

  return {
    availability,
    work_state: workState,
    work_state_detail: workStateDetail,
    last_meaningful_action: lastMeaningfulAction,
    charter_version: charterVersion,
    charter_effective_at: charterEffectiveAt,
    manager_chain_note: managerChainNote,
    behaviours,
  };
}
