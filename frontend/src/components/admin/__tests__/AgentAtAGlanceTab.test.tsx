import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentAtAGlanceTab from '../AgentAtAGlanceTab';
import { AgentDetail } from '../../../services/agentDetailApi';
import { ManagerInboxItem } from '../../../services/managerInboxApi';
import { ManagerDirective } from '../../../services/managerDirectiveApi';
import { ReportSubscription } from '../../../services/agentReportSubscriptionApi';
import { AgentGoal } from '../../../services/agentGoalApi';
import { AgentOneOnOne } from '../../../services/agentOneOnOneApi';
import { AgentRoleCharter } from '../../../services/agentRoleCharterApi';

// AI Agent Dashboard redesign, Checkpoint F: At a Glance (2026-09-03) —
// pins the real, conditional tone/KPI computation per tile (never a
// fabricated indicator) and that clicking a tile calls onNavigate with the
// real target tab. Live Status's tile reuses deriveOperationalState()/
// deriveAttentionItems() verbatim — this file trusts those already-tested
// pure functions and only checks the tile renders their real output.
//
// Checkpoint H (2026-09-10) — Ali: "Role Character should be moved to the
// At a glance tab under the dashboard." Added as a 7th tile, same
// tile+click-through pattern as every other section (the full edit form
// stays on Trust & Control — this tile is a real summary, not a duplicate
// editor). Unlike every other tile, an honest-empty charter is a real gap
// (tone 'warning', not 'neutral') — see build-platform-agent skill's own
// framing of this in references/trust-and-hierarchy.md.

jest.mock('../../../services/managerDirectiveApi', () => ({ listDirectives: jest.fn() }));
jest.mock('../../../services/agentReportSubscriptionApi', () => ({ listReportSubscriptions: jest.fn() }));
jest.mock('../../../services/agentGoalApi', () => ({ listGoals: jest.fn() }));
jest.mock('../../../services/agentOneOnOneApi', () => ({ listOneOnOnes: jest.fn() }));
jest.mock('../../../services/agentRoleCharterApi', () => ({ getAgentRoleCharter: jest.fn() }));

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

