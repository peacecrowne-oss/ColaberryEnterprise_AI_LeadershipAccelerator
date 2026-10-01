/**
 * agentManagerConversationService — AI Workforce Management, Checkpoint C.
 * Pins the find-or-create conversation semantics, the real turn-by-turn
 * persistence, and that a send never does anything beyond
 * persist+reply — no side effects on directives, inbox items, or anything
 * else (the deliberate non-goal boundary for this first slice).
 */
const mockAiAgentFindByPk = jest.fn();
jest.mock('../../models/AiAgent', () => ({
  __esModule: true,
  default: { findByPk: (...a: any[]) => mockAiAgentFindByPk(...a) },
}));

const mockConversationFindOrCreate = jest.fn();
jest.mock('../../models/AgentManagerConversation', () => ({
  __esModule: true,
  default: { findOrCreate: (...a: any[]) => mockConversationFindOrCreate(...a) },
}));

const mockMessageCreate = jest.fn();
const mockMessageFindAll = jest.fn();
jest.mock('../../models/AgentManagerMessage', () => ({
  __esModule: true,
  default: {
    create: (...a: any[]) => mockMessageCreate(...a),
    findAll: (...a: any[]) => mockMessageFindAll(...a),
  },
}));

jest.mock('../openaiInstrumented', () => ({ getInstrumentedOpenAI: jest.fn() }));
jest.mock('../agentBlueprint/agentManagerConversationPrompt', () => ({
  buildAgentManagerConversationSystemPrompt: jest.fn(),
}));
// Reese Agentic AI Employee mission, Checkpoint B — agentManagerConversationService.ts
// now imports managerReliabilityIntentService.ts, which imports ticketService.ts,
// which imports { Ticket, TicketActivity } from '../models' — the barrel, which
// triggers the full association graph (models/index.ts) at module-load time. This
// test's own AiAgent mock is a plain object with no hasMany/belongsTo, so letting the
// real barrel load crashes it — the exact same class of failure CI caught earlier
// this session for agentRecentActivitySummary.ts's own barrel import. Mocked
// wholesale here (this file only needs the detection path to return "not a
// reliability message" for its own unrelated test messages, never the real logic —
// that's agentManagerConversationService.reliabilityConfirmation.test.ts's job).
jest.mock('../managerReliabilityIntentService', () => ({
  detectReliabilityIntent: jest.fn(() => null),
  detectConfirmationReply: jest.fn(() => 'ambiguous'),
  buildConfirmationCardText: jest.fn(() => ''),
  toPendingConfirmation: jest.fn(),
  applyConfirmedReliabilityChange: jest.fn(),
}));
// Capability 8 — managerGoalIntentService.ts transitively imports
// agentGoalService.ts, which imports AiAgent/AdminUser/AgentGoal model
// classes directly plus trustMetricsService/liveAgentsService. Same
// isolation reasoning as the reliability mock above: this file only needs
// "not a goal-change message" for its own unrelated test messages.
jest.mock('../managerGoalIntentService', () => ({
  detectChangeGoalIntent: jest.fn(() => null),
  buildGoalConfirmationCardText: jest.fn(() => ''),
  toPendingGoalConfirmation: jest.fn(),
  applyConfirmedGoalChange: jest.fn(),
}));
jest.mock('../managerOneOnOneIntentService', () => ({
  detectScheduleOneOnOneIntent: jest.fn(() => null),
  buildOneOnOneConfirmationCardText: jest.fn(() => ''),
  toPendingOneOnOneConfirmation: jest.fn(),
  applyConfirmedOneOnOneSchedule: jest.fn(),
}));
jest.mock('../managerDirectiveIntentService', () => ({
  detectInstructIntent: jest.fn(() => null),
  buildDirectiveConfirmationCardText: jest.fn(() => ''),
  toPendingDirectiveConfirmation: jest.fn(),
  applyConfirmedDirective: jest.fn(),
}));
jest.mock('../managerAssignWorkIntentService', () => ({
  detectAssignWorkIntent: jest.fn(() => null),
  buildAssignWorkConfirmationCardText: jest.fn(() => ''),
  toPendingAssignWorkConfirmation: jest.fn(),
  applyConfirmedAssignWork: jest.fn(),
}));
jest.mock('../managerApprovalDecisionIntentService', () => ({
  detectApproveIntent: jest.fn(() => null),
  detectRejectIntent: jest.fn(() => null),
  resolvePendingApprovalTarget: jest.fn(),
  buildApproveConfirmationCardText: jest.fn(() => ''),
  buildRejectConfirmationCardText: jest.fn(() => ''),
  toPendingApproveConfirmation: jest.fn(),
  toPendingRejectConfirmation: jest.fn(),
  applyConfirmedApprove: jest.fn(),
  applyConfirmedReject: jest.fn(),
}));
// Same isolation reasoning as managerReliabilityIntentService above —
// agentWorkStatusIntentService.ts imports Ticket/AdminUser model classes
// directly; mocked wholesale here since this file only needs "not a
// work-status message" for its own unrelated test messages.
jest.mock('../agentWorkStatusIntentService', () => ({
  detectWorkStatusQuery: jest.fn(() => null),
  buildWorkStatusReply: jest.fn(),
}));
jest.mock('../agentUncertaintyIntentService', () => ({
  detectUncertaintyQuery: jest.fn(() => false),
  buildUncertaintyReply: jest.fn(),
}));
jest.mock('../agentInterventionIntentService', () => ({
  detectInterventionIntentQuery: jest.fn(() => null),
  buildInterventionIntentReply: jest.fn(),
}));
// Reese manager-directed growth mission, Phase 2 (2026-09-30) — same isolation reasoning as
// every mock above: summaryGeneratorService.ts itself imports { Ticket, TicketActionLink,
// WorkLedgerEvent } from the '../../models' barrel, which triggers the full association
// graph. This file only needs "no focused case" for its own unrelated test messages (every
// test here calls sendManagerMessage without a ticketId) — real focused-case behavior is
// agentManagerConversationService.focusedCase.test.ts's job.
jest.mock('../../models/Ticket', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/AdminUser', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../agentBlueprint/legacyCreatorAliases', () => ({ buildCreatorIdMatchList: jest.fn(() => []) }));
jest.mock('../workLedger/summaryGeneratorService', () => ({ generateTicketSummary: jest.fn() }));
jest.mock('../evidence/evidenceService', () => ({ getEvidenceForTicket: jest.fn() }));
jest.mock('../evidence/decisionRecordService', () => ({ getDecisionsForTicket: jest.fn() }));

