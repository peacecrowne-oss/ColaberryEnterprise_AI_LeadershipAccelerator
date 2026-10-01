/**
 * workforceController — HTTP boundary for the AI Workforce Operating System.
 * Admin-only, /api/admin/workforce/*.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  roster, office, briefing, runDailyMeeting, listMeetings,
  listTasks, createTask, updateTask, listMessages, review, analytics,
} from '../services/workforce/workforceService';
import { listLiveAgents, listLiveAgentActivity } from '../services/workforce/liveAgentsService';
import { listLiveAgentTimeline } from '../services/workforce/liveAgentsTimelineService';
import { getOrgChart, NAMED_DEPARTMENTS } from '../services/workforce/orgChartService';
import { workforceOrgChartResponseSchema } from '../schemas/workforceOrgChartSchema';
import {
  updateOrgMemberTeam,
  resolveDownstreamForAdminEmail,
  scopeOrgChartToHuman,
  emptyOrgChartResponse,
} from '../services/workforce/orgChartHierarchyService';
import { assignTaskToAgent } from '../services/workforce/orgChartTaskAssignmentService';
import { resetAgents } from '../services/workforce/agentResetService';
import { reactivateAgent, AUTONOMY_LEVELS } from '../services/workforce/agentReactivationService';
import { setAgentAbacOverride, ABAC_OVERRIDE_VALUES } from '../services/workforce/agentAbacOverrideService';
import { setAgentReportsTo } from '../services/workforce/agentReportsToService';
import { checkWireContract } from '../utils/responseContract';

function fail(res: Response, err: any, next: NextFunction) {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', issues: err.issues });
  if (err && typeof err.status === 'number') return res.status(err.status).json({ error: err.message });
  return next(err);
}

export async function handleRoster(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await roster()); } catch (e) { fail(res, e, next); }
}
export async function handleOffice(req: Request, res: Response, next: NextFunction) {
  try { res.json(await office(String(req.params.slug))); } catch (e) { fail(res, e, next); }
}
export async function handleBriefing(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await briefing()); } catch (e) { fail(res, e, next); }
}
export async function handleDailyMeeting(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await runDailyMeeting()); } catch (e) { fail(res, e, next); }
}
export async function handleMeetings(_req: Request, res: Response, next: NextFunction) {
  try { res.json({ meetings: await listMeetings() }); } catch (e) { fail(res, e, next); }
}
export async function handleListTasks(req: Request, res: Response, next: NextFunction) {
  try { res.json({ tasks: await listTasks(typeof req.query.status === 'string' ? req.query.status : undefined) }); } catch (e) { fail(res, e, next); }
}
const createSchema = z.object({ employee_slug: z.string().min(1), title: z.string().min(1), description: z.string().optional(), priority: z.enum(['low', 'medium', 'high']).optional(), deadline: z.string().nullable().optional() });
export async function handleCreateTask(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await createTask(createSchema.parse(req.body || {}))); } catch (e) { fail(res, e, next); }
}
export async function handleUpdateTask(req: Request, res: Response, next: NextFunction) {
  try { res.json(await updateTask(String(req.params.id), String(req.body?.status))); } catch (e) { fail(res, e, next); }
}
export async function handleMessages(_req: Request, res: Response, next: NextFunction) {
  try { res.json({ messages: await listMessages() }); } catch (e) { fail(res, e, next); }
}
export async function handleReview(req: Request, res: Response, next: NextFunction) {
  try { res.json(await review(String(req.params.slug))); } catch (e) { fail(res, e, next); }
}
export async function handleAnalytics(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await analytics()); } catch (e) { fail(res, e, next); }
}

// Reese Phase 4 (Workforce integration) — real, DB-backed AiAgent rows built via
// the agentBlueprint pattern, distinct from the static AI_ORG director roster above.
export async function handleListLiveAgents(_req: Request, res: Response, next: NextFunction) {
  try { res.json({ agents: await listLiveAgents() }); } catch (e) { fail(res, e, next); }
}
export async function handleListLiveAgentActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    res.json({ activity: await listLiveAgentActivity(Number.isFinite(limit) ? limit : undefined) });
  } catch (e) { fail(res, e, next); }
}

/**
 * Org Chart v4 (2026-08-20) — GET /api/admin/workforce/live-agents/timeline.
 * Real ticket-lifecycle events (created/status-changed/closed), replacing
 * WorkforceOSPage's old flat one-row-per-ticket Activity Timeline list. Zod-
 * validated `limit` (this IS a new route boundary — CLAUDE.md Contract
 * Enforcement Layer) rather than the manual parseInt() the sibling
 * `/live-agents/activity` route above still uses (pre-existing, out of scope
 * to retrofit here).
 */
