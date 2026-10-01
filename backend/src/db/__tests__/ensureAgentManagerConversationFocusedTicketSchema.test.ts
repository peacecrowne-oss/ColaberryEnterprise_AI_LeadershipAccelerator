/**
 * Static contract test for ensureAgentManagerConversationFocusedTicketSchema — asserts the
 * SQL statement array is additive/idempotent, WITHOUT requiring a live database (mocked
 * sequelize.query, same convention as ensureAgentManagerConversationIntentSchema.test.ts).
 */
jest.mock('../../config/database', () => ({ sequelize: { query: jest.fn().mockResolvedValue([]) } }));

import { sequelize } from '../../config/database';
import { ensureAgentManagerConversationFocusedTicketSchema } from '../ensureAgentManagerConversationFocusedTicketSchema';

const mockQuery = sequelize.query as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ensureAgentManagerConversationFocusedTicketSchema', () => {
  it('happy path: adds focused_ticket_id as a plain nullable UUID, no default', async () => {
    await ensureAgentManagerConversationFocusedTicketSchema();
    const statements = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(
      statements.some((s) => /ALTER TABLE agent_manager_conversations ADD COLUMN IF NOT EXISTS focused_ticket_id UUID/.test(s)),
    ).toBe(true);
  });

  it('running the ensure function twice does not error (idempotent DDL)', async () => {
    await ensureAgentManagerConversationFocusedTicketSchema();
    await expect(ensureAgentManagerConversationFocusedTicketSchema()).resolves.toBeUndefined();
  });

  it('a statement failure does not throw out of the ensure function (self-heals on next boot)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('already exists'));
    await expect(ensureAgentManagerConversationFocusedTicketSchema()).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
