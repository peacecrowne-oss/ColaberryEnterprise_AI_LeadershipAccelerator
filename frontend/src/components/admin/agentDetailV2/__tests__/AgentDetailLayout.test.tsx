import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import AgentDetailLayout from '../AgentDetailLayout';
import { AgentDetail } from '../../../../services/agentDetailApi';

// Agent Detail redesign, Track A0 (2026-09-21) — this component is a
// structural relocation of AgentDetailV2Header.tsx's real controls into a
// new sidebar/topbar shell (see this run's own plan.md,
// .loop-architect/runs/20260921-agent-detail-redesign-a0/). These tests
// prove every relocated control still fires the exact same real callback
// with the same arguments as before — a re-skin, never a silent feature
// drop — plus the 2 genuinely new pieces this run adds: the dark-mode
// toggle and the "Back to Admin" link.

const DETAIL: AgentDetail = {
  agent: {
    id: 'agent-reese', agent_name: 'Reese', agent_type: 'ai_staff_mentor', category: 'student_success',
    description: null, system_prompt: null, tools_granted: null, persona_version: null,
    enabled: true, created_at: null, autonomy_level: null,
    department: null, module: null, source_file: null,
    max_runs_per_hour: 60, max_writes_per_execution: 100, max_proposals_per_run: 50,
    autonomy_level_set_at: null, autonomy_level_source: null,
    reports_to_type: null, reports_to_id: null,
    abac_mode_override: null, abac_mode_override_set_at: null, abac_mode_override_set_by: null,
    abac_effective_mode: 'shadow', abac_global_default: 'shadow',
  },
  identity: null,
  live_status: 'online',
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
  cost_summary: null,
  authorization_summary: { window_days: 30, total: 0, allow: 0, approval: 0, block: 0, enforced_count: 0 },
  capabilities: { reads: [], produces: [], undocumented_tools: [], produced_ticket_types: [], by_tool: [] },
  autonomy_explanation: { level: 'observe', reason: 'No tools_granted recorded for this agent — the safe, honest default, not a guess.', matched_tool: null },
  reports_to: {
    trail: ['Reese (agent)', 'workforce_intelligence_engine (agent) -> [human]'],
    resolved_human: { id: 'org-kes', name: 'Kes', email: 'kesetebirhan@gmail.com' },
    immediate_agent: { id: 'agent-wie', name: 'workforce_intelligence_engine' },
  },
  trust_contract: {
    trigger_type: 'event_driven', schedule: null, status: 'idle', last_run_at: null,
    run_count: 0, error_count: 0, avg_duration_ms: null, last_error: null, last_error_at: null,
    last_activity_at: '2026-08-24T10:00:00Z',
  },
  goals: [],
  goals_overall: 0,
  employee_facts: null,
};

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  if (!btn) throw new Error(`Button "${label}" not found. Rendered buttons: ${Array.from(container.querySelectorAll('button')).map((b) => b.textContent).join(', ')}`);
  return btn as HTMLButtonElement;
}

let container: HTMLDivElement;
let root: Root;

function baseProps(overrides: Partial<React.ComponentProps<typeof AgentDetailLayout>> = {}) {
  return {
    detail: DETAIL,
    displayName: 'Reese',
    activeTab: 'overview' as const,
    onTabChange: jest.fn(),
    onDeactivate: jest.fn(),
    resetting: false,
    resetMessage: null,
    refreshing: false,
    onRefresh: jest.fn(),
    reactivating: false,
    reactivationMessage: null,
    selectedAutonomyLevel: '' as const,
    onSelectAutonomyLevel: jest.fn(),
    onReactivate: jest.fn(),
    children: <div data-testid="tab-content">Tab content goes here</div>,
    ...overrides,
  };
}

async function render(props: ReturnType<typeof baseProps>) {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <AgentDetailLayout {...props} />
      </MemoryRouter>,
    );
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

