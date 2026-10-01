const mockAccount = { findAll: jest.fn() };

jest.mock('../../../models', () => ({ ChannelAccount: mockAccount }));

import { resolveAccountFor } from '../channelAccountResolver';

/**
 * Which account a post actually publishes from.
 *
 * This is the last gate before a token is used, so the guarantee that matters is a NEGATIVE one:
 * an account the operator has not chosen must never carry a post. One sign-in can discover
 * several destinations on a network - three LinkedIn Pages, four Facebook Pages - and those land
 * as `needs_selection` holding live tokens. A resolver that looked only at "is it revoked?" would
 * happily publish from whichever of them sorted first, which is the confusion this whole rule
 * exists to remove.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';

function row(id: string, connectedAt: string) {
  return { id, tenant_id: TENANT, brand_id: BRAND, provider: 'meta_facebook_page', connected_at: new Date(connectedAt) };
}

beforeEach(() => {
  mockAccount.findAll.mockReset();
  mockAccount.findAll.mockResolvedValue([]);
});

describe('what the resolver will even consider', () => {
  it('asks only for CONNECTED, non-revoked accounts on this brand and network', async () => {
    await resolveAccountFor(TENANT, BRAND, 'meta_facebook_page');
    const { where, order } = mockAccount.findAll.mock.calls[0][0];

    expect(where).toMatchObject({
      tenant_id: TENANT,
      brand_id: BRAND,
      provider: 'meta_facebook_page',
      // The load-bearing one: `needs_selection` holds a live token and must never be picked.
      status: 'connected',
    });
    // Revocation is checked in the query rather than after it, so a revoked row is never a
    // candidate that something later has to remember to drop.
    expect(Object.getOwnPropertySymbols(where.revoked_at).length).toBeGreaterThan(0);
    expect(order).toEqual([['connected_at', 'DESC']]);
  });

  it('a brand-less item resolves to nothing without asking the database at all', async () => {
    expect(await resolveAccountFor(TENANT, null, 'meta_facebook_page')).toBeNull();
    expect(mockAccount.findAll).not.toHaveBeenCalled();
  });
});

describe('what it returns', () => {
  it('the single connected account', async () => {
    mockAccount.findAll.mockResolvedValue([row('acc-1', '2026-09-20T00:00:00Z')]);
    expect((await resolveAccountFor(TENANT, BRAND, 'meta_facebook_page'))?.id).toBe('acc-1');
  });

  it('nothing at all when the brand has no connected account on that network', async () => {
    // Distinct from throwing: the caller decides whether that is a handoff or an error.
    expect(await resolveAccountFor(TENANT, BRAND, 'meta_facebook_page')).toBeNull();
  });

  it('takes the newest when rows predating the one-per-network rule leave two, and SAYS so', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockAccount.findAll.mockResolvedValue([
      row('acc-new', '2026-09-25T00:00:00Z'),
      row('acc-old', '2026-09-01T00:00:00Z'),
    ]);

    expect((await resolveAccountFor(TENANT, BRAND, 'meta_facebook_page'))?.id).toBe('acc-new');
    // A silent pick is what made publishing from the wrong account invisible in the first place.
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).toContain('account_resolution_ambiguous');
    warn.mockRestore();
  });
});
