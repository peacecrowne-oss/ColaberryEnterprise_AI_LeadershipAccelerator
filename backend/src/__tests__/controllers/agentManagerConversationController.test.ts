import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { getConversationHistory, sendManagerMessage, AgentNotFoundError, TicketNotAccessibleError } from '../../services/agentManagerConversationService';
import agentManagerConversationRoutes from '../../routes/admin/agentManagerConversationRoutes';

// Reese Agentic AI Employee mission, Checkpoint B — requireActual() below still
// executes agentManagerConversationService.ts's real top-level imports, including
// managerReliabilityIntentService.ts, which transitively imports ticketService.ts,
// which imports { Ticket, TicketActivity } from the models barrel — loading the
// full association graph and crashing this file's own partial model mocks (the
// exact same class of failure agentManagerConversationService.test.ts's own fix
// addresses, and agentRecentActivitySummary.ts's fix addressed earlier the same
// session). Mocked wholesale since this controller test only exercises the two
// overridden functions below, never the reliability-intent logic itself.
jest.mock('../../services/managerReliabilityIntentService', () => ({
  detectReliabilityIntent: jest.fn(() => null),
  detectConfirmationReply: jest.fn(() => 'ambiguous'),
  buildConfirmationCardText: jest.fn(() => ''),
  toPendingConfirmation: jest.fn(),
  applyConfirmedReliabilityChange: jest.fn(),
}));

// Capability 8 — the same requireActual() above also now executes
// agentManagerConversationService.ts's new managerGoalIntentService.ts
// import, which transitively imports agentGoalService.ts ->
// trustMetricsService.ts -> agentPermissionService.ts -> the full models
// barrel, crashing this file's own partial model mocks the exact same way
// the reliability mock above already guards against. Mocked wholesale for
// the same reason.
jest.mock('../../services/managerGoalIntentService', () => ({
  detectChangeGoalIntent: jest.fn(() => null),
  buildGoalConfirmationCardText: jest.fn(() => ''),
  toPendingGoalConfirmation: jest.fn(),
  applyConfirmedGoalChange: jest.fn(),
}));

// Capability 8's second generic-column intent (SCHEDULE_ONE_ON_ONE) — mocked
// wholesale for consistency with the goal-intent mock above, even though
// managerOneOnOneIntentService.ts's own import chain (agentOneOnOneService.ts
// -> AiAgent/AgentOneOnOne model files directly) does not touch the models
// barrel the way agentGoalService.ts's chain does.
jest.mock('../../services/managerOneOnOneIntentService', () => ({
  detectScheduleOneOnOneIntent: jest.fn(() => null),
  buildOneOnOneConfirmationCardText: jest.fn(() => ''),
  toPendingOneOnOneConfirmation: jest.fn(),
  applyConfirmedOneOnOneSchedule: jest.fn(),
}));

