import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentOverviewV2Metrics from '../AgentOverviewV2Metrics';
import { AgentDetail, AgentDetailTicket } from '../../../../services/agentDetailApi';
import { ManagerInboxItem } from '../../../../services/managerInboxApi';

// Agent Detail redesign, Track A1 (2026-09-21) — split out of
// AgentOverviewV2Hero.test.tsx's own former KPI-tile tests when the 4 tiles
// moved into their own component, relabeled to the mockup's case-centric
// language. Each tile's real, honest data source is asserted directly —
// see AgentOverviewV2Metrics.tsx's own header comment for the full mapping.

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

function ticket(overrides: Partial<AgentDetailTicket>): AgentDetailTicket {
  return {
    id: 't1', ticket_number: 1, title: 'A ticket', description: null,
    status: 'todo', priority: 'medium', type: 'student_support',
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    due_date: null, status_bucket: 'open',
    ...overrides,
  };
}

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

function inboxItem(overrides: Partial<ManagerInboxItem> = {}): ManagerInboxItem {
  return {
    id: 'p1', actionType: 'propose_content_rewrite', reason: 'A real reason', confidence: 0.8,
    priorityScore: null, riskScore: null, impactScore: null,
    status: 'pending', createdAt: '2026-09-20T00:00:00Z', expiresAt: null,
    targetTable: null, targetId: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function renderMetrics(detail: AgentDetail, inboxItems: ManagerInboxItem[] = [], onNavigate: (tab: any) => void = () => {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AgentOverviewV2Metrics detail={detail} inboxItems={inboxItems} onNavigate={onNavigate} />);
  });
}

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('AgentOverviewV2Metrics', () => {
  it('"Owned cases" counts actionable tickets (status_bucket !== null), excluding closed ones', async () => {
    await renderMetrics(buildDetail({
      tickets: [
        ticket({ id: 't-open', status_bucket: 'open' }),
        ticket({ id: 't-overdue', status_bucket: 'overdue' }),
        ticket({ id: 't-closed', status: 'done', status_bucket: null }),
      ],
    }));
    expect(container.textContent).toContain('Owned cases');
    const ownedTile = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Owned cases'));
    expect(ownedTile?.querySelector('.adv2-v')?.textContent).toBe('2');
  });

  it('"Needs your decision" is the real inboxItems.length, same array Needs Ali renders', async () => {
    await renderMetrics(buildDetail(), [inboxItem(), inboxItem({ id: 'p2' })]);
    const tile = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Needs your decision'));
    expect(tile?.querySelector('.adv2-v')?.textContent).toBe('2');
  });

  it('"Ready for your review" counts only status_bucket === ready_to_verify — an honest partial proxy, not a full 3-way waiting split', async () => {
    await renderMetrics(buildDetail({
      tickets: [
        ticket({ id: 't-ready', status_bucket: 'ready_to_verify' }),
        ticket({ id: 't-open', status_bucket: 'open' }),
        ticket({ id: 't-needs-reply', status_bucket: 'needs_reply' }),
      ],
    }));
    const tile = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Ready for your review'));
    expect(tile?.querySelector('.adv2-v')?.textContent).toBe('1');
  });

  it('"Completed (30d)" is the real completed_ticket_count_30d field, never fabricated as "verified"', async () => {
    await renderMetrics(buildDetail({ completed_ticket_count_30d: 7 }));
    const tile = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Completed (30d)'));
    expect(tile?.querySelector('.adv2-v')?.textContent).toBe('7');
    expect(container.textContent).not.toContain('Verified');
  });

  it('clicking "Needs your decision" navigates to the Decisions tab (not Work, unlike the other 3 tiles)', async () => {
    const onNavigate = jest.fn();
    await renderMetrics(buildDetail(), [], onNavigate);
    const tile = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Needs your decision'));
    await act(async () => { tile!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onNavigate).toHaveBeenCalledWith('decisions');
  });

  it('clicking "Owned cases" navigates to the Work tab', async () => {
    const onNavigate = jest.fn();
    await renderMetrics(buildDetail(), [], onNavigate);
    const tile = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Owned cases'));
    await act(async () => { tile!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onNavigate).toHaveBeenCalledWith('work');
  });
});
