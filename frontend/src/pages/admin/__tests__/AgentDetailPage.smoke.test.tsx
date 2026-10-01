import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AgentDetailPage from '../AgentDetailPage';
import { AgentDetail } from '../../../services/agentDetailApi';

// Chat formatting fix (2026-09-29) — AgentTalkTab (rendered by this page's
// Talk tab) now imports react-markdown, which is pure ESM with a large
// transitive dependency tree Jest can't resolve under this repo's pinned
// react-scripts 5 (a real, pre-existing gap — see AgentTalkTab.test.tsx's
// own comment for the full explanation). Mocked here too since this file
// imports AgentDetailPage, which imports AgentTalkTab transitively.
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => children }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

/**
 * Reese Phase 1 (T012). Follows the established no-browser smoke-check pattern
 * already used for sibling admin pages (AdminWorkLedgerHealthPage.smoke.test.tsx):
 * `renderToStaticMarkup` never runs `useEffect` (no commit phase in static
 * rendering), so it never fires the real `getAgentDetail` API call this page
 * makes on mount — it only proves the page's INITIAL render (loading state,
 * before the fetch resolves) is safe: no crash from `useParams`, the shell
 * component imports, or the props wiring. Full data-rendering behavior is
 * proven live in production verification (Phase I) with a real screenshot.
 */

function renderPage() {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/admin/agents/agent-1']}>
      <Routes>
        <Route path="/admin/agents/:id" element={<AgentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AgentDetailPage (Reese Phase 1 transparency page)', () => {
  it('renders its initial loading state without throwing', () => {
    expect(() => renderPage()).not.toThrow();
    const html = renderPage();
    expect(html).toContain('spinner-border');
  });
});