const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export async function handleListLiveAgentTimeline(req: Request, res: Response, next: NextFunction) {
  try {
    const { limit } = timelineQuerySchema.parse(req.query);
    res.json({ timeline: await listLiveAgentTimeline(limit) });
  } catch (e) { fail(res, e, next); }
}

/**
 * Org-chart hierarchy build (2026-08-19) — GET /api/admin/workforce/org-chart.
 * Real 3-tier tree (Human Employees -> AI Leadership -> AI Staff). Response
 * shape checked against workforceOrgChartResponseSchema before sending: fail
 * loud (console.warn, structured) in dev, log-and-continue in production —
 * same pattern as capePortalController.ts::handleGetSkillProfile().
 *
 * Track B (2026-09-22) — additive `?scope=mine` boolean flag: when set, the
 * response is scoped down to the caller's own downstream (themselves as the
 * one human, their real AI Leadership, their real AI Staff). The unscoped
 * path stays byte-for-byte identical to before this slice — every admin
 * still sees the whole org chart by default; "my team" is a display filter
 * on top, never a new authorization boundary. The caller's identity is
 * ALWAYS derived server-side from the JWT-verified req.admin.email, never
 * from a client-supplied id, deliberately avoiding the client-supplied-id
 * vulnerability class agentManagerAuthMiddleware.ts's own header comment
 * flags elsewhere in this codebase.
 */
const orgChartQuerySchema = z.object({ scope: z.enum(['mine']).optional() });

export async function handleOrgChart(req: Request, res: Response, _next: NextFunction) {
  try {
    const { scope } = orgChartQuerySchema.parse(req.query);
    const chart = await getOrgChart();

    let responseChart = chart;
    if (scope === 'mine') {
      const resolved = await resolveDownstreamForAdminEmail(req.admin!.email);
      responseChart = resolved
        ? scopeOrgChartToHuman(chart, resolved.human, resolved.downstream)
        : emptyOrgChartResponse(chart);
    }

    // Validates the WIRE shape (post-JSON-serialization - Dates become ISO strings),
    // not the raw service object, since that is what the frontend contract promises to
    // consume. A check against the raw object can pass while what is actually sent does
    // not match, which reports success about a payload nobody looked at. The scoped
    // response is a strict subset of the same shape, so the same schema applies unchanged.
    checkWireContract('workforce_org_chart_contract_violation', workforceOrgChartResponseSchema, responseChart);
    res.json(responseChart);
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', issues: e.issues });
      return;
    }
    // Deliberately does NOT fall through to fail()'s next(err) path for an
    // unclassified error (real BREAK-phase finding, org-chart hierarchy build,
    // 2026-08-19): Express's own default error handler renders a full HTML
    // page WITH the stack trace whenever NODE_ENV isn't 'production', which
    // is exactly the "leaks the API response into user-facing surfaces" case
    // CLAUDE.md's Security Enforcement Layer forbids. This route always
    // returns a clean, generic, non-leaking JSON 500 itself, logging the real
    // error server-side with a stable error_class.
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(), level: 'error', service: 'backend',
      event: 'workforce_org_chart_error', outcome: 'failure',
      error_class: e?.error_class || e?.name || 'Error',
      context: { message: e?.message },
    }));
    res.status(500).json({ error: 'Could not build the org chart.' });
  }
}

/**
 * Org Chart v3 (2026-08-19) — PATCH /api/admin/workforce/org-chart/members/:id/team.
 * Ali, live: "Give me the ability to switch the people between teams." Zod
 * enforces the value is one of the 6 real named departments (or `null`, to
 * clear it — buckets into "Other" on next read) BEFORE it ever reaches the
 * service layer; the service (orgChartHierarchyService.ts) validates again
 * independently as a second, reusable-beyond-HTTP guard. Named errors
 * (`InvalidDepartmentError`/`OrgMemberNotFoundError`) both carry a `status`
 * property the existing `fail()` helper already knows how to read — zero
 * changes needed to `fail()` itself.
 */
const updateTeamSchema = z.object({ team: z.enum([...NAMED_DEPARTMENTS]).nullable() });
export async function handleUpdateOrgMemberTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const { team } = updateTeamSchema.parse(req.body || {});
    const member = await updateOrgMemberTeam(String(req.params.id), team);
    res.json(member);
  } catch (e) { fail(res, e, next); }
}

