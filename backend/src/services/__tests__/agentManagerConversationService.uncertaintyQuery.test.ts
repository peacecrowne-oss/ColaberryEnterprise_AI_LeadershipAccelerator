/**
 * agentManagerConversationService — uncertainty query integration (Reese
 * Agentic AI Employee mission, Capability 7). Pins the real wiring inside
 * sendManagerMessage() — not just the pure detector/answer-builder in
 * isolation (agentUncertaintyIntentService.test.ts covers those). Core
 * property: a real uncertainty question never reaches the LLM, and is
 * checked after the reliability flow and after the work-status check.
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
jest.mock('../agentInterventionIntentService', () => ({
  detectInterventionIntentQuery: jest.fn(() => null),
  buildInterventionIntentReply: jest.fn(),
}));

const mockAssessmentFindAll = jest.fn();
jest.mock('../../models/StudentAssessment', () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => mockAssessmentFindAll(...a) },
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
  mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'You are Reese.', tools_granted: ['assess_student_health'] });
  mockMessageFindAll.mockResolvedValue([]);
  mockAssessmentFindAll.mockResolvedValue([]);
  mockEnrollmentFindAll.mockResolvedValue([]);
});

describe('sendManagerMessage — uncertainty query', () => {
  it('a "what are you uncertain about" question is answered from real StudentAssessment rows and never reaches the LLM', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);
    mockAssessmentFindAll.mockResolvedValue([{ enrollment_id: 'e1', requires_human_review: true, unanswered_questions: [] }]);
    mockEnrollmentFindAll.mockResolvedValue([{ id: 'e1', full_name: 'Victor Chukwukere' }]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'What are you uncertain about?');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('Victor Chukwukere');
    expect(result.conversationId).toBe('conv-1');
  });

  it('honestly answered when nothing is uncertain', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, "What don't you know?");

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toBe("Nothing I'm currently uncertain about — every recent assessment came back with a clear picture.");
  });

  it('never triggers while a reliability confirmation is pending — that flow owns the turn first', async () => {
    const pending = { direction: 'quarantine', sourceSystem: 'attendance', metricKey: 'attendance.*', scopeType: 'global', scopeValue: null, reason: 'Attendance is broken.', detectedAt: '2026-09-04T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_reliability_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'What are you uncertain about?');

    expect(mockAssessmentFindAll).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_reliability_confirmation: null });
  });

  it('regression: a normal message with no uncertainty keywords goes through the unchanged LLM reply path', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'How is Victor doing this week?');

    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(mockAssessmentFindAll).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