// T007 (ticket-ux-fixes run) — Ali's live feedback: "Conditional formatting on the
// status in the Agent Dashboard" + "Format the time everywhere you see it to cst."
// Needs the real post-fetch render (unlike the static-markup test above), so this
// uses the react-dom/client + act pattern established in
// WorkforceOSPage.smoke.test.tsx, mocking getAgentDetail directly.
jest.mock('../../../services/agentDetailApi', () => ({ getAgentDetail: jest.fn(), setAgentAbacOverride: jest.fn(), setAgentReportsTo: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAgentDetail } = require('../../../services/agentDetailApi') as { getAgentDetail: jest.Mock };
// AI Workforce Reset (2026-08-24) — the "Deactivate" button's real API call.
// Phase C adds reactivateAgent() + the real AUTONOMY_LEVELS/descriptions the
// component imports directly (not mockable per-call — must exist here since
// the module itself is mocked).
jest.mock('../../../services/workforceOrgChartApi', () => ({
  resetAgents: jest.fn(),
  reactivateAgent: jest.fn(),
  getOrgChart: jest.fn(),
  AUTONOMY_LEVELS: ['observe', 'suggest', 'act_audited', 'communicate'],
  AUTONOMY_LEVEL_DESCRIPTIONS: {
    observe: 'Read only — the safest starting point for any agent coming back online.',
    suggest: 'May propose actions for human review, never executes them directly.',
    act_audited: 'May write to an allowlisted set of tables; every write is audited.',
    communicate: 'May send outbound email/SMS/voice/social, within scope + consent + approval rules.',
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resetAgents, reactivateAgent } = require('../../../services/workforceOrgChartApi') as {
  resetAgents: jest.Mock;
  reactivateAgent: jest.Mock;
};

// At a Glance, Checkpoint F (2026-09-03) — "At a Glance" was the default
// tab at the time (superseded by the Agent Detail redesign Track A1,
// 2026-09-21 — Overview is the default now), so every test in this file
// that mounts the page also mounted AgentAtAGlanceTab, which fetches the
// manager inbox (real, page-level fetch, previously never triggered by
// Overview) plus its own 4 summary endpoints. None of these were ever
// mocked in this file before that — unmocked, they'd hit a real
// (nonexistent, in jsdom) network call, and
// (confirmed live, the hard way) a bare `jest.fn()` with no resolved value
// makes `await getManagerInboxItems(id)` resolve to `undefined`, which
// `setInboxItems` then happily stores — `inboxItems.length` inside
// AgentAtAGlanceTab crashes on the very next render. Every describe
// block's own beforeEach already re-applies `getAgentDetail.mockResolvedValue`
// after `jest.clearAllMocks()` (the established pattern in this file) —
// these 5 new mocks follow the identical convention, applied per describe
// block below, not once at module scope.
jest.mock('../../../services/managerInboxApi', () => ({ getManagerInboxItems: jest.fn(), approveInboxItem: jest.fn(), getInboxItemInspector: jest.fn() }));
jest.mock('../../../services/ticketSummaryApi', () => ({ getTicketSummary: jest.fn() }));
jest.mock('../../../services/managerDirectiveApi', () => ({ listDirectives: jest.fn(), revokeDirective: jest.fn() }));
jest.mock('../../../services/agentReportSubscriptionApi', () => ({ listReportSubscriptions: jest.fn() }));
jest.mock('../../../services/agentGoalApi', () => ({ listGoals: jest.fn() }));
jest.mock('../../../services/agentOneOnOneApi', () => ({ listOneOnOnes: jest.fn() }));
// Dashboard redesign, Slice 1 (2026-09-19) — Performance & Settings'
// "Authority & controls" sub-tab mounts AgentTrustControlTab, which this
// file never needed to mock before (it was reached via a different tab).
jest.mock('../../../services/agentMemoryProposalApi', () => ({ listMemoryProposals: jest.fn() }));
// Role Charter tile, Checkpoint H (2026-09-10) — a 6th summary fetch,
// same reasoning as the 5 above: CRA's Jest preset runs `resetMocks: true`
// between every test (wipes implementations, not just call history — this
// file's own comment above already documents the exact same bare-`jest.fn()`
// -resolves-`undefined` crash for a different mock), so the resolved value
// set in the factory here is only a first-test fallback; every describe
// block's own beforeEach re-applies it explicitly, same convention as the
// other 5.
jest.mock('../../../services/agentRoleCharterApi', () => ({
  getAgentRoleCharter: jest.fn().mockResolvedValue({ agentId: 'agent-reese', charter: null }),
}));
// "Work, explained" (Overview tab) — same convention as agentRoleCharterApi above: every
// describe block's own beforeEach re-applies this explicitly.
jest.mock('../../../services/agentExplainabilityApi', () => ({ getAgentExplainability: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAgentExplainability } = require('../../../services/agentExplainabilityApi') as { getAgentExplainability: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getManagerInboxItems } = require('../../../services/managerInboxApi') as { getManagerInboxItems: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listDirectives } = require('../../../services/managerDirectiveApi') as { listDirectives: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listReportSubscriptions } = require('../../../services/agentReportSubscriptionApi') as { listReportSubscriptions: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listGoals } = require('../../../services/agentGoalApi') as { listGoals: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listOneOnOnes } = require('../../../services/agentOneOnOneApi') as { listOneOnOnes: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listMemoryProposals } = require('../../../services/agentMemoryProposalApi') as { listMemoryProposals: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAgentRoleCharter } = require('../../../services/agentRoleCharterApi') as { getAgentRoleCharter: jest.Mock };

const DETAIL: AgentDetail = {
  agent: {
    id: 'agent-reese',
    agent_name: 'Reese',
    agent_type: 'ai_staff_mentor',
    category: 'student_success',
    description: null,
    system_prompt: null,
    tools_granted: null,
    persona_version: null,
    enabled: true,
    created_at: null,
    // AI Workforce Reset, Phase C (2026-08-24) — honest null: this fixture
    // agent has never been through the reactivation flow.
    autonomy_level: null,
    // Trust & Control slice 2 (2026-09-03).
    department: null, module: null, source_file: null,
    max_runs_per_hour: 60, max_writes_per_execution: 100, max_proposals_per_run: 50,
    autonomy_level_set_at: null,
    autonomy_level_source: null,
    reports_to_type: null, reports_to_id: null,
    abac_mode_override: null,
    abac_mode_override_set_at: null,
    abac_mode_override_set_by: null,
    abac_effective_mode: 'shadow',
    abac_global_default: 'shadow',
  },
  identity: null,
  live_status: 'online',
  // Ticket Count Sync fix (2026-08-21) — the server's TRUE open count,
  // independent of the tickets array below (which is display-capped). Matches
  // this fixture's 1 open ticket (t-1) + 1 closed (t-2) for consistency, though
  // the two are intentionally separate fields/queries in the real service.
  open_ticket_count: 1,
  completed_ticket_count_30d: 0,
  verified_resolution_count: 0,
  owned_ticket_count_all_time: 0,
  most_recent_verified_ticket_id: null,
  tickets: [
    { id: 't-1', ticket_number: 1, title: 'Reaching out to Jordan Rivera', description: 'Reese is proactively reaching out to Jordan Rivera. Signal: inactivity. Goal: Confirm the student is unblocked and re-engaged with the curriculum within 7 days.', status: 'in_progress', priority: 'high', type: 'reese_autonomous_outreach', created_at: null, updated_at: '2026-08-12T15:00:00Z', due_date: null, status_bucket: 'open' },
    { id: 't-2', ticket_number: 2, title: 'DM conversation with Alex Chen', description: null, status: 'done', priority: 'medium', type: 'student_support', created_at: null, updated_at: '2026-01-15T15:00:00Z', due_date: null, status_bucket: null },
  ],
  // Task visibility (2026-08-26) — base fixture: matches Reese's real base
  // case (no `module` set on this fixture's agent), same honest-empty
  // pattern the backend uses. Individual tests below override to cover the
  // populated cases.
  ticket_breakdown: [],
  related_tasks: [],
  owned_behaviors: [],
  // Trust Contract Phase 1 (2026-08-26) — base fixture: honest-empty, same
  // pattern as ticket_breakdown/related_tasks above. Individual tests below
  // override to cover the populated cases.
  persona_version_history: [],
  cost_summary: null,
  authorization_summary: { window_days: 30, total: 0, allow: 0, approval: 0, block: 0, enforced_count: 0 },
  capabilities: {
    reads: ['ProofDesk learner-progress signals (XP, competencies, timeline state) for the student in the conversation'],
    produces: ['A reply message in the student DM thread'],
    undocumented_tools: [],
    produced_ticket_types: ['reese_autonomous_outreach', 'student_support'],
    by_tool: [
      { tool: 'respond_to_dm', reads: [], produces: ['A reply message in the student DM thread'], documented: true },
      { tool: 'read_learner_context', reads: ['ProofDesk learner-progress signals (XP, competencies, timeline state) for the student in the conversation'], produces: [], documented: true },
    ],
  },
  // UI follow-up to fleet-wide autonomy classification (2026-09-15) — base
  // fixture matches this DETAIL's own tools_granted: null, so the real
  // classifier's honest no-data default (real reason text, copied verbatim
  // from agentCapabilityClassifier.ts's DEFAULT_CLASSIFICATION).
  autonomy_explanation: {
    level: 'observe',
    reason: 'No tools_granted recorded for this agent — the safe, honest default, not a guess.',
    matched_tool: null,
  },
  // Org-chart hierarchy build (2026-08-19) — Reese's real shape: AI Staff
  // reporting through workforce_intelligence_engine to Kes.
  reports_to: {
    trail: ['Reese (agent)', 'workforce_intelligence_engine (agent) -> [human]'],
    resolved_human: { id: '3df017df-affa-49ab-884f-a99a4bd2ef4e', name: 'Kes', email: 'kesetebirhan@gmail.com' },
    immediate_agent: { id: 'agent-wie', name: 'workforce_intelligence_engine' },
  },
  // Trust Contract (2026-08-24) — Reese's real shape: identity-only, invoked
  // outside the generic scheduler wrapper, so last_run_at/run_count/error_count
  // are honest zeros. last_activity_at is NOT zero — this mirrors Reese's real
  // production state (Trust Contract fix, 2026-08-24): real ticket activity
  // exists even though the scheduler never tracked a "run".
  trust_contract: {
    trigger_type: 'event_driven',
    schedule: null,
    status: 'idle',
    last_run_at: null,
    run_count: 0,
    error_count: 0,
    avg_duration_ms: null,
    last_error: null,
    last_error_at: null,
    last_activity_at: '2026-08-24T10:00:00Z',
  },
  goals: [],
  goals_overall: 0,
  employee_facts: null,
};

let container: HTMLDivElement;
let root: Root;

// At a Glance, Checkpoint F (2026-09-03) — "Overview" is no longer the
// default tab; its real content (identity, tools, reports-to, trust
// contract, system prompt) moved into Command Center, unchanged. Every
// test below that asserts on that content needs that tab open first — done
// once, here, so all 50+ call sites below get it for free instead of
// touching each test individually. The one call site that predates this
// helper (line ~31, a separate `renderPage()` using `renderToStaticMarkup`)
// never fires `useEffect` at all, so it's unaffected by tab default.
//
// Checkpoint G (2026-09-10) — Command Center unfolded into "Live Status"
// (real-time content) and "Overview" (this content, unchanged, now its own
// top-level tab again). Updated to click "Overview" instead — the exact
// one-line change this comment always anticipated.
//
// Checkpoint H (2026-09-10) — Overview's own nine flat sections became
// seven sub-tabs. Superseded the next day (Checkpoint I) — see below.
//
// Checkpoint I (2026-09-11) — Ali pasted a full mockup and asked to match
// its format: Overview is a single flowing page again (AgentOverviewV2),
// no sub-tabs. The `overviewSubTab` param and its click logic are gone —
// every call site below that used to pass one now just gets the whole
// page's real content from a single "Overview" tab click.
async function renderAgentPage() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/admin/agents/agent-reese']}>
        <Routes>
          <Route path="/admin/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const overviewTabButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Overview');
  if (overviewTabButton) {
    await act(async () => {
      overviewTabButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

// Agent Detail polish round 3 (2026-09-29) — Ali, live: "let's remove ticket
// activity since it's redundant and we already have it in the work
// category." Retired 3 describe blocks (10 tests) that exercised
// AgentOverviewV2Tickets.tsx's own Overview mount, which this round removes:
// "Ticket activity table: colored status badges + CST timestamps",
// "'last activity' indicator on the ticket-activity table", and (further
// below) "'Ticket activity' table: Why column and ticket_breakdown summary".
// A deliberate, disclosed consequence of Ali's own removal instruction —
// same precedent as AgentDetailPage.commandCenter.test.tsx's full deletion
// in polish round 2 when its tab was removed.

// Agent Detail transparency, part 2 (2026-08-18, session CC-20260818-wf9k) —
// "what it reads / what it produces", derived from real tools_granted + real
// observed ticket types, never hand-written per-agent prose.
describe('AgentDetailPage — "what this agent reads / produces" section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it('renders the real reads/produces text derived from tools_granted, and the live produced-ticket-type badges', async () => {
    getAgentDetail.mockResolvedValue(DETAIL);

    // Dashboard redesign, Slice 1 (2026-09-19) — Capabilities relocated to
    // Performance & Settings' "Tools & channels" sub-tab.
    await renderToolsChannelsTab();

    expect(container.textContent).toContain('Capabilities');
    expect(container.textContent).toContain('ProofDesk learner-progress signals');
    expect(container.textContent).toContain('A reply message in the student DM thread');
    // Ticket-type badges reuse the same getTicketTypeLabel() humanization as the
    // Ticket activity table below it — "Reese Outreach" is reese_autonomous_outreach's label.
    expect(container.textContent).toContain('Reese Outreach');
    expect(container.textContent).toContain('Student Support');
  });

  it('honesty path: an agent with an undocumented tool renders the disclosure note, never silent, never fabricated text', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      capabilities: { reads: [], produces: [], undocumented_tools: ['a_tool_from_the_future'], produced_ticket_types: [], by_tool: [] },
    });

    await renderToolsChannelsTab();

    expect(container.textContent).toContain('a_tool_from_the_future');
    expect(container.textContent).toContain('no documented reads/produces yet');
  });

  it('boundary: an agent with empty reads/produces (no granted tools) shows an honest empty state, not a blank section', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      capabilities: { reads: [], produces: [], undocumented_tools: [], produced_ticket_types: [], by_tool: [] },
    });

    await renderToolsChannelsTab();

    expect(container.textContent).toContain("don't read any external data source");
    expect(container.textContent).toContain("don't produce anything on their own");
  });
});

// Agent Alias & Identity Fix — page title/breadcrumb prefer the real
// AdminUser.display_name over the raw technical agent_name (same bug, same fix
// as the Live Agents card list).
describe('AgentDetailPage — title prefers identity.display_name over raw agent_name', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it('display name fix: renders the real display_name in the title when identity exists and differs from agent_name', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      agent: { ...DETAIL.agent, id: 'agent-process-1', agent_name: 'cory-engine' },
      identity: { admin_user_id: 'admin-process-1', email: 'cory-engine@colaberry.com', display_name: 'Cory Engine — Autonomous Operations', is_ai_operated: true },
    });

    await renderAgentPage();

    expect(container.textContent).toContain('Cory Engine — Autonomous Operations');
    // The h1/page title must never show the raw technical id.
    const h1 = container.querySelector('h1, .page-title, [class*="title"]');
    expect(h1?.textContent).not.toBe('cory-engine');
  });

  it('boundary: falls back to agent_name when identity is null (a non-blueprint agent with no linked AdminUser)', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, identity: null });

    await renderAgentPage();

    expect(container.textContent).toContain('Reese');
  });
});

