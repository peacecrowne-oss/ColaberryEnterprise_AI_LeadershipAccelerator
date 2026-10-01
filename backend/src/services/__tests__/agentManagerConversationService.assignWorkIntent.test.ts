/**
 * agentManagerConversationService — ASSIGN_WORK confirmation workflow
 * integration (Reese Agentic AI Employee mission, Capability 8). Mirrors
 * agentManagerConversationService.instructIntent.test.ts's own structure
 * exactly, on the same generic pending_intent_confirmation column. Core
 * safety property under test: a task is NEVER assigned on the same turn
 * it's first detected, and a pending CHANGE_GOAL, SCHEDULE_ONE_ON_ONE, or
 * INSTRUCT confirmation always outranks a newly-typed task assignment on
 * the same turn.
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
// (reliability, CHANGE_GOAL, SCHEDULE_ONE_ON_ONE, INSTRUCT, ASSIGN_WORK) —
// must behave realistically for this file's own 'confirm'/'cancel' test
// messages, same reasoning as the sibling intent test files' own mocks.
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

// This file tests the ASSIGN_WORK flow specifically — CHANGE_GOAL,
// SCHEDULE_ONE_ON_ONE, and INSTRUCT are unrelated, mocked wholesale so none
// of them fire on this file's own messages.
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

// Mocked wholesale, never jest.requireActual — the real module imports
// { Ticket } from models/index.ts, the full Sequelize association-setup
// barrel, which collides with this file's own partial AiAgent mock above
// (same isolation bug class as every other sibling intent's test file).
// This file never exercises the error classes directly (that's
// managerAssignWorkIntentService.test.ts's job), so they're omitted here.
const mockAssignTaskToAgent = jest.fn();
jest.mock('../workforce/orgChartTaskAssignmentService', () => ({
  assignTaskToAgent: (...a: any[]) => mockAssignTaskToAgent(...a),
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
  mockAssignTaskToAgent.mockResolvedValue({ id: 'ticket-1' });
});

describe('sendManagerMessage — ASSIGN_WORK confirmation workflow', () => {
  it('detection turn: a fresh task-assignment request produces a confirmation card, sets pending state, and never calls the LLM or assigns a real task', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'New task: reconcile the July invoices.');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    expect(mockAssignTaskToAgent).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      pending_intent_confirmation: expect.objectContaining({ intentType: 'ASSIGN_WORK', title: 'New task: reconcile the July invoices.' }),
    }));
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('confirm');
    expect(result.conversationId).toBe('conv-1');
  });

  it('confirmation turn: a pending task + a real "confirm" reply assigns the real task and clears pending state', async () => {
    const pending = { intentType: 'ASSIGN_WORK' as const, title: 'New task: reconcile the July invoices.', idempotencyKey: 'idem-1', detectedAt: '2026-09-09T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'confirm');

    expect(mockAssignTaskToAgent).toHaveBeenCalledWith({
      orgMemberId: 'org-member-1',
      agentId: 'agent-1',
      title: 'New task: reconcile the July invoices.',
      idempotencyKey: 'idem-1',
    });
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
    expect(mockCreateCompletion).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('task');
  });

  it('confirmation turn, no linked org profile: a pending task + "confirm" from a super admin declines honestly and never calls assignTaskToAgent()', async () => {
    const pending = { intentType: 'ASSIGN_WORK' as const, title: 'New task: reconcile the July invoices.', idempotencyKey: 'idem-1', detectedAt: '2026-09-09T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', null, 'confirm');

    expect(mockAssignTaskToAgent).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain("can't assign work");
  });

  it('cancel turn: a pending task + a "cancel" reply clears pending state without ever assigning a real task', async () => {
    const pending = { intentType: 'ASSIGN_WORK' as const, title: 'New task: reconcile the July invoices.', idempotencyKey: 'idem-1', detectedAt: '2026-09-09T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'cancel');

    expect(mockAssignTaskToAgent).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });

  it('priority: a pending INSTRUCT confirmation outranks a newly-typed task assignment on the same turn', async () => {
    const pendingDirective = { intentType: 'INSTRUCT' as const, directiveText: 'From now on, always CC me.', detectedAt: '2026-09-09T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pendingDirective });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'New task: reconcile the July invoices.');

    // The generic pending-confirmation handler owns this turn regardless of
    // intent type; the new-detection path must never even run for a task
    // assignment on this turn.
    expect(mockAssignTaskToAgent).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });

  it('regression: a normal message with no pending state and no task-assignment keywords goes through the unchanged LLM reply path', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'How is Victor doing this week?');

    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(conversation.update).not.toHaveBeenCalled();
    expect(mockAssignTaskToAgent).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
