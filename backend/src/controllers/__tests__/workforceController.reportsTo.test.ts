/**
 * Controller unit tests for workforceController.ts's new handleSetAgentReportsTo handler
 * (Reports-to editor, 2026-09-30). Mirrors capeGovernanceController.test.ts's mock-res
 * pattern (this repo's established convention for controller-level tests): mock the
 * service dependency, use the real handler + real Zod schema, a minimal Express res double.
 */
jest.mock('../../services/workforce/agentReportsToService', () => ({ setAgentReportsTo: jest.fn() }));

import { setAgentReportsTo } from '../../services/workforce/agentReportsToService';
import { handleSetAgentReportsTo } from '../workforceController';

const mockSetAgentReportsTo = setAgentReportsTo as jest.Mock;

function mockRes() {
  const res: any = { statusCode: 200, jsonBody: undefined };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn((body: any) => { res.jsonBody = body; return res; });
  return res;
}
const mockNext = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handleSetAgentReportsTo', () => {
  it('happy path: valid body calls the service with the admin actor and returns its result', async () => {
    mockSetAgentReportsTo.mockResolvedValue({
      agentId: 'agent-1', agentName: 'Reese', found: true, updated: true,
      reportsTo: { trail: [], resolved_human: null, immediate_agent: null }, setAt: new Date(), setBy: 'dhee@colaberry.com', error: null,
    });
    const req: any = {
      params: { id: 'agent-1' },
      body: { reports_to_type: 'human', reports_to_id: '11111111-1111-4111-8111-111111111111' },
      admin: { email: 'dhee@colaberry.com' },
    };
    const res = mockRes();
    await handleSetAgentReportsTo(req, res, mockNext);

    expect(mockSetAgentReportsTo).toHaveBeenCalledWith('agent-1', 'human', '11111111-1111-4111-8111-111111111111', 'dhee@colaberry.com');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ updated: true }) }));
  });

  it('failure path: a malformed body (invalid type enum) fails Zod validation with 400, never reaches the service', async () => {
    const req: any = {
      params: { id: 'agent-1' },
      body: { reports_to_type: 'robot', reports_to_id: '11111111-1111-4111-8111-111111111111' },
      admin: { email: 'dhee@colaberry.com' },
    };
    const res = mockRes();
    await handleSetAgentReportsTo(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSetAgentReportsTo).not.toHaveBeenCalled();
  });

  it('failure path: a missing reports_to_id fails Zod validation with 400, never reaches the service', async () => {
    const req: any = { params: { id: 'agent-1' }, body: { reports_to_type: 'human' }, admin: { email: 'dhee@colaberry.com' } };
    const res = mockRes();
    await handleSetAgentReportsTo(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSetAgentReportsTo).not.toHaveBeenCalled();
  });

  it('failure path: a logical rejection from the service (e.g. unresolvable chain) surfaces as a real 400, not a silent 200', async () => {
    mockSetAgentReportsTo.mockResolvedValue({
      agentId: 'agent-1', agentName: 'Reese', found: true, updated: false,
      reportsTo: null, setAt: null, setBy: null, error: 'That agent\'s own reports-to chain does not resolve to a real human',
    });
    const req: any = {
      params: { id: 'agent-1' },
      body: { reports_to_type: 'agent', reports_to_id: '22222222-2222-4222-8222-222222222222' },
      admin: { email: 'dhee@colaberry.com' },
    };
    const res = mockRes();
    await handleSetAgentReportsTo(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/does not resolve to a real human/i) }));
  });

  it('falls back to req.admin.sub, then "unknown-admin", when email is absent', async () => {
    mockSetAgentReportsTo.mockResolvedValue({ agentId: 'agent-1', agentName: 'Reese', found: true, updated: true, reportsTo: null, setAt: new Date(), setBy: 'sub-123', error: null });
    const req: any = {
      params: { id: 'agent-1' },
      body: { reports_to_type: 'human', reports_to_id: '11111111-1111-4111-8111-111111111111' },
      admin: { sub: 'sub-123' },
    };
    const res = mockRes();
    await handleSetAgentReportsTo(req, res, mockNext);

    expect(mockSetAgentReportsTo).toHaveBeenCalledWith('agent-1', 'human', '11111111-1111-4111-8111-111111111111', 'sub-123');
  });
});
