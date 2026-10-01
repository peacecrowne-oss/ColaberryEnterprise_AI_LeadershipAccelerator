import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AgentTalkTab from '../AgentTalkTab';
import { Conversation } from '../../../services/agentManagerConversationApi';
import { ManagerDirective } from '../../../services/managerDirectiveApi';
import { AgentDetail } from '../../../services/agentDetailApi';
import type { TabKey } from '../agentDetailV2/AgentDetailV2Header';

// AI Agent Dashboard redesign, Checkpoint C (2026-09-02) — Talk tab: real
// conversation + Ask/Direct composer, where Direct creates a real
// ManagerDirective. No automated conflict detection exists, so this pins
// the honest alternative: the real active-directive count/list shown before
// every Direct submission, and the real "can only narrow" guarantee text —
// never a fabricated "no conflicts found" claim.
//
// Agent Detail redesign, Track F (2026-09-28) — composer upgraded from a
// single-line <input> to a <textarea> (Enter sends, Shift+Enter inserts a
// newline), plus a new real "Shared working context" sidebar backed by the
// role charter + trust_contract. Ports every real assertion from the
// pre-Track-F file, rewrites the 4 real classname-coupled `input.form-
// control` queries to the new `textarea` element, and adds explicit
// regression tests for the 2 real bugs plan-audit caught before any code
// was written: a stray newline left behind on a failed send, and the
// idempotent-send guard (!sending) surviving the composer upgrade.
//
// Chat formatting fix (2026-09-29, Ali live: a numbered-list reply with
// **bold** markers rendered as one unbroken wall of literal text) — bubbles
// now render through react-markdown (same library RecordProse.tsx already
// used, pre-existing this fix). react-markdown v10 / remark-gfm v4 are
// pure ESM with a large transitive dependency tree; CRA's default Jest
// config (this repo has no transformIgnorePatterns override — a real,
// pre-existing gap RecordProse.tsx's own untested consumers never
// surfaced) cannot transform them, so they're mocked here as passthrough
// components. The real markdown rendering behavior (bold, numbered lists,
// preserved line breaks) is verified live in production, not here — same
// as any other pure-CSS/visual behavior this test suite can't assert on.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => children,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

(Element.prototype as any).scrollIntoView = () => { /* no layout in jsdom */ };

jest.mock('../../../services/agentManagerConversationApi', () => ({
  getConversation: jest.fn(),
  sendMessage: jest.fn(),
}));
jest.mock('../../../services/managerDirectiveApi', () => ({
  listDirectives: jest.fn(),
  createDirective: jest.fn(),
  revokeDirective: jest.fn(),
}));
jest.mock('../../../services/agentRoleCharterApi', () => ({
  getAgentRoleCharter: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getConversation, sendMessage } = require('../../../services/agentManagerConversationApi') as {
  getConversation: jest.Mock; sendMessage: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listDirectives, createDirective, revokeDirective } = require('../../../services/managerDirectiveApi') as {
  listDirectives: jest.Mock; createDirective: jest.Mock; revokeDirective: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAgentRoleCharter } = require('../../../services/agentRoleCharterApi') as { getAgentRoleCharter: jest.Mock };

const EMPTY_CONVERSATION: Conversation = { conversationId: 'c1', agentId: 'agent-1', messages: [], focusedTicketId: null };
const REAL_CONVERSATION: Conversation = {
  conversationId: 'c1', agentId: 'agent-1', focusedTicketId: null,
  messages: [
    { id: 'm1', role: 'manager', content: 'Should I hold escalations this week?', createdAt: '2026-09-01T00:00:00Z' },
    { id: 'm2', role: 'agent', content: 'Yes, budget is tight — hold anything under $50 impact.', createdAt: '2026-09-01T00:01:00Z' },
  ],
};

const ACTIVE_DIRECTIVE: ManagerDirective = {
  id: 'd1', directiveText: 'Hold anything under $50 impact until Friday.', status: 'active',
  createdByEmail: 'ali@colaberry.com', createdByOrgMemberId: null, createdAt: '2026-08-30T00:00:00Z',
  revokedAt: null, revokedByEmail: null,
};

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

let container: HTMLDivElement;
let root: Root;
let confirmSpy: jest.SpyInstance;

// React 18 tracks a textarea's previous value on the DOM node itself;
// setting `.value` directly and dispatching a plain Event bypasses the
// native setter React's change-detection relies on, so the synthetic
// onChange never fires. Going through the native prototype setter first is
// the standard workaround — same pattern as AgentTrustControlTab.test.tsx's
// own typeInto() for its 2 real textareas.
function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  jest.clearAllMocks();
  getConversation.mockResolvedValue(EMPTY_CONVERSATION);
  listDirectives.mockResolvedValue([]);
  getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-1', charter: null });
  confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  confirmSpy.mockRestore();
  act(() => { root.unmount(); });
  container.remove();
});

