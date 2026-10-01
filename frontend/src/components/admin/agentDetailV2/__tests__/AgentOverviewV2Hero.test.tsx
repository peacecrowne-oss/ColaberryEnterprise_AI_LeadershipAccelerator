import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentOverviewV2Hero from '../AgentOverviewV2Hero';
import { AgentDetail, AgentDetailTicket, AgentDetailEmployeeFacts } from '../../../../services/agentDetailApi';

// Dashboard redesign, Slice 2b (2026-09-19) — the hero sentence must only
// ever phrase around the 2 real work_state values this codebase actually
// computes (idle/working_on_ticket).
//
// Agent Detail redesign, Track A1 (2026-09-21) — the 4 KPI tiles moved to
// AgentOverviewV2Metrics.test.tsx (see that file). This file gained the
// "next commitment" panel's own tests — a small, honest, frontend-only
// derivation with no single real backing field (execution-contract.md
// Assumption 1).

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

function employeeFacts(overrides: Partial<AgentDetailEmployeeFacts>): AgentDetailEmployeeFacts {
  return {
    availability: 'available', work_state: 'idle', work_state_detail: null,
    last_meaningful_action: null, charter_version: null, charter_effective_at: null,
    manager_chain_note: 'Reports to: Ali Muwwakkil', behaviours: [],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function renderHero(detail: AgentDetail, onNavigate: (tab: any) => void = () => {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AgentOverviewV2Hero detail={detail} onNavigate={onNavigate} />);
  });
}

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('AgentOverviewV2Hero', () => {
  it('renders the real idle sentence for Reese', async () => {
    await renderHero(buildDetail({ employee_facts: employeeFacts({ work_state: 'idle' }) }));
    expect(container.textContent).toContain('Reese is currently idle.');
  });

  it('renders the real working_on_ticket sentence with work_state_detail and last_meaningful_action', async () => {
    await renderHero(buildDetail({
      employee_facts: employeeFacts({
        work_state: 'working_on_ticket', work_state_detail: '3 open ticket(s)',
        last_meaningful_action: { at: '2026-09-19T10:00:00Z', description: 'Sent a DM: "Here is your next move."' },
      }),
    }));
    expect(container.textContent).toContain('Reese is currently working on tickets, with 3 open ticket(s).');
    expect(container.textContent).toContain('Sent a DM: "Here is your next move."');
  });

  it('honesty boundary: no hero sentence at all for a non-Reese agent (employee_facts: null)', async () => {
    await renderHero(buildDetail({ agent: { ...BASE_AGENT, agent_name: 'CoryBrain' }, employee_facts: null }));
    expect(container.textContent).not.toContain('is currently');
  });

  it('CTA button navigates to the Talk tab', async () => {
    const onNavigate = jest.fn();
    await renderHero(buildDetail(), onNavigate);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes("Ask me about today's work"));
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('talk');
  });

  describe('next commitment panel (Track A1)', () => {
    it('shows the actionable ticket with the soonest real due_date', async () => {
      await renderHero(buildDetail({
        tickets: [
          ticket({ id: 't-far', title: 'Far-out task', status_bucket: 'open', due_date: '2026-12-01T00:00:00Z' }),
          ticket({ id: 't-soon', title: 'Verify Jordan can open the lab', status_bucket: 'ready_to_verify', due_date: '2026-09-22T00:00:00Z' }),
        ],
      }));
      expect(container.textContent).toContain('Verify Jordan can open the lab');
      expect(container.textContent).toContain('Ready to verify');
      expect(container.textContent).not.toContain('Far-out task');
    });

    it('honesty boundary: omitted entirely when no actionable ticket has a real due_date', async () => {
      await renderHero(buildDetail({
        tickets: [ticket({ id: 't-no-due', status_bucket: 'open', due_date: null })],
      }));
      expect(container.textContent).not.toContain('My next commitment');
    });

    it('a terminal (closed) ticket is never shown as the next commitment even with a due_date', async () => {
      await renderHero(buildDetail({
        tickets: [ticket({ id: 't-closed', status: 'done', status_bucket: null, due_date: '2026-09-01T00:00:00Z' })],
      }));
      expect(container.textContent).not.toContain('My next commitment');
    });

    it('"Inspect the case" navigates to the Work tab', async () => {
      const onNavigate = jest.fn();
      await renderHero(buildDetail({
        tickets: [ticket({ id: 't-1', title: 'Verify Jordan can open the lab', status_bucket: 'open', due_date: '2026-09-22T00:00:00Z' })],
      }), onNavigate);
      const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Inspect the case'));
      await act(async () => {
        button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onNavigate).toHaveBeenCalledWith('work');
    });
  });
});
