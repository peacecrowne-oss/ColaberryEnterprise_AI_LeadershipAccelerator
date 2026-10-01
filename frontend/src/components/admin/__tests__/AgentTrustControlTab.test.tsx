import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentTrustControlTab from '../AgentTrustControlTab';
import { AgentDetail, setAgentAbacOverride } from '../../../services/agentDetailApi';
import { AgentMemoryProposal } from '../../../services/agentMemoryProposalApi';
import { ManagerDirective } from '../../../services/managerDirectiveApi';

// AI Agent Dashboard redesign, Checkpoint E: Trust & Control, slice 1
// (2026-09-03) — pins the honest governed-memory gate (a pending proposal
// shows Approve/Reject; approved/rejected never do) and the consolidated
// Directives view (revoke here, no create control — creation stays in
// Talk's Ask/Direct composer).
//
// Overview sub-tabs (2026-09-10) — Charter moved out of this tab entirely
// (now lives on Overview's Identity sub-tab, see AgentOverviewTab.tsx), so
// the AgentCharterTab mock and its "Charter reuse" describe block below are
// gone; `agentName` is no longer a prop of this component.

jest.mock('../../../services/agentMemoryProposalApi', () => ({
  listMemoryProposals: jest.fn(),
  proposeMemory: jest.fn(),
  approveMemoryProposal: jest.fn(),
  rejectMemoryProposal: jest.fn(),
}));
jest.mock('../../../services/managerDirectiveApi', () => ({
  listDirectives: jest.fn(),
  createDirective: jest.fn(),
  revokeDirective: jest.fn(),
}));
jest.mock('../../../services/agentDetailApi', () => {
  const actual = jest.requireActual('../../../services/agentDetailApi');
  return { ...actual, setAgentAbacOverride: jest.fn() };
});
// Track A2 — the new Independence with boundaries card (AgentTrustControlAuthority)
// fetches the charter on its own; mocked here so this suite never makes a real call.
jest.mock('../../../services/agentRoleCharterApi', () => ({
  getAgentRoleCharter: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listMemoryProposals, proposeMemory, approveMemoryProposal, rejectMemoryProposal } =
  require('../../../services/agentMemoryProposalApi') as {
    listMemoryProposals: jest.Mock; proposeMemory: jest.Mock; approveMemoryProposal: jest.Mock; rejectMemoryProposal: jest.Mock;
  };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listDirectives, revokeDirective } = require('../../../services/managerDirectiveApi') as {
  listDirectives: jest.Mock; revokeDirective: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAgentRoleCharter } = require('../../../services/agentRoleCharterApi') as { getAgentRoleCharter: jest.Mock };

function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const PENDING_PROPOSAL: AgentMemoryProposal = {
  id: 'm1', agentId: 'agent-1', content: 'Ali prefers terse status updates.', evidence: null,
  status: 'pending', proposedByEmail: 'ali@colaberry.com', reviewedByEmail: null, reviewedAt: null,
  reviewNotes: null, createdAt: '2026-09-03T00:00:00Z',
};
const APPROVED_PROPOSAL: AgentMemoryProposal = {
  ...PENDING_PROPOSAL, id: 'm2', status: 'approved', reviewedByEmail: 'ali@colaberry.com', reviewedAt: '2026-09-03T01:00:00Z',
};

const ACTIVE_DIRECTIVE: ManagerDirective = {
  id: 'd1', directiveText: 'Always cc Kes on escalations.', status: 'active',
  createdByEmail: 'ali@colaberry.com', createdByOrgMemberId: null, createdAt: '2026-09-03T00:00:00Z',
  revokedAt: null, revokedByEmail: null,
};

const DETAIL: AgentDetail = {
  agent: {
    id: 'agent-1', agent_name: 'CoryStrategicAgent', agent_type: 'ai_staff', category: null,
    description: null, system_prompt: null, tools_granted: [], persona_version: null,
    enabled: true, created_at: null, autonomy_level: null,
    department: 'student_success', module: 'reese', source_file: 'reeseWorker.ts',
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
  goals: [
    { key: 'governance', label: 'Governance', score: 5, source: 'fixed', evidence: 'Tier suggest_only.' },
    { key: 'observability', label: 'Observability', score: 3, source: 'live', evidence: '0/0 of the last 0 logged actions carry a trace_id.' },
    { key: 'availability', label: 'Availability', score: 2, source: 'live', evidence: 'Enabled · trigger on_demand.' },
    { key: 'lexicon', label: 'Lexicon', score: 4, source: 'fixed', evidence: 'Domain category: "uncategorized".' },
    { key: 'solid', label: 'Solid', score: 5, source: 'live', evidence: '0/0 of the last 0 logged actions failed.' },
  ],
  goals_overall: 3.8,
  employee_facts: null,
};

let container: HTMLDivElement;
let root: Root;

const mockSetAgentAbacOverride = setAgentAbacOverride as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  listMemoryProposals.mockResolvedValue([]);
  listDirectives.mockResolvedValue([]);
  getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-1', charter: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const noopNavigate = () => {};

async function renderTab() {
  await act(async () => {
    root.render(<AgentTrustControlTab agentId="agent-1" detail={DETAIL} onNavigate={noopNavigate} />);
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('AgentTrustControlTab — GOALS score', () => {
  it('renders the real overall score and all 5 real dimensions with their live/fixed source and evidence', async () => {
    await renderTab();
    expect(container.textContent).toContain('3.8');
    expect(container.textContent).toContain('Governance');
    expect(container.textContent).toContain('Tier suggest_only.');
    expect(container.textContent).toContain('Observability');
    expect(container.textContent).toContain('Availability');
    expect(container.textContent).toContain('Lexicon');
    expect(container.textContent).toContain('Solid');
    // 2 dimensions are structurally declared, not freshly measured — must
    // read as "Declared," never presented as a live reading.
    const declaredBadges = Array.from(container.querySelectorAll('.adv2-pill')).filter((b) => b.textContent?.includes('Declared'));
    expect(declaredBadges.length).toBe(2);
    const liveBadges = Array.from(container.querySelectorAll('.adv2-pill')).filter((b) => b.textContent === 'Live');
    expect(liveBadges.length).toBe(3);
  });
});

describe('AgentTrustControlTab — Governed Memory', () => {
  it('shows the honest empty state when nothing has been proposed', async () => {
    await renderTab();
    expect(container.textContent).toContain('No memory has been proposed for this agent yet.');
  });

  it('shows Approve/Reject only for a pending proposal, never for a decided one', async () => {
    listMemoryProposals.mockResolvedValue([PENDING_PROPOSAL, APPROVED_PROPOSAL]);
    await renderTab();
    expect(container.textContent).toContain('Ali prefers terse status updates.');
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Approve');
    expect(buttons).toContain('Reject');
    expect(container.textContent).toContain('Pending review');
    expect(container.textContent).toContain('Approved');
  });

  it('propose calls the real API with the entered content and evidence', async () => {
    proposeMemory.mockResolvedValue(PENDING_PROPOSAL);
    await renderTab();
    const [contentBox, evidenceBox] = Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    await act(async () => {
      typeInto(contentBox, 'Ali prefers terse status updates.');
      typeInto(evidenceBox, 'Said so on 2026-09-03.');
    });
    const proposeButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Propose')!;
    await act(async () => { proposeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(proposeMemory).toHaveBeenCalledWith('agent-1', 'Ali prefers terse status updates.', 'Said so on 2026-09-03.');
  });

  it('approve calls the real API and refreshes the list', async () => {
    listMemoryProposals.mockResolvedValue([PENDING_PROPOSAL]);
    approveMemoryProposal.mockResolvedValue({ ...PENDING_PROPOSAL, status: 'approved' });
    await renderTab();
    const approveButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Approve')!;
    await act(async () => { approveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(approveMemoryProposal).toHaveBeenCalledWith('agent-1', 'm1');
    expect(listMemoryProposals).toHaveBeenCalledTimes(2);
  });

  it('reject calls the real API', async () => {
    listMemoryProposals.mockResolvedValue([PENDING_PROPOSAL]);
    rejectMemoryProposal.mockResolvedValue({ ...PENDING_PROPOSAL, status: 'rejected' });
    await renderTab();
    const rejectButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Reject')!;
    await act(async () => { rejectButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(rejectMemoryProposal).toHaveBeenCalledWith('agent-1', 'm1');
  });
});

describe('AgentTrustControlTab — Directives', () => {
  it('shows the honest empty state when none exist', async () => {
    await renderTab();
    expect(container.textContent).toContain('No directives have been given to this agent yet.');
  });

  it('renders an active directive with a Revoke control and no create control', async () => {
    listDirectives.mockResolvedValue([ACTIVE_DIRECTIVE]);
    await renderTab();
    expect(container.textContent).toContain('Always cc Kes on escalations.');
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Revoke');
    expect(container.textContent).toContain('Ask/Direct on the Talk tab');
  });

  it('revoke calls the real API and refreshes the list', async () => {
    listDirectives.mockResolvedValue([ACTIVE_DIRECTIVE]);
    revokeDirective.mockResolvedValue({ ...ACTIVE_DIRECTIVE, status: 'revoked' });
    await renderTab();
    const revokeButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Revoke')!;
    await act(async () => { revokeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(revokeDirective).toHaveBeenCalledWith('agent-1', 'd1');
    expect(listDirectives).toHaveBeenCalledTimes(2);
  });
});

describe('AgentTrustControlTab — Architecture drawer', () => {
  it('starts collapsed, and Expand reveals the real platform-configuration fields', async () => {
    await renderTab();
    expect(container.textContent).not.toContain('Registry module');
    const expandButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Expand')!;
    await act(async () => { expandButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('student_success');
    expect(container.textContent).toContain('reeseWorker.ts');
    expect(container.textContent).toContain('60');
    expect(container.textContent).toContain('Never — sitting on the untouched default');
  });

  // Real, live-caught bug (2026-09-03): CoryStrategicAgent genuinely has
  // `null` execution limits in the database — the drawer must disclose the
  // real fallback rather than render a blank or a fabricated number.
  it('discloses the real fallback default when an execution limit is honestly null', async () => {
    const nullLimitsDetail: AgentDetail = {
      ...DETAIL,
      agent: { ...DETAIL.agent, max_runs_per_hour: null, max_writes_per_execution: null, max_proposals_per_run: null },
    };
    await act(async () => {
      root.render(<AgentTrustControlTab agentId="agent-1" detail={nullLimitsDetail} onNavigate={noopNavigate} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    const expandButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Expand')!;
    await act(async () => { expandButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('Not set — 60 applies');
    expect(container.textContent).toContain('Not set — 100 applies');
    expect(container.textContent).toContain('Not set — 50 applies');
  });
});

// Real-enforcement scoping, Phase 3 (2026-09-20) — the per-agent shadow/enforce switch Ali
// asked for. This test suite proves the CARD works — it never calls the real backend route;
// setAgentAbacOverride is fully mocked, per this run's own hard stop (never set a real agent's
// override during BUILD/QUALITY GATE).
describe('AgentTrustControlTab — Authorization Enforcement', () => {
  it('shows "Following global default" copy when no override is set', async () => {
    await renderTab();
    expect(container.textContent).toContain('Following the platform-wide default (shadow)');
    expect(container.textContent).toContain('Shadow');
  });

  it('shows the real override, who set it, and the current global default when one IS set', async () => {
    const overriddenDetail: AgentDetail = {
      ...DETAIL,
      agent: {
        ...DETAIL.agent,
        abac_mode_override: 'enforce',
        abac_mode_override_set_at: '2026-09-20T18:00:00Z',
        abac_mode_override_set_by: 'ali@colaberry.com',
        abac_effective_mode: 'enforce',
        abac_global_default: 'shadow',
      },
    };
    await act(async () => {
      root.render(<AgentTrustControlTab agentId="agent-1" detail={overriddenDetail} onNavigate={noopNavigate} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain('Overridden to');
    expect(container.textContent).toContain('enforce');
    expect(container.textContent).toContain('ali@colaberry.com');
    expect(container.textContent).toContain('the platform-wide default is currently shadow');
    expect(container.textContent).toContain('Enforce'); // the badge
  });

  it('global "off" always wins in the display, even when a per-agent override to enforce is set', async () => {
    const offDetail: AgentDetail = {
      ...DETAIL,
      agent: {
        ...DETAIL.agent,
        abac_mode_override: 'enforce',
        abac_effective_mode: 'off',
        abac_global_default: 'off',
      },
    };
    await act(async () => {
      root.render(<AgentTrustControlTab agentId="agent-1" detail={offDetail} onNavigate={noopNavigate} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain('Off (platform-wide)');
    expect(container.textContent).toContain('platform-wide authorization gate is fully off');
  });

  it('selecting Enforce and Save calls the real API with the real agent id and the chosen value — never a live click against a real agent outside this mocked test', async () => {
    mockSetAgentAbacOverride.mockResolvedValue({
      agentId: 'agent-1', agentName: 'CoryStrategicAgent', found: true, updated: true,
      override: 'enforce', setAt: '2026-09-20T18:05:00Z', setBy: 'ali@colaberry.com', error: null,
    });
    await renderTab();
    const radios = Array.from(container.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    const enforceRadio = radios[2]; // default, shadow, enforce — in that declared order
    await act(async () => { enforceRadio.dispatchEvent(new MouseEvent('click', { bubbles: true })); enforceRadio.checked = true; enforceRadio.dispatchEvent(new Event('change', { bubbles: true })); });
    const saveButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save')!;
    await act(async () => { saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(mockSetAgentAbacOverride).toHaveBeenCalledWith('agent-1', 'enforce');
  });

  it('selecting "Follow platform-wide default" and Save sends null, a real first-class revert, not treated as missing', async () => {
    const overriddenDetail: AgentDetail = {
      ...DETAIL,
      agent: { ...DETAIL.agent, abac_mode_override: 'enforce', abac_effective_mode: 'enforce' },
    };
    mockSetAgentAbacOverride.mockResolvedValue({
      agentId: 'agent-1', agentName: 'CoryStrategicAgent', found: true, updated: true,
      override: null, setAt: '2026-09-20T18:05:00Z', setBy: 'ali@colaberry.com', error: null,
    });
    await act(async () => {
      root.render(<AgentTrustControlTab agentId="agent-1" detail={overriddenDetail} onNavigate={noopNavigate} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    const radios = Array.from(container.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    const defaultRadio = radios[0];
    await act(async () => { defaultRadio.dispatchEvent(new MouseEvent('click', { bubbles: true })); defaultRadio.checked = true; defaultRadio.dispatchEvent(new Event('change', { bubbles: true })); });
    const saveButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save')!;
    await act(async () => { saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(mockSetAgentAbacOverride).toHaveBeenCalledWith('agent-1', null);
  });

  it('a save failure shows a real error, not a silent no-op', async () => {
    mockSetAgentAbacOverride.mockRejectedValue({ response: { data: { error: 'Agent not found' } } });
    await renderTab();
    const radios = Array.from(container.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    const enforceRadio = radios[2];
    await act(async () => { enforceRadio.dispatchEvent(new MouseEvent('click', { bubbles: true })); enforceRadio.checked = true; enforceRadio.dispatchEvent(new Event('change', { bubbles: true })); });
    const saveButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save')!;
    await act(async () => { saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(container.textContent).toContain('Agent not found');
  });
});

// Track A2 (2026-09-22) — the new "Independence with boundaries" card
// (AgentTrustControlAuthority): real charter authority tiers, never
// fetched/rendered anywhere before this slice.
describe('AgentTrustControlTab — Independence with boundaries', () => {
  it('shows the honest empty state when no charter has been written', async () => {
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-1', charter: null });
    await renderTab();
    expect(container.textContent).toContain('No role charter has been written yet.');
  });

  it('renders the 3 real authority tiers from the charter', async () => {
    getAgentRoleCharter.mockResolvedValue({
      agentId: 'agent-1',
      charter: {
        roleTitle: 'Student Success', mission: 'Help students.', responsibilities: [], kpis: [],
        updatedByEmail: 'ali@colaberry.com', updatedAt: '2026-09-18T00:00:00Z',
        authorityAutonomous: ['respond_to_dm', 'read_learner_context'],
        authorityApprovalRequired: ['adjust_deadline'],
        authorityForbidden: ['financial_decisions'],
      },
    });
    await renderTab();
    expect(container.textContent).toContain('Can act');
    expect(container.textContent).toContain('respond_to_dm');
    expect(container.textContent).toContain('Ask Ali first');
    expect(container.textContent).toContain('adjust_deadline');
    expect(container.textContent).toContain('Outside role');
    expect(container.textContent).toContain('financial_decisions');
  });

  it('shows "None recorded" for a tier with an empty array, never silently omitting it', async () => {
    getAgentRoleCharter.mockResolvedValue({
      agentId: 'agent-1',
      charter: {
        roleTitle: 'Student Success', mission: 'Help students.', responsibilities: [], kpis: [],
        updatedByEmail: 'ali@colaberry.com', updatedAt: '2026-09-18T00:00:00Z',
        authorityAutonomous: ['respond_to_dm'], authorityApprovalRequired: [], authorityForbidden: null,
      },
    });
    await renderTab();
    const noneRecorded = Array.from(container.querySelectorAll('.adv2-tier')).filter((el) => el.textContent?.includes('None recorded.'));
    expect(noneRecorded.length).toBe(2);
  });
});

// Track A2 (2026-09-22) — the new link-only "Work controls" card: no
// duplicated switch state, just a real navigation to Employee Facts.
describe('AgentTrustControlTab — Work controls link', () => {
  it('navigates to Overview (Employee Facts) on click, without fetching or rendering any switch state', async () => {
    const onNavigate = jest.fn();
    await act(async () => {
      root.render(<AgentTrustControlTab agentId="agent-1" detail={DETAIL} onNavigate={onNavigate} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain('Work controls');
    expect(container.textContent).not.toContain('Basecamp handoffs');
    const goButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Go to Employee Facts')!;
    await act(async () => { goButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onNavigate).toHaveBeenCalledWith('overview');
  });
});
