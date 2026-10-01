import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentReportsTabSummary from '../AgentReportsTabSummary';
import { AgentDetail } from '../../../services/agentDetailApi';
import { ManagerInboxItem } from '../../../services/managerInboxApi';

// Agent Detail polish round 5 (2026-09-30) — Results & Reports' new
// top-of-page summary: a real "Verified resolution" stat
// (countVerifiedResolutionsForAgent()'s honest evidence+success gate) and a
// real manager-briefing card (inboxItems + owned-ticket count + the real
// most-recently-verified ticket's own outcome sentence, via the already-
// proven getTicketSummary()). "Discuss this report" drafts a real,
// aggregate-backed message, never auto-sent.

jest.mock('../../../services/ticketSummaryApi', () => ({ getTicketSummary: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getTicketSummary } = require('../../../services/ticketSummaryApi') as { getTicketSummary: jest.Mock };

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
    agent: BASE_AGENT, identity: null, live_status: 'unknown',
    open_ticket_count: 0, completed_ticket_count_30d: 0,
    verified_resolution_count: 0, owned_ticket_count_all_time: 0, most_recent_verified_ticket_id: null,
    tickets: [], ticket_breakdown: [], related_tasks: [], owned_behaviors: [], persona_version_history: [],
    cost_summary: null,
    authorization_summary: { window_days: 30, total: 0, allow: 0, approval: 0, block: 0, enforced_count: 0 },
    capabilities: { reads: [], produces: [], undocumented_tools: [], produced_ticket_types: [], by_tool: [] },
    autonomy_explanation: { level: 'observe', reason: 'No tools_granted recorded for this agent — the safe, honest default, not a guess.', matched_tool: null },
    reports_to: null,
    trust_contract: { trigger_type: 'on_demand', schedule: null, status: 'idle', last_run_at: null, run_count: 0, error_count: 0, avg_duration_ms: null, last_error: null, last_error_at: null, last_activity_at: null },
    goals: [], goals_overall: 0, employee_facts: null,
    ...overrides,
  };
}

function inboxItem(overrides: Partial<ManagerInboxItem> = {}): ManagerInboxItem {
  return {
    id: 'p1', actionType: 'propose_content_rewrite', reason: 'x', confidence: 0.7,
    priorityScore: null, riskScore: null, impactScore: null, status: 'pending',
    createdAt: '2026-09-01T00:00:00Z', expiresAt: null, targetTable: null, targetId: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function render(detail: AgentDetail, inboxItems: ManagerInboxItem[] = [], onDraftTalkText = jest.fn(), onNavigate = jest.fn()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AgentReportsTabSummary detail={detail} inboxItems={inboxItems} onDraftTalkText={onDraftTalkText} onNavigate={onNavigate} />);
    await new Promise((r) => setTimeout(r, 0));
  });
  return { onDraftTalkText, onNavigate };
}

beforeEach(() => { jest.clearAllMocks(); });

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('AgentReportsTabSummary', () => {
  it('shows the real Verified resolution count and percentage', async () => {
    await render(buildDetail({ verified_resolution_count: 3, owned_ticket_count_all_time: 4 }));
    expect(container.textContent).toContain('3 / 4');
    expect(container.textContent).toContain('75%');
  });

  it('boundary: zero owned tickets shows 0/0 and 0%, never NaN or a crash', async () => {
    await render(buildDetail({ verified_resolution_count: 0, owned_ticket_count_all_time: 0 }));
    expect(container.textContent).toContain('0 / 0');
    expect(container.textContent).not.toContain('NaN');
  });

  it('never shows "Human handoff acknowledged" or "Evidence confidence" — confirmed no real backing exists', async () => {
    await render(buildDetail());
    expect(container.textContent).not.toContain('Human handoff');
    expect(container.textContent).not.toContain('Evidence confidence');
  });

  it('the manager-briefing card shows real exceptions from inboxItems, with an honest empty state', async () => {
    await render(buildDetail(), [inboxItem(), inboxItem({ id: 'p2' })]);
    expect(container.textContent).toContain('2 items need your decision.');
  });

  it('honest "nothing needs your decision" when inboxItems is empty', async () => {
    await render(buildDetail(), []);
    expect(container.textContent).toContain('Nothing needs your decision right now.');
  });

  it('shows the real owned-work count, matching the status_bucket !== null derivation used elsewhere on this page', async () => {
    const detail = buildDetail({
      tickets: [
        { id: 't1', ticket_number: 1, title: 'A', description: null, status: 'todo', priority: 'medium', type: 'student_support', created_at: '', updated_at: '', due_date: null, status_bucket: 'open' },
        { id: 't2', ticket_number: 2, title: 'B', description: null, status: 'done', priority: 'medium', type: 'student_support', created_at: '', updated_at: '', due_date: null, status_bucket: null },
      ] as any,
    });
    await render(detail);
    expect(container.textContent).toContain('1 owned case.');
  });

  it('fetches and shows the real most-recently-verified ticket\'s own outcome sentence when one exists', async () => {
    getTicketSummary.mockResolvedValue({ outcome: 'Outcome: real ticket outcome text.', proof: 'p', humanAction: 'h', hasEvidence: true });
    await render(buildDetail({ most_recent_verified_ticket_id: 'ticket-7' }));

    expect(getTicketSummary).toHaveBeenCalledWith('ticket-7');
    expect(container.textContent).toContain('Outcome: real ticket outcome text.');
  });

  it('shows no "Verified result" line at all when nothing has been verified yet', async () => {
    await render(buildDetail({ most_recent_verified_ticket_id: null }));
    expect(getTicketSummary).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Verified result');
  });

  it('"Discuss this report" drafts a real, aggregate-backed message and navigates to Talk, never auto-sending', async () => {
    const { onDraftTalkText, onNavigate } = await render(
      buildDetail({ verified_resolution_count: 2, owned_ticket_count_all_time: 5 }),
      [inboxItem()],
    );

    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Discuss this report');
    await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(onDraftTalkText).toHaveBeenCalledTimes(1);
    const draftedText = onDraftTalkText.mock.calls[0][0] as string;
    expect(draftedText).toContain('2 of 5');
    expect(onNavigate).toHaveBeenCalledWith('talk');
  });
});
