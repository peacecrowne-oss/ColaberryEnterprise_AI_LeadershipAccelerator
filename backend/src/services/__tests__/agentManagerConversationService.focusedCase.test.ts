/**
 * agentManagerConversationService — Reese manager-directed growth mission, Phase 2
 * (2026-09-30). Pins the real fix for "Discuss with Reese on a specific case" producing
 * "I cannot access the conversation details": binding/switching a conversation's
 * focused_ticket_id, the pre-persist ownership check that closes a real gap found during
 * discovery (ticketRoutes.ts's summary/evidence/decisions endpoints have no per-ticket
 * ownership check at all), and that a manager-wide message never touches any of this.
 *
 * Same wholesale-mock isolation convention as agentManagerConversationService.test.ts —
 * every transitively-imported service that itself imports model classes directly (which
 * would trigger the full association graph at module-load time against this file's plain
 * mock objects) is mocked wholesale; this file only exercises the focused-case logic.
 */
const mockAiAgentFindByPk = jest.fn();
jest.mock('../../models/AiAgent', () => ({
  __esModule: true,
  default: { findByPk: (...a: any[]) => mockAiAgentFindByPk(...a) },
}));

const mockAdminUserFindOne = jest.fn();
jest.mock('../../models/AdminUser', () => ({
  __esModule: true,
  default: { findOne: (...a: any[]) => mockAdminUserFindOne(...a) },
}));

const mockTicketFindByPk = jest.fn();
jest.mock('../../models/Ticket', () => ({
  __esModule: true,
  default: { findByPk: (...a: any[]) => mockTicketFindByPk(...a) },
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
jest.mock('../agentBlueprint/legacyCreatorAliases', () => ({ buildCreatorIdMatchList: jest.fn() }));
jest.mock('../workLedger/summaryGeneratorService', () => ({ generateTicketSummary: jest.fn() }));
jest.mock('../evidence/evidenceService', () => ({ getEvidenceForTicket: jest.fn() }));
jest.mock('../evidence/decisionRecordService', () => ({ getDecisionsForTicket: jest.fn() }));

// Same isolation reasoning as agentManagerConversationService.test.ts — these all
// transitively import model classes directly; this file only needs "not a X message" for
// its own unrelated test messages.
jest.mock('../managerReliabilityIntentService', () => ({
  detectReliabilityIntent: jest.fn(() => null),
  detectConfirmationReply: jest.fn(() => 'ambiguous'),
  buildConfirmationCardText: jest.fn(() => ''),
  toPendingConfirmation: jest.fn(),
  applyConfirmedReliabilityChange: jest.fn(),
}));
jest.mock('../managerGoalIntentService', () => ({
  detectChangeGoalIntent: jest.fn(() => null), buildGoalConfirmationCardText: jest.fn(() => ''),
  toPendingGoalConfirmation: jest.fn(), applyConfirmedGoalChange: jest.fn(),
}));
jest.mock('../managerOneOnOneIntentService', () => ({
  detectScheduleOneOnOneIntent: jest.fn(() => null), buildOneOnOneConfirmationCardText: jest.fn(() => ''),
  toPendingOneOnOneConfirmation: jest.fn(), applyConfirmedOneOnOneSchedule: jest.fn(),
}));
jest.mock('../managerDirectiveIntentService', () => ({
  detectInstructIntent: jest.fn(() => null), buildDirectiveConfirmationCardText: jest.fn(() => ''),
  toPendingDirectiveConfirmation: jest.fn(), applyConfirmedDirective: jest.fn(),
}));
jest.mock('../managerAssignWorkIntentService', () => ({
  detectAssignWorkIntent: jest.fn(() => null), buildAssignWorkConfirmationCardText: jest.fn(() => ''),
  toPendingAssignWorkConfirmation: jest.fn(), applyConfirmedAssignWork: jest.fn(),
}));
jest.mock('../managerApprovalDecisionIntentService', () => ({
  detectApproveIntent: jest.fn(() => null), detectRejectIntent: jest.fn(() => null),
  resolvePendingApprovalTarget: jest.fn(), buildApproveConfirmationCardText: jest.fn(() => ''),
  buildRejectConfirmationCardText: jest.fn(() => ''), toPendingApproveConfirmation: jest.fn(),
  toPendingRejectConfirmation: jest.fn(), applyConfirmedApprove: jest.fn(), applyConfirmedReject: jest.fn(),
}));
jest.mock('../agentWorkStatusIntentService', () => ({ detectWorkStatusQuery: jest.fn(() => null), buildWorkStatusReply: jest.fn() }));
jest.mock('../agentUncertaintyIntentService', () => ({ detectUncertaintyQuery: jest.fn(() => false), buildUncertaintyReply: jest.fn() }));
jest.mock('../agentInterventionIntentService', () => ({ detectInterventionIntentQuery: jest.fn(() => null), buildInterventionIntentReply: jest.fn() }));

import { buildCreatorIdMatchList } from '../agentBlueprint/legacyCreatorAliases';
import { generateTicketSummary } from '../workLedger/summaryGeneratorService';
import { getEvidenceForTicket } from '../evidence/evidenceService';
import { getDecisionsForTicket } from '../evidence/decisionRecordService';
import { getInstrumentedOpenAI } from '../openaiInstrumented';
import { buildAgentManagerConversationSystemPrompt } from '../agentBlueprint/agentManagerConversationPrompt';
import { sendManagerMessage, TicketNotAccessibleError } from '../agentManagerConversationService';

const mockBuildCreatorIdMatchList = buildCreatorIdMatchList as unknown as jest.Mock;
const mockGenerateTicketSummary = generateTicketSummary as unknown as jest.Mock;
const mockGetEvidenceForTicket = getEvidenceForTicket as unknown as jest.Mock;
const mockGetDecisionsForTicket = getDecisionsForTicket as unknown as jest.Mock;
const mockGetInstrumentedOpenAI = getInstrumentedOpenAI as unknown as jest.Mock;
const mockBuildPrompt = buildAgentManagerConversationSystemPrompt as unknown as jest.Mock;
const mockCreateCompletion = jest.fn();

function makeConversation(overrides: Partial<any> = {}) {
  const conv: any = { id: 'conv-1', focused_ticket_id: null, ...overrides };
  conv.update = jest.fn(async (fields: any) => Object.assign(conv, fields));
  return conv;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateCompletion.mockReset();
  mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: 'Here is my answer.' } }] });
  mockGetInstrumentedOpenAI.mockReturnValue({ chat: { completions: { create: mockCreateCompletion } } });
  mockBuildPrompt.mockResolvedValue('SYSTEM PROMPT');
  mockMessageFindAll.mockResolvedValue([]);
  mockAiAgentFindByPk.mockResolvedValue({ id: 'agent-1', agent_name: 'Reese', system_prompt: 'persona' });
  mockAdminUserFindOne.mockResolvedValue({ id: 'admin-user-1' });
  mockBuildCreatorIdMatchList.mockReturnValue(['admin-user-1']);
});