const noopNavigate = (_tab: TabKey) => {};

async function renderTab(
  detail: AgentDetail = buildDetail(),
  extra: { initialDraft?: { text: string; ticketId: string | null } | null; onDraftConsumed?: () => void } = {},
) {
  await act(async () => {
    root.render(<AgentTalkTab agentId="agent-1" detail={detail} onNavigate={noopNavigate} {...extra} />);
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('AgentTalkTab — conversation history', () => {
  it('shows the honest empty state when there are no messages yet', async () => {
    await renderTab();
    expect(container.textContent).toContain('No messages yet — say hello.');
  });

  it('renders real messages from both roles', async () => {
    getConversation.mockResolvedValue(REAL_CONVERSATION);
    await renderTab();
    expect(container.textContent).toContain('Should I hold escalations this week?');
    expect(container.textContent).toContain('Yes, budget is tight — hold anything under $50 impact.');
  });

  it('discloses honestly that no per-message cost/model/trace is tracked', async () => {
    await renderTab();
    expect(container.textContent).toContain('Not tracked at that granularity today');
  });

  it('shows a real error when the conversation fails to load', async () => {
    getConversation.mockRejectedValue({ response: { data: { error: 'Conversation service unavailable' } } });
    await renderTab();
    expect(container.textContent).toContain('Conversation service unavailable');
  });
});

describe('AgentTalkTab — Ask mode', () => {
  it('sends a real message and renders the real updated conversation', async () => {
    sendMessage.mockResolvedValue(REAL_CONVERSATION);
    await renderTab();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { typeInto(textarea, 'Should I hold escalations this week?'); });
    const sendButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send')!;
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(sendMessage).toHaveBeenCalledWith('agent-1', 'Should I hold escalations this week?', undefined);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Yes, budget is tight');
  });

  it('never calls createDirective in Ask mode', async () => {
    sendMessage.mockResolvedValue(REAL_CONVERSATION);
    await renderTab();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { typeInto(textarea, 'hello'); });
    const sendButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send')!;
    await act(async () => { sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(createDirective).not.toHaveBeenCalled();
  });

  it('a quick-prompt button pre-fills the composer without sending anything', async () => {
    await renderTab();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const quickButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'What needs my decision?')!;
    await act(async () => { quickButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(textarea.value).toBe('What needs my decision?');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createDirective).not.toHaveBeenCalled();
  });

  it('quick-prompt buttons are hidden in Direct mode', async () => {
    await renderTab();
    const directButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Direct')!;
    await act(async () => { directButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).not.toContain('What needs my decision?');
  });
});

// Track F (2026-09-28) — the composer's new keyboard handling. Both real
// bugs plan-audit caught before any code was written, now pinned as tests.
describe('AgentTalkTab — composer keyboard handling (Track F)', () => {
  it('plain Enter sends and leaves no stray trailing newline in the composer, even on a FAILED send', async () => {
    sendMessage.mockRejectedValue({ response: { data: { error: 'Model unavailable' } } });
    await renderTab();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { typeInto(textarea, 'hello'); });

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(sendMessage).toHaveBeenCalledWith('agent-1', 'hello', undefined);
    expect(container.textContent).toContain('Model unavailable');
    expect(textarea.value.endsWith('\n')).toBe(false);
  });

  it('Shift+Enter inserts a real newline and does not send anything', async () => {
    await renderTab();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { typeInto(textarea, 'line one'); });

    await act(async () => {
      const evt = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
      const prevented = !textarea.dispatchEvent(evt);
      // jsdom does not perform the native textarea newline-insert on an
      // unprevented keydown (no real layout engine) — assert the REAL,
      // load-bearing behavior instead: this app's own handler never calls
      // preventDefault() for Shift+Enter, so the native browser action (a
      // newline) is left free to occur, and no send fires.
      expect(prevented).toBe(false);
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(createDirective).not.toHaveBeenCalled();
  });

  it('a second plain Enter while a send is still in flight never calls sendMessage a second time', async () => {
    let resolveSend: (c: Conversation) => void = () => {};
    sendMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    await renderTab();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { typeInto(textarea, 'hello'); });

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true, cancelable: true }));
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(textarea.disabled).toBe(true);

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true, cancelable: true }));
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => { resolveSend(REAL_CONVERSATION); await new Promise((r) => setTimeout(r, 0)); });
  });
});

