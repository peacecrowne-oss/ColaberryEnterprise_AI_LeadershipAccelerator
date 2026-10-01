/**
 * agentManagerConversationService — CHANGE_GOAL confirmation workflow
 * integration (Reese Agentic AI Employee mission, Capability 8). Pins the
 * real two-turn state machine at the point it actually lives — inside
 * sendManagerMessage() — not just the pure detector in isolation
 * (managerGoalIntentService.test.ts already covers that). Mirrors
 * agentManagerConversationService.reliabilityConfirmation.test.ts's own
 * structure exactly, on the generic pending_intent_confirmation column
 * instead of the dedicated reliability one. The core safety property under
 * test: a goal change is NEVER applied on the same turn it's first
 * detected, and a pending reliability confirmation always outranks a
 * pending/newly-detected goal-change intent on the same turn.
 */
const mockAiAgentFindByPk = jest.fn();
jest.mock('../../models/AiAgent', () => ({ __esModule: true, default: { findByPk: (...a: any[]) => mockAiAgentFindByPk(...a) } }));

const mockConversationFindOrCreate = jest.fn();
jest.mock('../../models/AgentManagerConversation', () => ({
  __esModule: true,
  default: { findOrCreate: (...a: any[]) => mockConversationFindOrCreate(...a) },
}));

const mockMessageCreate = jest.fn();
const mockMessageFindAll = jest.fn();
jest.mock('../../models/AgentManagerMessage', () => ({
  __esModule: true,
  default: { create: (...a: any[]) => mockMessageCreate(...a), findAll: (...a: any[]) => mockMessageFindAll(...a) },
}));

jest.mock('../openaiInstrumented', () => ({ getInstrumentedOpenAI: jest.fn() }));
jest.mock('../agentBlueprint/agentManagerConversationPrompt', () => ({ buildAgentManagerConversationSystemPrompt: jest.fn() }));

const mockDetectReliabilityIntent = jest.fn(() => null);
// detectConfirmationReply is the one function agentManagerConversationService.ts
// shares between the reliability flow AND the goal-intent flow (both pending-
// confirmation handlers reuse the same generic confirm/cancel-word detector) —
// so unlike a normal wholesale stub, this must behave realistically for this
// file's own 'confirm'/'cancel' test messages, or the goal-confirmation turn
// never actually registers as confirmed. Full word-list coverage is
// managerReliabilityIntentService.test.ts's own job; this only needs to be
// right for the literal words this file's tests send.
jest.mock('../managerReliabilityIntentService', () => ({
  detectReliabilityIntent: (...a: any[]) => mockDetectReliabilityIntent(...a),
  detectConfirmationReply: jest.fn((msg: string) => {
    const lower = msg.trim().toLowerCase();
    if (lower === 'confirm') return 'confirm';
    if (lower === 'cancel') return 'cancel';
    return 'ambiguous';
  }),
  buildConfirmationCardText: jest.fn(() => ''),
  toPendingConfirmation: jest.fn(),
  applyConfirmedReliabilityChange: jest.fn(),
}));

const mockCreateGoal = jest.fn();
jest.mock('../agentGoalService', () => ({
  createGoal: (...a: any[]) => mockCreateGoal(...a),
}));

// This file tests the CHANGE_GOAL flow specifically — SCHEDULE_ONE_ON_ONE is
// unrelated, mocked wholesale so it never fires on this file's own messages.
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
// every mock above: agentManagerConversationService.ts now imports summaryGeneratorService.ts
// (focused-case retrieval), which itself imports the '../../models' barrel, triggering the
// full association graph. This file only needs "no focused case" for its own unrelated test
// messages — real focused-case behavior is agentManagerConversationService.focusedCase.test.ts's job.
jest.mock('../../models/Ticket', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/AdminUser', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../agentBlueprint/legacyCreatorAliases', () => ({ buildCreatorIdMatchList: jest.fn(() => []) }));
jest.mock('../workLedger/summaryGeneratorService', () => ({ generateTicketSummary: jest.fn() }));
jest.mock('../evidence/evidenceService', () => ({ getEvidenceForTicket: jest.fn() }));
jest.mock('../evidence/decisionRecordService', () => ({ getDecisionsForTicket: jest.fn() }));

import { getInstrumentedOpenAI } from '../openaiInstrumented';
import { sendManagerMessage } from '../agentManagerConversationService';

const mockGetInstrumentedOpenAI = getInstrumentedOpenAI as unknown as jest.Mock;
const mockCreateCompletion = jest.fn();

function fakeConversation(overrides: Record<string, any> = {}) {
  return { id: 'conv-1', pending_reliability_confirmation: null, pending_intent_confirmation: null, update: jest.fn().mockResolvedValue(undefined), ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDetectReliabilityIntent.mockReturnValue(null);
  mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: 'Normal reply.' } }] });
  mockGetInstrumentedOpenAI.mockReturnValue({ chat: { completions: { create: mockCreateCompletion } } });
  mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'You are Reese.' });
  mockMessageFindAll.mockResolvedValue([]);
  mockCreateGoal.mockResolvedValue({ id: 'goal-1' });
});

describe('sendManagerMessage — CHANGE_GOAL confirmation workflow', () => {
  it('detection turn: a fresh goal-change request produces a confirmation card, sets pending state, and never calls the LLM or writes a real goal', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'Set a goal: monthly cost at most $500.');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    expect(mockCreateGoal).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      pending_intent_confirmation: expect.objectContaining({ intentType: 'CHANGE_GOAL', metricKey: 'monthly_cost_usd', targetValue: 500 }),
    }));
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('confirm');
    expect(result.conversationId).toBe('conv-1');
  });

  it('confirmation turn: a pending goal change + a real "confirm" reply creates the real goal and clears pending state', async () => {
    const pending = { intentType: 'CHANGE_GOAL' as const, metricKey: 'monthly_cost_usd', comparison: 'at_most' as const, targetValue: 500, reason: 'Set a goal: monthly cost at most $500.', detectedAt: '2026-09-08T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'confirm');

    expect(mockCreateGoal).toHaveBeenCalledWith('agent-1', 'org-member-1', 'ali@colaberry.com', 'monthly_cost_usd', 'at_most', 500);
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('monthly cost');
  });

  it('cancel turn: a pending goal change + a "cancel" reply clears pending state without ever creating a goal', async () => {
    const pending = { intentType: 'CHANGE_GOAL' as const, metricKey: 'monthly_cost_usd', comparison: 'at_most' as const, targetValue: 500, reason: 'Set a goal: monthly cost at most $500.', detectedAt: '2026-09-08T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'cancel');

    expect(mockCreateGoal).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });

  it('priority: a pending RELIABILITY confirmation outranks a newly-typed goal-change message on the same turn', async () => {
    const pendingReliability = { direction: 'quarantine', sourceSystem: 'attendance', metricKey: 'attendance.*', scopeType: 'global', scopeValue: null, reason: 'Attendance is broken.', detectedAt: '2026-09-08T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_reliability_confirmation: pendingReliability });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'Set a goal: monthly cost at most $500.');

    // The reliability handler owns this turn (its own pending state existed);
    // the goal handler must never even run its detector on this turn.
    expect(mockCreateGoal).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_reliability_confirmation: null });
  });

  it('regression: a normal message with no pending state and no goal-change keywords goes through the unchanged LLM reply path', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'How is Victor doing this week?');

    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(conversation.update).not.toHaveBeenCalled();
    expect(mockCreateGoal).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