describe('sendManagerMessage — focused-case binding and authorization', () => {
  it('happy path: binds a real, owned ticket (assigned_to_type ai_staff) to the conversation', async () => {
    const conv = makeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conv, false]);
    mockTicketFindByPk.mockResolvedValue({ id: 'ticket-1', assigned_to_type: 'ai_staff', assigned_to_id: 'admin-user-1', created_by_id: null, title: 'Power BI training', description: 'Student asks about Power BI', status: 'in_progress', ticket_number: 42 });
    mockGenerateTicketSummary.mockResolvedValue({ outcome: 'o', proof: 'p', humanAction: 'h', hasEvidence: true });
    mockGetEvidenceForTicket.mockResolvedValue([{ id: 'e1' }]);
    mockGetDecisionsForTicket.mockResolvedValue([]);

    await sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'Can you catch me up?', 'ticket-1');

    expect(conv.update).toHaveBeenCalledWith({ focused_ticket_id: 'ticket-1' });
    expect(mockBuildPrompt).toHaveBeenCalledWith('agent-1', 'Reese', 'persona', expect.objectContaining({ ticketId: 'ticket-1', title: 'Power BI training' }));
  });

  it('happy path: also recognizes assigned_to_type:"agent" (the org-chart task-assignment convention) — the real type mismatch this mission found, not repeated here', async () => {
    const conv = makeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conv, false]);
    mockTicketFindByPk.mockResolvedValue({ id: 'ticket-2', assigned_to_type: 'agent', assigned_to_id: 'agent-1', created_by_id: null, title: 'Assigned task', description: null, status: 'backlog', ticket_number: 7 });
    mockGenerateTicketSummary.mockResolvedValue({ outcome: 'o', proof: 'p', humanAction: 'h', hasEvidence: false });
    mockGetEvidenceForTicket.mockResolvedValue([]);
    mockGetDecisionsForTicket.mockResolvedValue([]);

    await sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'What about this task?', 'ticket-2');

    expect(conv.update).toHaveBeenCalledWith({ focused_ticket_id: 'ticket-2' });
  });

  it('failure (A04): a ticket that does not belong to this agent is rejected with a generic, identical error — never leaking whether it exists', async () => {
    const conv = makeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conv, false]);
    mockTicketFindByPk.mockResolvedValue({ id: 'ticket-3', assigned_to_type: 'ai_staff', assigned_to_id: 'someone-elses-admin-user', created_by_id: 'someone-else', title: 'Unrelated', description: null, status: 'open', ticket_number: 1 });

    await expect(
      sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'Tell me about this', 'ticket-3'),
    ).rejects.toBeInstanceOf(TicketNotAccessibleError);
    expect(conv.update).not.toHaveBeenCalled();
  });

  it('failure (A04): a nonexistent ticket id gets the SAME generic error as an unowned one', async () => {
    const conv = makeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conv, false]);
    mockTicketFindByPk.mockResolvedValue(null);

    await expect(
      sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'Tell me about this', 'does-not-exist'),
    ).rejects.toBeInstanceOf(TicketNotAccessibleError);
  });

  it('boundary (A06): a manager-wide message on a conversation with NO case ever bound touches no ticket lookup, authorization, or write', async () => {
    const conv = makeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conv, false]);

    await sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'How are things going generally?');

    expect(mockTicketFindByPk).not.toHaveBeenCalled();
    expect(conv.update).not.toHaveBeenCalled();
  });

  it('regression: re-supplying the SAME already-bound ticket id never re-validates or re-writes (binding is idempotent), but real case context is still retrieved for the reply exactly as it would be for any other message on a bound conversation', async () => {
    const conv = makeConversation({ focused_ticket_id: 'ticket-1' });
    mockConversationFindOrCreate.mockResolvedValue([conv, false]);
    mockTicketFindByPk.mockResolvedValue({ id: 'ticket-1', title: 'Case', description: null, status: 'open', ticket_number: 3 });
    mockGenerateTicketSummary.mockResolvedValue({ outcome: 'o', proof: 'p', humanAction: 'h', hasEvidence: false });
    mockGetEvidenceForTicket.mockResolvedValue([]);
    mockGetDecisionsForTicket.mockResolvedValue([]);

    await sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'Why did you open it?', 'ticket-1');

    // Real retrieval for the reply (one real lookup, for context) — but no NEW write, since
    // the binding itself didn't change. The ownership check (assertTicketBelongsToAgent)
    // specifically is skipped — confirmed indirectly: it never needs AdminUser/the match
    // list, which this test never bothers to configure beyond the beforeEach defaults.
    expect(mockTicketFindByPk).toHaveBeenCalledTimes(1);
    expect(conv.update).not.toHaveBeenCalled();
  });

  it('explicit switch: a DIFFERENT real, owned ticket id overwrites the previously-bound one', async () => {
    const conv = makeConversation({ focused_ticket_id: 'old-ticket' });
    mockConversationFindOrCreate.mockResolvedValue([conv, false]);
    mockTicketFindByPk.mockResolvedValue({ id: 'new-ticket', assigned_to_type: 'ai_staff', assigned_to_id: 'admin-user-1', created_by_id: null, title: 'New case', description: null, status: 'open', ticket_number: 9 });
    mockGenerateTicketSummary.mockResolvedValue({ outcome: 'o', proof: 'p', humanAction: 'h', hasEvidence: false });
    mockGetEvidenceForTicket.mockResolvedValue([]);
    mockGetDecisionsForTicket.mockResolvedValue([]);

    await sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'Switch to the new case', 'new-ticket');

    expect(conv.update).toHaveBeenCalledWith({ focused_ticket_id: 'new-ticket' });
  });

  it('idempotency: sending the same bind twice (e.g. a retried request) succeeds both times with the same end state', async () => {
    const conv = makeConversation();
    mockConversationFindOrCreate.mockResolvedValue([conv, false]);
    mockTicketFindByPk.mockResolvedValue({ id: 'ticket-1', assigned_to_type: 'ai_staff', assigned_to_id: 'admin-user-1', created_by_id: null, title: 'Case', description: null, status: 'open', ticket_number: 3 });
    mockGenerateTicketSummary.mockResolvedValue({ outcome: 'o', proof: 'p', humanAction: 'h', hasEvidence: false });
    mockGetEvidenceForTicket.mockResolvedValue([]);
    mockGetDecisionsForTicket.mockResolvedValue([]);

    await sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'First', 'ticket-1');
    expect(conv.focused_ticket_id).toBe('ticket-1');
    // Second call: ticketId now equals the already-bound value — no-op per the regression
    // test above, but confirm the end state is stable, not a duplicate write or an error.
    await sendManagerMessage('agent-1', 'manager@colaberry.com', 'org-member-1', 'Second', 'ticket-1');
    expect(conv.focused_ticket_id).toBe('ticket-1');
  });
});