/**
 * Org Chart v3 (2026-08-19) — POST /api/admin/workforce/org-chart/members/:id/tasks.
 * Ali, live: "The human has the ability to create and assign tasks to any
 * agent in it's hierarchy even if they report to another AI Agent."
 * `idempotency_key` is required (not optional) per CLAUDE.md's Idempotency &
 * Replayability section — see orgChartTaskAssignmentService.ts for the real
 * dedup mechanism this enables. `AgentNotInHierarchyError` carries
 * `status = 403`, picked up by the existing `fail()` helper unchanged.
 */
const assignTaskSchema = z.object({
  agent_id: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  idempotency_key: z.string().min(1).max(200),
});
export async function handleAssignHierarchyTask(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = assignTaskSchema.parse(req.body || {});
    const ticket = await assignTaskToAgent({
      orgMemberId: String(req.params.id),
      agentId: parsed.agent_id,
      title: parsed.title,
      description: parsed.description,
      idempotencyKey: parsed.idempotency_key,
    });
    res.status(201).json(ticket);
  } catch (e) { fail(res, e, next); }
}

/**
 * AI Workforce Reset (2026-08-24) — POST /api/admin/workforce/agents/reset.
 * Ali, live: deactivate a specific, explicit set of AI-generated agents and
 * cancel their open tickets, so he can rebuild the roster deliberately. No
 * "reset everything" mode — `agent_ids` is required and explicit, never
 * inferred, so this can never silently touch an agent outside the list a
 * human actually chose. See agentResetService.ts for the real, reversible
 * (enabled:false, real ticket cancellation via updateTicketStatus()) mechanism.
 */
const resetAgentsSchema = z.object({
  agent_ids: z.array(z.string().min(1)).min(1).max(100),
});
export async function handleResetAgents(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = resetAgentsSchema.parse(req.body || {});
    const actorId = req.admin?.email || req.admin?.sub || 'unknown-admin';
    const results = await resetAgents(parsed.agent_ids, actorId);
    res.json({ results });
  } catch (e) { fail(res, e, next); }
}

/**
 * AI Workforce Reset, Phase C (2026-08-24) — POST
 * /api/admin/workforce/agents/:id/reactivate. Ali, live: "add new ones
 * slowly... so I can see how they perform." `autonomy_level` is required
 * (one of docs/ai-governance/abac-design.md's already-proposed 4-level
 * ladder) — bringing an agent back online is a deliberate, visible act, not
 * a silent flip. See agentReactivationService.ts for the real mechanism.
 */
const reactivateAgentSchema = z.object({
  autonomy_level: z.enum(AUTONOMY_LEVELS),
});
export async function handleReactivateAgent(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = reactivateAgentSchema.parse(req.body || {});
    const result = await reactivateAgent(String(req.params.id), parsed.autonomy_level);
    res.json({ result });
  } catch (e) { fail(res, e, next); }
}

/**
 * Real-enforcement scoping, Phase 3 (2026-09-20) — PATCH
 * /api/admin/workforce/agents/:id/abac-override. Ali, live: "I would like a
 * switch for each agent so I can turn off/on Shadow mode." `override` is
 * `'shadow' | 'enforce' | null` — `null` clears the override and reverts the
 * agent to following the global `abac_enforcement` default. Deliberately
 * excludes `'off'`: that stays a global-only concept, a broader bypass than
 * the shadow/enforce toggle this switch was actually asked for. See
 * agentAbacOverrideService.ts for the real mechanism.
 */
const setAbacOverrideSchema = z.object({
  override: z.enum(ABAC_OVERRIDE_VALUES).nullable(),
});
export async function handleSetAgentAbacOverride(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = setAbacOverrideSchema.parse(req.body || {});
    const actorId = req.admin?.email || req.admin?.sub || 'unknown-admin';
    const result = await setAgentAbacOverride(String(req.params.id), parsed.override, actorId);
    res.json({ result });
  } catch (e) { fail(res, e, next); }
}

/**
 * Reports-to editor (2026-09-30). `reports_to_type`/`reports_to_id` are both required —
 * unlike the ABAC override, this write deliberately has no "clear it" mode: every AI
 * employee must have exactly one direct accountable human in its reports-to chain. See
 * agentReportsToService.ts for the real mechanism, including the pre-persist chain
 * validation.
 */
const setReportsToSchema = z.object({
  reports_to_type: z.enum(['human', 'agent']),
  reports_to_id: z.string().uuid(),
});
export async function handleSetAgentReportsTo(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = setReportsToSchema.parse(req.body || {});
    const actorId = req.admin?.email || req.admin?.sub || 'unknown-admin';
    const result = await setAgentReportsTo(String(req.params.id), parsed.reports_to_type, parsed.reports_to_id, actorId);
    if (!result.updated) return res.status(400).json({ error: result.error || 'Failed to update reports-to' });
    res.json({ result });
  } catch (e) { fail(res, e, next); }
}
