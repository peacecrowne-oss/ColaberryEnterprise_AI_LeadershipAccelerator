/**
 * agentManagerConversationService — intervention-intent query integration
 * (Reese Agentic AI Employee mission, Capability 7). Pins the real wiring
 * inside sendManagerMessage() — not just the pure detector/answer-builder
 * in isolation (agentInterventionIntentService.test.ts covers those). Core
 * property: these questions never reach the LLM, and are checked after the
 * reliability/work-status/uncertainty pre-checks.
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
jest.mock('../agentWorkStatusIntentService', () => ({
  detectWorkStatusQuery: jest.fn(() => null),
  buildWorkStatusReply: jest.fn(),
}));
jest.mock('../agentUncertaintyIntentService', () => ({
  detectUncertaintyQuery: jest.fn(() => false),
  buildUncertaintyReply: jest.fn(),
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

const mockReeseOutreachFindAll = jest.fn();
jest.mock('../../models/ReeseOutreach', () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => mockReeseOutreachFindAll(...a) },
}));

const mockEnrollmentFindAll = jest.fn();
jest.mock('../../models/Enrollment', () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => mockEnrollmentFindAll(...a) },
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
  mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'You are Reese.' });
  mockMessageFindAll.mockResolvedValue([]);
  mockAdminUserFindOne.mockResolvedValue({ id: 'admin-1' });
  mockTicketFindAll.mockResolvedValue([]);
  mockReeseOutreachFindAll.mockResolvedValue([]);
  mockEnrollmentFindAll.mockResolvedValue([]);
});

describe('sendManagerMessage — intervention intent queries', () => {
  it('a "which students need me" question is answered from real ReeseOutreach rows and never reaches the LLM', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);
    mockTicketFindAll.mockResolvedValue([{ id: 'ticket-1' }]);
    mockReeseOutreachFindAll.mockResolvedValue([{ enrollment_id: 'e1', signal_type: 'inactivity', status: 'active' }]);
    mockEnrollmentFindAll.mockResolvedValue([{ id: 'e1', full_name: 'Victor Chukwukere' }]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'Which students need me?');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('Victor Chukwukere');
    expect(result.conversationId).toBe('conv-1');
  });

  it('a "what did you promise to follow up on" question is answered honestly when there are none', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'What did you promise to follow up on?');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toBe("I don't have any open follow-up commitments right now.");
  });

  it('a "which interventions are working" question is answered from real outcome counts', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);
    mockTicketFindAll.mockResolvedValue([{ id: 'ticket-1' }]);
    mockReeseOutreachFindAll.mockResolvedValue([{ status: 'goal_met' }, { status: 'signal_cleared' }]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'Which interventions are working?');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('Of 2 resolved interventions');
  });

  it('never triggers while a reliability confirmation is pending — that flow owns the turn first', async () => {
    const pending = { direction: 'quarantine', sourceSystem: 'attendance', metricKey: 'attendance.*', scopeType: 'global', scopeValue: null, reason: 'Attendance is broken.', detectedAt: '2026-09-04T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_reliability_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'Which students need me?');

    expect(mockReeseOutreachFindAll).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_reliability_confirmation: null });
  });

  it('regression: a normal message with no intervention keywords goes through the unchanged LLM reply path', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'How is Victor doing this week?');

    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(mockReeseOutreachFindAll).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
