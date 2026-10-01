import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentOverviewV2EmployeeFacts from '../AgentOverviewV2EmployeeFacts';
import { AgentDetail, AgentDetailEmployeeFacts, AgentDetailEmployeeFactsBehaviour } from '../../../../services/agentDetailApi';

// Agent Detail polish round 3 (2026-09-29) — focused unit coverage for the
// redesigned Employee Facts section, extracted out of
// AgentOverviewV2Sidebar.tsx. Integration-level coverage (rendered inside
// the full AgentDetailPage tree, real toggle wiring against the mocked API)
// lives in AgentDetailPage.overview.test.tsx's own "Employee facts:
// behaviour switches" describe block — this file covers the component's
// own rendering/grouping/collapse logic in isolation.

jest.mock('../../../../services/agentDetailApi', () => {
  const actual = jest.requireActual('../../../../services/agentDetailApi');
  return { ...actual, setReeseBehaviourSwitch: jest.fn() };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setReeseBehaviourSwitch } = require('../../../../services/agentDetailApi') as { setReeseBehaviourSwitch: jest.Mock };

function behaviour(overrides: Partial<AgentDetailEmployeeFactsBehaviour>): AgentDetailEmployeeFactsBehaviour {
  return {
    key: 'reactive_dm_reply', name: 'Reactive DM reply', enabled: true,
    population: 'Whoever messages her.', kill_switch: "Reese's own ai_agents.enabled.",
    tools: [], scheduled_work_ref: null, last_ticket: null, trigger_mode: 'model_selected',
    status: { callable: true, configured: true, authorized: true, enabled: true, healthy: null },
    ...overrides,
  };
}

// The real, verified 7-behaviour split (request.md): 2 Replies to messages,
// 4 Scheduled, 1 Rule-triggered.
const SEVEN_BEHAVIOURS: AgentDetailEmployeeFactsBehaviour[] = [
  behaviour({ key: 'reactive_dm_reply', name: 'Reactive DM reply', tools: ['respond_to_dm'], trigger_mode: 'model_selected', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: null } }),
  behaviour({ key: 'health_assessment', name: 'Health assessment', tools: ['assess_student_health'], trigger_mode: 'model_selected', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: null } }),
  behaviour({ key: 'autonomous_outreach_sweep', name: 'Autonomous outreach sweep', scheduled_work_ref: 'ReeseAutonomousOutreachSweep', trigger_mode: 'rule_triggered', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: true } }),
  behaviour({ key: 'outreach_follow_ups', name: 'Outreach follow-ups', scheduled_work_ref: 'ReeseOutreachFollowUps', trigger_mode: 'rule_triggered', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: true } }),
  behaviour({ key: 'presence_heartbeat', name: 'Presence heartbeat', scheduled_work_ref: 'ReesePresenceHeartbeat', trigger_mode: 'rule_triggered', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: false } }),
  behaviour({ key: 'student_support_supersession_resolver', name: 'Student support supersession resolver', scheduled_work_ref: 'ReeseSupersessionResolver', trigger_mode: 'rule_triggered', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: true } }),
  behaviour({ key: 'welcome_dms', name: 'Welcome DMs', trigger_mode: 'rule_triggered', status: { callable: true, configured: true, authorized: true, enabled: true, healthy: null } }),
];

function employeeFacts(overrides: Partial<AgentDetailEmployeeFacts>): AgentDetailEmployeeFacts {
  return {
    availability: 'available', work_state: 'idle', work_state_detail: null,
    last_meaningful_action: { at: '2026-09-29T10:00:00Z', description: 'Sent a DM: "Checking in."' },
    charter_version: 3, charter_effective_at: '2026-09-18T00:00:00Z',
    manager_chain_note: 'Reports to: Ali Muwwakkil',
    behaviours: SEVEN_BEHAVIOURS,
    ...overrides,
  };
}

const BASE_AGENT: AgentDetail['agent'] = {
  id: 'agent-reese', agent_name: 'Reese', agent_type: 'ai_staff_mentor', category: null,
  description: null, system_prompt: null, tools_granted: [], persona_version: null,
  enabled: true, created_at: null, autonomy_level: null,
  department: null, module: null, source_file: null,
  max_runs_per_hour: 60, max_writes_per_execution: 100, max_proposals_per_run: 50,
  autonomy_level_set_at: null, autonomy_level_source: null,
  reports_to_type: null, reports_to_id: null,
  abac_mode_override: null, abac_mode_override_set_at: null, abac_mode_override_set_by: null,
  abac_effective_mode: 'shadow', abac_global_default: 'shadow',
};

function buildDetail(facts: AgentDetailEmployeeFacts | null): AgentDetail {
  return {
    agent: BASE_AGENT, identity: null, live_status: 'unknown',
    open_ticket_count: 0, completed_ticket_count_30d: 0, verified_resolution_count: 0, owned_ticket_count_all_time: 0, most_recent_verified_ticket_id: null, tickets: [], ticket_breakdown: [],
    related_tasks: [], owned_behaviors: [], persona_version_history: [],
    cost_summary: null,
    authorization_summary: { window_days: 30, total: 0, allow: 0, approval: 0, block: 0, enforced_count: 0 },
    capabilities: { reads: [], produces: [], undocumented_tools: [], produced_ticket_types: [], by_tool: [] },
    autonomy_explanation: { level: 'observe', reason: 'No tools_granted recorded for this agent — the safe, honest default, not a guess.', matched_tool: null },
    reports_to: null,
    trust_contract: { trigger_type: 'on_demand', schedule: null, status: 'idle', last_run_at: null, run_count: 0, error_count: 0, avg_duration_ms: null, last_error: null, last_error_at: null, last_activity_at: null },
    goals: [], goals_overall: 0,
    employee_facts: facts,
  };
}

