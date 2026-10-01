import { deriveAttentionItems, deriveRecentOutcome } from '../agentAttentionRequired';
import { AgentDetail, AgentDetailTicket } from '../../services/agentDetailApi';
import { ManagerInboxItem } from '../../services/managerInboxApi';

function makeTicket(overrides: Partial<AgentDetailTicket> = {}): AgentDetailTicket {
  return {
    id: 't1',
    ticket_number: 1,
    title: 'Test ticket',
    description: null,
    status: 'done',
    priority: 'normal',
    type: 'ops_summary',
    created_at: '2026-08-25T00:00:00.000Z',
    updated_at: '2026-08-25T00:00:00.000Z',
    due_date: null,
    status_bucket: null, // base status is 'done' (terminal) — honest default per Slice 2a
    ...overrides,
  };
}

function makeDetail(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    agent: {
      id: 'a1', agent_name: 'corybrain', agent_type: 'ai_leadership', category: 'executive',
      description: null, system_prompt: null, tools_granted: [], persona_version: null,
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
      trigger_type: null, schedule: null, status: 'idle', last_run_at: null, run_count: 0,
      error_count: 0, avg_duration_ms: null, last_error: null, last_error_at: null, last_activity_at: null,
    },
    goals: [],
    goals_overall: 0,
    employee_facts: null,
    ...overrides,
  };
}

function makeInboxItem(overrides: Partial<ManagerInboxItem> = {}): ManagerInboxItem {
  return {
    id: 'p1', actionType: 'propose_content_rewrite', reason: 'Rewrite onboarding template',
    confidence: 0.74, priorityScore: null, riskScore: null, impactScore: null,
    status: 'pending', createdAt: '2026-08-30T00:00:00.000Z', expiresAt: null,
    targetTable: null, targetId: null,
    ...overrides,
  };
}

describe('deriveAttentionItems', () => {
  it('returns the honest "no action required" item when nothing is wrong', () => {
    const items = deriveAttentionItems(makeDetail(), []);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('none');
  });

  it('surfaces an error-state item, high severity, quoting the real last_error', () => {
    const detail = makeDetail({ trust_contract: { ...makeDetail().trust_contract, status: 'error', last_error: 'OpenAI timeout' } });
    const items = deriveAttentionItems(detail, []);
    const errorItem = items.find((i) => i.title.includes('error state'));
    expect(errorItem?.severity).toBe('high');
    expect(errorItem?.body).toBe('OpenAI timeout');
  });

  it('surfaces a pending-approvals item sized to the real inbox count', () => {
    const items = deriveAttentionItems(makeDetail(), [makeInboxItem(), makeInboxItem({ id: 'p2' })]);
    const approvalItem = items.find((i) => i.title.includes('approval'));
    expect(approvalItem?.title).toBe('2 approvals waiting for review');
    expect(approvalItem?.severity).toBe('medium');
  });

  it('never fabricates a goal-at-risk or report-failure item — Live Status does not fetch that data yet', () => {
    const items = deriveAttentionItems(makeDetail(), []);
    expect(items.some((i) => /goal/i.test(i.title))).toBe(false);
    expect(items.some((i) => /report/i.test(i.title))).toBe(false);
  });

  it('surfaces shadow-mode as high severity when a real would-block verdict was allowed through', () => {
    const detail = makeDetail({ authorization_summary: { window_days: 30, total: 38, allow: 34, approval: 3, block: 1, enforced_count: 0 } });
    const items = deriveAttentionItems(detail, []);
    const shadowItem = items.find((i) => i.title.includes('shadow mode'));
    expect(shadowItem?.severity).toBe('high');
    expect(shadowItem?.body).toContain('1 of those had a policy verdict of "would block"');
  });

  it('surfaces shadow-mode as info severity when there was no would-block verdict', () => {
    const detail = makeDetail({ authorization_summary: { window_days: 30, total: 10, allow: 10, approval: 0, block: 0, enforced_count: 0 } });
    const items = deriveAttentionItems(detail, []);
    const shadowItem = items.find((i) => i.title.includes('shadow mode'));
    expect(shadowItem?.severity).toBe('info');
  });

  it('says nothing about shadow mode when there are zero authorization checks — never fabricates a mode from an empty denominator', () => {
    const items = deriveAttentionItems(makeDetail(), []);
    expect(items.some((i) => /shadow|enforc/i.test(i.title))).toBe(false);
  });

  it('surfaces partial enforcement distinctly from full shadow mode', () => {
    const detail = makeDetail({ authorization_summary: { window_days: 30, total: 10, allow: 10, approval: 0, block: 0, enforced_count: 4 } });
    const items = deriveAttentionItems(detail, []);
    const item = items.find((i) => i.title.includes('partial'));
    expect(item?.body).toBe('4 of 10 authorization checks in the last 30 days were under real enforcement; the rest were shadow-only.');
  });
});

describe('deriveRecentOutcome', () => {
  it('picks the most recent ticket with status="done"', () => {
    const detail = makeDetail({ tickets: [makeTicket({ id: 'a', status: 'in_progress' }), makeTicket({ id: 'b', status: 'done' })] });
    expect(deriveRecentOutcome(detail)?.id).toBe('b');
  });

  it('returns null when there is no done ticket — never falls back to the most recent ticket regardless of status', () => {
    const detail = makeDetail({ tickets: [makeTicket({ id: 'a', status: 'in_progress' }), makeTicket({ id: 'b', status: 'todo' })] });
    expect(deriveRecentOutcome(detail)).toBeNull();
  });

  it('returns null on an empty ticket list', () => {
    expect(deriveRecentOutcome(makeDetail({ tickets: [] }))).toBeNull();
  });
});
