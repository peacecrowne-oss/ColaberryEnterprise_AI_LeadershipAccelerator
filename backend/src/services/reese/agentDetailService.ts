import { Op } from 'sequelize';
import AiAgent from '../../models/AiAgent';
import AdminUser from '../../models/AdminUser';
import Enrollment from '../../models/Enrollment';
import CommunityMember from '../../models/CommunityMember';
import OrgMember from '../../models/OrgMember';
import { Ticket, TicketActivity } from '../../models';
import { derivePresence } from '../communityService';
import type { CommunityPresenceStatus } from '../../models/CommunityMember';
import { buildCreatorIdMatchList } from '../agentBlueprint/legacyCreatorAliases';
import { countOpenTicketsForAgent, countCompletedTicketsForAgent, countVerifiedResolutionsForAgent, getLastTicketActivityForAgent, getOldestOpenTicketAge } from '../workforce/liveAgentsService';
import { deriveAgentCapabilities } from './agentToolCapabilities';
import { resolveReportsToChainWithTrail } from '../ticketCreatorReportsToResolver';
import { getPersonaVersionHistory } from '../agentPersonaVersionHistoryService';
import { agentCostRows } from '../trustMetricsService';
import { getAgentAuthorizationSummary, getAbacMode, resolveEffectiveMode } from '../agentAuthorizationService';
import { computeAgentGoalsDimensions } from '../agentGoalsDimensionsService';
import { classifyAgentAutonomyLevel } from '../agentCapabilityClassifier';
import { getReeseEmployeeFacts, type AgentDetailResult } from './agentDetailEmployeeFacts';
import { computeLastTicketPerBehaviour } from './reeseBehaviourLastTicket';
import { BEHAVIOUR_KEY_BY_CRON_AGENT_NAME } from './reeseBehaviourMetadata';
import { computeNeedsReply, computeStatusBucket } from './ticketStatusBucket';

export type { AgentDetailResult } from './agentDetailEmployeeFacts';

// Agent Detail — the transparency page Ali asked for: real identity, real
// system prompt, real tools, live status, real linked ticket activity. Written
// generically (any AiAgent id, not hardcoded to Reese) so this is genuinely the
// reusable blueprint for every future agent, not a one-off Reese page.
//
// Reuses derivePresence() (communityService.ts) — the SAME function the real
// People panel uses — rather than reinventing presence logic here.
//
// Reese Product Phase 1, R7 — the AgentDetailResult shape (and every doc
// comment on it) now lives in agentDetailEmployeeFacts.ts, which also carries
// the new Reese-only truthful-employee fields this phase adds. This file was
// 565 lines, over this repo's 500-line hard ceiling; the split is pure type
// extraction, zero behaviour change — this file's own existing test suite
// passes untouched.

const MAX_TICKETS = 50;

/** Real human display name for a resolved org_members.id — Enrollment.full_name
 * falling back to email, the same pattern orgService.ts::getRoster() and
 * orgChartService.ts already use for this exact data. */
async function resolveHumanIdentity(orgMemberId: string): Promise<{ id: string; name: string; email: string } | null> {
  const member = await OrgMember.findByPk(orgMemberId);
  if (!member) return null;
  let name = member.email;
  if (member.enrollment_id) {
    const enrollment = await Enrollment.findByPk(member.enrollment_id);
    if (enrollment?.full_name) name = enrollment.full_name;
  }
  return { id: member.id, name, email: member.email };
}

/** Reports-to editor (2026-09-30) — pure extraction of this file's own existing
 * reports_to-building logic (org-chart hierarchy build, 2026-08-19), so
 * agentReportsToService.ts's new write path can return the SAME real, recomputed
 * display shape this file already builds for GET, rather than a second copy of this
 * logic. Zero behaviour change for this file's own existing call site below. */
