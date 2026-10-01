/**
 * agentManagerConversationService — work-status query integration (Reese
 * Agentic AI Employee mission, Checkpoint F, first slice). Pins the real
 * wiring at the point it actually lives — inside sendManagerMessage() —
 * not just the pure detector/answer-builder in isolation
 * (agentWorkStatusIntentService.test.ts already covers those). The core
 * property under test: a real work-status question never reaches the LLM
 * and never collides with the reliability-confirmation flow's own
 * pre-check.
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

// Unrelated to this file's scenarios — mocked wholesale, same reasoning as
// agentManagerConversationService.test.ts's own header comment.
jest.mock('../managerReliabilityIntentService', () => ({
  detectReliabilityIntent: jest.fn(() => null),
  detectConfirmationReply: jest.fn(() => 'ambiguous'),
  buildConfirmationCardText: jest.fn(() => ''),
  toPendingConfirmation: jest.fn(),
  applyConfirmedReliabilityChange: jest.fn(),
}));
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
jest.mock('../agentUncertaintyIntentService', () => ({
  detectUncertaintyQuery: jest.fn(() => false),
  buildUncertaintyReply: jest.fn(),
}));
jest.mock('../agentInterventionIntentService', () => ({
  detectInterventionIntentQuery: jest.fn(() => null),
  buildInterventionIntentReply: jest.fn(),
}));

const mockAdminUserFindOne = jest.fn();
jest.mock('../../models/AdminUser', () => ({
  __esModule: true,
  default: { findOne: (...a: any[]) => mockAdminUserFindOne(...a) },
}));

const mockTicketFindAll = jest.fn();
jest.mock('../../models/Ticket', () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => mockTicketFindAll(...a), findByPk: jest.fn() },
}));

// Reese manager-directed growth mission, Phase 2 (2026-09-30) — same isolation reasoning as
// every mock above: agentManagerConversationService.ts now imports summaryGeneratorService.ts
// (focused-case retrieval), which itself imports the '../../models' barrel, triggering the
// full association graph. This file only needs "no focused case" for its own unrelated test
// messages — real focused-case behavior is agentManagerConversationService.focusedCase.test.ts's job.
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
  mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'You are Reese.', config: null });
  mockMessageFindAll.mockResolvedValue([]);
  mockAdminUserFindOne.mockResolvedValue({ id: 'admin-1' });
  mockTicketFindAll.mockResolvedValue([]);
});

describe('sendManagerMessage — work-status query', () => {
  it('a "what are you working on" question is answered from real Ticket rows and never reaches the LLM', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);
    mockTicketFindAll.mockResolvedValue([{ ticket_number: 7, title: 'Check in with a flagged student' }]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'What are you working on?');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('Check in with a flagged student');
    expect(result.conversationId).toBe('conv-1');
  });

  it('a "what is overdue" question is answered honestly when nothing is overdue', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);
    mockTicketFindAll.mockResolvedValue([]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, "What's overdue?");

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toBe('Nothing of mine is overdue right now.');
  });

  it('never triggers while a reliability confirmation is pending — that flow owns the turn first', async () => {
    const pending = { direction: 'quarantine', sourceSystem: 'attendance', metricKey: 'attendance.*', scopeType: 'global', scopeValue: null, reason: 'Attendance is broken.', detectedAt: '2026-09-04T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_reliability_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    // Even a message that would otherwise match a work-status trigger phrase
    // is intercepted by the pending reliability turn's cancel/ambiguous path
    // first — 'ambiguous' is this file's mocked detectConfirmationReply verdict.
    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'What are you working on?');

    expect(mockTicketFindAll).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_reliability_confirmation: null });
  });

  it('regression: a normal message with no work-status keywords goes through the unchanged LLM reply path', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'How is Victor doing this week?');

    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(mockTicketFindAll).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