const DETAIL: AgentDetail = {
  agent: {
    id: 'agent-1', agent_name: 'CoryStrategicAgent', agent_type: 'ai_staff', category: null,
    description: null, system_prompt: null, tools_granted: [], persona_version: null,
    enabled: true, created_at: null, autonomy_level: null,
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
  goals: [
    { key: 'governance', label: 'Governance', score: 5, source: 'fixed', evidence: 'Tier suggest_only.' },
    { key: 'observability', label: 'Observability', score: 3, source: 'live', evidence: '0/0 carry a trace_id.' },
    { key: 'availability', label: 'Availability', score: 5, source: 'live', evidence: 'Enabled.' },
    { key: 'lexicon', label: 'Lexicon', score: 4, source: 'fixed', evidence: 'uncategorized.' },
    { key: 'solid', label: 'Solid', score: 5, source: 'live', evidence: '0/0 failed.' },
  ],
  goals_overall: 4.4,
  employee_facts: null,
};

const PENDING_ITEM: ManagerInboxItem = {
  id: 'p-1', actionType: 'update_scheduled_email', reason: 'Shift send window',
  confidence: 0.8, priorityScore: null, riskScore: null, impactScore: null,
  status: 'pending', createdAt: '2026-08-30T00:00:00Z', expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  targetTable: 'scheduled_emails', targetId: 'email-1',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  jest.clearAllMocks();
  listDirectives.mockResolvedValue([]);
  listReportSubscriptions.mockResolvedValue([]);
  listGoals.mockResolvedValue([]);
  listOneOnOnes.mockResolvedValue([]);
  getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-1', charter: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

async function renderTab(overrides: Partial<{ detail: AgentDetail; inboxItems: ManagerInboxItem[]; inboxLoading: boolean; onNavigate: (t: any) => void }> = {}) {
  const onNavigate = overrides.onNavigate || jest.fn();
  await act(async () => {
    root.render(
      <AgentAtAGlanceTab
        agentId="agent-1"
        detail={overrides.detail || DETAIL}
        inboxItems={overrides.inboxItems || []}
        inboxLoading={overrides.inboxLoading ?? false}
        onNavigate={onNavigate}
      />,
    );
    await new Promise((r) => setTimeout(r, 0));
  });
  return onNavigate;
}

describe('AgentAtAGlanceTab — Live Status tile', () => {
  it('shows the real operational-state label with no attention items when nothing is pending', async () => {
    await renderTab();
    expect(container.textContent).toContain('Live Status');
    // trigger_type on_demand + no live presence chain + no ticket activity -> Unknown
    expect(container.textContent).toContain('Unknown');
  });

  it('reflects real pending approvals in both the count and the reason', async () => {
    await renderTab({ inboxItems: [PENDING_ITEM] });
    expect(container.textContent).toContain('Needs Approval');
  });
});

describe('AgentAtAGlanceTab — Work & Decisions tile', () => {
  it('shows "Nothing pending" when the inbox is empty', async () => {
    await renderTab();
    expect(container.textContent).toContain('Nothing pending');
  });

  it('shows the real oldest reason when items are pending', async () => {
    await renderTab({ inboxItems: [PENDING_ITEM] });
    expect(container.textContent).toContain('Shift send window');
  });
});

describe('AgentAtAGlanceTab — Talk tile', () => {
  it('shows "No standing directives" when none are active', async () => {
    await renderTab();
    expect(container.textContent).toContain('No standing directives');
  });

  it('shows the real active directive text', async () => {
    const directive: ManagerDirective = {
      id: 'd1', directiveText: 'Always cc Kes.', status: 'active',
      createdByEmail: 'ali@colaberry.com', createdByOrgMemberId: null, createdAt: '2026-09-01T00:00:00Z',
      revokedAt: null, revokedByEmail: null,
    };
    listDirectives.mockResolvedValue([directive]);
    await renderTab();
    expect(container.textContent).toContain('Always cc Kes.');
  });
});

describe('AgentAtAGlanceTab — Reports tile', () => {
  it('shows "Nothing scheduled yet" when there are no subscriptions', async () => {
    await renderTab();
    expect(container.textContent).toContain('Nothing scheduled yet');
  });

  it('shows the real enabled-of-total breakdown', async () => {
    const subs: ReportSubscription[] = [
      { id: 's1', agentId: 'agent-1', contentScope: ['cost'], cadence: 'daily', deliveryHourLocal: 8, timezone: 'America/Chicago', channel: 'email', enabled: true, createdByEmail: 'ali@colaberry.com', createdAt: '2026-09-01T00:00:00Z' },
      { id: 's2', agentId: 'agent-1', contentScope: ['activity'], cadence: 'weekly', deliveryHourLocal: 8, timezone: 'America/Chicago', channel: 'email', enabled: false, createdByEmail: 'ali@colaberry.com', createdAt: '2026-09-01T00:00:00Z' },
    ];
    listReportSubscriptions.mockResolvedValue(subs);
    await renderTab();
    expect(container.textContent).toContain('1 of 2 enabled');
  });
});

describe('AgentAtAGlanceTab — Performance tile', () => {
  it('shows an honest "—" when no goals are set', async () => {
    await renderTab();
    expect(container.textContent).toContain('No goals set');
  });

  it('shows the real met/total fraction from active goals only', async () => {
    const goals: AgentGoal[] = [
      { id: 'g1', metricKey: 'open_ticket_count', comparison: 'at_most', targetValue: 5, currentValue: 2, met: true, status: 'active', createdByEmail: 'ali@colaberry.com', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'g2', metricKey: 'monthly_cost_usd', comparison: 'at_most', targetValue: 50, currentValue: 80, met: false, status: 'active', createdByEmail: 'ali@colaberry.com', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'g3', metricKey: 'open_ticket_count', comparison: 'at_least', targetValue: 1, currentValue: 1, met: true, status: 'archived', createdByEmail: 'ali@colaberry.com', createdAt: '2026-08-01T00:00:00Z' },
    ];
    listGoals.mockResolvedValue(goals);
    await renderTab();
    // archived goal excluded -> 1 met of 2 active
    expect(container.textContent).toContain('1/2');
  });
});

describe('AgentAtAGlanceTab — Trust & Control tile', () => {
  it('shows the real GOALS™ overall score and the real weakest dimension', async () => {
    await renderTab();
    expect(container.textContent).toContain('4.4');
    expect(container.textContent).toContain('Observability (3/5) is the lowest dimension');
  });
});

describe('AgentAtAGlanceTab — Role Charter tile', () => {
  it('shows the honest "Not written" state, tone warning (a real gap, not a neutral non-event), when no charter exists', async () => {
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-1', charter: null });
    await renderTab();
    expect(container.textContent).toContain('Role Charter');
    expect(container.textContent).toContain('Not written');
    expect(container.textContent).toContain('No charter written yet');
  });

  it('shows the real role title and attribution when a charter exists', async () => {
    const charter: AgentRoleCharter = {
      roleTitle: 'AI Mentor — Student Success & Retention',
      mission: 'Real mission text.',
      responsibilities: ['Real responsibility.'],
      kpis: ['Real KPI.'],
      updatedByEmail: 'ali@colaberry.com',
      updatedAt: '2026-09-10T15:48:53.702Z',
      authorityAutonomous: null,
      authorityApprovalRequired: null,
      authorityForbidden: null,
    };
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-1', charter });
    await renderTab();
    expect(container.textContent).toContain('Written');
    expect(container.textContent).toContain('AI Mentor — Student Success & Retention');
  });
});

describe('AgentAtAGlanceTab — navigation', () => {
  it('clicking each tile calls onNavigate with the real target tab', async () => {
    const onNavigate = await renderTab();
    const buttons = Array.from(container.querySelectorAll('button'));
    const clickByLabel = (label: string) => {
      const btn = buttons.find((b) => b.textContent?.includes(label));
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    clickByLabel('Live Status');
    clickByLabel('Decisions');
    clickByLabel('Talk');
    clickByLabel('Reports');
    clickByLabel('Performance');
    clickByLabel('Trust & Control');
    clickByLabel('Role Charter');
    expect(onNavigate).toHaveBeenCalledWith('command');
    expect(onNavigate).toHaveBeenCalledWith('decisions');
    expect(onNavigate).toHaveBeenCalledWith('talk');
    // Dashboard redesign, Slice 1 (2026-09-19) — Reports/Performance/Trust &
    // Control tiles all now navigate to the one consolidated
    // 'performance_settings' destination, not 3 separate keys.
    expect(onNavigate).toHaveBeenCalledWith('performance_settings');
    // Checkpoint H (2026-09-10) — Role Charter moved to Overview's Identity
    // sub-tab, so its tile now navigates to 'overview', not 'trust'.
    expect(onNavigate).toHaveBeenCalledWith('overview');
  });
});

describe('AgentAtAGlanceTab — resilience', () => {
  it('one failing endpoint does not blank the other tiles, and shows an honest partial-load notice', async () => {
    listReportSubscriptions.mockRejectedValue(new Error('network error'));
    listDirectives.mockResolvedValue([]);
    await renderTab();
    expect(container.textContent).toContain('Some summary data could not be loaded');
    // Talk tile (a different, successful fetch) still renders its real state.
    expect(container.textContent).toContain('No standing directives');
  });
});
