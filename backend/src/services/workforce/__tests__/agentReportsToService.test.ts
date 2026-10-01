import AiAgent from '../../../models/AiAgent';
import { resolveReportsToChainWithTrail } from '../../ticketCreatorReportsToResolver';
import { buildReportsToView } from '../../reese/agentDetailService';
import { setAgentReportsTo } from '../agentReportsToService';

// Reports-to editor (2026-09-30) — setAgentReportsTo() is the real, deliberate mechanism
// behind the new "change who this agent reports to" admin write. Mirrors
// agentAbacOverrideService.test.ts's exact mocking shape (findByPk + a mutable agent.update
// mock) — no real DB row, real or synthetic, is ever touched by this test.

jest.mock('../../../models/AiAgent', () => ({ findByPk: jest.fn() }));
jest.mock('../../ticketCreatorReportsToResolver', () => ({ resolveReportsToChainWithTrail: jest.fn() }));
jest.mock('../../reese/agentDetailService', () => ({ buildReportsToView: jest.fn() }));

const mockAgentFindByPk = AiAgent.findByPk as unknown as jest.Mock;
const mockResolveChain = resolveReportsToChainWithTrail as unknown as jest.Mock;
const mockBuildReportsToView = buildReportsToView as unknown as jest.Mock;

function makeAgent(overrides: Partial<any> = {}) {
  const agent: any = { id: 'agent-1', agent_name: 'TestAgent', reports_to_type: null, reports_to_id: null, ...overrides };
  agent.update = jest.fn(async (fields: any) => Object.assign(agent, fields));
  return agent;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveChain.mockResolvedValue({ resolvedHumanId: 'human-1', trail: ['TestAgent (agent) -> [human]'] });
  mockBuildReportsToView.mockResolvedValue({ trail: ['TestAgent (agent) -> [human]'], resolved_human: { id: 'human-1', name: 'Ali', email: 'ali@colaberry.com' }, immediate_agent: null });
});

describe('setAgentReportsTo', () => {
  it('happy path (human target): sets reports_to_type/id and the real audit-trail fields in the same update', async () => {
    const agent = makeAgent();
    mockAgentFindByPk.mockResolvedValue(agent);

    const result = await setAgentReportsTo('agent-1', 'human', 'human-1', 'dhee@colaberry.com');

    expect(agent.update).toHaveBeenCalledWith({
      reports_to_type: 'human',
      reports_to_id: 'human-1',
      reports_to_set_at: expect.any(Date),
      reports_to_set_by: 'dhee@colaberry.com',
    });
    expect(result.updated).toBe(true);
    expect(result.setBy).toBe('dhee@colaberry.com');
    expect(result.reportsTo).toEqual(expect.objectContaining({ resolved_human: expect.objectContaining({ id: 'human-1' }) }));
  });

  it('happy path (agent target): dry-runs the candidate through the real resolver before persisting', async () => {
    const agent = makeAgent();
    mockAgentFindByPk.mockResolvedValue(agent);

    await setAgentReportsTo('agent-1', 'agent', 'leadership-agent-1', 'dhee@colaberry.com');

    expect(mockResolveChain).toHaveBeenCalledWith(
      expect.objectContaining({ agent_name: 'TestAgent', reports_to_type: 'agent', reports_to_id: 'leadership-agent-1' }),
    );
    expect(agent.update).toHaveBeenCalledWith(expect.objectContaining({ reports_to_type: 'agent', reports_to_id: 'leadership-agent-1' }));
  });

  it('failure: target agent not found reports found:false and updated:false, never throws', async () => {
    mockAgentFindByPk.mockResolvedValue(null);

    const result = await setAgentReportsTo('does-not-exist', 'human', 'human-1', 'dhee@colaberry.com');

    expect(result).toEqual({
      agentId: 'does-not-exist', agentName: 'does-not-exist', found: false, updated: false,
      reportsTo: null, setAt: null, setBy: null, error: 'Agent not found',
    });
  });

  it('failure: a candidate chain that does not resolve to a real human is rejected BEFORE persisting', async () => {
    const agent = makeAgent();
    mockAgentFindByPk.mockResolvedValue(agent);
    mockResolveChain.mockResolvedValue({ resolvedHumanId: null, trail: ['TestAgent (agent) -> [unset]'] });

    const result = await setAgentReportsTo('agent-1', 'agent', 'orphaned-agent-1', 'dhee@colaberry.com');

    expect(result.updated).toBe(false);
    expect(result.error).toMatch(/does not resolve to a real human/i);
    expect(agent.update).not.toHaveBeenCalled();
  });

  it('boundary: an agent reporting to itself is rejected immediately, never reaches the resolver', async () => {
    const agent = makeAgent();
    mockAgentFindByPk.mockResolvedValue(agent);

    const result = await setAgentReportsTo('agent-1', 'agent', 'agent-1', 'dhee@colaberry.com');

    expect(result.updated).toBe(false);
    expect(result.error).toBe('An agent cannot report to itself');
    expect(mockResolveChain).not.toHaveBeenCalled();
    expect(agent.update).not.toHaveBeenCalled();
  });

  it('idempotency: calling twice with the same valid target succeeds both times, re-stamping set_at/set_by each call', async () => {
    const agent = makeAgent();
    mockAgentFindByPk.mockResolvedValue(agent);

    const first = await setAgentReportsTo('agent-1', 'human', 'human-1', 'dhee@colaberry.com');
    const second = await setAgentReportsTo('agent-1', 'human', 'human-1', 'dhee@colaberry.com');

    expect(first.updated).toBe(true);
    expect(second.updated).toBe(true);
    expect(agent.reports_to_type).toBe('human');
    expect(agent.reports_to_id).toBe('human-1');
  });

  it('failure isolation: a DB update failure is reported on the result, never thrown', async () => {
    const agent = makeAgent();
    agent.update = jest.fn().mockRejectedValue(new Error('DB unavailable'));
    mockAgentFindByPk.mockResolvedValue(agent);

    const result = await setAgentReportsTo('agent-1', 'human', 'human-1', 'dhee@colaberry.com');

    expect(result.updated).toBe(false);
    expect(result.error).toBe('DB unavailable');
  });
});