// Org-chart hierarchy build (2026-08-19) — "Reports to" section: this agent's
// real accountability chain, reused from AgentDetailResult.reports_to rather
// than re-derived client-side.
describe('AgentDetailPage — "Reports to" section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it('renders the real chain and the resolved human name/email when the chain resolves', async () => {
    getAgentDetail.mockResolvedValue(DETAIL);

    await renderAgentPage();

    expect(container.textContent).toContain('Reports to');
    // Checkpoint I (2026-09-11) — the raw trail string ("workforce_intelligence_engine
    // (agent) -> [human]") is now parsed into a named chain (see
    // AgentOverviewV2Sidebar.tsx's parseHop) rather than shown verbatim, per
    // Ali's pasted mockup — the underlying fact (who reports to whom) is the
    // same real data, just a cleaner view.
    expect(container.textContent).toContain('workforce_intelligence_engine');
    expect(container.textContent).toContain('Kes');
    expect(container.textContent).toContain('kesetebirhan@gmail.com');
  });

  it('boundary: reports_to is null -> renders an honest "no chain configured" message, never a blank or fabricated section', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, reports_to: null });

    await renderAgentPage();

    expect(container.textContent).toContain('No reports-to chain configured');
  });

  it('boundary: the chain trail exists but resolved_human is null -> discloses the break honestly, never fabricates a human', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      reports_to: { trail: ['OrphanedAgent (agent) -> [dangling]'], resolved_human: null, immediate_agent: null },
    });

    await renderAgentPage();

    expect(container.textContent).toContain('does not currently resolve to a real human');
  });

  // 2026-08-23 — "I'd like to have a link to the agent they report to" (Ali,
  // 3rd time reporting the linked issue this message bundled with).
  it('immediate_agent: renders a real clickable link to the next-hop agent\'s own detail page', async () => {
    getAgentDetail.mockResolvedValue(DETAIL); // immediate_agent = { id: 'agent-wie', name: 'workforce_intelligence_engine' }

    await renderAgentPage();

    const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'workforce_intelligence_engine');
    expect(link).toBeDefined();
    expect(link!.getAttribute('href')).toBe('/admin/agents/agent-wie');
  });

  it('boundary: immediate_agent is null (reports directly to a human) -> no "Reports directly to" link rendered, only the existing chain text', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      reports_to: { trail: ['Reese (agent) -> [human]'], resolved_human: { id: 'ali', name: 'Ali', email: 'ali@colaberry.com' }, immediate_agent: null },
    });

    await renderAgentPage();

    expect(container.textContent).not.toContain('Reports directly to');
  });
});

