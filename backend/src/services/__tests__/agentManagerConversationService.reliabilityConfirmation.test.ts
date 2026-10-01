/**
 * agentManagerConversationService — reliability confirmation workflow
 * integration (Reese Agentic AI Employee mission, Checkpoint B). Pins the
 * real two-turn state machine at the point it actually lives — inside
 * sendManagerMessage() — not just the pure detector in isolation
 * (managerReliabilityIntentService.test.ts already covers that). The core
 * safety property under test: a reliability declaration is NEVER applied
 * on the same turn it's first detected, and the normal LLM reply path is
 * NEVER invoked while a reliability turn is being handled.
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

const mockDeclareReliabilityChange = jest.fn();
const mockRestoreMetric = jest.fn();
const mockGetReliabilityStatus = jest.fn();
jest.mock('../metricReliabilityService', () => ({
  declareReliabilityChange: (...a: any[]) => mockDeclareReliabilityChange(...a),
  restoreMetric: (...a: any[]) => mockRestoreMetric(...a),
  getReliabilityStatus: (...a: any[]) => mockGetReliabilityStatus(...a),
}));

const mockCreateTicket = jest.fn();
jest.mock('../ticketService', () => ({
  createTicket: (...a: any[]) => mockCreateTicket(...a),
  updateTicketStatus: jest.fn(),
  addTicketComment: jest.fn(),
}));

// Capability 8's CHANGE_GOAL intent is unrelated to this file's reliability
// scenarios — mocked wholesale so it never fires on this file's own messages.
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
// Checkpoint F's work-status query is unrelated to this file's reliability
// scenarios — mocked wholesale so none of these tests need to also stub the
// Ticket/AdminUser models agentWorkStatusIntentService.ts queries directly.
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
  return { id: 'conv-1', pending_reliability_confirmation: null, update: jest.fn().mockResolvedValue(undefined), ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: 'Normal reply.' } }] });
  mockGetInstrumentedOpenAI.mockReturnValue({ chat: { completions: { create: mockCreateCompletion } } });
  mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'You are Reese.' });
  mockMessageFindAll.mockResolvedValue([]);
  mockDeclareReliabilityChange.mockResolvedValue({});
  mockRestoreMetric.mockResolvedValue({});
  mockGetReliabilityStatus.mockResolvedValue({ status: 'quarantined', severity: 'high', reason: 'Attendance is broken.', declaredAt: new Date(), recordId: 'rec-1', incidentTicketId: null });
  mockCreateTicket.mockResolvedValue({ id: 'ticket-1' });
});

describe('sendManagerMessage — reliability confirmation workflow', () => {
  it('detection turn: a fresh reliability declaration produces a confirmation card, sets pending state, and never calls the LLM or writes durable state', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'Attendance is broken.');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    expect(mockDeclareReliabilityChange).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      pending_reliability_confirmation: expect.objectContaining({ direction: 'quarantine', sourceSystem: 'attendance' }),
    }));
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('confirm');
    expect(result.conversationId).toBe('conv-1');
  });

  it('confirmation turn: a pending declaration + a real "confirm" reply applies the change for real and clears pending state', async () => {
    const pending = { direction: 'quarantine', sourceSystem: 'attendance', metricKey: 'attendance.*', scopeType: 'global', scopeValue: null, reason: 'Attendance is broken.', detectedAt: '2026-09-04T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_reliability_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'confirm');

    expect(mockDeclareReliabilityChange).toHaveBeenCalledWith(expect.objectContaining({ sourceSystem: 'attendance', status: 'quarantined', declaredByEmail: 'ali@colaberry.com' }));
    expect(conversation.update).toHaveBeenCalledWith({ pending_reliability_confirmation: null });
    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('quarantined');
  });

  it('cancel turn: a pending declaration + a "cancel" reply clears pending state without ever writing durable state', async () => {
    const pending = { direction: 'quarantine', sourceSystem: 'attendance', metricKey: 'attendance.*', scopeType: 'global', scopeValue: null, reason: 'Attendance is broken.', detectedAt: '2026-09-04T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_reliability_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'cancel');

    expect(mockDeclareReliabilityChange).not.toHaveBeenCalled();
    expect(mockRestoreMetric).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_reliability_confirmation: null });
  });

  it('ambiguous turn: a pending declaration + an unrelated reply is treated as a real cancel, never left lingering for a later out-of-context confirm', async () => {
    const pending = { direction: 'quarantine', sourceSystem: 'attendance', metricKey: 'attendance.*', scopeType: 'global', scopeValue: null, reason: 'Attendance is broken.', detectedAt: '2026-09-04T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_reliability_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'What time is the next session?');

    expect(mockDeclareReliabilityChange).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_reliability_confirmation: null });
  });

  it('regression: a normal message with no pending state and no reliability keywords goes through the unchanged LLM reply path', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'How is Victor doing this week?');

    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(conversation.update).not.toHaveBeenCalled();
    expect(mockDeclareReliabilityChange).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