export async function buildReportsToView(agent: AiAgent): Promise<AgentDetailResult['reports_to']> {
  if (!agent.reports_to_type) return null;
  const { resolvedHumanId, trail } = await resolveReportsToChainWithTrail(agent);
  const resolvedHuman = resolvedHumanId ? await resolveHumanIdentity(resolvedHumanId) : null;
  // Immediate next hop, only when it's an agent (2026-08-23 "link to the
  // agent they report to" ask) — a single extra lookup, not a second copy
  // of the recursive chain-walk (that stays the one canonical
  // implementation in ticketCreatorReportsToResolver.ts).
  let immediateAgent: { id: string; name: string } | null = null;
  if (agent.reports_to_type === 'agent' && agent.reports_to_id) {
    const nextAgent = await AiAgent.findByPk(agent.reports_to_id);
    if (nextAgent) immediateAgent = { id: nextAgent.id, name: nextAgent.agent_name };
  }
  return { trail, resolved_human: resolvedHuman, immediate_agent: immediateAgent };
}

export async function getAgentDetail(agentId: string): Promise<AgentDetailResult | null> {
  const agent = await AiAgent.findByPk(agentId);
  if (!agent) return null;

  const adminUser = await AdminUser.findOne({ where: { agent_id: agent.id } });

  let liveStatus: CommunityPresenceStatus | 'unknown' = 'unknown';
  // Reese Product Phase 1, R7 — captured here (not a second lookup) so
  // getReeseEmployeeFacts() can find her latest real room_messages row
  // without re-resolving her enrollment id.
  let enrollmentId: string | null = null;
  if (adminUser) {
    const enrollment = await Enrollment.findOne({ where: { email: adminUser.email } });
    if (enrollment) {
      enrollmentId = enrollment.id;
      const member = await CommunityMember.findOne({ where: { enrollment_id: enrollment.id } });
      if (member) liveStatus = derivePresence(member.last_active_at);
    }
  }

  // The core "who is this agent targeting, why, and follow up over time" view —
  // only tickets actually belonging to THIS agent's real staff identity, never
  // every ticket in the system. Agent Alias & Identity Fix: matches EITHER the
  // real AdminUser.id (assigned_to_id, going forward) OR any of this agent's
  // known legacy raw creator strings (created_by_id — the only field this
  // agent's historical tickets may have ever populated, e.g. cory-engine's
  // 9,606 tickets). An agent with zero legacy aliases (Reese) gets a match list
  // of exactly its own id, so this is unchanged for Reese.
  const tickets = adminUser
    ? await Ticket.findAll({
        where: {
          [Op.or]: [
            { assigned_to_type: 'ai_staff', assigned_to_id: { [Op.in]: buildCreatorIdMatchList(adminUser.id, agent) } },
            { created_by_id: { [Op.in]: buildCreatorIdMatchList(adminUser.id, agent) } },
          ],
        },
        order: [['created_at', 'DESC']],
        limit: MAX_TICKETS,
      })
    : [];

  // Dashboard redesign, Slice 2a (2026-09-19) — the Work tab's honest
  // "needs a reply" filter needs each ticket's most recent activity actor.
  // One bounded query scoped to the SAME ticket ids already fetched above
  // (never unbounded — capped by MAX_TICKETS transitively), grouped in JS
  // to the latest row per ticket_id — same "fetch once, group in JS" shape
  // as ticketBreakdown below. Skipped entirely when there are no tickets.
  const ticketIds = tickets.map((t: any) => t.id);
  const latestActivityByTicketId = new Map<string, { actor_id: string; created_at: Date }>();
  if (ticketIds.length > 0) {
    const activityRows = await TicketActivity.findAll({
      where: { ticket_id: { [Op.in]: ticketIds } },
      attributes: ['ticket_id', 'actor_id', 'created_at'],
      order: [['ticket_id', 'ASC'], ['created_at', 'DESC']],
    });
    for (const row of activityRows as any[]) {
      // First row seen per ticket_id (thanks to the DESC order above) is
      // the latest — never overwritten by an older row for the same ticket.
      if (!latestActivityByTicketId.has(row.ticket_id)) {
        latestActivityByTicketId.set(row.ticket_id, { actor_id: row.actor_id, created_at: row.created_at });
      }
    }
  }
  const ownIdentityIds = adminUser ? buildCreatorIdMatchList(adminUser.id, agent) : [];

  // Agent Detail transparency, part 2 (2026-08-18) — the real, live ticket
  // types this agent has ever created/been assigned, UNLIMITED (not the
  // capped-50/DESC `tickets` list above, which can miss older types entirely).
  // Same match-list where-clause as the tickets query. Was a SQL `group:
  // ['type']` returning only distinct types; now selects `metadata` per row
  // too (task visibility, 2026-08-26) so ticket_breakdown below can sub-group
  // by the real `metadata.signal_type` where it exists — the grouping itself
  // moved to JS since a JSONB column can't be selected ungrouped alongside a
  // SQL GROUP BY. `produced_ticket_types` (capabilities, further below)
  // derives its distinct list from this same query, unchanged in result.
  const allTicketTypeRows = adminUser
    ? await Ticket.findAll({
        // R9 — id/ticket_number/title/status/updated_at added so
        // computeLastTicketPerBehaviour() below can derive each behaviour's
        // real last ticket from this SAME already-fetched set, with zero
        // extra queries.
        attributes: ['id', 'ticket_number', 'title', 'status', 'type', 'metadata', 'updated_at'],
        where: {
          [Op.or]: [
            { assigned_to_type: 'ai_staff', assigned_to_id: { [Op.in]: buildCreatorIdMatchList(adminUser.id, agent) } },
            { created_by_id: { [Op.in]: buildCreatorIdMatchList(adminUser.id, agent) } },
          ],
        },
      })
    : [];

  // Task visibility (2026-08-26) — "which task is creating the most tickets."
  // Groups the same unlimited row set above by `type`, then by real
  // `metadata.signal_type` within each type ONLY where at least one ticket of
  // that type actually carries it — never a fabricated "unknown" bucket for
  // types that don't use signal_type at all.
  const ticketBreakdown: AgentDetailResult['ticket_breakdown'] = (() => {
    const byType = new Map<string, { count: number; signalCounts: Map<string, number> }>();
    for (const row of allTicketTypeRows as any[]) {
      const entry = byType.get(row.type) ?? { count: 0, signalCounts: new Map<string, number>() };
      entry.count += 1;
      const signalType = row.metadata?.signal_type;
      if (typeof signalType === 'string' && signalType) {
        entry.signalCounts.set(signalType, (entry.signalCounts.get(signalType) ?? 0) + 1);
      }
      byType.set(row.type, entry);
    }
    return Array.from(byType.entries())
      .map(([type, { count, signalCounts }]) => ({
        type,
        count,
        by_signal: Array.from(signalCounts.entries())
          .map(([signal_type, signalCount]) => ({ signal_type, count: signalCount }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count);
  })();

  const capabilities = deriveAgentCapabilities(agent.tools_granted);
  const autonomyClassification = classifyAgentAutonomyLevel(agent.tools_granted);

  // Ticket Count Sync fix (2026-08-21) — the TRUE open count, via the same
  // shared per-agent query the org chart's badges and the Live Agents grid
  // use, independent of the `tickets` array's MAX_TICKETS cap above.
  const openTicketCount = adminUser ? await countOpenTicketsForAgent(adminUser.id, agent) : 0;

  // Agent Detail redesign, Track A1 (2026-09-21) — the Overview hero's honest
  // "Completed (30d)" tile (relabeled from the mockup's "Verified complete" —
  // see countCompletedTicketsForAgent()'s own header comment for why).
  const completedTicketCount30d = adminUser ? await countCompletedTicketsForAgent(adminUser.id, agent) : 0;

  // Agent Detail polish round 5 (2026-09-30) — Results & Reports' real
  // "Verified resolution" stat (see countVerifiedResolutionsForAgent()'s own
  // header comment for the honest evidence+success gate this mirrors).
  const verifiedResolution = adminUser
    ? await countVerifiedResolutionsForAgent(adminUser.id, agent)
    : { verified: 0, owned: 0, mostRecentVerifiedTicketId: null };

  // Dara v2 Phase 6 ("open-ticket accountability") — same shared query shape,
  // ASC instead of COUNT. Null (not 0) when there's nothing open, so a caller
  // never confuses "no data" with "brand new, zero days old".
  const oldestOpenTicketAge = adminUser ? await getOldestOpenTicketAge(adminUser.id, agent) : null;

  // Trust Contract fix (2026-08-24) — real, unlimited "last touched a ticket"
  // signal for agents `last_run_at` will never cover (see trust_contract's
  // last_activity_at doc comment above).
  const lastActivityAt = adminUser ? await getLastTicketActivityForAgent(adminUser.id, agent) : null;

  // reports_to (org-chart hierarchy build, 2026-08-19) — null when this agent
  // has no reports_to_type configured at all, never a fabricated empty shape.
  // buildReportsToView() above is the one canonical builder (extracted 2026-09-30
  // for the reports-to editor's write path to reuse — pure extraction here, zero
  // behaviour change).
  const reportsTo: AgentDetailResult['reports_to'] = await buildReportsToView(agent);

  // Task visibility (2026-08-26) — this agent's own real recurring tasks:
  // sibling AiAgent rows sharing its `module` (e.g. 'reese'), excluding
  // itself. Real, already-registered scheduled jobs (see agentRegistrySeed.ts)
  // that were never visible before because the detail page only ever loaded
  // the ONE row it was asked for. `[]`, not fetched at all, when this agent
  // has no `module` set — most agents don't, and a blank module would
  // otherwise match every other module-less row, which is not "related."
  const relatedTaskRows = agent.module
    ? await AiAgent.findAll({ where: { module: agent.module, id: { [Op.ne]: agent.id } }, order: [['agent_name', 'ASC']] })
    : [];

  // AI Employee Consolidation Program (2026-09-15/16) — real ownership via
  // parent_agent_id, distinct from relatedTaskRows' same-module inference
  // above (module-sharing is a loose heuristic; parent_agent_id is a real,
  // deliberate assignment made when a legacy item is actually absorbed).
  const ownedBehaviorRows = await AiAgent.findAll({
    where: { parent_agent_id: agent.id },
    order: [['agent_name', 'ASC']],
  });

  // Trust Contract Phase 1 (2026-08-26) — real version history, real cost,
  // real authorization verdicts. All three key on `agent.id` directly (not
  // `adminUser.id` like the tickets queries above), since ai_events and the
  // new history table are keyed on the real AiAgent row regardless of
  // whether it has a linked staff identity.
  const [personaVersionHistory, costRows, authorizationSummary, goalsResult, abacGlobalDefault] = await Promise.all([
    getPersonaVersionHistory(agent.id),
    agentCostRows(30, agent.id),
    getAgentAuthorizationSummary(agent.id, agent.agent_name, 30),
    computeAgentGoalsDimensions(agent),
    getAbacMode(),
  ]);
  const costSummary = costRows[0] ? { cost_usd: costRows[0].costUsd, runs: costRows[0].runs } : null;

  // Real-enforcement scoping, Phase 3 (2026-09-20) — the per-agent switch Ali asked for.
  // Global 'off' ALWAYS wins over any per-agent override, matching
  // authorizeAgentAction()'s own early return (its 'off' short-circuit happens BEFORE the
  // registry row/override is ever read — resolveEffectiveMode() is only ever called there in
  // the non-'off' branch). Reproduced here explicitly rather than calling
  // resolveEffectiveMode() unconditionally, which would incorrectly let an 'enforce' override
  // win over a global 'off' state on this page alone.
  const abacOverride = (agent as any).abac_mode_override ?? null;
  const abacEffectiveMode = abacGlobalDefault === 'off' ? 'off' : resolveEffectiveMode(abacGlobalDefault, abacOverride);

  // R9 — Ali, live: "I'd also like to see the last time the tool and
  // scheduled work was used/run and the ticket." Reese-only, computed from
  // the ticket rows already fetched above (zero new queries). `{}` for
  // every other agent — never populated outside this branch.
  const lastTicketByBehaviour =
    agent.agent_name === 'Reese' ? computeLastTicketPerBehaviour(allTicketTypeRows as any[]) : {};

  // Reese Product Phase 1, R7 — truthful employee facts, Reese-only. Gated
  // strictly on agent_name so no other agent's response shape or content
  // changes by a single byte (proven by this file's own existing tests,
  // which cover non-Reese agents and pass unmodified).
  const employeeFacts =
    agent.agent_name === 'Reese'
      ? await getReeseEmployeeFacts(agent, {
          lastTicketActivityAt: lastActivityAt,
          openTicketCount,
          reportsTo,
          reeseEnrollmentId: enrollmentId,
          relatedTasks: relatedTaskRows.map((t: any) => ({
            agent_name: t.agent_name,
            enabled: t.enabled,
            run_count: t.run_count ?? 0,
            error_count: t.error_count ?? 0,
          })),
          lastTicketByBehaviour,
        })
      : null;

  return {
    agent: {
      id: agent.id,
      agent_name: agent.agent_name,
      agent_type: agent.agent_type,
      category: agent.category ?? null,
      description: agent.description ?? null,
      system_prompt: agent.system_prompt ?? null,
      tools_granted: agent.tools_granted ?? null,
      persona_version: agent.persona_version ?? null,
      enabled: agent.enabled,
      created_at: agent.created_at ?? null,
      autonomy_level: agent.autonomy_level ?? null,
      department: agent.department ?? null,
      module: agent.module ?? null,
      source_file: agent.source_file ?? null,
      max_runs_per_hour: agent.max_runs_per_hour ?? null,
      max_writes_per_execution: agent.max_writes_per_execution ?? null,
      max_proposals_per_run: agent.max_proposals_per_run ?? null,
      autonomy_level_set_at: agent.autonomy_level_set_at ?? null,
      autonomy_level_source: agent.autonomy_level_source ?? null,
      reports_to_type: agent.reports_to_type ?? null,
      reports_to_id: agent.reports_to_id ?? null,
      abac_mode_override: abacOverride,
      abac_mode_override_set_at: (agent as any).abac_mode_override_set_at ?? null,
      abac_mode_override_set_by: (agent as any).abac_mode_override_set_by ?? null,
      abac_effective_mode: abacEffectiveMode,
      abac_global_default: abacGlobalDefault,
    },
    identity: adminUser
      ? {
          admin_user_id: adminUser.id,
          email: adminUser.email,
          display_name: adminUser.display_name ?? null,
          is_ai_operated: adminUser.is_ai_operated,
        }
      : null,
    live_status: liveStatus,
    open_ticket_count: openTicketCount,
    completed_ticket_count_30d: completedTicketCount30d,
    verified_resolution_count: verifiedResolution.verified,
    owned_ticket_count_all_time: verifiedResolution.owned,
    most_recent_verified_ticket_id: verifiedResolution.mostRecentVerifiedTicketId,
    oldest_open_ticket_age_days: oldestOpenTicketAge?.ageDays ?? null,
    tickets: tickets.map((t: any) => {
      const latestActivity = latestActivityByTicketId.get(t.id) ?? null;
      const needsReply = computeNeedsReply(latestActivity?.actor_id ?? null, ownIdentityIds);
      // Ticket due-date validation gap fix (2026-09-28) surfaced a real,
      // pre-existing bug here: Ticket.due_date is a Sequelize DATEONLY
      // column, which comes back from a real DB read as a plain string
      // (e.g. "2026-10-02"), never a JS Date, regardless of the model's
      // own `declare due_date: Date | null` claiming otherwise. Before this
      // session's fix, almost no ticket had a due_date at all, so
      // computeStatusBucket()'s `dueDate.getTime()` call almost never ran
      // against a real value — now every open ticket has one, so it ran on
      // every ticket and crashed this page's tickets mapping outright.
      // Coerce once, here, rather than trusting the model's own type.
      const dueDate = t.due_date ? new Date(t.due_date) : null;
      return {
        id: t.id,
        ticket_number: t.ticket_number ?? null,
        title: t.title,
        description: t.description ?? null,
        status: t.status,
        priority: t.priority,
        type: t.type,
        created_at: t.created_at ?? null,
        updated_at: t.updated_at ?? null,
        // Dashboard redesign, Slice 2a — real column, previously fetched but
        // never surfaced in this response (response-shape change only, no
        // schema change; see models/Ticket.ts's real due_date column).
        due_date: t.due_date ?? null,
        status_bucket: computeStatusBucket({ status: t.status, dueDate, needsReply }),
      };
    }),
    ticket_breakdown: ticketBreakdown,
    related_tasks: relatedTaskRows.map((t: any) => ({
      id: t.id,
      agent_name: t.agent_name,
      description: t.description ?? null,
      trigger_type: t.trigger_type ?? null,
      schedule: t.schedule || null,
      enabled: t.enabled,
      status: t.status,
      last_run_at: t.last_run_at ?? null,
      run_count: t.run_count ?? 0,
      error_count: t.error_count ?? 0,
      // R9 — Reese-only cross-reference (the "and the ticket" half of
      // Scheduled work). BEHAVIOUR_KEY_BY_CRON_AGENT_NAME has no entry for
      // any non-Reese sibling row, so this is `null` for every other agent.
      last_ticket: lastTicketByBehaviour[BEHAVIOUR_KEY_BY_CRON_AGENT_NAME[t.agent_name]] ?? null,
    })),
    owned_behaviors: ownedBehaviorRows.map((b: any) => ({
      id: b.id,
      agent_name: b.agent_name,
      record_kind: b.record_kind ?? null,
      description: b.description ?? null,
      trigger_type: b.trigger_type ?? null,
      schedule: b.schedule || null,
      enabled: b.enabled,
      migration_status: b.migration_status ?? null,
    })),
    persona_version_history: personaVersionHistory,
    cost_summary: costSummary,
    authorization_summary: authorizationSummary,
    capabilities: {
      reads: capabilities.reads,
      produces: capabilities.produces,
      undocumented_tools: capabilities.undocumentedTools,
      produced_ticket_types: Array.from(new Set((allTicketTypeRows as any[]).map((t) => t.type))),
      by_tool: capabilities.byTool.map((t) => ({ tool: t.tool, reads: t.reads, produces: t.produces, documented: t.documented })),
    },
    autonomy_explanation: {
      level: autonomyClassification.level,
      reason: autonomyClassification.reason,
      matched_tool: autonomyClassification.matchedTool,
    },
    reports_to: reportsTo,
    trust_contract: {
      trigger_type: agent.trigger_type ?? null,
      schedule: agent.schedule || null,
      status: agent.status,
      last_run_at: agent.last_run_at ?? null,
      run_count: agent.run_count ?? 0,
      error_count: agent.error_count ?? 0,
      avg_duration_ms: agent.avg_duration_ms ?? null,
      last_error: agent.last_error ?? null,
      last_error_at: agent.last_error_at ?? null,
      last_activity_at: lastActivityAt,
    },
    goals: goalsResult.goals,
    goals_overall: goalsResult.goalsOverall,
    employee_facts: employeeFacts,
  };
}
