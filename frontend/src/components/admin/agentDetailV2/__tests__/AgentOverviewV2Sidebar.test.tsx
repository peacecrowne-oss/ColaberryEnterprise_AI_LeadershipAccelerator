import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentOverviewV2Sidebar from '../AgentOverviewV2Sidebar';
import { AgentDetail } from '../../../../services/agentDetailApi';

// Agent Detail polish round 2 (2026-09-29) — Ali, live: a long
// charter.mission pushed the sections after "Role charter" (Reports to,
// Employee facts, Persona and prompt) below the fold. This is the first
// real test coverage of a populated (non-null) charter anywhere on this
// page — every existing AgentDetailPage.smoke.test.tsx test mocks
// getAgentRoleCharter to return charter: null.

jest.mock('../../../../services/agentRoleCharterApi', () => ({
  getAgentRoleCharter: jest.fn(),
  saveAgentRoleCharter: jest.fn(),
}));
jest.mock('../../../../services/agentDetailApi', () => ({ setAgentReportsTo: jest.fn() }));
jest.mock('../../../../services/workforceOrgChartApi', () => ({ getOrgChart: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAgentRoleCharter } = require('../../../../services/agentRoleCharterApi') as { getAgentRoleCharter: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setAgentReportsTo } = require('../../../../services/agentDetailApi') as { setAgentReportsTo: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getOrgChart } = require('../../../../services/workforceOrgChartApi') as { getOrgChart: jest.Mock };

const BASE_AGENT: AgentDetail['agent'] = {
  id: 'agent-1', agent_name: 'Reese', agent_type: 'ai_staff_mentor', category: null,
  description: null, system_prompt: null, tools_granted: [], persona_version: null,
  enabled: true, created_at: null, autonomy_level: null,
  department: null, module: null, source_file: null,
  max_runs_per_hour: 60, max_writes_per_execution: 100, max_proposals_per_run: 50,
  autonomy_level_set_at: null, autonomy_level_source: null,
  reports_to_type: null, reports_to_id: null,
  abac_mode_override: null, abac_mode_override_set_at: null, abac_mode_override_set_by: null,
  abac_effective_mode: 'shadow', abac_global_default: 'shadow',
};

function buildDetail(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    agent: BASE_AGENT,
    identity: null,
    live_status: 'unknown',
    open_ticket_count: 0,
    completed_ticket_count_30d: 0,
    verified_resolution_count: 0,
    owned_ticket_count_all_time: 0,
    most_recent_verified_ticket_id: null,
    tickets: [],
    ticket_breakdown: [],
    related_tasks: [],
    owned_behaviors: [],
    persona_version_history: [],
    cost_summary: null,
    authorization_summary: { window_days: 30, total: 0, allow: 0, approval: 0, block: 0, enforced_count: 0 },
    capabilities: { reads: [], produces: [], undocumented_tools: [], produced_ticket_types: [], by_tool: [] },
    autonomy_explanation: { level: 'observe', reason: 'No tools_granted recorded for this agent — the safe, honest default, not a guess.', matched_tool: null },
    reports_to: null,
    trust_contract: {
      trigger_type: 'on_demand', schedule: null, status: 'idle', last_run_at: null, run_count: 0,
      error_count: 0, avg_duration_ms: null, last_error: null, last_error_at: null, last_activity_at: null,
    },
    goals: [],
    goals_overall: 0,
    employee_facts: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

const onReportsToChanged = jest.fn();

async function render(detail: AgentDetail) {
  await act(async () => {
    root.render(<AgentOverviewV2Sidebar detail={detail} agentId="agent-1" agentDisplayName="Reese" onReportsToChanged={onReportsToChanged} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
  getOrgChart.mockResolvedValue({
    organization: { id: 'org-1', name: 'Colaberry' },
    humans: [{ id: 'human-1', name: 'Ali Muwwakkil', email: 'ali@colaberry.com', team: null, department: 'Exec', role: 'manager', leadership_agent_ids: [], staff_count: 0, task: null, hierarchy_color: null }],
    leadership: [{ id: 'leader-1', agent_name: 'CoryBrain', display_name: 'CoryBrain', reports_to_human_id: 'human-1', reports_to_summary: 'Reports to: Ali Muwwakkil', staff_ids: [], open_ticket_count: 0, hierarchy_color: null, enabled: true }],
    staff: [],
    unresolved: [],
    generated_at: '2026-09-30T00:00:00Z',
  });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('AgentOverviewV2Sidebar — Role charter truncation', () => {
  it('a short mission renders in full, no toggle, every section after it visible without truncation', async () => {
    getAgentRoleCharter.mockResolvedValue({
      agentId: 'agent-1',
      charter: { roleTitle: 'Student Success', mission: 'Help students move forward.', responsibilities: [], kpis: [], updatedByEmail: 'ali@colaberry.com', updatedAt: '2026-09-01T00:00:00Z' },
    });
    await render(buildDetail());
    expect(container.textContent).toContain('Help students move forward.');
    expect(container.querySelector('.adv2-truncate-toggle')).toBeNull();
    expect(container.textContent).toContain('Reports to');
  });

  it('a long mission truncates to ~140 chars with a working expand toggle', async () => {
    const longMission = 'Reese is the student\'s dedicated AI mentor. '.repeat(6); // > 140 chars
    getAgentRoleCharter.mockResolvedValue({
      agentId: 'agent-1',
      charter: { roleTitle: 'Student Success', mission: longMission, responsibilities: [], kpis: [], updatedByEmail: 'ali@colaberry.com', updatedAt: '2026-09-01T00:00:00Z' },
    });
    await render(buildDetail());

    expect(container.textContent).toContain('…');
    expect(container.textContent).not.toContain(longMission);
    const toggle = container.querySelector('.adv2-truncate-toggle') as HTMLElement;
    expect(toggle).toBeTruthy();
    expect(toggle.textContent).toBe('Show more');

    await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain(longMission.trim());
  });
});

// Reports-to editor (2026-09-30) — Dhee: "I should be able to change who Reese reports to."
describe('AgentOverviewV2Sidebar — Reports-to editor', () => {
  beforeEach(() => {
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-1', charter: null });
  });

  function findButton(text: string): HTMLElement {
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
    if (!btn) throw new Error(`Button "${text}" not found`);
    return btn as HTMLElement;
  }

  it('renders a real "Change manager…" control on the Reports to card', async () => {
    await render(buildDetail());
    expect(findButton('Change manager…')).toBeTruthy();
  });

  it('opening the editor fetches real candidates and lets the admin pick a new one', async () => {
    await render(buildDetail());
    await act(async () => { findButton('Change manager…').dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(getOrgChart).toHaveBeenCalled();
    expect(container.textContent).toContain('Ali Muwwakkil (ali@colaberry.com)');
    const select = container.querySelector('select[aria-label="Choose who Reese reports to"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
  });

  it('Save is disabled until a genuinely different real target is picked, then calls the real API and refetches', async () => {
    setAgentReportsTo.mockResolvedValue({
      agentId: 'agent-1', agentName: 'Reese', found: true, updated: true,
      reports_to: { trail: [], resolved_human: { id: 'human-1', name: 'Ali Muwwakkil', email: 'ali@colaberry.com' }, immediate_agent: null },
      setAt: '2026-09-30T00:00:00Z', setBy: 'dhee@colaberry.com', error: null,
    });
    await render(buildDetail());
    await act(async () => { findButton('Change manager…').dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const saveBtn = findButton('Save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true); // nothing picked yet

    const select = container.querySelector('select[aria-label="Choose who Reese reports to"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'human-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(saveBtn.disabled).toBe(false);

    await act(async () => { saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(setAgentReportsTo).toHaveBeenCalledWith('agent-1', 'human', 'human-1');
    expect(onReportsToChanged).toHaveBeenCalled();
  });

  it('shows the real server error inline on a rejected save, never silently swallowed', async () => {
    setAgentReportsTo.mockRejectedValue({ response: { data: { error: 'That chain does not resolve to a real human' } } });
    await render(buildDetail());
    await act(async () => { findButton('Change manager…').dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const select = container.querySelector('select[aria-label="Choose who Reese reports to"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'human-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { findButton('Save').dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(container.textContent).toContain('That chain does not resolve to a real human');
    expect(onReportsToChanged).not.toHaveBeenCalled();
  });

  it('Cancel closes the editor without calling the API', async () => {
    await render(buildDetail());
    await act(async () => { findButton('Change manager…').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { findButton('Cancel').dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(setAgentReportsTo).not.toHaveBeenCalled();
    expect(findButton('Change manager…')).toBeTruthy();
  });
});
