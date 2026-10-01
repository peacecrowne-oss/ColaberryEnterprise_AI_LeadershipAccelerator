import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentOverviewV2OperationalState from '../AgentOverviewV2OperationalState';
import { AgentDetail } from '../../../../services/agentDetailApi';
import { ManagerInboxItem } from '../../../../services/managerInboxApi';

// Agent Detail polish round 2 (2026-09-29) — Live Status retired from the
// nav; its 2 real, unique pieces (Operational state, Attention Required)
// fold into Overview via this new component, verbatim (same derivation
// functions, same markup). These tests are relocated from the old
// AgentDetailPage.commandCenter.test.tsx (now deleted — its "Live Status"
// tab no longer exists to click into), not new coverage: same real
// scenarios, now exercised directly against this component instead of
// through a full-page tab-click harness.

const BASE_AGENT: AgentDetail['agent'] = {
  id: 'agent-cory', agent_name: 'corybrain', agent_type: 'ai_leadership', category: 'executive',
  description: null, system_prompt: null, tools_granted: [], persona_version: '2026-08-20',
  enabled: true, created_at: null, autonomy_level: 'suggest',
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
      // Relative to test-run time, not a fixed literal — deriveOperationalState
      // compares against the real Date.now(), so a hardcoded past date would
      // silently drift outside the 24h idle window as real time passes.
      last_activity_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    },
    goals: [],
    goals_overall: 0,
    employee_facts: null,
    ...overrides,
  };
}

const PENDING_ITEM: ManagerInboxItem = {
  id: 'p-1', actionType: 'update_scheduled_email', reason: 'Shift send window to 8am recipient-local',
  confidence: 0.88, priorityScore: null, riskScore: null, impactScore: null,
  status: 'pending', createdAt: '2026-08-30T00:00:00Z', expiresAt: '2026-09-02T00:00:00Z',
  targetTable: 'scheduled_emails', targetId: 'email-1',
};

let container: HTMLDivElement;
let root: Root;

async function render(detail: AgentDetail, inboxItems: ManagerInboxItem[], inboxLoading = false, inboxError: string | null = null) {
  await act(async () => {
    root.render(<AgentOverviewV2OperationalState detail={detail} inboxItems={inboxItems} inboxLoading={inboxLoading} inboxError={inboxError} />);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('AgentOverviewV2OperationalState — Operational state', () => {
  it('derives and renders a real operational-state label from trust_contract + live_status', async () => {
    await render(buildDetail(), []);
    expect(container.textContent).toContain('Idle');
  });
});

describe('AgentOverviewV2OperationalState — Attention Required', () => {
  it('shows a loading state while the inbox is being fetched', async () => {
    await render(buildDetail(), [], true);
    expect(container.textContent).toContain('Checking pending approvals');
  });

  it('shows an honest error message, never a silent failure, when the inbox call rejects', async () => {
    await render(buildDetail(), [], false, 'Network timeout');
    expect(container.textContent).toContain('Network timeout');
  });

  it('surfaces a real pending-approval item with its real reason text', async () => {
    await render(buildDetail(), [PENDING_ITEM]);
    expect(container.textContent).toContain('1 approval waiting for review');
    expect(container.textContent).toContain('Shift send window to 8am recipient-local');
  });

  it('surfaces a real shadow-mode item citing the real would-block count', async () => {
    await render(buildDetail(), []);
    expect(container.textContent).toContain('shadow mode');
    expect(container.textContent).toContain('1 of those had a policy verdict of "would block"');
  });

  it('shows the honest "no action required" item when nothing is pending and enforcement is real', async () => {
    await render(
      buildDetail({ authorization_summary: { window_days: 30, total: 5, allow: 5, approval: 0, block: 0, enforced_count: 5 } }),
      [],
    );
    expect(container.textContent).toContain('No manager action required right now');
  });
});
