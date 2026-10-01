/**
 * agentManagerConversationService — APPROVE/REJECT confirmation workflow
 * integration (Reese Agentic AI Employee mission, Capability 8). Mirrors
 * the sibling intent integration test files' own structure, on the same
 * generic pending_intent_confirmation column. Core safety properties under
 * test: a decision is NEVER applied on the same turn it's first detected;
 * zero or multiple pending proposals are surfaced honestly WITHOUT ever
 * setting pending state or guessing which one was meant; and a pending
 * decision from an EARLIER intent always outranks a newly-typed approve/
 * reject on the same turn.
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

// Every other Capability 8 intent is unrelated to this file — mocked
// wholesale so none of them fire on this file's own messages.
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

const mockGetManagerInboxItems = jest.fn();
jest.mock('../managerInboxService', () => ({
  getManagerInboxItems: (...a: any[]) => mockGetManagerInboxItems(...a),
}));
const mockApproveProposedAction = jest.fn();
const mockRejectProposedAction = jest.fn();
jest.mock('../agentApprovalService', () => ({
  approveProposedAction: (...a: any[]) => mockApproveProposedAction(...a),
  rejectProposedAction: (...a: any[]) => mockRejectProposedAction(...a),
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

const fakeItem = {
  id: 'proposal-1',
  actionType: 'content_optimization',
  reason: 'Subject line underperforming by 40%.',
  confidence: 0.8,
  priorityScore: null,
  riskScore: null,
  impactScore: null,
  status: 'pending' as const,
  createdAt: new Date('2026-09-10T00:00:00.000Z'),
  expiresAt: null,
  targetTable: 'scheduled_emails',
  targetId: 'email-1',
};

function fakeConversation(overrides: Record<string, any> = {}) {
  return { id: 'conv-1', agent_id: 'agent-1', pending_reliability_confirmation: null, pending_intent_confirmation: null, update: jest.fn().mockResolvedValue(undefined), ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDetectReliabilityIntent.mockReturnValue(null);
  mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: 'Normal reply.' } }] });
  mockGetInstrumentedOpenAI.mockReturnValue({ chat: { completions: { create: mockCreateCompletion } } });
  mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'You are Reese.' });
  mockMessageFindAll.mockResolvedValue([]);
  mockGetManagerInboxItems.mockResolvedValue([fakeItem]);
  mockApproveProposedAction.mockResolvedValue({ outcome: 'approved', applied: true, proposal: {} });
  mockRejectProposedAction.mockResolvedValue({ outcome: 'rejected', proposal: {} });
});

describe('sendManagerMessage — APPROVE confirmation workflow', () => {
  it('detection turn: exactly one pending proposal produces a confirmation card, sets pending state, and never approves yet', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'Approve it.');

    expect(mockCreateCompletion).not.toHaveBeenCalled();
    expect(mockApproveProposedAction).not.toHaveBeenCalled();
    expect(mockGetManagerInboxItems).toHaveBeenCalledWith('agent-1');
    expect(conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      pending_intent_confirmation: expect.objectContaining({ intentType: 'APPROVE', proposalId: 'proposal-1' }),
    }));
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('confirm');
    expect(result.conversationId).toBe('conv-1');
  });

  it('detection turn, zero pending proposals: honest decline, no pending state ever set', async () => {
    mockGetManagerInboxItems.mockResolvedValue([]);
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'Approve it.');

    expect(conversation.update).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain("nothing pending");
  });

  it('detection turn, multiple pending proposals: honest ambiguity, no pending state ever set, never guesses', async () => {
    mockGetManagerInboxItems.mockResolvedValue([fakeItem, { ...fakeItem, id: 'proposal-2' }]);
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'Approve it.');

    expect(conversation.update).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('more than one');
  });

  it('confirmation turn: a pending approval + a real "confirm" reply approves the real proposal and clears pending state', async () => {
    const pending = { intentType: 'APPROVE' as const, proposalId: 'proposal-1', reason: 'Subject line underperforming by 40%.', detectedAt: '2026-09-10T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'confirm');

    expect(mockApproveProposedAction).toHaveBeenCalledWith('proposal-1', 'ali@colaberry.com', null);
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
    expect(mockCreateCompletion).not.toHaveBeenCalled();
  });

  it('cancel turn: a pending approval + a "cancel" reply clears pending state without ever approving', async () => {
    const pending = { intentType: 'APPROVE' as const, proposalId: 'proposal-1', reason: 'Subject line underperforming by 40%.', detectedAt: '2026-09-10T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'cancel');

    expect(mockApproveProposedAction).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });
});

describe('sendManagerMessage — REJECT confirmation workflow', () => {
  it('detection turn: exactly one pending proposal produces a confirmation card and never rejects yet', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'Reject it.');

    expect(mockRejectProposedAction).not.toHaveBeenCalled();
    const agentTurn = mockMessageCreate.mock.calls.find((c) => c[0].role === 'agent');
    expect(agentTurn[0].content).toContain('confirm');
  });

  it('confirmation turn: a pending rejection + "confirm" rejects the real proposal', async () => {
    const pending = { intentType: 'REJECT' as const, proposalId: 'proposal-1', reason: 'Subject line underperforming by 40%.', detectedAt: '2026-09-10T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pending });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'confirm');

    expect(mockRejectProposedAction).toHaveBeenCalledWith('proposal-1', 'ali@colaberry.com', null);
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });
});

describe('sendManagerMessage — priority and regression', () => {
  it('priority: a pending ASSIGN_WORK confirmation outranks a newly-typed approve on the same turn', async () => {
    const pendingAssignWork = { intentType: 'ASSIGN_WORK' as const, title: 'New task: reconcile invoices.', idempotencyKey: 'idem-1', detectedAt: '2026-09-10T00:00:00.000Z' };
    const conversation = fakeConversation({ pending_intent_confirmation: pendingAssignWork });
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'Approve it.');

    // The generic pending-confirmation handler owns this turn regardless of
    // intent type; the new-detection path (and its own DB lookup) must
    // never even run for an approve message on this turn.
    expect(mockGetManagerInboxItems).not.toHaveBeenCalled();
    expect(conversation.update).toHaveBeenCalledWith({ pending_intent_confirmation: null });
  });

  it('regression: a normal message with no approve/reject keywords goes through the unchanged LLM reply path', async () => {
    const conversation = fakeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conversation, false]);

    const result = await sendManagerMessage('agent-1', 'ali@colaberry.com', 'org-member-1', 'How is Victor doing this week?');

    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(mockGetManagerInboxItems).not.toHaveBeenCalled();
    expect(conversation.update).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
