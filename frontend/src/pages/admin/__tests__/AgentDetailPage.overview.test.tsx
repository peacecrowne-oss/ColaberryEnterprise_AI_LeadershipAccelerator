import React from 'react';
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

// Checkpoint I (2026-09-11) — Ali pasted a full mockup and asked to match
// its format for Overview. Replaces the Checkpoint H sub-tabbed version:
// Overview is now one flowing page (AgentOverviewV2), so every section's
// real content shows with a single "Overview" tab click, no further
// sub-tab clicks needed.
//
// Dashboard redesign, Slice 2b (2026-09-19) — AgentOverviewV2 now also
// takes inboxItems/inboxLoading/onNavigate (the hero's 4 KPI tiles + the
// new "Needs Ali" card). This file's existing getManagerInboxItems mock
// (already present for other tests) covers it — no new mock needed, only
// this comment update since it was previously (correctly, at the time)
// stated as inbox-independent.

jest.mock('../../../services/agentDetailApi', () => ({ getAgentDetail: jest.fn(), setReeseBehaviourSwitch: jest.fn(), setAgentAbacOverride: jest.fn(), setAgentReportsTo: jest.fn() }));
jest.mock('../../../services/managerInboxApi', () => ({ getManagerInboxItems: jest.fn(), approveInboxItem: jest.fn(), getInboxItemInspector: jest.fn() }));
jest.mock('../../../services/ticketSummaryApi', () => ({ getTicketSummary: jest.fn() }));
jest.mock('../../../services/workforceOrgChartApi', () => ({
  resetAgents: jest.fn(),
  reactivateAgent: jest.fn(),
  getOrgChart: jest.fn(),
  AUTONOMY_LEVELS: ['observe', 'suggest', 'act_audited', 'communicate'],
  AUTONOMY_LEVEL_DESCRIPTIONS: {
    observe: 'Read only.', suggest: 'May propose actions.', act_audited: 'May write, audited.', communicate: 'May send outbound comms.',
  },
}));
jest.mock('../../../services/managerDirectiveApi', () => ({ listDirectives: jest.fn() }));
jest.mock('../../../services/agentReportSubscriptionApi', () => ({ listReportSubscriptions: jest.fn() }));
jest.mock('../../../services/agentGoalApi', () => ({ listGoals: jest.fn() }));
jest.mock('../../../services/agentOneOnOneApi', () => ({ listOneOnOnes: jest.fn() }));
jest.mock('../../../services/agentRoleCharterApi', () => ({ getAgentRoleCharter: jest.fn(), saveAgentRoleCharter: jest.fn() }));
jest.mock('../../../services/agentExplainabilityApi', () => ({ getAgentExplainability: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAgentDetail, setReeseBehaviourSwitch } = require('../../../services/agentDetailApi') as { getAgentDetail: jest.Mock; setReeseBehaviourSwitch: jest.Mock };
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
const { getAgentRoleCharter } = require('../../../services/agentRoleCharterApi') as { getAgentRoleCharter: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAgentExplainability } = require('../../../services/agentExplainabilityApi') as { getAgentExplainability: jest.Mock };

const DETAIL: AgentDetail = {
  agent: {
    id: 'agent-cory', agent_name: 'corybrain', agent_type: 'ai_leadership', category: 'executive',
    description: null, system_prompt: 'You are CoryBrain.', tools_granted: [], persona_version: '2026-08-20',
    enabled: true, created_at: null, autonomy_level: 'suggest',
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
  live_status: 'unknown',
  open_ticket_count: 1,
  completed_ticket_count_30d: 0,
  verified_resolution_count: 0,
  owned_ticket_count_all_time: 0,
  most_recent_verified_ticket_id: null,
  tickets: [],
  ticket_breakdown: [],
  related_tasks: [],
  owned_behaviors: [],
  persona_version_history: [],
  cost_summary: { cost_usd: 0.42, runs: 38 },
  authorization_summary: { window_days: 30, total: 38, allow: 34, approval: 3, block: 1, enforced_count: 0 },
  capabilities: { reads: [], produces: [], undocumented_tools: [], produced_ticket_types: [], by_tool: [] },
  autonomy_explanation: { level: 'observe', reason: 'No tools_granted recorded for this agent — the safe, honest default, not a guess.', matched_tool: null },
  reports_to: null,
  trust_contract: {
    trigger_type: 'on_demand', schedule: null, status: 'idle', last_run_at: null, run_count: 0,
    error_count: 0, avg_duration_ms: null, last_error: null, last_error_at: null,
    last_activity_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
  goals: [],
  goals_overall: 0,
  employee_facts: null,
};

let container: HTMLDivElement;
let root: Root;

async function renderAgentPage() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/admin/agents/agent-cory']}>
        <Routes><Route path="/admin/agents/:id" element={<AgentDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openOverviewTab() {
  const tabButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Overview');
  if (!tabButton) throw new Error('Overview tab button not found');
  await act(async () => {
    tabButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  listDirectives.mockResolvedValue([]);
  listReportSubscriptions.mockResolvedValue([]);
  listGoals.mockResolvedValue([]);
  listOneOnOnes.mockResolvedValue([]);
  getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-cory', charter: null });
  getAgentExplainability.mockResolvedValue({ agentId: 'agent-cory', agentName: 'corybrain', events: [], proposedActions: [] });
  getAgentDetail.mockResolvedValue(DETAIL);
  getManagerInboxItems.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('AgentDetailPage — Overview tab (V2, flowing layout)', () => {
  // Agent Detail redesign, Track A1 (2026-09-21) — Overview is now the
  // default landing tab (was "At a Glance"/'glance'), so its content is
  // visible on mount with no tab click needed — the inverse of what this
  // test asserted before this run.
  it('IS shown on mount — Overview is the new default tab', async () => {
    await renderAgentPage();
    expect(container.textContent).toContain('Identity');
    expect(container.textContent).toContain('You are CoryBrain.');
  });

  it('shows Identity, System prompt, and Trust content all at once — no sub-tab clicks needed', async () => {
    await renderAgentPage();
    await openOverviewTab();

    // Identity (sidebar)
    expect(container.textContent).toContain('Identity');
    expect(container.textContent).toContain('ai_leadership');
    // System prompt is inside a closed <details> but its text is still in
    // the DOM (native <details> content isn't removed, just visually hidden).
    expect(container.textContent).toContain('You are CoryBrain.');
    // Trust Contract (main column) — real autonomy ladder + real evidence.
    expect(container.textContent).toContain('Trust Contract');
    expect(container.textContent).toContain('Trust evidence');
  });

  // Agent Detail redesign, Track A1 (2026-09-21) — re-derived from real
  // post-change behavior, not assumed to still hold: Overview now IS the
  // default tab, and its own Needs Ali card + "Needs your decision" metric
  // tile both need real inbox data — the inbox-fetch gate
  // (AgentDetailPage.tsx) already included 'overview' before this run
  // (built for the Needs Ali card in an earlier slice), so this fetch now
  // fires on initial mount, not on a later click.
  it('fetches the manager inbox on initial mount — Overview (the new default) needs it for Needs Ali + the metrics tile', async () => {
    await renderAgentPage();
    expect(getManagerInboxItems).toHaveBeenCalledTimes(1);
  });

  // Agent Detail polish round 5 (2026-09-30) — Ali, live: "work explained
  // should be in the top right section of 'Needs Ali' section." Both real
  // sections now render together, in the same new .adv2-needs-row, above
  // the main 2-column grid — not buried mid-stack in the main column
  // anymore.
  it('"Needs Ali" and "Work, explained" render together in the same row, above the main grid', async () => {
    getManagerInboxItems.mockResolvedValue([]);
    getAgentExplainability.mockResolvedValue({ agentId: 'agent-cory', agentName: 'corybrain', events: [], proposedActions: [] });
    await renderAgentPage();
    await openOverviewTab();

    const row = container.querySelector('.adv2-needs-row');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('Needs Ali');
    expect(row!.textContent).toContain('Work, explained');
  });

  // AI Employee Consolidation Program (2026-09-15/16) — mission Section 13:
  // legacy workflows appear inside the employee's own "Capabilities &
  // Automations" area, real ownership via owned_behaviors (parent_agent_id),
  // not related_tasks' same-module inference.
  it('Capabilities & Automations: honest empty state when this agent owns nothing yet (the whole fleet on day one except Dara)', async () => {
    await renderAgentPage();
    await openOverviewTab();

    expect(container.textContent).toContain('Capabilities & Automations');
    expect(container.textContent).toContain("doesn't own any absorbed legacy behaviors or tools yet");
  });

  it('Capabilities & Automations: renders a real owned behavior when owned_behaviors has one', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      owned_behaviors: [{
        id: 'director-id', agent_name: 'WorkforceCurriculumDirector', record_kind: 'behavior',
        description: 'Flags curriculum gaps daily.', trigger_type: 'cron', schedule: '10 6 * * *',
        enabled: true, migration_status: 'absorbed',
      }],
    });
    await renderAgentPage();
    await openOverviewTab();

    expect(container.textContent).toContain('WorkforceCurriculumDirector');
    expect(container.textContent).toContain('Flags curriculum gaps daily.');
    expect(container.textContent).toContain('behavior');
    expect(container.textContent).not.toContain("doesn't own any absorbed legacy behaviors");
  });

  // Reese Product Phase 1, R7 — truthful employee facts. Not shown for the
  // CoryBrain fixture (employee_facts: null); this test proves the section
  // DOES render, with real content, when it is populated.
  it('Employee facts: renders charter version, manager chain, last meaningful action, and behaviour switches when employee_facts is populated', async () => {
    getAgentDetail.mockResolvedValue({
      ...DETAIL,
      employee_facts: {
        availability: 'available',
        work_state: 'working_on_ticket',
        work_state_detail: '2 open ticket(s)',
        last_meaningful_action: { at: '2026-09-18T10:00:00Z', description: 'Sent a DM: "Here is your next move."' },
        charter_version: 2,
        charter_effective_at: '2026-09-18T00:00:00Z',
        manager_chain_note: 'Reports to: Ali Muwwakkil',
        behaviours: [
          { key: 'reactive_dm_reply', name: 'Reactive DM reply', enabled: true, population: 'Whoever messages her.', kill_switch: "Reese's own ai_agents.enabled.", tools: ['respond_to_dm'], scheduled_work_ref: null, last_ticket: null, trigger_mode: 'model_selected', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: null } },
          { key: 'autonomous_outreach_sweep', name: 'Autonomous outreach sweep', enabled: true, population: 'Pilot cohort.', kill_switch: 'Registry row enabled.', tools: [], scheduled_work_ref: 'ReeseAutonomousOutreachSweep', last_ticket: null, trigger_mode: 'rule_triggered', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: true } },
        ],
      },
    });
    await renderAgentPage();
    await openOverviewTab();

    expect(container.textContent).toContain('Employee facts');
    expect(container.textContent).toContain('Reports to: Ali Muwwakkil');
    expect(container.textContent).toContain('v2');
    expect(container.textContent).toContain('Sent a DM: "Here is your next move."');
    expect(container.textContent).toContain('Reactive DM reply');
    expect(container.textContent).toContain('Autonomous outreach sweep');
  });

  it('Employee facts: honest empty state (section absent) for every non-Reese agent', async () => {
    await renderAgentPage();
    await openOverviewTab();

    expect(container.textContent).not.toContain('Employee facts');
  });

  describe('Employee facts: behaviour switches (Reese Product Phase 1 follow-up, 2026-09-18)', () => {
    const EMPLOYEE_FACTS_DETAIL = {
      ...DETAIL,
      employee_facts: {
        availability: 'available',
        work_state: 'idle',
        work_state_detail: null,
        last_meaningful_action: null,
        charter_version: 2,
        charter_effective_at: '2026-09-18T00:00:00Z',
        manager_chain_note: 'Reports to: Ali Muwwakkil',
        behaviours: [
          { key: 'reactive_dm_reply', name: 'Reactive DM reply', enabled: true, population: 'Whoever messages her.', kill_switch: "Reese's own ai_agents.enabled.", tools: ['respond_to_dm'], scheduled_work_ref: null, last_ticket: null, trigger_mode: 'model_selected', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: null } },
          { key: 'health_assessment', name: 'Health assessment', enabled: true, population: 'Whoever gets a reply.', kill_switch: 'Shares the reply switch.', tools: ['assess_student_health'], scheduled_work_ref: null, last_ticket: null, trigger_mode: 'model_selected', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: null } },
          { key: 'autonomous_outreach_sweep', name: 'Autonomous outreach sweep', enabled: true, population: 'Pilot cohort.', kill_switch: 'Registry row enabled.', tools: [], scheduled_work_ref: 'ReeseAutonomousOutreachSweep', last_ticket: null, trigger_mode: 'rule_triggered', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: true } },
        ],
      },
    };

    async function clickBehaviourToggle(name: string) {
      const row = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === name);
      const button = row?.parentElement?.querySelector('button');
      if (!button) throw new Error(`Toggle button for "${name}" not found`);
      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    // Agent Detail polish round 3 (2026-09-29) — AgentOverviewV2EmployeeFacts.tsx
    // collapses each behaviour row by default; tools/scheduled-work link/
    // decomposed status facts/last-ticket link/shared-switch note all now
    // live behind a per-row "Show details" toggle. The ON/OFF switch itself
    // and any per-key error stay always-visible (a considered design
    // decision — a failed toggle must never be hidden by a collapsed row),
    // so clickBehaviourToggle above needs no change.
    async function expandBehaviourRow(name: string) {
      const nameSpan = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === name);
      const rowDiv = nameSpan?.closest('.adv2-behaviour-row');
      const toggle = rowDiv?.querySelector('.adv2-behaviour-expand-toggle');
      if (!toggle) throw new Error(`Expand toggle for "${name}" not found`);
      await act(async () => {
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    it('shows the real tool correlation and the Scheduled work link', async () => {
      getAgentDetail.mockResolvedValue(EMPLOYEE_FACTS_DETAIL);
      await renderAgentPage();
      await openOverviewTab();
      await expandBehaviourRow('Reactive DM reply');
      await expandBehaviourRow('Health assessment');
      await expandBehaviourRow('Autonomous outreach sweep');

      expect(container.textContent).toContain('uses: respond_to_dm');
      expect(container.textContent).toContain('uses: assess_student_health');
      expect(container.querySelector('a[href="#task-ReeseAutonomousOutreachSweep"]')).not.toBeNull();
    });

    // Phase 1 workspace mission, R11 (2026-09-18) — Ali's new mission doc:
    // "Show whether each action is model-selected, rule-triggered, or
    // human-directed. Show callable, configured, authorized, enabled, and
    // healthy as distinct facts." The trigger-mode chip is always-visible
    // (collapsed view); the decomposed status facts are behind expand.
    it('shows trigger mode and decomposed status facts per behaviour, with an honest dash when healthy is unknown', async () => {
      getAgentDetail.mockResolvedValue(EMPLOYEE_FACTS_DETAIL);
      await renderAgentPage();
      await openOverviewTab();

      expect(container.textContent).toContain('Model-selected');
      expect(container.textContent).toContain('Rule-triggered');

      await expandBehaviourRow('Reactive DM reply');
      await expandBehaviourRow('Autonomous outreach sweep');

      expect(container.textContent).toContain('Healthy: yes');
      expect(container.textContent).toContain('Healthy: —');
    });

    // Reese Product Phase 1 follow-up (2026-09-18) — Ali, live: "I'd also
    // like to see a link to the last ticket... the ticket should open in a
    // new tab."
    it('links a behaviour\'s real last ticket, opening in a new tab, and shows an honest "None" when there is none', async () => {
      getAgentDetail.mockResolvedValue({
        ...EMPLOYEE_FACTS_DETAIL,
        related_tasks: [{
          id: 'sweep-id', agent_name: 'ReeseAutonomousOutreachSweep', description: null,
          trigger_type: 'cron', schedule: '0 15 * * *', enabled: true, status: 'idle',
          last_run_at: new Date(Date.now() - 3600_000).toISOString(), run_count: 1, error_count: 0,
          last_ticket: { id: 'ticket-7', ticket_number: 7, title: 'Outreach', at: new Date(Date.now() - 3600_000).toISOString() },
        }],
        employee_facts: {
          ...EMPLOYEE_FACTS_DETAIL.employee_facts,
          behaviours: [
            { ...EMPLOYEE_FACTS_DETAIL.employee_facts.behaviours[0], last_ticket: null },
            { ...EMPLOYEE_FACTS_DETAIL.employee_facts.behaviours[2], last_ticket: { id: 'ticket-7', ticket_number: 7, title: 'Outreach', at: new Date(Date.now() - 3600_000).toISOString() } },
          ],
        },
      });
      await renderAgentPage();
      await openOverviewTab();
      await expandBehaviourRow('Reactive DM reply');
      await expandBehaviourRow('Autonomous outreach sweep');

      const link = container.querySelector('a[href="/admin/tickets?open=ticket-7"]');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(link?.textContent).toContain('#7');
      expect(container.textContent).toContain('Last ticket: None');
    });

    it('discloses the shared-switch coupling on both rows', async () => {
      getAgentDetail.mockResolvedValue(EMPLOYEE_FACTS_DETAIL);
      await renderAgentPage();
      await openOverviewTab();
      await expandBehaviourRow('Reactive DM reply');
      await expandBehaviourRow('Health assessment');

      expect(container.textContent).toContain("Shares Reese's own on/off switch with Health assessment.");
      expect(container.textContent).toContain("Shares Reese's own on/off switch with Reactive DM reply.");
    });

    it('turning ON calls the API immediately, no confirmation needed', async () => {
      getAgentDetail.mockResolvedValue({
        ...EMPLOYEE_FACTS_DETAIL,
        employee_facts: { ...EMPLOYEE_FACTS_DETAIL.employee_facts, behaviours: [{ ...EMPLOYEE_FACTS_DETAIL.employee_facts.behaviours[2], enabled: false }] },
      });
      setReeseBehaviourSwitch.mockResolvedValue({ key: 'autonomous_outreach_sweep', enabled: true, alsoChanged: ['autonomous_outreach_sweep'] });
      const confirmSpy = jest.spyOn(window, 'confirm');
      await renderAgentPage();
      await openOverviewTab();

      await clickBehaviourToggle('Autonomous outreach sweep');

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(setReeseBehaviourSwitch).toHaveBeenCalledWith('agent-cory', 'autonomous_outreach_sweep', true);
      confirmSpy.mockRestore();
    });

    it('turning OFF asks for confirmation first, and does nothing if declined', async () => {
      getAgentDetail.mockResolvedValue(EMPLOYEE_FACTS_DETAIL);
      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
      await renderAgentPage();
      await openOverviewTab();

      await clickBehaviourToggle('Reactive DM reply');

      expect(confirmSpy).toHaveBeenCalled();
      expect(setReeseBehaviourSwitch).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it('turning OFF and confirming calls the API and moves BOTH shared-switch rows to Off', async () => {
      getAgentDetail.mockResolvedValue(EMPLOYEE_FACTS_DETAIL);
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      setReeseBehaviourSwitch.mockResolvedValue({ key: 'reactive_dm_reply', enabled: false, alsoChanged: ['reactive_dm_reply', 'health_assessment'] });
      await renderAgentPage();
      await openOverviewTab();

      await clickBehaviourToggle('Reactive DM reply');

      expect(setReeseBehaviourSwitch).toHaveBeenCalledWith('agent-cory', 'reactive_dm_reply', false);
      const offButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'Off');
      expect(offButtons.length).toBeGreaterThanOrEqual(2);
    });

    it('a failed toggle shows the real error message, not a silent failure', async () => {
      getAgentDetail.mockResolvedValue(EMPLOYEE_FACTS_DETAIL);
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      setReeseBehaviourSwitch.mockRejectedValue({ response: { data: { error: 'This agent is not in your reporting chain.' } } });
      await renderAgentPage();
      await openOverviewTab();

      await clickBehaviourToggle('Reactive DM reply');

      expect(container.textContent).toContain('This agent is not in your reporting chain.');
    });
  });
});