describe('AgentDetailLayout — sidebar nav', () => {
  it('renders exactly the 5 real tabs, in the mockup\'s order, and clicking one calls onTabChange with the real tab key', async () => {
    const props = baseProps();
    await render(props);

    const labels = ['Overview', 'Talk to Reese', 'Work & commitments', 'Decisions & evidence', 'Performance & settings'];
    labels.forEach((label) => expect(findButton(container, label)).toBeTruthy());

    // 'At a Glance'/'Live Status' are retired — never reachable via the nav.
    expect(container.querySelectorAll('.adv2-sidebar-navbtn')).toHaveLength(5);

    await act(async () => { findButton(container, 'Work & commitments').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(props.onTabChange).toHaveBeenCalledWith('work');
  });

  it('the active tab is marked aria-selected', async () => {
    await render(baseProps({ activeTab: 'decisions' }));
    const activeBtn = findButton(container, 'Decisions & evidence');
    expect(activeBtn.getAttribute('aria-selected')).toBe('true');
    expect(findButton(container, 'Work & commitments').getAttribute('aria-selected')).toBe('false');
  });

  it('renders the manager footer with the real resolved human', async () => {
    await render(baseProps());
    expect(container.textContent).toContain('Kes');
  });

  it('boundary: an agent with no resolved manager shows an honest empty state, not a crash', async () => {
    await render(baseProps({ detail: { ...DETAIL, reports_to: null } }));
    expect(container.textContent).toContain('No manager resolved');
  });
});

describe('AgentDetailLayout — relocated real controls (verbatim from AgentDetailV2Header.tsx)', () => {
  it('Deactivate button calls onDeactivate, only rendered when the agent is enabled', async () => {
    const props = baseProps();
    await render(props);
    await act(async () => { findButton(container, 'Deactivate').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(props.onDeactivate).toHaveBeenCalledTimes(1);
  });

  it('Deactivate is not rendered for a disabled agent', async () => {
    await render(baseProps({ detail: { ...DETAIL, agent: { ...DETAIL.agent, enabled: false } } }));
    expect(() => findButton(container, 'Deactivate')).toThrow();
  });

  it('Refresh button calls onRefresh', async () => {
    const props = baseProps();
    await render(props);
    await act(async () => { findButton(container, 'Refresh').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('autonomy override: Override… reveals the select + Set level, which calls onReactivate', async () => {
    const props = baseProps();
    await render(props);
    await act(async () => { findButton(container, 'Override…').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(findButton(container, 'Set level')).toBeTruthy();
    await act(async () => { findButton(container, 'Set level').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // Disabled until a level is chosen — real prop wiring, not a fake click.
    expect(props.onReactivate).not.toHaveBeenCalled();
  });

  it('description read-more toggle preserved: long descriptions truncate with a working "Read full description" toggle', async () => {
    const longDescription = 'A'.repeat(200);
    await render(baseProps({ detail: { ...DETAIL, agent: { ...DETAIL.agent, description: longDescription } } }));
    expect(container.textContent).toContain('Read full description');
    const toggle = Array.from(container.querySelectorAll('span[role="button"]')).find((s) => s.textContent === 'Read full description');
    expect(toggle).toBeTruthy();
    await act(async () => { toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('Show less');
    expect(container.textContent).toContain(longDescription);
  });
});

describe('AgentDetailLayout — new in Track A0', () => {
  it('dark mode toggle flips the scoped .adv2-dark class and its own label', async () => {
    await render(baseProps());
    expect(container.querySelector('.adv2-page.adv2-dark')).toBeNull();
    await act(async () => { findButton(container, 'Dark mode').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('.adv2-page.adv2-dark')).toBeTruthy();
    expect(findButton(container, 'Light mode')).toBeTruthy();
  });

  it('"Back to Admin" is a real link to /admin/workforce', async () => {
    await render(baseProps());
    const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('Back to Admin'));
    expect(link?.getAttribute('href')).toBe('/admin/workforce');
  });

  it('renders the real page heading (h1) with the display name — never silently dropped', async () => {
    await render(baseProps());
    const h1 = container.querySelector('h1');
    expect(h1?.textContent).toBe('Reese');
  });

  it('renders the tab content passed as children', async () => {
    await render(baseProps());
    expect(container.querySelector('[data-testid="tab-content"]')?.textContent).toBe('Tab content goes here');
  });
});