// Tool & capability drill-down (2026-08-23) — Ali: "I also would like to see
// the tool & capability drill down so I can understand the tool better."
// Dashboard redesign, Slice 1, R18 (2026-09-19) — Capabilities relocated
// out of Overview into Performance & Settings' "Tools & channels" sub-tab
// (AgentOverviewV2ToolsChannels.tsx). This describe block's own tests are
// unchanged in what they assert — only how they navigate there, via a
// local helper rather than renderAgentPage()'s default Overview landing.
async function renderToolsChannelsTab() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/admin/agents/agent-reese']}>
        <Routes>
          <Route path="/admin/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const findButton = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  const performanceSettingsTab = findButton('Performance & settings');
  if (!performanceSettingsTab) throw new Error('Performance & settings tab button not found');
  await act(async () => {
    performanceSettingsTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const toolsChannelsSubTab = findButton('Tools & channels');
  if (!toolsChannelsSubTab) throw new Error('Tools & channels sub-tab button not found');
  await act(async () => {
    toolsChannelsSubTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('AgentDetailPage — "Tools & capabilities" per-tool drill-down', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    getAgentDetail.mockResolvedValue(DETAIL);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it('is no longer on Overview — relocated to Performance & Settings' + "'" + 's Tools & channels sub-tab', async () => {
    await renderAgentPage();
    expect(container.querySelector('.adv2-tool')).toBeNull();
    expect(container.textContent).not.toContain('respond_to_dm');
  });

  it('renders one row per granted tool, named after the real tool string', async () => {
    await renderToolsChannelsTab();

    // Checkpoint I (2026-09-11) — the per-tool drill-down is no longer a
    // collapsible <details> (the mockup's own .adv2-tool rows are always
    // expanded — short enough not to need collapsing); each tool still
    // gets its own real, named row.
    const rows = Array.from(container.querySelectorAll('.adv2-tool'));
    const toolNames = rows.map((d) => d.querySelector('code')?.textContent);
    expect(toolNames).toEqual(['respond_to_dm', 'read_learner_context']);
  });

  it('each tool\'s own reads/produces are nested inside ITS row, not the flattened aggregate', async () => {
    await renderToolsChannelsTab();

    const rows = Array.from(container.querySelectorAll('.adv2-tool'));
    const readLearnerContext = rows.find((d) => d.querySelector('code')?.textContent === 'read_learner_context');
    expect(readLearnerContext?.textContent).toContain('ProofDesk learner-progress signals');
    // respond_to_dm has no reads of its own — its OWN row must not claim
    // the other tool's read fact.
    const respondToDm = rows.find((d) => d.querySelector('code')?.textContent === 'respond_to_dm');
    expect(respondToDm?.textContent).not.toContain('ProofDesk learner-progress signals');
    expect(respondToDm?.textContent).toContain('A reply message in the student DM thread');
  });

  // Reese Product Phase 1 follow-up (2026-09-18) — Ali, live: "color
  // coordinate the tools so they show up the same place all over... I'd
  // also like to see the last time the tool... was used." Each tool row
  // gets a distinct color dot (assignDistinctAvatarColors — real colors,
  // never blank) and an honest "Last used" line.
  it('gives each tool its own distinct color dot, and an honest "not recorded yet" when no behaviour activity backs it', async () => {
    await renderToolsChannelsTab();

    const rows = Array.from(container.querySelectorAll('.adv2-tool'));
    const dots = rows.map((d) => (d.querySelector('.adv2-dot') as HTMLElement | null)?.style.background);
    expect(dots.every((d) => !!d)).toBe(true);
    expect(new Set(dots).size).toBe(dots.length);
    expect(container.textContent).toContain('Last used: not recorded yet');
  });

  it('honesty path: an undocumented tool renders an "undocumented" badge and a per-tool disclosure, never fabricated reads/produces', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      capabilities: { ...DETAIL.capabilities, by_tool: [{ tool: 'a_tool_from_the_future', reads: [], produces: [], documented: false }] },
    });

    await renderToolsChannelsTab();

    expect(container.textContent).toContain('a_tool_from_the_future');
    expect(container.textContent).toContain('undocumented');
    expect(container.textContent).toContain('No documented reads/produces yet for this tool');
  });

  it('boundary: no tools granted (by_tool empty) shows the existing "No tools recorded" empty state', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      capabilities: { ...DETAIL.capabilities, by_tool: [] },
    });

    await renderToolsChannelsTab();

    expect(container.textContent).toContain('No tools recorded.');
  });
});

