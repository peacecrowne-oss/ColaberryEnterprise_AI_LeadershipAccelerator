/**
 * agentManagerConversationService — INSTRUCT confirmation workflow
 * integration (Reese Agentic AI Employee mission, Capability 8). Mirrors
 * agentManagerConversationService.oneOnOneIntent.test.ts's own structure
 * exactly, on the same generic pending_intent_confirmation column. Core
 * safety property under test: a directive is NEVER saved on the same turn
 * it's first detected, and a pending CHANGE_GOAL or SCHEDULE_ONE_ON_ONE
 * confirmation always outranks a newly-typed directive on the same turn.
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
// (reliability, CHANGE_GOAL, SCHEDULE_ONE_ON_ONE, INSTRUCT) — must behave
// realistically for this file's own 'confirm'/'cancel' test messages, same
// reasoning as the sibling intent test files' own mocks.
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

// This file tests the INSTRUCT flow specifically — CHANGE_GOAL and
// SCHEDULE_ONE_ON_ONE are unrelated, mocked wholesale so neither fires on
// this file's own messages.
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

const mockCreateDirective = jest.fn();
jest.mock('../managerDirectiveService', () => ({
  createDirective: (...a: any[]) => mockCreateDirective(...a),
}));

// ASSIGN_WORK is unrelated to this file — mocked wholesale so it never
// fires on this file's own messages, same reasoning as the CHANGE_GOAL/
// SCHEDULE_ONE_ON_ONE mocks above.
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
  mockCreateDirective.mockResolvedValue({ id: 'directive-1' });
});

describe('sendManagerMessage — INSTRUCT confirmation workflow', () => {
  it('detection turn: a fresh standing-directive request produces a confirmation card, sets pending state, and never calls the LLM or saves a real directive', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'From now on, always CC me on financial tickets.');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    expect(mockCreateDirective).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      pending_intent_confirmation: expect.objectContaining({ intentType: 'INSTRUCT', directiveText: 'From now on, always CC me on financial tickets.' }),
    }));
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('confirm');
    expect(result.conversationId).toBe('conv-1');
  });

  it('confirmation turn: a pending directive + a real "confirm" reply saves the real directive and clears pending state', async () => {
    const pending = { intentType: 'INSTRUCT' as const, directiveText: 'From now on, always CC me on financial tickets.', detectedAt: '2026-09-09T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'confirm');

    expect(mockCreateDirective).toHaveBeenCalledWith('agent-1', 'org-member-1', 'ali@colaberry.com', 'From now on, always CC me on financial tickets.');
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('directive');
  });

  it('cancel turn: a pending directive + a "cancel" reply clears pending state without ever saving a real directive', async () => {
    const pending = { intentType: 'INSTRUCT' as const, directiveText: 'From now on, always CC me.', detectedAt: '2026-09-09T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'cancel');

    expect(mockCreateDirective).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });

  it('priority: a pending SCHEDULE_ONE_ON_ONE confirmation outranks a newly-typed directive on the same turn', async () => {
    const pendingOneOnOne = { intentType: 'SCHEDULE_ONE_ON_ONE' as const, agenda: "Let's schedule a 1:1.", detectedAt: '2026-09-09T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pendingOneOnOne });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'From now on, always CC me on financial tickets.');

    // The generic pending-confirmation handler owns this turn regardless of
    // intent type; the new-detection path must never even run for a
    // directive on this turn.
    expect(mockCreateDirective).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });

  it('regression: a normal message with no pending state and no standing-directive keywords goes through the unchanged LLM reply path', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'How is Victor doing this week?');

    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(conversation.update).not.toHaveBeenCalled();
    expect(mockCreateDirective).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
