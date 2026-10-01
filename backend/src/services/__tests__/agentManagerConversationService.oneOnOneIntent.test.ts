/**
 * agentManagerConversationService — SCHEDULE_ONE_ON_ONE confirmation
 * workflow integration (Reese Agentic AI Employee mission, Capability 8).
 * Mirrors agentManagerConversationService.goalIntent.test.ts's own structure
 * exactly, on the same generic pending_intent_confirmation column. Core
 * safety property under test: a 1:1 is NEVER created on the same turn it's
 * first detected, and a pending CHANGE_GOAL confirmation (or reliability
 * confirmation) always outranks a newly-typed 1:1 request on the same turn.
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
// detectConfirmationReply is shared across every pending-confirmation flow
// (reliability, CHANGE_GOAL, SCHEDULE_ONE_ON_ONE) — must behave realistically
// for this file's own 'confirm'/'cancel' test messages, same reasoning as
// agentManagerConversationService.goalIntent.test.ts's own mock.
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

// This file tests the SCHEDULE_ONE_ON_ONE flow specifically — CHANGE_GOAL is
// unrelated, mocked wholesale so it never fires on this file's own messages.
jest.mock('../managerGoalIntentService', () => ({
  detectChangeGoalIntent: jest.fn(() => null),
  buildGoalConfirmationCardText: jest.fn(() => ''),
  toPendingGoalConfirmation: jest.fn(),
  applyConfirmedGoalChange: jest.fn(),
}));

const mockCreateOneOnOne = jest.fn();
jest.mock('../agentOneOnOneService', () => ({
  createOneOnOne: (...a: any[]) => mockCreateOneOnOne(...a),
}));

// INSTRUCT is unrelated to this file's scenarios — mocked wholesale so it
// never fires on this file's own messages.
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
  mockCreateOneOnOne.mockResolvedValue({ id: 'oneOnOne-1' });
});

describe('sendManagerMessage — SCHEDULE_ONE_ON_ONE confirmation workflow', () => {
  it('detection turn: a fresh 1:1 request produces a confirmation card, sets pending state, and never calls the LLM or creates a real 1:1', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, "Let's schedule a 1:1 to talk about the July cohort.");

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    expect(mockCreateOneOnOne).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      pending_intent_confirmation: expect.objectContaining({ intentType: 'SCHEDULE_ONE_ON_ONE', agenda: "Let's schedule a 1:1 to talk about the July cohort." }),
    }));
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('confirm');
    expect(result.conversationId).toBe('conv-1');
  });

  it('confirmation turn: a pending 1:1 + a real "confirm" reply creates the real 1:1 and clears pending state', async () => {
    const pending = { intentType: 'SCHEDULE_ONE_ON_ONE' as const, agenda: "Let's schedule a 1:1 to talk about the July cohort.", detectedAt: '2026-09-08T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'confirm');

    expect(mockCreateOneOnOne).toHaveBeenCalledWith('agent-1', 'org-member-1', 'ali@colaberry.com', "Let's schedule a 1:1 to talk about the July cohort.");
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('scheduled');
  });

  it('cancel turn: a pending 1:1 + a "cancel" reply clears pending state without ever creating a real 1:1', async () => {
    const pending = { intentType: 'SCHEDULE_ONE_ON_ONE' as const, agenda: "Let's schedule a 1:1.", detectedAt: '2026-09-08T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'cancel');

    expect(mockCreateOneOnOne).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });

  it('priority: a pending CHANGE_GOAL confirmation outranks a newly-typed 1:1 request on the same turn', async () => {
    const pendingGoal = { intentType: 'CHANGE_GOAL' as const, metricKey: 'monthly_cost_usd', comparison: 'at_most' as const, targetValue: 500, reason: 'Set a goal: monthly cost at most $500.', detectedAt: '2026-09-08T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pendingGoal });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, "Let's schedule a 1:1.");

    // The generic pending-confirmation handler owns this turn (its own
    // pending state existed, regardless of intent type); the new-detection
    // path must never even run for a 1:1 on this turn.
    expect(mockCreateOneOnOne).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });

  it('regression: a normal message with no pending state and no scheduling keywords goes through the unchanged LLM reply path', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'How is Victor doing this week?');

    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(conversation.update).not.toHaveBeenCalled();
    expect(mockCreateOneOnOne).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