// Dashboard redesign, Slice 1 (2026-09-19) — Reports/Performance/Trust &
// Control consolidated into one "Performance & Settings" tab with 3 real
// sub-tabs, matching Ali's preview (3).html mockup.
describe('AgentDetailPage — "Performance & Settings" consolidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    listMemoryProposals.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    getAgentDetail.mockResolvedValue(DETAIL);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  async function openPerformanceSettings() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/agents/agent-reese']}>
          <Routes><Route path="/admin/agents/:id" element={<AgentDetailPage />} /></Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const tab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Performance & settings');
    if (!tab) throw new Error('Performance & settings tab button not found');
    await act(async () => {
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function clickSubTab(label: string) {
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
    if (!btn) throw new Error(`${label} sub-tab button not found`);
    return act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('the 3 old top-level tab buttons no longer exist — only one consolidated tab remains', async () => {
    await renderAgentPage();
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Reports');
    expect(labels).not.toContain('Performance');
    expect(labels).not.toContain('Trust & Control');
    expect(labels).toContain('Performance & settings');
  });

  it('lands on "Results & reports" by default, showing real Reports and Performance content', async () => {
    listReportSubscriptions.mockResolvedValue([{ id: 'sub-1', contentScope: ['cost'], cadence: 'daily', deliveryHourLocal: 8, timezone: 'America/Chicago', channel: 'email', enabled: true }]);
    listGoals.mockResolvedValue([{ id: 'goal-1', metricKey: 'monthly_cost_usd', comparison: 'at_most', targetValue: 50, currentValue: 10, met: true, status: 'active' }]);

    await openPerformanceSettings();

    expect(container.textContent).toContain('Results & reports');
    expect(container.textContent).toContain('Tools & channels');
    expect(container.textContent).toContain('Authority & controls');
  });

  it('"Tools & channels" sub-tab shows the real Capabilities content', async () => {
    await openPerformanceSettings();
    await clickSubTab('Tools & channels');

    expect(container.querySelector('.adv2-tool')).not.toBeNull();
    expect(container.textContent).toContain('respond_to_dm');
  });

  it('"Authority & controls" sub-tab shows the real Trust & Control content (GOALS score, Governed Memory)', async () => {
    await openPerformanceSettings();
    await clickSubTab('Authority & controls');

    expect(container.textContent).toContain('Governed Memory');
  });

  // Track A2 (2026-09-22) — the new Work controls link card must navigate via the
  // page's own real tab state, not a mocked/no-op handler.
  it('"Authority & controls" Work controls card navigates to Overview on click', async () => {
    await openPerformanceSettings();
    await clickSubTab('Authority & controls');

    expect(container.textContent).toContain('Work controls');
    const goButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Go to Employee Facts')!;
    await act(async () => { goButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    // Real Overview-tab content — confirms the tab actually switched, not just
    // that the button exists. This fixture's employee_facts is null so the
    // Employee facts card itself doesn't render; the hero heading always does.
    expect(container.textContent).toContain("Your employee's briefing");
  });

  it('works for a non-Reese agent too — this is a generic page', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, agent: { ...DETAIL.agent, id: 'agent-cory', agent_name: 'cory-engine' } });

    await openPerformanceSettings();
    await clickSubTab('Tools & channels');

    expect(container.querySelector('.adv2-tool')).not.toBeNull();
  });
});

// Task visibility (2026-08-26) — Ali, live, looking at Reese's real page:
// "I need to see what those [tasks] are... what triggers them, what they
// are looking for, why they triggered."
describe('AgentDetailPage — "Scheduled tasks" section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it('renders each real sibling task with its schedule, trigger, last run, and run/error counts', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      related_tasks: [
        {
          id: 'sweep-id', agent_name: 'ReeseAutonomousOutreachSweep',
          description: 'Daily scan of the approved pilot cohort for two real risk signals.',
          trigger_type: 'cron', schedule: '0 15 * * *', enabled: true, status: 'idle',
          last_run_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), run_count: 12, error_count: 0,
        },
      ],
    });

    await renderAgentPage();

    expect(container.textContent).toContain('Scheduled work');
    expect(container.textContent).toContain('ReeseAutonomousOutreachSweep');
    expect(container.textContent).toContain('Daily scan of the approved pilot cohort');
    expect(container.textContent).toContain('0 15 * * *');
    expect(container.textContent).toContain('5h ago');
    expect(container.textContent).toContain('Enabled');
  });

  // Reese Product Phase 1 follow-up (2026-09-18) — Ali, live: "I'd also like
  // to see the last time the tool and scheduled work was used/run and the
  // ticket... the ticket should open in a new tab."
  it('renders a real last-ticket link that opens in a new tab, and a boundary "None" when there is no ticket yet', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      related_tasks: [
        {
          id: 'sweep-id', agent_name: 'ReeseAutonomousOutreachSweep',
          description: 'Daily scan of the approved pilot cohort for two real risk signals.',
          trigger_type: 'cron', schedule: '0 15 * * *', enabled: true, status: 'idle',
          last_run_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), run_count: 12, error_count: 0,
          last_ticket: { id: 'ticket-9', ticket_number: 9, title: 'Outreach follow-up', at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
        },
        {
          id: 'heartbeat-id', agent_name: 'ReesePresenceHeartbeat', description: null,
          trigger_type: 'cron', schedule: '*/15 * * * *', enabled: true, status: 'idle',
          last_run_at: null, run_count: 0, error_count: 0, last_ticket: null,
        },
      ],
    });

    await renderAgentPage();

    const link = container.querySelector('a[href="/admin/tickets?open=ticket-9"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.textContent).toContain('#9');
    expect(container.textContent).toContain('Last ticket');
    // The heartbeat task has no ticket — an honest "None", not a fabricated link.
    const rows = Array.from(container.querySelectorAll('.adv2-task'));
    const heartbeatRow = rows.find((r) => r.textContent?.includes('ReesePresenceHeartbeat'));
    expect(heartbeatRow?.querySelector('a[href^="/admin/tickets"]')).toBeNull();
  });

  it('honesty boundary: shows a disabled badge for a paused task, never disguising it as running', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      related_tasks: [
        {
          id: 'sweep-id', agent_name: 'ReeseAutonomousOutreachSweep', description: null,
          trigger_type: 'cron', schedule: '0 15 * * *', enabled: false, status: 'paused',
          last_run_at: null, run_count: 0, error_count: 0,
        },
      ],
    });

    await renderAgentPage();

    expect(container.textContent).toContain('Disabled');
    expect(container.textContent).toContain('Never');
  });

  it('boundary: no related tasks (the common case — most agents have no module) shows an honest empty state', async () => {
    getAgentDetail.mockResolvedValue(DETAIL); // base fixture: related_tasks: []

    await renderAgentPage();

    expect(container.textContent).toContain('No other scheduled tasks are registered');
  });
});