import { getInstrumentedOpenAI } from '../openaiInstrumented';
import { buildAgentManagerConversationSystemPrompt } from '../agentBlueprint/agentManagerConversationPrompt';
import { getConversationHistory, sendManagerMessage, AgentNotFoundError } from '../agentManagerConversationService';

const mockGetInstrumentedOpenAI = getInstrumentedOpenAI as unknown as jest.Mock;
const mockBuildPrompt = buildAgentManagerConversationSystemPrompt as unknown as jest.Mock;
const mockCreateCompletion = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateCompletion.mockReset();
  mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: 'Here is my answer.' } }] });
  mockGetInstrumentedOpenAI.mockReturnValue({ chat: { completions: { create: mockCreateCompletion } } });
  mockBuildPrompt.mockResolvedValue('SYSTEM PROMPT');
});

describe('getConversationHistory', () => {
  it('happy path: finds/creates the conversation and returns its message history', async () => {
    mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1' });
    mockConversationFindOrCreate.mockResolvedValue([{ id: 'conv-1' }, false]);
    mockMessageFindAll.mockResolvedValue([
      { id: 'm1', role: 'manager', content: 'Hi', created_at: new Date() },
      { id: 'm2', role: 'agent', content: 'Hello', created_at: new Date() },
    ]);

    const result = await getConversationHistory('agent-1', 'manager@colaberry.com');

    expect(result?.conversationId).toBe('conv-1');
    expect(result?.messages).toHaveLength(2);
  });

  it('boundary: a nonexistent agent returns null', async () => {
    mockAiAgentFindByPk.mockResolvedValue(null);

    const result = await getConversationHistory('does-not-exist', 'manager@colaberry.com');

    expect(result).toBeNull();
    expect(mockConversationFindOrCreate).not.toHaveBeenCalled();
  });

  it('boundary: a real agent with no prior conversation returns an empty message list, not an error', async () => {
    mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1' });
    mockConversationFindOrCreate.mockResolvedValue([{ id: 'conv-1' }, true]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await getConversationHistory('agent-1', 'manager@colaberry.com');

    expect(result?.messages).toEqual([]);
  });

  it('regression: queries for the MOST RECENT messages (DESC + limit), never the oldest — ORDER BY created_at ASC LIMIT N silently returns the oldest N once a conversation exceeds the limit, freezing the view on stale history forever', async () => {
    mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1' });
    mockConversationFindOrCreate.mockResolvedValue([{ id: 'conv-1' }, false]);
    mockMessageFindAll.mockResolvedValue([]);

    await getConversationHistory('agent-1', 'manager@colaberry.com');

    expect(mockMessageFindAll).toHaveBeenCalledWith(expect.objectContaining({ order: [['created_at', 'DESC']] }));
  });

  it('regression: still returns messages in chronological (oldest-first) order for display, even though the underlying query fetches newest-first', async () => {
    mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1' });
    mockConversationFindOrCreate.mockResolvedValue([{ id: 'conv-1' }, false]);
    // The real DB, queried DESC, would hand back newest-first — this mock
    // mirrors that shape rather than the already-chronological shape every
    // other test in this file uses, to prove the reverse actually happens.
    mockMessageFindAll.mockResolvedValue([
      { id: 'm3', role: 'agent', content: 'Third', created_at: new Date('2026-09-10T00:00:03.000Z') },
      { id: 'm2', role: 'manager', content: 'Second', created_at: new Date('2026-09-10T00:00:02.000Z') },
      { id: 'm1', role: 'manager', content: 'First', created_at: new Date('2026-09-10T00:00:01.000Z') },
    ]);

    const result = await getConversationHistory('agent-1', 'manager@colaberry.com');

    expect(result?.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('sendManagerMessage', () => {
  it('happy path: persists the manager turn, calls the real LLM with a real assembled prompt, persists and returns the agent reply', async () => {
    mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'You are Reese.' });
    mockConversationFindOrCreate.mockResolvedValue([{ id: 'conv-1' }, false]);
    mockMessageFindAll
      .mockResolvedValueOnce([{ id: 'm1', role: 'manager', content: 'How are you doing?', created_at: new Date() }])
      .mockResolvedValueOnce([
        { id: 'm1', role: 'manager', content: 'How are you doing?', created_at: new Date() },
        { id: 'm2', role: 'agent', content: 'Here is my answer.', created_at: new Date() },
      ]);

    const result = await sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'How are you doing?');

    expect(mockMessageCreate).toHaveBeenCalledWith(expect.objectContaining({ role: 'manager', content: 'How are you doing?' }));
    // Reese manager-directed growth mission, Phase 2 (2026-09-30) — now carries a 4th,
    // focused-case-context argument (null here — this test's conversation has no bound
    // case, the manager-wide-question case; real focused-case behavior is
    // agentManagerConversationService.focusedCase.test.ts's job).
    expect(mockBuildPrompt).toHaveBeenCalledWith('agent-1', 'Reese', 'You are Reese.', null);
    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(mockMessageCreate).toHaveBeenCalledWith(expect.objectContaining({ role: 'agent', content: 'Here is my answer.' }));
    expect(result.messages).toHaveLength(2);
  });

  it('real per-agent cost tracking: getInstrumentedOpenAI is tagged with this agent\'s real id, from the start (not a later retrofit)', async () => {
    mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'You are Reese.' });
    mockConversationFindOrCreate.mockResolvedValue([{ id: 'conv-1' }, false]);
    mockMessageFindAll.mockResolvedValue([]);

    await sendManagerMessage('agent-1', 'manager@colaberry.com', null, 'hi');

    expect(mockGetInstrumentedOpenAI).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'agent-1' }));
  });

  it('BREAK: a nonexistent agent throws AgentNotFoundError and never calls the LLM', async () => {
    mockAiAgentFindByPk.mockResolvedValue(null);

    await expect(sendManagerMessage('does-not-exist', 'manager@colaberry.com', null, 'hi')).rejects.toBeInstanceOf(AgentNotFoundError);
    expect(mockCreateCompletion).not.toHaveBeenCalled();
  });

  it('boundary: an empty/whitespace LLM reply degrades to an honest fallback line, never an empty persisted message', async () => {
    mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'You are Reese.' });
    mockConversationFindOrCreate.mockResolvedValue([{ id: 'conv-1' }, false]);
    mockMessageFindAll.mockResolvedValue([]);
    mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });

    await sendManagerMessage('agent-1', 'manager@colaberry.com', null, 'hi');

    const agentTurnCall = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurnCall[0].content.length).toBeGreaterThan(0);
  });
});
