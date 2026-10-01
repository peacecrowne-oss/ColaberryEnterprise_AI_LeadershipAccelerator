/**
 * The team-scoped dismissal service: dismiss/restore are idempotent (no duplicate row; the same call twice yields
 * the same end state), a create race is resolved via the unique index, and every read is tenant-scoped. The model
 * is mocked so these tests assert BEHAVIOR (which rows are written, with what fields, under which where-clause), not
 * a database round-trip.
 */
const findOne = jest.fn();
const create = jest.fn();
const findAll = jest.fn();
jest.mock('../../../../models/GovOpportunityDismissal', () => ({
  __esModule: true,
  default: {
    findOne: (...a: any[]) => findOne(...a),
    create: (...a: any[]) => create(...a),
    findAll: (...a: any[]) => findAll(...a),
  },
}));

import { dismissOpportunity, restoreOpportunity, listActiveDismissedKeys, listActiveDismissals } from '../govOpportunityDismissals';

/** A fake Sequelize instance: mutable fields + save()/get(). */
function makeRow(fields: Record<string, any>) {
  const row: any = { ...fields, save: jest.fn().mockResolvedValue(undefined) };
  row.get = (key?: string) => (key ? row[key] : { ...fields, ...row, save: undefined, get: undefined });
  return row;
}

beforeEach(() => jest.clearAllMocks());

describe('dismissOpportunity — idempotent hide for the whole team', () => {
  it('creates a new ACTIVE dismissal when none exists (restored_at null, keyed on the OP uuid)', async () => {
    findOne.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce(makeRow({ id: '1', opportunity_key: 'u1', restored_at: null }));
    await dismissOpportunity({ tenantId: 't1', opportunityKey: 'u1', dismissedBy: 'dhee@colaberry.com', title: 'X', agency: 'A' });
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0];
    expect(arg).toMatchObject({ tenant_id: 't1', opportunity_key: 'u1', dismissed_by: 'dhee@colaberry.com', restored_at: null, title: 'X', agency: 'A' });
  });

  it('re-dismissing an existing row REACTIVATES it in place (no second row created)', async () => {
    const existing = makeRow({ id: '1', opportunity_key: 'u1', restored_at: new Date('2026-01-01') });
    findOne.mockResolvedValueOnce(existing);
    await dismissOpportunity({ tenantId: 't1', opportunityKey: 'u1', dismissedBy: 'dhee@colaberry.com' });
    expect(create).not.toHaveBeenCalled();
    expect(existing.save).toHaveBeenCalledTimes(1);
    expect(existing.restored_at).toBeNull(); // previously restored -> active again
  });

  it('scopes the lookup to tenant + opportunity_key', async () => {
    findOne.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce(makeRow({ id: '1' }));
    await dismissOpportunity({ tenantId: 't9', opportunityKey: 'uK', dismissedBy: 'x' });
    expect(findOne.mock.calls[0][0]).toMatchObject({ where: { tenant_id: 't9', opportunity_key: 'uK' } });
  });

  it('resolves a create RACE via the unique index: on a unique violation it reactivates the row the racer created', async () => {
    const raced = makeRow({ id: '2', opportunity_key: 'u1', restored_at: null });
    findOne.mockResolvedValueOnce(null)       // first look: nothing yet
           .mockResolvedValueOnce(raced);     // after the conflict: the racer's row
    create.mockRejectedValueOnce({ name: 'SequelizeUniqueConstraintError' });
    const out = await dismissOpportunity({ tenantId: 't1', opportunityKey: 'u1', dismissedBy: 'x' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(raced.save).toHaveBeenCalledTimes(1);
    expect(out).toBeTruthy();
  });

  it('rethrows a non-unique error (does not swallow a real failure)', async () => {
    findOne.mockResolvedValueOnce(null);
    create.mockRejectedValueOnce(new Error('connection reset'));
    await expect(dismissOpportunity({ tenantId: 't1', opportunityKey: 'u1', dismissedBy: 'x' })).rejects.toThrow('connection reset');
  });
});

describe('restoreOpportunity — reversible, idempotent', () => {
  it('sets restored_at on an active dismissal', async () => {
    const existing = makeRow({ id: '1', opportunity_key: 'u1', restored_at: null });
    findOne.mockResolvedValueOnce(existing);
    await restoreOpportunity({ tenantId: 't1', opportunityKey: 'u1' });
    expect(existing.save).toHaveBeenCalledTimes(1);
    expect(existing.restored_at).toBeInstanceOf(Date);
  });

  it('is a no-op returning null when there is nothing to restore', async () => {
    findOne.mockResolvedValueOnce(null);
    expect(await restoreOpportunity({ tenantId: 't1', opportunityKey: 'nope' })).toBeNull();
  });

  it('leaves an already-restored row unchanged (idempotent)', async () => {
    const existing = makeRow({ id: '1', opportunity_key: 'u1', restored_at: new Date('2026-01-01') });
    findOne.mockResolvedValueOnce(existing);
    await restoreOpportunity({ tenantId: 't1', opportunityKey: 'u1' });
    expect(existing.save).not.toHaveBeenCalled();
  });
});

describe('listActiveDismissedKeys / listActiveDismissals — tenant-scoped, active only', () => {
  it('returns only active (restored_at IS NULL) keys for the tenant', async () => {
    findAll.mockResolvedValueOnce([
      makeRow({ opportunity_key: 'u1' }), makeRow({ opportunity_key: 'u2' }),
    ]);
    const keys = await listActiveDismissedKeys('t1');
    expect(keys).toEqual(new Set(['u1', 'u2']));
    expect(findAll.mock.calls[0][0]).toMatchObject({ where: { tenant_id: 't1', restored_at: null } });
  });

  it('listActiveDismissals returns plain rows newest-first, tenant-scoped', async () => {
    findAll.mockResolvedValueOnce([makeRow({ opportunity_key: 'u1', title: 'X' })]);
    const rows = await listActiveDismissals('t7');
    expect(rows[0]).toMatchObject({ opportunity_key: 'u1', title: 'X' });
    expect(findAll.mock.calls[0][0]).toMatchObject({ where: { tenant_id: 't7', restored_at: null }, order: [['dismissed_at', 'DESC']] });
  });
});