// Agent Detail polish round 3 (2026-09-29) — retired here too, see the
// disclosure comment near the top of this file: this described the same
// removed AgentOverviewV2Tickets.tsx Overview mount (Why column,
// ticket_breakdown summary), 4 tests.

// Trust Contract Phase 1 (2026-08-26) — real cost, real authorization
// verdicts, real version history. Closes the "declared autonomy_level vs.
// what's actually enforced" gap using evidence that already exists.
describe('AgentDetailPage — "Trust evidence" section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it('renders the real cost figure and run count when this agent has tracked ai_events activity', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, cost_summary: { cost_usd: 4.82, runs: 37 } });

    await renderAgentPage();

    expect(container.textContent).toContain('Trust evidence');
    expect(container.textContent).toContain('$4.82');
    expect(container.textContent).toContain('37');
  });

  it('boundary: an em dash, not $0.00, when this agent has zero cost-tracked events', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, cost_summary: null });

    await renderAgentPage();

    const stats = Array.from(container.querySelectorAll('.adv2-stat')).map((el) => el.textContent || '');
    expect(stats.some((text) => text.includes('Cost (30d)') && text.includes('—'))).toBe(true);
    expect(container.textContent).not.toContain('$0.00');
  });

  it('renders the real allow/approval/block verdict counts', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      authorization_summary: { window_days: 30, total: 18, allow: 14, approval: 3, block: 1, enforced_count: 0 },
    });

    await renderAgentPage();

    expect(container.textContent).toContain('Allowed: 14');
    expect(container.textContent).toContain('Would require approval: 3');
    expect(container.textContent).toContain('Would block: 1');
  });

  it('honesty callout: discloses that every decision was shadow-mode when enforced_count is 0 but real decisions exist', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      authorization_summary: { window_days: 30, total: 5, allow: 5, approval: 0, block: 0, enforced_count: 0 },
    });

    await renderAgentPage();

    expect(container.textContent).toContain('shadow mode');
  });

  it('boundary: no shadow-mode callout when there are zero authorization checks at all — nothing to disclose', async () => {
    getAgentDetail.mockResolvedValue(DETAIL); // base fixture: authorization_summary.total === 0

    await renderAgentPage();

    expect(container.textContent).toContain('No authorization checks recorded');
    expect(container.textContent).not.toContain('shadow mode');
  });

  it('renders real persona version history entries, most-recent first as passed from the API', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      persona_version_history: [
        { id: 'h1', persona_version: '2026-09-01', previous_version: '2026-08-06', source: 'registry_seed', created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      ],
    });

    await renderAgentPage();

    expect(container.textContent).toContain('2026-08-06');
    expect(container.textContent).toContain('2026-09-01');
    expect(container.textContent).toContain('1h ago');
  });

  it('boundary: honest empty state when persona_version_history is empty, never fabricated history', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, persona_version_history: [] });

    await renderAgentPage();

    expect(container.textContent).toContain('No version change recorded yet');
  });
});