describe('AgentTalkTab — Direct mode', () => {
  it('shows the real active-directive count before submission, never a fabricated conflict check', async () => {
    listDirectives.mockResolvedValue([ACTIVE_DIRECTIVE]);
    await renderTab();
    const directButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Direct')!;
    await act(async () => { directButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('1 other directive is already active');
  });

  it('confirms with the real "can only narrow" guarantee before creating a directive', async () => {
    createDirective.mockResolvedValue(ACTIVE_DIRECTIVE);
    await renderTab();

    const directButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Direct')!;
    await act(async () => { directButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { typeInto(textarea, 'Hold anything under $50.'); });
    const addButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Add Directive')!;
    await act(async () => { addButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('can only narrow'));
    expect(createDirective).toHaveBeenCalledWith('agent-1', 'Hold anything under $50.');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not create a directive if the manager cancels the confirmation', async () => {
    confirmSpy.mockReturnValue(false);
    await renderTab();
    const directButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Direct')!;
    await act(async () => { directButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { typeInto(textarea, 'x'); });
    const addButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Add Directive')!;
    await act(async () => { addButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(createDirective).not.toHaveBeenCalled();
  });
});

describe('AgentTalkTab — Standing Directives', () => {
  it('shows the honest empty state when nothing is active', async () => {
    await renderTab();
    expect(container.textContent).toContain('No standing directives active for this agent.');
  });

  it('renders a real active directive with its real author and revoke control', async () => {
    listDirectives.mockResolvedValue([ACTIVE_DIRECTIVE]);
    await renderTab();
    expect(container.textContent).toContain('Hold anything under $50 impact until Friday.');
    expect(container.textContent).toContain('Set by ali@colaberry.com');
  });

  it('revoke calls the real API and refreshes the list', async () => {
    listDirectives.mockResolvedValue([ACTIVE_DIRECTIVE]);
    revokeDirective.mockResolvedValue({ ...ACTIVE_DIRECTIVE, status: 'revoked' });
    await renderTab();

    const revokeButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Revoke')!;
    await act(async () => { revokeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });

    expect(revokeDirective).toHaveBeenCalledWith('agent-1', 'd1');
    expect(listDirectives).toHaveBeenCalledTimes(2); // once on mount, once after revoke
  });
});

// Track F (2026-09-28) — the new "Shared working context" sidebar. Every
// field is real data already fetched elsewhere on this page; each gets its
// own honest empty state, never a fabricated placeholder.
describe('AgentTalkTab — Shared working context sidebar (Track F)', () => {
  it('shows the real mission as Objective, the real active-directive count, the real approval-required list, and the real schedule', async () => {
    getAgentRoleCharter.mockResolvedValue({
      agentId: 'agent-1',
      charter: {
        roleTitle: 'Student Success', mission: 'Help students move forward.', responsibilities: [], kpis: [],
        updatedByEmail: 'ali@colaberry.com', updatedAt: '2026-09-18T00:00:00Z',
        authorityAutonomous: [], authorityApprovalRequired: ['adjust_deadline'], authorityForbidden: [],
      },
    });
    listDirectives.mockResolvedValue([ACTIVE_DIRECTIVE]);
    await renderTab(buildDetail({ trust_contract: { ...buildDetail().trust_contract, schedule: 'Daily, 8am' } }));

    expect(container.textContent).toContain('Help students move forward.');
    expect(container.textContent).toContain('1 active — see below.');
    expect(container.textContent).toContain('adjust_deadline');
    expect(container.textContent).toContain('Daily, 8am');
  });

  it('shows honest empty states for every field when nothing real backs them', async () => {
    getAgentRoleCharter.mockResolvedValue({ agentId: 'agent-1', charter: null });
    await renderTab();

    expect(container.textContent).toContain('No role charter has been written yet.');
    expect(container.textContent).toContain('None active right now.');
    expect(container.textContent).toContain('None'); // Next scheduled check, schedule: null
  });

  it('"Inspect work records" navigates to the Work tab', async () => {
    const onNavigate = jest.fn();
    await act(async () => {
      root.render(<AgentTalkTab agentId="agent-1" detail={buildDetail()} onNavigate={onNavigate} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    const link = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Inspect work records →')!;
    await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onNavigate).toHaveBeenCalledWith('work');
  });
});

// Agent Detail polish round 4 (2026-09-30) — Ali, live: "Discuss with
// Reese... should send a message about that case." Confirmed via
// AskUserQuestion: pre-fill only, never auto-send.
describe('AgentTalkTab — initialDraft (Work tab "Discuss with Reese")', () => {
  it('copies a real initialDraft into the composer on mount', async () => {
    await renderTab(buildDetail(), { initialDraft: { text: 'Can you catch me up on ticket #7 — "Student support case"? It\'s currently In Progress.', ticketId: 'ticket-7' } });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Can you catch me up on ticket #7 — "Student support case"? It\'s currently In Progress.');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createDirective).not.toHaveBeenCalled();
  });

  it('calls onDraftConsumed exactly once after copying the draft', async () => {
    const onDraftConsumed = jest.fn();
    await renderTab(buildDetail(), { initialDraft: { text: 'A real draft.', ticketId: null }, onDraftConsumed });
    expect(onDraftConsumed).toHaveBeenCalledTimes(1);
  });

  it('resets the composer to Ask mode even if it was left on Direct', async () => {
    await renderTab(buildDetail());
    const directButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Direct')!;
    await act(async () => { directButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(directButton.className).toContain('adv2-primary');

    // Simulate a fresh mount with a draft arriving (the real path: the Work
    // tab sets talkDraft, then AgentDetailPage switches activeTab to
    // 'talk', mounting this component fresh).
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await renderTab(buildDetail(), { initialDraft: { text: 'Draft about a ticket.', ticketId: 'ticket-7' } });

    const askButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Ask')!;
    expect(askButton.className).toContain('adv2-primary');
  });

  it('never sends the draft automatically — a human must still click Send', async () => {
    await renderTab(buildDetail(), { initialDraft: { text: 'Draft about a ticket.', ticketId: 'ticket-7' } });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('Reese manager-directed growth mission, Phase 2 — sending the drafted message passes the real ticket id to the API, once', async () => {
    getConversation.mockResolvedValue(EMPTY_CONVERSATION);
    sendMessage.mockResolvedValue(EMPTY_CONVERSATION);
    await renderTab(buildDetail(), { initialDraft: { text: 'Can you catch me up on ticket #7?', ticketId: 'ticket-7' } });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const sendButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send')!;
    await act(async () => { sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(sendMessage).toHaveBeenCalledWith('agent-1', 'Can you catch me up on ticket #7?', 'ticket-7');

    // A second, manually-typed message after the draft was consumed must NOT resend the
    // same stale ticket id — the binding is one-shot, per the real backend contract.
    await act(async () => { typeInto(textarea, 'A completely unrelated follow-up.'); });
    await act(async () => { sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(sendMessage).toHaveBeenLastCalledWith('agent-1', 'A completely unrelated follow-up.', undefined);
  });

  it('a manager-wide message typed without ever receiving a draft never passes a ticket id', async () => {
    getConversation.mockResolvedValue(EMPTY_CONVERSATION);
    sendMessage.mockResolvedValue(EMPTY_CONVERSATION);
    await renderTab(buildDetail());

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { typeInto(textarea, 'How are things going generally?'); });
    const sendButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send')!;
    await act(async () => { sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(sendMessage).toHaveBeenCalledWith('agent-1', 'How are things going generally?', undefined);
  });
});
