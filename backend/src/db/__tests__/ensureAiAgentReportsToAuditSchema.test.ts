/**
 * Static contract test for ensureAiAgentReportsToAuditSchema — asserts the SQL
 * statement array is additive/idempotent, WITHOUT requiring a live database
 * (mocked sequelize.query, same convention as ensureAiAgentAbacOverrideSchema.test.ts).
 */
jest.mock('../../config/database', () => ({ sequelize: { query: jest.fn().mockResolvedValue([]) } }));

import { sequelize } from '../../config/database';
import { ensureAiAgentReportsToAuditSchema } from '../ensureAiAgentReportsToAuditSchema';

const mockQuery = sequelize.query as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ensureAiAgentReportsToAuditSchema', () => {
  it('happy path: adds reports_to_set_at as a plain nullable TIMESTAMP', async () => {
    await ensureAiAgentReportsToAuditSchema();
    const statements = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(
      statements.some((s) => /ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS reports_to_set_at TIMESTAMP/.test(s)),
    ).toBe(true);
  });

  it('happy path: adds reports_to_set_by as a plain nullable VARCHAR(255) — the real audit-trail field', async () => {
    await ensureAiAgentReportsToAuditSchema();
    const statements = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(
      statements.some((s) => /ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS reports_to_set_by VARCHAR\(255\)/.test(s)),
    ).toBe(true);
  });

  it('running the ensure function twice does not error (idempotent DDL)', async () => {
    await ensureAiAgentReportsToAuditSchema();
    await expect(ensureAiAgentReportsToAuditSchema()).resolves.toBeUndefined();
  });

  it('a statement failure does not throw out of the ensure function (self-heals on next boot), and later statements still run', async () => {
    mockQuery.mockRejectedValueOnce(new Error('already exists'));
    await expect(ensureAiAgentReportsToAuditSchema()).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(2); // both statements attempted despite the first failing
  });
});