// AI Workforce Reset (2026-08-24) — Ali, live: "we just need to remove all
// of the task they are assigned with at this time... deactivate current."
describe('AgentDetailPage — "Deactivate" action', () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    getAgentDetail.mockResolvedValue(DETAIL);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    confirmSpy.mockRestore();
  });

  function deactivateButton(): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Deactivate')) as HTMLButtonElement | undefined;
  }

  it('renders a "Deactivate" button when the agent is enabled', async () => {
    await renderAgentPage();

    expect(deactivateButton()).toBeDefined();
  });

  it('boundary: no "Deactivate" button when the agent is already disabled — nothing left to deactivate', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, agent: { ...DETAIL.agent, enabled: false } });

    await renderAgentPage();

    expect(deactivateButton()).toBeUndefined();
  });

  it('happy path: confirming asks the user first, then calls resetAgents() with this agent\'s real id and shows the real cancelled-ticket count', async () => {
    resetAgents.mockResolvedValue([{ agentId: 'agent-reese', agentName: 'Reese', found: true, deactivated: true, ticketsCancelled: 3, error: null }]);

    await renderAgentPage();
    await act(async () => {
      deactivateButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(resetAgents).toHaveBeenCalledWith(['agent-reese']);
    expect(container.textContent).toContain('3 open tickets cancelled');
  });

  it('declining the confirmation never calls resetAgents()', async () => {
    confirmSpy.mockReturnValue(false);

    await renderAgentPage();
    await act(async () => {
      deactivateButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(resetAgents).not.toHaveBeenCalled();
  });

  it('failure path: a server error is shown honestly, not swallowed', async () => {
    resetAgents.mockResolvedValue([{ agentId: 'agent-reese', agentName: 'Reese', found: true, deactivated: false, ticketsCancelled: 0, error: 'Agent not found' }]);

    await renderAgentPage();
    await act(async () => {
      deactivateButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Failed to deactivate: Agent not found');
  });
});

// AI Workforce Reset, Phase C (2026-08-24) — Ali, live: "add new ones
// slowly... so I can see how they perform." Reactivation requires a
// deliberate autonomy-level choice before the button enables.
describe('AgentDetailPage — reactivation flow (deactivated agent)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  function reactivateSelect(): HTMLSelectElement | undefined {
    return container.querySelector('select[aria-label="Autonomy level"]') as HTMLSelectElement | undefined;
  }

  function reactivateButton(): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Reactivate')) as HTMLButtonElement | undefined;
  }

  // The picker's own control (label reads "Reactivate" on a disabled agent,
  // "Set level" once the agent is already enabled — same real backend call
  // either way, see agentDetailV2Header.tsx's own header comment on why).
  function autonomyButton(): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Reactivate' || b.textContent === 'Set level' || b.textContent === 'Saving…' || b.textContent === 'Reactivating…') as HTMLButtonElement | undefined;
  }

  // UI follow-up (2026-09-15) — Ali: "why give the user the ability to
  // change it... it wouldn't take away capabilities from it." Changing an
  // ENABLED agent's level has zero runtime effect (confirmed via a real
  // code audit before this change shipped), so the picker is now a
  // click-to-reveal "Override…" affordance rather than always-open — this
  // helper opens it. A DISABLED agent's control is unchanged (still always
  // visible — reactivating IS a real, meaningful action).
  function openOverride(): void {
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Override…') as HTMLButtonElement | undefined;
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  // Ali, live, on Reese's own page: "why is the autonomy not past Observe"
  // — traced to this picker only ever rendering for a DISABLED agent, even
  // though the real reactivateAgent() mechanism behind it has no such
  // restriction. Now always renders (behind "Override…" once enabled);
  // framing/copy/button-label differ by real state instead of the control
  // disappearing once an agent is active.
  it('an enabled agent whose level was never deliberately set shows the honest "untouched default" framing and the real classifier reason, not "inactive"', async () => {
    getAgentDetail.mockResolvedValue(DETAIL); // enabled: true, autonomy_level_set_at: null

    await renderAgentPage();

    expect(container.textContent).toContain('Sitting at the untouched default');
    expect(container.textContent).toContain('No tools_granted recorded for this agent');
    expect(container.textContent).not.toContain('This agent is inactive.');

    await act(async () => { openOverride(); });
    expect(reactivateSelect()).toBeDefined();
    expect(autonomyButton()!.textContent).toBe('Set level');
  });

  it('an enabled agent with a real, previously-set autonomy level that still matches its real granted tools shows the "still matches" framing, not "never set" or stale', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      agent: { ...DETAIL.agent, autonomy_level: 'suggest', autonomy_level_set_at: '2026-09-01T00:00:00Z' },
      autonomy_explanation: { level: 'suggest', reason: 'Matched "propose_content_rewrite" — highest-capability tool among 1 granted.', matched_tool: 'propose_content_rewrite' },
    });

    await renderAgentPage();

    expect(container.textContent).toContain('Set by a human');
    expect(container.textContent).toContain('still matches what the agent\'s real granted tools would earn');
    expect(container.textContent).not.toContain('never been deliberately set');
    expect(container.textContent).not.toContain('have since changed');
  });

  // Fleet-wide autonomy-level auto-classification, Phase 2 (2026-09-14) —
  // the system classified this, no human reviewed it; the UI must say so
  // rather than looking identical to a real human decision, and must show
  // the REAL reason (2026-09-15 follow-up), not a generic disclaimer.
  it('an enabled agent auto-classified by the capability classifier shows the real classification reason, not the manual-set framing', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      agent: { ...DETAIL.agent, autonomy_level: 'act_audited', autonomy_level_set_at: '2026-09-14T00:00:00Z', autonomy_level_source: 'auto' },
      autonomy_explanation: { level: 'act_audited', reason: 'Matched "create_tickets" — highest-capability tool among 2 granted.', matched_tool: 'create_tickets' },
    });

    await renderAgentPage();

    expect(container.textContent).toContain('Auto-classified');
    expect(container.textContent).toContain('Matched "create_tickets"');
    expect(container.textContent).not.toContain('Set by a human');
  });

  it('an enabled agent with a real, previously-set autonomy level and NO recorded source (predates the source column) still shows the honest manual-set framing, never defaulted to auto', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      agent: { ...DETAIL.agent, autonomy_level: 'suggest', autonomy_level_set_at: '2026-09-01T00:00:00Z', autonomy_level_source: null },
      autonomy_explanation: { level: 'suggest', reason: 'Matched "propose_content_rewrite" — highest-capability tool among 1 granted.', matched_tool: 'propose_content_rewrite' },
    });

    await renderAgentPage();

    expect(container.textContent).toContain('Set by a human');
    expect(container.textContent).not.toContain('Auto-classified');
  });

  // UI follow-up (2026-09-15) — the honesty guardrail on the OTHER side of
  // "never silently overwrite a human's manual choice": if this agent's real
  // granted tools have since changed, a stale manual setting is disclosed,
  // not left looking current forever.
  it('a manually-set level that no longer matches the agent\'s CURRENT real granted tools discloses the staleness, naming what it would be now', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      agent: { ...DETAIL.agent, autonomy_level: 'suggest', autonomy_level_set_at: '2026-08-01T00:00:00Z', autonomy_level_source: 'manual' },
      autonomy_explanation: { level: 'communicate', reason: 'Matched "respond_to_dm" — highest-capability tool among 4 granted.', matched_tool: 'respond_to_dm' },
    });

    await renderAgentPage();

    expect(container.textContent).toContain('have since changed');
    expect(container.textContent).toContain('now classify it as communicate');
    expect(container.textContent).toContain('Matched "respond_to_dm"');
  });

  it('happy path: setting a level on an ALREADY-ENABLED agent calls the real reactivateAgent() and shows the "set", not "reactivated", confirmation', async () => {
    reactivateAgent.mockResolvedValue({
      agentId: 'agent-reese', agentName: 'Reese', found: true, reactivated: true, autonomyLevel: 'communicate', error: null,
    });
    getAgentDetail.mockResolvedValue(DETAIL); // enabled: true
    await renderAgentPage();

    await act(async () => { openOverride(); });
    await act(async () => {
      const select = reactivateSelect()!;
      select.value = 'communicate';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      autonomyButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(reactivateAgent).toHaveBeenCalledWith('agent-reese', 'communicate');
    expect(container.textContent).toContain('Autonomy level set to "communicate".');
    expect(container.textContent).not.toContain('Reactivated at autonomy level');
  });

  it('boundary: a disabled agent shows the autonomy-level select and a Reactivate button disabled until a level is chosen', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, agent: { ...DETAIL.agent, enabled: false } });
    await renderAgentPage();

    expect(reactivateSelect()).toBeDefined();
    expect(reactivateButton()!.disabled).toBe(true);
  });

  it('choosing a level enables the button and shows that level\'s real description', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, agent: { ...DETAIL.agent, enabled: false } });
    await renderAgentPage();

    await act(async () => {
      const select = reactivateSelect()!;
      select.value = 'suggest';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(reactivateButton()!.disabled).toBe(false);
    expect(container.textContent).toContain('May propose actions for human review, never executes them directly.');
  });

  it('happy path: clicking Reactivate calls reactivateAgent() with the real id and chosen level, then shows the real confirmation', async () => {
    reactivateAgent.mockResolvedValue({
      agentId: 'agent-reese', agentName: 'Reese', found: true, reactivated: true, autonomyLevel: 'observe', error: null,
    });
    getAgentDetail.mockResolvedValue({ ...DETAIL, agent: { ...DETAIL.agent, enabled: false } });
    await renderAgentPage();

    await act(async () => {
      const select = reactivateSelect()!;
      select.value = 'observe';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      reactivateButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(reactivateAgent).toHaveBeenCalledWith('agent-reese', 'observe');
    expect(container.textContent).toContain('Reactivated at autonomy level "observe".');
  });

  it('failure path: a server error is shown honestly, not swallowed', async () => {
    reactivateAgent.mockResolvedValue({
      agentId: 'agent-reese', agentName: 'Reese', found: false, reactivated: false, autonomyLevel: null, error: 'Agent not found',
    });
    getAgentDetail.mockResolvedValue({ ...DETAIL, agent: { ...DETAIL.agent, enabled: false } });
    await renderAgentPage();

    await act(async () => {
      const select = reactivateSelect()!;
      select.value = 'observe';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      reactivateButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Failed to reactivate: Agent not found');
  });
});

// Trust Contract (2026-08-24) — Ali, live: "All Agents should have a trust
// contract based on [Trust Before Intelligence]."
describe('AgentDetailPage — "Trust Contract" section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getManagerInboxItems.mockResolvedValue([]);
    listDirectives.mockResolvedValue([]);
    listReportSubscriptions.mockResolvedValue([]);
    listGoals.mockResolvedValue([]);
    listOneOnOnes.mockResolvedValue([]);
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-reese', charter: null });
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-reese', agentName: 'Reese', events: [], proposedActions: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it('happy path: a cron-tracked agent shows its real schedule, last run, and run/error counts', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      trust_contract: {
        trigger_type: 'cron',
        schedule: '28 */6 * * *',
        status: 'idle',
        last_run_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        run_count: 623,
        error_count: 4,
        avg_duration_ms: 5791,
        last_error: 'out of shared memory',
        last_error_at: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
        last_activity_at: null, // irrelevant here — last_run_at is set, so the fallback never triggers
      },
    });

    await renderAgentPage();

    expect(container.textContent).toContain('Trust Contract');
    expect(container.textContent).toContain('cron');
    expect(container.textContent).toContain('28 */6 * * *');
    expect(container.textContent).toContain('623'); // total runs
    expect(container.textContent).toContain('5h ago'); // last run, via the real timeAgo() helper
    expect(container.textContent).toContain('5.8s'); // avg duration, formatted from ms
    expect(container.textContent).toContain('out of shared memory'); // real last error, disclosed
  });

  it('honesty boundary: an identity-only agent (no scheduler tracking) shows its real trigger_type, not a fabricated schedule', async () => {
    getAgentDetail.mockResolvedValue(DETAIL); // base fixture: trigger_type 'event_driven', schedule null

    await renderAgentPage();

    expect(container.textContent).toContain('Trust Contract');
    expect(container.textContent).toContain('event_driven');
  });

  it("boundary: no trigger_type at all shows the honest 'not invoked through the scheduled-run tracker' disclosure", async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      trust_contract: { ...DETAIL.trust_contract, trigger_type: null },
    });

    await renderAgentPage();

    expect(container.textContent).toContain("isn't invoked through the");
  });

  it('never fabricates a schedule/error when both are genuinely absent', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      trust_contract: { ...DETAIL.trust_contract, trigger_type: 'cron', schedule: null, last_error: null },
    });

    await renderAgentPage();

    // The rows render (trigger_type is set), but no fabricated error banner.
    expect(container.textContent).toContain('Trust Contract');
    expect(container.textContent).not.toContain('Last error:');
  });

  // AI Workforce Reset, Phase C (2026-08-24) — the Permitted dimension: this
  // agent's real, chosen autonomy level (or an honest "not yet set").
  it('Permitted: shows "Not yet set" when autonomy_level is null (never reactivated through the Phase C flow)', async () => {
    getAgentDetail.mockResolvedValue(DETAIL); // base fixture: agent.autonomy_level null

    await renderAgentPage();

    expect(container.textContent).toContain('Autonomy level (Permitted)');
    expect(container.textContent).toContain('Not yet set');
  });

  it('Permitted: shows the real, previously-chosen autonomy level verbatim', async () => {
    getAgentDetail.mockResolvedValue({ ...DETAIL, agent: { ...DETAIL.agent, autonomy_level: 'act_audited' } });

    await renderAgentPage();

    expect(container.textContent).toContain('Autonomy level (Permitted)');
    expect(container.textContent).toContain('act_audited');
  });

  // Trust Contract fix (2026-08-24) — Ali, live, looking at Reese's real page:
  // "Reese has several tickets that have been opened... but this says it's
  // never been run." Fixes the literal complaint: an event-driven agent with
  // real ticket activity must never show a bare "Never".
  // Checkpoint I (2026-09-11) — scoped to the Trust Contract card's own
  // <dl> (first .adv2-rows on the page) rather than page-wide text: the
  // Scheduled work section below also has its own "Last run" label per
  // task (unrelated), so an unscoped check could false-positive once a
  // test's fixture has related_tasks — none of these three do today, but
  // scoping removes the trap for whoever edits this next.
  function trustContractRowsText(): string {
    return container.querySelector('.adv2-rows')?.textContent || '';
  }

  it('Instant: an event-driven agent with real ticket activity shows a "Last activity" row (not "Last run"/"Never")', async () => {
    getAgentDetail.mockResolvedValue(DETAIL); // base fixture: event_driven, last_run_at null, last_activity_at real

    await renderAgentPage();

    const text = trustContractRowsText();
    expect(text).toContain('Last activity');
    expect(text).not.toContain('Last run');
    expect(text).not.toContain('Never');
  });

  it('boundary: an event-driven agent with genuinely zero ticket history ever still shows an honest "Last run: Never"', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      trust_contract: { ...DETAIL.trust_contract, last_activity_at: null },
    });

    await renderAgentPage();

    const text = trustContractRowsText();
    expect(text).toContain('Last run');
    expect(text).toContain('Never');
    expect(text).not.toContain('Last activity');
  });

  it('a scheduler-tracked (cron) agent keeps showing "Last run" from last_run_at, never the ticket-derived fallback', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      trust_contract: {
        ...DETAIL.trust_contract,
        trigger_type: 'cron',
        last_run_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        last_activity_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // more recent, but must be ignored
      },
    });

    await renderAgentPage();

    const text = trustContractRowsText();
    expect(text).toContain('Last run');
    expect(text).toContain('5h ago');
    expect(text).not.toContain('Last activity');
  });
});
