import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentWorkV2 from '../AgentWorkV2';
import { AgentDetail, AgentDetailTicket } from '../../../../services/agentDetailApi';

jest.mock('../../../../services/ticketSummaryApi', () => ({ getTicketSummary: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getTicketSummary } = require('../../../../services/ticketSummaryApi') as { getTicketSummary: jest.Mock };

// Agent Detail redesign, Track A1 (2026-09-21) — replaces
// AgentWorkTab.test.tsx (deleted alongside the flat-list component it
// tested). Ports every real assertion from that file to the new
// list+detail split, plus 2 new, explicitly required negative checks: no
// mockup-only 5-step ladder, no mockup-only 3-way "waiting on a person"
// split — neither has any real backing anywhere in this codebase (see
// AgentWorkV2CaseDetail.tsx's own header comment).

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

function buildDetail(tickets: AgentDetailTicket[]): AgentDetail {
  return {
    agent: BASE_AGENT,
    identity: null,
    live_status: 'unknown',
    open_ticket_count: tickets.length,
    completed_ticket_count_30d: 0,
    verified_resolution_count: 0,
    owned_ticket_count_all_time: 0,
    most_recent_verified_ticket_id: null,
    tickets,
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
  };
}

let container: HTMLDivElement;
let root: Root;

async function renderTab(
  tickets: AgentDetailTicket[],
  onNavigate: (tab: any) => void = () => {},
  onDraftTalk: (ticket: AgentDetailTicket) => void = () => {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AgentWorkV2 detail={buildDetail(tickets)} onNavigate={onNavigate} onDraftTalk={onDraftTalk} />);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('AgentWorkV2', () => {
  // Track C (2026-09-28) — rewritten: the default changed from 'overdue' to
  // 'all' (real, live bug — a manager with real open work but nothing
  // literally overdue saw an empty-looking Work tab on first load). "All"
  // aggregates every real bucket; it is never a real per-ticket value.
  it('happy path: default view (All) shows every actionable ticket across all 4 buckets, the right live count on every button including All, and auto-selects the first case for the detail panel', async () => {
    await renderTab([
      ticket({ id: 't-overdue', title: 'Overdue ticket', status_bucket: 'overdue' }),
      ticket({ id: 't-verify', title: 'Ready ticket', status_bucket: 'ready_to_verify' }),
      ticket({ id: 't-reply', title: 'Needs reply ticket', status_bucket: 'needs_reply' }),
      ticket({ id: 't-open', title: 'Open ticket', status_bucket: 'open' }),
    ]);

    expect(container.textContent).toContain('Overdue ticket');
    expect(container.textContent).toContain('Ready ticket');
    expect(container.textContent).toContain('Needs reply ticket');
    expect(container.textContent).toContain('Open ticket');
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('All') && b.textContent?.includes('4'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('Overdue') && b.textContent?.includes('1'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('Ready to verify') && b.textContent?.includes('1'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('Needs a reply') && b.textContent?.includes('1'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('Open') && b.textContent?.includes('1'))).toBe(true);
  });

  it('clicking a filter button switches the visible subset to that bucket only', async () => {
    await renderTab([
      ticket({ id: 't-overdue', title: 'Overdue ticket', status_bucket: 'overdue' }),
      ticket({ id: 't-reply', title: 'Needs reply ticket', status_bucket: 'needs_reply' }),
    ]);

    const buttons = Array.from(container.querySelectorAll('button'));
    const needsReplyBtn = buttons.find((b) => b.textContent?.includes('Needs a reply'));
    await act(async () => {
      needsReplyBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Needs reply ticket');
    expect(container.textContent).not.toContain('Overdue ticket');
  });

  // Track C (2026-09-28) — rewritten for the new 'all' default; the honest
  // per-bucket empty state (e.g. "No tickets are overdue right now.") is
  // still real and still covered, just reached by clicking into that
  // specific bucket now rather than seeing it on load.
  it('honest empty state on load (All, no tickets at all), not a blank list', async () => {
    await renderTab([]);
    expect(container.textContent).toContain('No open cases right now.');
  });

  it('honest empty state for a specific bucket once selected, not a blank list', async () => {
    await renderTab([ticket({ id: 't-open', title: 'Open ticket', status_bucket: 'open' })]);

    const overdueBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Overdue'));
    await act(async () => { overdueBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(container.textContent).toContain('No tickets are overdue right now.');
  });

  it('selecting a case in the list shows its real detail — description, priority, type, timestamps, real status', async () => {
    await renderTab([
      ticket({ id: 't-a', title: 'First ticket', status_bucket: 'overdue', description: 'Real narrative text.', priority: 'high', type: 'student_support', status: 'in_review' }),
      ticket({ id: 't-b', title: 'Second ticket', status_bucket: 'overdue', description: 'Other narrative.', priority: 'low', type: 'task' }),
    ]);

    // First case auto-selected.
    expect(container.textContent).toContain('Real narrative text.');
    expect(container.textContent).toContain('high');
    expect(container.textContent).toContain('In Review');

    const secondRow = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Second ticket'));
    await act(async () => { secondRow!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(container.textContent).toContain('Other narrative.');
    expect(container.textContent).not.toContain('Real narrative text.');
  });

  it('excludes closed tickets (status_bucket: null) from every bucket count and list entirely', async () => {
    await renderTab([
      ticket({ id: 't-open', title: 'Open ticket', status_bucket: 'open' }),
      ticket({ id: 't-closed', title: 'Closed ticket', status: 'done', status_bucket: null }),
    ]);

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('Open') && b.textContent?.includes('1'))).toBe(true);
    expect(container.textContent).not.toContain('Closed ticket');
  });

  it('shows "No due date" honestly rather than a blank or fabricated date', async () => {
    await renderTab([
      ticket({ id: 't-overdue', title: 'Overdue ticket', status_bucket: 'overdue', due_date: null }),
    ]);

    expect(container.textContent).toContain('No due date');
  });

  // Agent Detail polish round 4 (2026-09-30) — Ali, live: "when I click on
  // Explain this decision, the results doesn't tell me anything
  // beneficial." Rewritten (plan-audit cycle 1 finding, this run): no
  // longer navigates anywhere — fetches and shows the real, ticket-specific
  // summary inline instead.
  describe('"Explain this decision" (inline, real per-ticket summary)', () => {
    async function clickExplain() {
      const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Explain this decision' || b.textContent === 'Hide explanation');
      await act(async () => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    }

    it('fetches and renders the real Outcome/Proof/Human-action summary, and never calls onNavigate', async () => {
      getTicketSummary.mockResolvedValue({ outcome: 'Real outcome text.', proof: 'Real proof text.', humanAction: 'Real human action text.', hasEvidence: true });
      const onNavigate = jest.fn();
      await renderTab([ticket({ id: 't-1', status_bucket: 'overdue' })], onNavigate);

      await clickExplain();

      expect(getTicketSummary).toHaveBeenCalledWith('t-1');
      expect(container.textContent).toContain('Real outcome text.');
      expect(container.textContent).toContain('Real proof text.');
      expect(container.textContent).toContain('Real human action text.');
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('clicking again hides the panel without a second fetch', async () => {
      getTicketSummary.mockResolvedValue({ outcome: 'O', proof: 'P', humanAction: 'H', hasEvidence: true });
      await renderTab([ticket({ id: 't-1', status_bucket: 'overdue' })]);

      await clickExplain();
      expect(getTicketSummary).toHaveBeenCalledTimes(1);
      await clickExplain();
      expect(container.textContent).not.toContain('Human action');
      await clickExplain();
      expect(getTicketSummary).toHaveBeenCalledTimes(1);
    });

    it('an error response renders an honest unavailable message, not a crash', async () => {
      getTicketSummary.mockRejectedValue(new Error('boom'));
      await renderTab([ticket({ id: 't-1', status_bucket: 'overdue' })]);

      await clickExplain();

      expect(container.textContent).toContain('Summary unavailable right now');
    });

    it('switching to a different ticket fetches THAT ticket\'s own summary, not a stale one', async () => {
      getTicketSummary.mockImplementation((id: string) =>
        Promise.resolve({ outcome: `Outcome for ${id}`, proof: 'P', humanAction: 'H', hasEvidence: true }));
      await renderTab([
        ticket({ id: 't-a', title: 'First ticket', status_bucket: 'overdue' }),
        ticket({ id: 't-b', title: 'Second ticket', status_bucket: 'overdue' }),
      ]);

      await clickExplain();
      expect(container.textContent).toContain('Outcome for t-a');

      const secondRow = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Second ticket'));
      await act(async () => { secondRow!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      // Switching cases closes any open explanation — never carries the
      // previous ticket's panel/content over.
      expect(container.textContent).not.toContain('Outcome for t-a');

      await clickExplain();
      expect(getTicketSummary).toHaveBeenCalledWith('t-b');
      expect(container.textContent).toContain('Outcome for t-b');
    });
  });

  // Agent Detail polish round 4 (2026-09-30) — Ali, live: "Discuss with
  // Reese... should send a message about that case." Confirmed via
  // AskUserQuestion: pre-fill the draft, never auto-send.
  it('"Discuss with Reese" drafts a real, ticket-specific message, then navigates to the Talk tab', async () => {
    const onNavigate = jest.fn();
    const onDraftTalk = jest.fn();
    const t = ticket({ id: 't-1', ticket_number: 7, title: 'Student support case', status: 'in_progress', status_bucket: 'overdue' });
    await renderTab([t], onNavigate, onDraftTalk);

    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Discuss with Reese');
    await act(async () => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(onDraftTalk).toHaveBeenCalledWith(t);
    expect(onNavigate).toHaveBeenCalledWith('talk');
    // Draft happens before the tab switch, matching AgentDetailPage.tsx's own
    // ordering — the compose box must already have real content by the time
    // Talk actually renders.
    expect(onDraftTalk.mock.invocationCallOrder[0]).toBeLessThan(onNavigate.mock.invocationCallOrder[0]);
  });

  // Agent Detail polish round 3 (2026-09-29) — Ali, live: "we need a link to
  // open the actual ticket in another tab down below with the two other
  // buttons." Copies the exact target/rel/href pattern already proven twice
  // elsewhere on this page (AgentOverviewV2MainColumn.tsx,
  // AgentOverviewV2Sidebar.tsx's own last-ticket links).
  it('"Open ticket" opens the exact selected ticket in a new tab, and changes when a different ticket is selected', async () => {
    await renderTab([
      ticket({ id: 't-a', title: 'First ticket', status_bucket: 'overdue' }),
      ticket({ id: 't-b', title: 'Second ticket', status_bucket: 'overdue' }),
    ]);

    const openLink = () => Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('Open ticket'));
    expect(openLink()?.getAttribute('href')).toBe('/admin/tickets?open=t-a');
    expect(openLink()?.getAttribute('target')).toBe('_blank');
    expect(openLink()?.getAttribute('rel')).toBe('noopener noreferrer');

    const secondRow = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Second ticket'));
    await act(async () => { secondRow!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(openLink()?.getAttribute('href')).toBe('/admin/tickets?open=t-b');
  });

  // Agent Detail polish round 3 (2026-09-29) — Ali, live: "we need to explain
  // why things get on the backlog, in progress etc... that should be clear
  // in the layout." The filled bucket pill and the outlined status pill are
  // now visually distinct, and the header hint explains the distinction in
  // words too.
  it('the status pill is visually outlined and distinct from the solid bucket pill, in both the list row and the detail view', async () => {
    await renderTab([ticket({ id: 't-1', status_bucket: 'open', status: 'in_review' })]);

    const pills = Array.from(container.querySelectorAll('.adv2-pill'));
    const statusPills = pills.filter((p) => p.textContent === 'In Review');
    const bucketPills = pills.filter((p) => p.textContent === 'Open');
    expect(statusPills.length).toBe(2); // one list row + one detail view
    expect(bucketPills.length).toBeGreaterThan(0);
    for (const p of statusPills) expect(p.className).toContain('adv2-pill-outline');
    for (const p of bucketPills) expect(p.className).not.toContain('adv2-pill-outline');
  });

  it('explains the bucket-vs-status distinction in the header hint', async () => {
    await renderTab([ticket({ id: 't-1', status_bucket: 'open' })]);

    expect(container.textContent).toContain('The filled pill shows why it needs attention now');
    expect(container.textContent).toContain('the outlined pill shows where it really is in its workflow');
  });

  // Required, run-specific hard-stop checks (this run's own plan.md R68 and
  // execution-contract.md) — neither the mockup's FICTIONAL 5-step ladder
  // (Assess/Plan/Handoff/Verify/Complete — invented stage names with no
  // real backing field) nor its 3-way "waiting on Ali/staff/student" split
  // has any real backing anywhere in this codebase. Polish round 2
  // (2026-09-29) DOES now render a real 5-step stepper (see below) — the
  // honest version, using real getTicketStatusLabel() strings, confirmed
  // via AskUserQuestion — so this test is scoped precisely to the
  // mockup's own fabricated stage NAMES, never generalized to "no stepper
  // at all."
  it('never renders the mockup\'s fictional stage names (Assess/Handoff/Verify/Complete) — the real stepper uses honest status labels instead', async () => {
    await renderTab([ticket({ id: 't-1', status_bucket: 'overdue' })]);

    for (const step of ['Assess', 'Handoff', 'Verify', 'Complete']) {
      expect(container.textContent).not.toContain(step);
    }
  });

  it('renders the honest real-status stepper for a non-cancelled ticket, with the real current status marked', async () => {
    await renderTab([ticket({ id: 't-1', status_bucket: 'overdue', status: 'in_progress' })]);

    const steps = Array.from(container.querySelectorAll('.adv2-step'));
    expect(steps.map((s) => s.textContent)).toEqual(['✓ Backlog', '✓ To Do', 'In Progress', 'In Review', 'Done']);
    expect(steps[2].className).toContain('adv2-step-current');
    expect(steps[0].className).toContain('adv2-step-done');
  });

  it('a cancelled ticket shows a plain Cancelled badge, never a stepper implying it reached a fixed stage', async () => {
    await renderTab([ticket({ id: 't-1', status_bucket: 'open', status: 'cancelled' })]);

    expect(container.querySelector('.adv2-steps')).toBeNull();
    expect(container.textContent).toContain('Cancelled');
  });

  it('every list row shows its own real status pill, distinct from the bucket pill', async () => {
    await renderTab([
      ticket({ id: 't-1', status_bucket: 'open', status: 'in_review' }),
    ]);

    expect(container.textContent).toContain('In Review');
  });

  it('every ticket shows its real due date as "Next commitment", both in the list row and the detail view', async () => {
    await renderTab([ticket({ id: 't-1', status_bucket: 'overdue', due_date: '2026-10-05' })]);

    const occurrences = container.textContent?.split('Next commitment').length! - 1;
    expect(occurrences).toBe(2); // one list row + one detail view
  });

  // Agent Detail polish round 4 (2026-09-30) — Ali, live: "next commitment
  // should show relative time as well. 6 hours ... 2 days etc." Appends to,
  // never replaces, the existing absolute date.
  describe('"Next commitment" relative time', () => {
    it('a future due date 2 days out shows "in 2 days"', async () => {
      const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      await renderTab([ticket({ id: 't-1', status_bucket: 'overdue', due_date: dueDate })]);
      expect(container.textContent).toContain('(in 2 days)');
    });

    it('a future due date 6 hours out shows "in 6 hours"', async () => {
      const dueDate = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      await renderTab([ticket({ id: 't-1', status_bucket: 'overdue', due_date: dueDate })]);
      expect(container.textContent).toContain('(in 6 hours)');
    });

    it('an overdue due date shows "N days overdue", never a naive negative count', async () => {
      const dueDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      await renderTab([ticket({ id: 't-1', status_bucket: 'overdue', due_date: dueDate })]);
      expect(container.textContent).toContain('(3 days overdue)');
      expect(container.textContent).not.toContain('(-3');
    });

    it('a null due date shows no relative suffix at all — just "No due date"', async () => {
      await renderTab([ticket({ id: 't-1', status_bucket: 'overdue', due_date: null })]);
      expect(container.textContent).toContain('No due date');
      expect(container.textContent).not.toContain('No due date (');
    });
  });

  it('paginates the list to the first 10 tickets by default, with a working "show older" control', async () => {
    const tickets = Array.from({ length: 14 }, (_, i) => ticket({ id: `t-${i}`, title: `Ticket ${i}`, status_bucket: 'open' }));
    await renderTab(tickets);

    for (let i = 0; i < 10; i++) expect(container.textContent).toContain(`Ticket ${i}`);
    for (let i = 10; i < 14; i++) expect(container.textContent).not.toContain(`Ticket ${i}`);

    const showMore = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Show 4 older ticket'));
    expect(showMore).toBeTruthy();
    await act(async () => { showMore!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    for (let i = 10; i < 14; i++) expect(container.textContent).toContain(`Ticket ${i}`);
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('older ticket'))).toBe(false);
  });

  it('switching buckets resets pagination back to the default page size', async () => {
    const overdueTickets = Array.from({ length: 12 }, (_, i) => ticket({ id: `t-od-${i}`, title: `Overdue ${i}`, status_bucket: 'overdue' }));
    await renderTab([...overdueTickets, ticket({ id: 't-open', title: 'Open one', status_bucket: 'open' })]);

    const showMore = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('older ticket'));
    await act(async () => { showMore!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('Overdue 11'); // all 12 now visible

    const openBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Open') && !b.textContent?.includes('Overdue'));
    await act(async () => { openBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('Open one');

    const overdueBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Overdue') && b.textContent?.includes('12'));
    await act(async () => { overdueBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // Back to the default page size — only the first 10 of the 12 overdue tickets.
    expect(container.textContent).toContain('Overdue 9');
    expect(container.textContent).not.toContain('Overdue 11');
  });

  it('never renders the mockup-only 3-way "waiting on a person" split — only the 4 real buckets exist', async () => {
    await renderTab([ticket({ id: 't-1', status_bucket: 'overdue' })]);

    expect(container.textContent).not.toContain('Waiting on');
    expect(container.textContent).not.toContain('Assign an outcome');
  });
});
