/** AI Workforce Operating System (Phase 5) — admin routes. /api/admin/workforce. */
import { Router } from 'express';
import { requireAdmin } from '../../middlewares/authMiddleware';
import {
  handleRoster, handleOffice, handleBriefing, handleDailyMeeting, handleMeetings,
  handleListTasks, handleCreateTask, handleUpdateTask, handleMessages, handleReview, handleAnalytics,
  handleListLiveAgents, handleListLiveAgentActivity, handleListLiveAgentTimeline, handleOrgChart,
  handleUpdateOrgMemberTeam, handleAssignHierarchyTask, handleResetAgents, handleReactivateAgent,
  handleSetAgentAbacOverride, handleSetAgentReportsTo,
} from '../../controllers/workforceController';

const router = Router();

router.get('/api/admin/workforce/roster', requireAdmin, handleRoster);
router.get('/api/admin/workforce/briefing', requireAdmin, handleBriefing);
router.post('/api/admin/workforce/meeting/daily', requireAdmin, handleDailyMeeting);
router.get('/api/admin/workforce/meetings', requireAdmin, handleMeetings);
router.get('/api/admin/workforce/tasks', requireAdmin, handleListTasks);
router.post('/api/admin/workforce/tasks', requireAdmin, handleCreateTask);
router.put('/api/admin/workforce/tasks/:id', requireAdmin, handleUpdateTask);
router.get('/api/admin/workforce/messages', requireAdmin, handleMessages);
router.get('/api/admin/workforce/analytics', requireAdmin, handleAnalytics);
router.get('/api/admin/workforce/employee/:slug/review', requireAdmin, handleReview);
router.get('/api/admin/workforce/employee/:slug', requireAdmin, handleOffice);

// Reese Phase 4 (Workforce integration) — real, DB-backed AiAgent rows built via the
// agentBlueprint pattern (see liveAgentsService.ts), distinct from the static AI_ORG
// director roster the routes above are keyed to.
router.get('/api/admin/workforce/live-agents', requireAdmin, handleListLiveAgents);
router.get('/api/admin/workforce/live-agents/activity', requireAdmin, handleListLiveAgentActivity);

// Org Chart v4 (2026-08-20) — real ticket-lifecycle Activity Timeline
// (created/status-changed/closed), not just a ticket's current status. See
// liveAgentsTimelineService.ts. Additive alongside /activity above, not a
// replacement — that route stays available/tested even though the frontend
// switches to this one.
router.get('/api/admin/workforce/live-agents/timeline', requireAdmin, handleListLiveAgentTimeline);

// Org-chart hierarchy build (2026-08-19) — real Human Employees -> AI
// Leadership -> AI Staff tree, replacing the static AI_ORG roster's "who's in
// this org" answer with the real one. See services/workforce/orgChartService.ts.
router.get('/api/admin/workforce/org-chart', requireAdmin, handleOrgChart);

// Org Chart v3 (2026-08-19) — Ali: "Give me the ability to switch the people
// between teams." Grouped under the org-chart namespace since it's an
// org-chart-page-specific action, distinct from the generic employee_slug-
// keyed /tasks endpoints above (a different, older data model).
router.patch('/api/admin/workforce/org-chart/members/:id/team', requireAdmin, handleUpdateOrgMemberTeam);

// Org Chart v3 (2026-08-19) — Ali: "The human has the ability to create and
// assign tasks to any agent in it's hierarchy even if they report to
// another AI Agent." Server-side authorization re-validated inside
// assignTaskToAgent() — never trusts req.params/req.body alone.
router.post('/api/admin/workforce/org-chart/members/:id/tasks', requireAdmin, handleAssignHierarchyTask);

// AI Workforce Reset (2026-08-24) — Ali, live: deactivate a specific,
// explicit set of AI-generated agents and cancel their open tickets. See
// agentResetService.ts and handleResetAgents()'s own header comment.
router.post('/api/admin/workforce/agents/reset', requireAdmin, handleResetAgents);

// AI Workforce Reset, Phase C (2026-08-24) — reactivate one deactivated
// agent, requiring a real autonomy level. See handleReactivateAgent()'s own
// header comment.
router.post('/api/admin/workforce/agents/:id/reactivate', requireAdmin, handleReactivateAgent);

// Real-enforcement scoping, Phase 3 (2026-09-20) — the per-agent shadow/enforce switch Ali
// asked for. See handleSetAgentAbacOverride()'s own header comment.
router.patch('/api/admin/workforce/agents/:id/abac-override', requireAdmin, handleSetAgentAbacOverride);

// Reports-to editor (2026-09-30) — Dhee: "I should be able to change who Reese reports to."
// No real write path existed anywhere before this. See handleSetAgentReportsTo()'s own
// header comment and agentReportsToService.ts for the real pre-persist chain validation.
router.patch('/api/admin/workforce/agents/:id/reports-to', requireAdmin, handleSetAgentReportsTo);

export default router;