let container: HTMLDivElement;
let root: Root;

async function renderFacts(facts: AgentDetailEmployeeFacts | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AgentOverviewV2EmployeeFacts detail={buildDetail(facts)} agentId="agent-reese" />);
  });
}

async function expandRow(name: string) {
  const nameSpan = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === name);
  const rowDiv = nameSpan?.closest('.adv2-behaviour-row');
  const toggle = rowDiv?.querySelector('.adv2-behaviour-expand-toggle');
  if (!toggle) throw new Error(`Expand toggle for "${name}" not found`);
  await act(async () => {
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => { jest.clearAllMocks(); });

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('AgentOverviewV2EmployeeFacts', () => {
  it('renders nothing when employee_facts is null (honest empty state for every non-Reese agent)', async () => {
    await renderFacts(null);
    expect(container.textContent).toBe('');
  });

  it('renders the 3-column mini-stat row with real data', async () => {
    await renderFacts(employeeFacts({ work_state: 'working_on_ticket', work_state_detail: '2 open ticket(s)' }));

    expect(container.textContent).toContain('Working');
    expect(container.textContent).toContain('2 open ticket(s)');
    expect(container.textContent).toContain('v3');
    expect(container.textContent).toContain('Reports to: Ali Muwwakkil');
  });

  it('renders the real quoted last-meaningful-action preview, with no "View message" link anywhere', async () => {
    await renderFacts(employeeFacts({}));

    expect(container.textContent).toContain('Sent a DM: "Checking in."');
    expect(container.textContent).not.toContain('View message');
    expect(Array.from(container.querySelectorAll('a')).some((a) => a.textContent?.includes('View message'))).toBe(false);
  });

  it('honest "No recorded activity yet" when there is none', async () => {
    await renderFacts(employeeFacts({ last_meaningful_action: null }));
    expect(container.textContent).toContain('No recorded activity yet');
  });

  it('computes the behaviour-count summary from a mixed healthy/unknown/unhealthy fixture', async () => {
    await renderFacts(employeeFacts({}));
    // 3 healthy (autonomous_outreach_sweep, outreach_follow_ups, student_support_supersession_resolver),
    // 1 unhealthy (presence_heartbeat), 3 unknown (reactive_dm_reply, health_assessment, welcome_dms).
    expect(container.textContent).toContain('3 healthy, 3 unknown, 1 unhealthy across 7 behaviours');
  });

  it('groups all 7 real behaviours into exactly the 2/4/1 split', async () => {
    await renderFacts(employeeFacts({}));

    expect(container.textContent).toContain('Replies to messages');
    expect(container.textContent).toContain('Scheduled');
    expect(container.textContent).toContain('Rule-triggered');
    expect(container.textContent).toContain('Replies to messages (2)');
    expect(container.textContent).toContain('Scheduled (4)');
    expect(container.textContent).toContain('Rule-triggered (1)');
  });

  it('collapses every behaviour row by default, and expands/collapses each independently', async () => {
    await renderFacts(employeeFacts({}));

    expect(container.textContent).not.toContain('uses: respond_to_dm');

    await expandRow('Reactive DM reply');
    expect(container.textContent).toContain('uses: respond_to_dm');
    // A sibling row stays collapsed.
    expect(container.textContent).not.toContain('uses: assess_student_health');

    await expandRow('Reactive DM reply');
    expect(container.textContent).not.toContain('uses: respond_to_dm');
  });

  it('a per-key error renders even while the row stays collapsed', async () => {
    setReeseBehaviourSwitch.mockRejectedValue({ response: { data: { error: 'This agent is not in your reporting chain.' } } });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    await renderFacts(employeeFacts({}));

    const nameSpan = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === 'Reactive DM reply');
    const button = nameSpan?.parentElement?.querySelector('button');
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('This agent is not in your reporting chain.');
    // Never expanded this row — the error is visible without an expand click.
    expect(container.textContent).not.toContain('uses: respond_to_dm');
  });

  it('every real expanded field renders exactly as the prior flat version did', async () => {
    await renderFacts(employeeFacts({}));
    await expandRow('Autonomous outreach sweep');

    expect(container.querySelector('a[href="#task-ReeseAutonomousOutreachSweep"]')).not.toBeNull();
    expect(container.textContent).toContain('Last ticket: None');
    expect(container.textContent).toContain('Healthy: yes');
  });

  it('a null status fact renders an honest dash, never a fabricated value', async () => {
    await renderFacts(employeeFacts({}));
    await expandRow('Welcome DMs');

    expect(container.textContent).toContain('Healthy: —');
  });
});