// Capability 8's third generic-column intent (INSTRUCT) — mocked wholesale
// for consistency with the other two intent mocks above.
jest.mock('../../services/managerDirectiveIntentService', () => ({
  detectInstructIntent: jest.fn(() => null),
  buildDirectiveConfirmationCardText: jest.fn(() => ''),
  toPendingDirectiveConfirmation: jest.fn(),
  applyConfirmedDirective: jest.fn(),
}));
jest.mock('../../services/managerAssignWorkIntentService', () => ({
  detectAssignWorkIntent: jest.fn(() => null),
  buildAssignWorkConfirmationCardText: jest.fn(() => ''),
  toPendingAssignWorkConfirmation: jest.fn(),
  applyConfirmedAssignWork: jest.fn(),
}));
jest.mock('../../services/managerApprovalDecisionIntentService', () => ({
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

// Phase 2 case-aware manager chat — the same requireActual() above now also
// executes agentManagerConversationService.ts's new summaryGeneratorService.ts
// import, which imports { Ticket, TicketActionLink, WorkLedgerEvent } from the
// models barrel — the exact same association-graph crash the mocks above
// already guard against. Mocked wholesale for the same reason; this
// controller test never exercises real ticket-summary/evidence/decision
// retrieval (getConversationHistory/sendManagerMessage are overridden below).
jest.mock('../../services/workLedger/summaryGeneratorService', () => ({
  generateTicketSummary: jest.fn(),
}));
jest.mock('../../services/evidence/evidenceService', () => ({
  getEvidenceForTicket: jest.fn(),
}));
jest.mock('../../services/evidence/decisionRecordService', () => ({
  getDecisionsForTicket: jest.fn(),
}));

jest.mock('../../services/agentManagerConversationService', () => {
  const actual = jest.requireActual('../../services/agentManagerConversationService');
  return { ...actual, getConversationHistory: jest.fn(), sendManagerMessage: jest.fn() };
});

const mockOrgMemberFindOne = jest.fn();
jest.mock('../../models/OrgMember', () => ({
  __esModule: true,
  default: { findOne: (...a: any[]) => mockOrgMemberFindOne(...a) },
}));

const mockIsAgentInHumanDownstream = jest.fn();
jest.mock('../../services/workforce/orgChartHierarchyService', () => ({
  isAgentInHumanDownstream: (...a: any[]) => mockIsAgentInHumanDownstream(...a),
}));

const mockGetConversationHistory = getConversationHistory as unknown as jest.Mock;
const mockSendManagerMessage = sendManagerMessage as unknown as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(agentManagerConversationRoutes);
  return app;
}

function superAdminToken() {
  return jwt.sign({ sub: 'admin-1', email: 'ali@colaberry.com', role: 'super_admin' }, env.jwtSecret);
}

function managerToken(email = 'manager@colaberry.com') {
  return jwt.sign({ sub: 'admin-2', email, role: 'admin' }, env.jwtSecret);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/admin/agents/:id/conversation', () => {
  it('happy path: 200s with the real conversation history', async () => {
    mockGetConversationHistory.mockResolvedValue({ conversationId: 'conv-1', agentId: 'agent-1', messages: [] });

    const res = await request(buildApp()).get('/api/admin/agents/agent-1/conversation').set('Authorization', `Bearer ${superAdminToken()}`);

    expect(res.status).toBe(200);
    expect(mockGetConversationHistory).toHaveBeenCalledWith('agent-1', 'ali@colaberry.com');
  });

  it('boundary: a nonexistent agent 404s', async () => {
    mockGetConversationHistory.mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/admin/agents/does-not-exist/conversation').set('Authorization', `Bearer ${superAdminToken()}`);

    expect(res.status).toBe(404);
  });

  it('auth: an admin outside this agent\'s reporting chain is 403d and the service is never called', async () => {
    mockOrgMemberFindOne.mockResolvedValue({ id: 'org-member-1' });
    mockIsAgentInHumanDownstream.mockResolvedValue(false);

    const res = await request(buildApp()).get('/api/admin/agents/agent-1/conversation').set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(403);
    expect(mockGetConversationHistory).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/agents/:id/conversation/messages', () => {
  it('happy path: a manager in this agent\'s chain can send a message and gets the real reply back', async () => {
    mockOrgMemberFindOne.mockResolvedValue({ id: 'org-member-1' });
    mockIsAgentInHumanDownstream.mockResolvedValue(true);
    mockSendManagerMessage.mockResolvedValue({ conversationId: 'conv-1', agentId: 'agent-1', messages: [{ role: 'agent', content: 'reply' }] });

    const res = await request(buildApp())
      .post('/api/admin/agents/agent-1/conversation/messages')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ message: 'How are you doing?' });

    expect(res.status).toBe(201);
    expect(mockSendManagerMessage).toHaveBeenCalledWith('agent-1', 'manager@colaberry.com', 'org-member-1', 'How are you doing?', null);
  });

  it('happy path: a real ticket id in the request body is forwarded to the service as the 5th arg', async () => {
    mockOrgMemberFindOne.mockResolvedValue({ id: 'org-member-1' });
    mockIsAgentInHumanDownstream.mockResolvedValue(true);
    mockSendManagerMessage.mockResolvedValue({ conversationId: 'conv-1', agentId: 'agent-1', messages: [{ role: 'agent', content: 'reply' }] });

    const res = await request(buildApp())
      .post('/api/admin/agents/agent-1/conversation/messages')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ message: 'What is the status of this case?', ticket_id: '11111111-1111-4111-8111-111111111111' });

    expect(res.status).toBe(201);
    expect(mockSendManagerMessage).toHaveBeenCalledWith(
      'agent-1',
      'manager@colaberry.com',
      'org-member-1',
      'What is the status of this case?',
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('boundary: a ticket the manager does not own 404s honestly without leaking existence (TicketNotAccessibleError)', async () => {
    mockOrgMemberFindOne.mockResolvedValue({ id: 'org-member-1' });
    mockIsAgentInHumanDownstream.mockResolvedValue(true);
    mockSendManagerMessage.mockRejectedValue(new TicketNotAccessibleError());

    const res = await request(buildApp())
      .post('/api/admin/agents/agent-1/conversation/messages')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ message: 'What about ticket X?', ticket_id: '22222222-2222-4222-8222-222222222222' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('That case was not found.');
  });

  it('BREAK: an admin outside the chain is 403d and never reaches the service (never triggers a real LLM call)', async () => {
    mockOrgMemberFindOne.mockResolvedValue({ id: 'org-member-1' });
    mockIsAgentInHumanDownstream.mockResolvedValue(false);

    const res = await request(buildApp())
      .post('/api/admin/agents/agent-1/conversation/messages')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ message: 'hi' });

    expect(res.status).toBe(403);
    expect(mockSendManagerMessage).not.toHaveBeenCalled();
  });

  it('BREAK: empty message 400s before the service (and the LLM) is ever called', async () => {
    const res = await request(buildApp())
      .post('/api/admin/agents/agent-1/conversation/messages')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .send({ message: '' });

    expect(res.status).toBe(400);
    expect(mockSendManagerMessage).not.toHaveBeenCalled();
  });

  it('BREAK: an oversized message (>4000 chars) 400s', async () => {
    const res = await request(buildApp())
      .post('/api/admin/agents/agent-1/conversation/messages')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .send({ message: 'x'.repeat(4001) });

    expect(res.status).toBe(400);
    expect(mockSendManagerMessage).not.toHaveBeenCalled();
  });

  it('boundary: a nonexistent agent 404s (service throws AgentNotFoundError)', async () => {
    mockSendManagerMessage.mockRejectedValue(new AgentNotFoundError('does-not-exist'));

    const res = await request(buildApp())
      .post('/api/admin/agents/does-not-exist/conversation/messages')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .send({ message: 'hi' });

    expect(res.status).toBe(404);
  });

  it('failure: an unexpected error (e.g. the LLM call itself failing) 500s without leaking the raw message', async () => {
    mockSendManagerMessage.mockRejectedValue(new Error('OpenAI API error: rate limited'));

    const res = await request(buildApp())
      .post('/api/admin/agents/agent-1/conversation/messages')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .send({ message: 'hi' });

    expect(res.status).toBe(500);
    expect(res.body.error).not.toMatch(/rate limited/);
  });
});
