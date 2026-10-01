/**
 * channelAccountService — T003's three "done when" guarantees, plus the failure paths.
 *
 * The assertions that matter most are the negative ones: no secret in a list response, no
 * secret in a log line, and no plaintext fallback when the vault is unavailable. A credential
 * store is judged by what it refuses to do.
 */

const mockAccount = { findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn(), create: jest.fn() };
const mockCredential = { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), destroy: jest.fn(), count: jest.fn() };

jest.mock('../../../models', () => ({
  ChannelAccount: mockAccount,
  ConnectorCredential: mockCredential,
}));

import { randomBytes } from 'crypto';
import {
  connectAccount,
  listAccounts,
  getAccessToken,
  revokeAccount,
  rotateCredential,
  credentialsNeedingRewrap,
  selectAccount,
} from '../channelAccountService';
import { MASTER_KEY_ENV } from '../../security/credentialVault';
import { WorkflowError } from '../../content/contentWorkflowService';

// Generated, not a literal: a base64 key in a source file is indistinguishable from a real
// leaked one to a scanner, and the tests depend on nothing about its value.
const KEY = randomBytes(32).toString('base64');
const TOKEN = ['EAA', 'G7ZC8ZBxyz0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('');
const TENANT = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

/** A stand-in row that behaves like a Sequelize instance for the fields this service touches. */
function fakeAccount(over: Record<string, unknown> = {}) {
  const row: any = {
    id: 'acc-1', tenant_id: TENANT, brand_id: BRAND, owner_member_id: null,
    provider: 'meta_facebook_page', provider_account_id: 'page-9', display_name: 'Colaberry',
    handle: null, avatar_url: null, status: 'connected', granted_scopes: [], missing_scopes: [],
    connected_at: new Date('2026-09-12T00:00:00Z'), last_health_check_at: null,
    last_health_ok: null, last_health_error_class: null, revoked_at: null, revoked_by: null,
    metadata: {}, ...over,
  };
  row.update = jest.fn(async (patch: Record<string, unknown>) => { Object.assign(row, patch); return row; });
  return row;
}

const storedCredentials: any[] = [];

beforeEach(() => {
  process.env[MASTER_KEY_ENV] = KEY;
  storedCredentials.length = 0;
  for (const m of [mockAccount, mockCredential]) for (const fn of Object.values(m)) (fn as jest.Mock).mockReset();

  mockAccount.findOne.mockResolvedValue(null);
  // Nothing else is on this network for this brand unless a test says so. `connectAccount`
  // reads this to enforce one account per network per brand.
  mockAccount.findAll.mockResolvedValue([]);
  mockAccount.create.mockImplementation(async (values: any) => fakeAccount(values));
  mockCredential.findOne.mockImplementation(async ({ where }: any) =>
    storedCredentials.find((c) => c.channel_account_id === where.channel_account_id && c.credential_type === where.credential_type) ?? null);
  mockCredential.create.mockImplementation(async (values: any) => {
    const row = { ...values, update: jest.fn(async (p: any) => { Object.assign(row, p); return row; }) };
    storedCredentials.push(row);
    return row;
  });
  mockCredential.findAll.mockImplementation(async () => storedCredentials);
  mockCredential.destroy.mockImplementation(async () => { const n = storedCredentials.length; storedCredentials.length = 0; return n; });
});

const CONNECT = {
  tenantId: TENANT, brandId: BRAND, provider: 'meta_facebook_page', providerAccountId: 'page-9',
  displayName: 'Colaberry', accessToken: TOKEN, grantedScopes: ['pages_manage_posts'],
  missingScopes: ['instagram_basic'], connectedBy: 'admin-1',
};

describe('connect', () => {
  it('seals the token: the stored row contains no readable secret', async () => {
    await connectAccount(CONNECT);
    expect(storedCredentials).toHaveLength(1);
    const row = storedCredentials[0];
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(row.ciphertext).toBeTruthy();
    expect(row.key_id).toMatch(/^[0-9a-f]{16}$/);
    // The account row itself must hold nothing secret at all.
    expect(JSON.stringify(mockAccount.create.mock.calls[0][0])).not.toContain(TOKEN);
  });

  it('returns a view with lifecycle metadata and no secret anywhere in it', async () => {
    // RELATIVE, not a literal date. This read `new Date('2026-10-01T00:00:00Z')` and asserted
    // `expired: false`, which was true when it was written and became false at midnight UTC on
    // 2026-10-01 - failing CI on every open PR at once, for a reason that had nothing to do with
    // any of them. A test that asserts "not expired" has to derive its date from now.
    const notYetExpired = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const view = await connectAccount({ ...CONNECT, tokenExpiresAt: notYetExpired });
    const asText = JSON.stringify(view);
    expect(asText).not.toContain(TOKEN);
    expect(asText).not.toContain('ciphertext');
    expect(asText).not.toContain('wrapped_data_key');
    expect(view.credentials).toEqual([
      expect.objectContaining({ credential_type: 'access_token', expired: false }),
    ]);
    expect(view.missing_scopes).toEqual(['instagram_basic']);
  });

  it('stores a refresh token as its own row, because its lifetime differs', async () => {
    await connectAccount({ ...CONNECT, refreshToken: 'refresh-abcdefghijklmnop' });
    expect(storedCredentials.map((c) => c.credential_type).sort()).toEqual(['access_token', 'refresh_token']);
    expect(JSON.stringify(storedCredentials)).not.toContain('refresh-abcdefghijklmnop');
  });

  it('reconnecting the same provider account updates it rather than creating a duplicate', async () => {
    const existing = fakeAccount();
    mockAccount.findOne.mockResolvedValue(existing);
    await connectAccount(CONNECT);
    expect(mockAccount.create).not.toHaveBeenCalled();
    expect(existing.update).toHaveBeenCalled();
  });

  it('REFUSES to store anything when the vault is unavailable', async () => {
    delete process.env[MASTER_KEY_ENV];
    await expect(connectAccount(CONNECT)).rejects.toMatchObject({ status: 503, errorClass: 'VaultUnavailable' });
    // The whole point: no account row, no credential row, no plaintext anywhere.
    expect(mockAccount.create).not.toHaveBeenCalled();
    expect(storedCredentials).toHaveLength(0);
  });

  it('requires exactly one owner', async () => {
    await expect(connectAccount({ ...CONNECT, brandId: null, ownerMemberId: null }))
      .rejects.toMatchObject({ status: 400, errorClass: 'ValidationError' });
    await expect(connectAccount({ ...CONNECT, ownerMemberId: MEMBER }))
      .rejects.toMatchObject({ status: 400, errorClass: 'ValidationError' });
  });

  it('accepts a person-owned account, which is what student posting needs', async () => {
    const view = await connectAccount({ ...CONNECT, brandId: null, ownerMemberId: MEMBER });
    expect(view.owner_member_id).toBe(MEMBER);
    expect(view.brand_id).toBeNull();
  });

  it('logs the connection without the token in the log line', async () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    await connectAccount(CONNECT);
    const lines = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain('account_connected');
    expect(lines).not.toContain(TOKEN);
    spy.mockRestore();
  });
});

describe('read back', () => {
  it('round-trips the token through getAccessToken', async () => {
    await connectAccount(CONNECT);
    mockAccount.findByPk.mockResolvedValue(fakeAccount());
    await expect(getAccessToken('acc-1')).resolves.toBe(TOKEN);
  });

  it('marks the account needs_reconnect when a row cannot be opened, rather than failing silently', async () => {
    await connectAccount(CONNECT);
    const account = fakeAccount();
    mockAccount.findByPk.mockResolvedValue(account);
    // Simulate a row altered in the database.
    const raw = Buffer.from(storedCredentials[0].ciphertext, 'base64');
    raw[0] ^= 0x01;
    storedCredentials[0].ciphertext = raw.toString('base64');

    await expect(getAccessToken('acc-1')).rejects.toMatchObject({ errorClass: 'CredentialTampered' });
    expect(account.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'needs_reconnect',
      last_health_ok: false,
      last_health_error_class: 'CredentialTampered',
    }));
  });

  it('refuses a revoked account', async () => {
    mockAccount.findByPk.mockResolvedValue(fakeAccount({ status: 'revoked', revoked_at: new Date() }));
    await expect(getAccessToken('acc-1')).rejects.toMatchObject({ status: 409, errorClass: 'AccountRevoked' });
  });

  it('says CredentialMissing rather than returning an empty token', async () => {
    mockAccount.findByPk.mockResolvedValue(fakeAccount());
    await expect(getAccessToken('acc-1')).rejects.toMatchObject({ errorClass: 'CredentialMissing' });
  });

  it('404s an unknown account', async () => {
    mockAccount.findByPk.mockResolvedValue(null);
    await expect(getAccessToken('nope')).rejects.toBeInstanceOf(WorkflowError);
  });
});

describe('list', () => {
  it('never returns a secret column for any account', async () => {
    await connectAccount(CONNECT);
    mockAccount.findAll.mockResolvedValue([fakeAccount()]);

    const views = await listAccounts({ tenantIds: [TENANT] });

    const asText = JSON.stringify(views);
    expect(asText).not.toContain(TOKEN);
    for (const key of ['ciphertext', 'iv', 'auth_tag', 'wrapped_data_key']) {
      expect(asText).not.toContain(key);
    }
    expect(views[0].credentials[0].credential_type).toBe('access_token');
  });

  it('flags an expired token in the view so the operator sees why publishing stopped', async () => {
    await connectAccount({ ...CONNECT, tokenExpiresAt: new Date('2020-01-01T00:00:00Z') });
    mockAccount.findAll.mockResolvedValue([fakeAccount()]);
    const [view] = await listAccounts({ tenantIds: [TENANT] });
    expect(view.credentials[0].expired).toBe(true);
  });


  it('returns nothing for an empty tenant allow-list instead of reading every tenant', async () => {
    // A denied scope must never widen into an unfiltered read.
    await expect(listAccounts({ tenantIds: [] })).resolves.toEqual([]);
    expect(mockAccount.findAll).not.toHaveBeenCalled();
  });

  it('applies no tenant filter only when the caller passes null, the membership ramp case', async () => {
    mockAccount.findAll.mockResolvedValue([]);
    await listAccounts({ tenantIds: null });
    expect(mockAccount.findAll.mock.calls[0][0].where.tenant_id).toBeUndefined();
  });
  it('returns an empty list without querying credentials when there are no accounts', async () => {
    mockAccount.findAll.mockResolvedValue([]);
    await expect(listAccounts({ tenantIds: [TENANT] })).resolves.toEqual([]);
    expect(mockCredential.findAll).not.toHaveBeenCalled();
  });
});

describe('rotate and revoke', () => {
  it('rotation replaces the secret and clears a needs_reconnect state', async () => {
    await connectAccount(CONNECT);
    const account = fakeAccount({ status: 'needs_reconnect' });
    mockAccount.findByPk.mockResolvedValue(account);

    await rotateCredential('acc-1', 'access_token', 'EAAnewtoken0123456789abcdefghij');

    expect(storedCredentials).toHaveLength(1); // replaced, not accumulated
    expect(storedCredentials[0].rotated_at).toBeInstanceOf(Date);
    expect(account.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected' }));
    await expect(getAccessToken('acc-1')).resolves.toBe('EAAnewtoken0123456789abcdefghij');
  });

  it('revoke destroys every secret but keeps the account row for published history', async () => {
    await connectAccount({ ...CONNECT, refreshToken: 'refresh-abcdefghijklmnop' });
    const account = fakeAccount();
    mockAccount.findByPk.mockResolvedValue(account);

    const view = await revokeAccount('acc-1', 'admin-1');

    expect(mockCredential.destroy).toHaveBeenCalledWith({ where: { channel_account_id: 'acc-1' } });
    expect(storedCredentials).toHaveLength(0);
    expect(view.credentials).toEqual([]);
    expect(account.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'revoked', revoked_by: 'admin-1' }));
  });
});

describe('rotation reporting', () => {
  it('counts rows not on the active master key', async () => {
    mockCredential.count.mockResolvedValue(4);
    await expect(credentialsNeedingRewrap(TENANT)).resolves.toBe(4);
    expect(mockCredential.count.mock.calls[0][0].where.tenant_id).toBe(TENANT);
  });

  it('reports zero rather than querying when no key is configured', async () => {
    delete process.env[MASTER_KEY_ENV];
    await expect(credentialsNeedingRewrap()).resolves.toBe(0);
    expect(mockCredential.count).not.toHaveBeenCalled();
  });
});
describe('one account per network, per brand', () => {
  // Loomly states the rule and we adopted it on 2026-09-29: connecting a different account for a
  // network the brand already has REPLACES the old one. Before this, two could sit on one brand
  // and the publisher silently used whichever was connected most recently.
  it('revokes the account it replaces, destroys its credentials, and says what it replaced', async () => {
    const old = fakeAccount({ id: 'acc-old', provider_account_id: 'page-1', display_name: 'Old Page' });
    mockAccount.findAll.mockResolvedValue([old]);

    const view = await connectAccount(CONNECT);

    expect(old.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'revoked', revoked_by: 'admin-1' }));
    expect((old.update as jest.Mock).mock.calls[0][0].revoked_at).toBeInstanceOf(Date);
    expect(mockCredential.destroy).toHaveBeenCalledWith({ where: { channel_account_id: 'acc-old' } });
    expect(view.replaced).toEqual([{ id: 'acc-old', display_name: 'Old Page' }]);
  });

  it('looks only at the same brand and the same network, and never at the account being connected', async () => {
    await connectAccount(CONNECT);
    const where = mockAccount.findAll.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenant_id: TENANT, brand_id: BRAND, provider: 'meta_facebook_page' });
    // The row just written must not revoke itself.
    expect(Object.getOwnPropertySymbols(where.id).length).toBeGreaterThan(0);
  });

  it('a member-owned account is scoped to the member, not to a brand', async () => {
    await connectAccount({ ...CONNECT, brandId: null, ownerMemberId: MEMBER });
    expect(mockAccount.findAll.mock.calls[0][0].where).toMatchObject({ owner_member_id: MEMBER });
  });

  it('reconnecting the SAME account replaces nothing and says so', async () => {
    // The existing row is found by (tenant, provider, provider_account_id) and updated in place;
    // there is nothing to supersede, so no `replaced` key at all.
    mockAccount.findOne.mockResolvedValue(fakeAccount());
    const view = await connectAccount(CONNECT);
    expect(view.replaced).toBeUndefined();
  });

  it('replaces only AFTER the new credential is sealed', async () => {
    // A failure to seal must leave the brand with the connection it already had, not with none.
    const old = fakeAccount({ id: 'acc-old', provider_account_id: 'page-1' });
    mockAccount.findAll.mockResolvedValue([old]);
    mockCredential.create.mockRejectedValueOnce(new Error('vault down'));

    await expect(connectAccount(CONNECT)).rejects.toThrow();
    expect(old.update).not.toHaveBeenCalled();
    expect(mockCredential.destroy).not.toHaveBeenCalled();
  });
});


describe('several destinations from one sign-in', () => {
  /**
   * The bug this closes. The OAuth callback connects each discovered destination in turn, and the
   * one-per-network rule ran on every one of them - so connecting three LinkedIn Pages meant page
   * 2 revoking page 1 and page 3 revoking page 2, with their credentials destroyed, while the
   * redirect still reported "3 accounts added". The last one discovered won, silently.
   */

  it('lands as needs_selection and revokes nothing', async () => {
    const other = fakeAccount({ id: 'acc-other', provider_account_id: 'page-1', display_name: 'Other Page' });
    mockAccount.findAll.mockResolvedValue([other]);

    const view = await connectAccount({ ...CONNECT, awaitingSelection: true });

    expect(view.status).toBe('needs_selection');
    expect(view.replaced).toBeUndefined();
    expect(other.update).not.toHaveBeenCalled();
    expect(mockCredential.destroy).not.toHaveBeenCalled();
  });

  it('still seals its token, so choosing it later needs no second sign-in', async () => {
    await connectAccount({ ...CONNECT, awaitingSelection: true });
    expect(storedCredentials).toHaveLength(1);
    expect(JSON.stringify(storedCredentials[0])).not.toContain(TOKEN);
  });

  it('an account that is ALREADY the live connection stays connected rather than being demoted', async () => {
    // Re-running a Meta sign-in and ticking the same Page again must not turn a working
    // connection into "please choose".
    mockAccount.findOne.mockResolvedValue(fakeAccount({ status: 'connected' }));
    const view = await connectAccount({ ...CONNECT, awaitingSelection: true });
    expect(view.status).toBe('connected');
  });

  it('and that member of the batch still supersedes nothing, whatever order it arrived in', async () => {
    // The order a provider lists destinations in must not decide the outcome. If the connected
    // one superseded, arriving last would revoke the siblings created moments earlier - the same
    // destruction, one step later.
    const sibling = fakeAccount({ id: 'acc-sib', provider_account_id: 'page-2' });
    mockAccount.findOne.mockResolvedValue(fakeAccount({ status: 'connected' }));
    mockAccount.findAll.mockResolvedValue([sibling]);

    await connectAccount({ ...CONNECT, awaitingSelection: true });

    expect(sibling.update).not.toHaveBeenCalled();
    expect(mockCredential.destroy).not.toHaveBeenCalled();
  });

  it('a single discovered destination is unaffected and connects normally', async () => {
    const view = await connectAccount(CONNECT);
    expect(view.status).toBe('connected');
  });
});

describe('choosing which destination the brand posts as', () => {
  it('promotes the chosen account and revokes the others, naming them', async () => {
    const chosen = fakeAccount({ id: 'acc-chosen', status: 'needs_selection' });
    const loser = fakeAccount({ id: 'acc-loser', provider_account_id: 'page-2', display_name: 'Second Page' });
    mockAccount.findOne.mockResolvedValue(chosen);
    mockAccount.findAll.mockResolvedValue([loser]);

    const view = await selectAccount({ tenantId: TENANT, accountId: 'acc-chosen', selectedBy: 'admin-1' });

    expect(chosen.update).toHaveBeenCalledWith({ status: 'connected' });
    expect(view.replaced).toEqual([{ id: 'acc-loser', display_name: 'Second Page' }]);
    expect(loser.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'revoked', revoked_by: 'admin-1' }));
    // A revoked account must not leave a usable token behind it.
    expect(mockCredential.destroy).toHaveBeenCalledWith({ where: { channel_account_id: 'acc-loser' } });
  });

  it('scopes the query by tenant, so a wrong tenant reads as a wrong id', async () => {
    mockAccount.findOne.mockResolvedValue(null);
    await expect(selectAccount({ tenantId: TENANT, accountId: 'acc-x' })).rejects.toThrow(WorkflowError);
    expect(mockAccount.findOne.mock.calls[0][0].where).toEqual({ id: 'acc-x', tenant_id: TENANT });
  });

  it('refuses an account that was already disconnected, rather than resurrecting one with no token', async () => {
    mockAccount.findOne.mockResolvedValue(fakeAccount({ status: 'revoked', revoked_at: new Date() }));
    await expect(selectAccount({ tenantId: TENANT, accountId: 'acc-1' })).rejects.toThrow(/disconnected/i);
  });

  it('is idempotent: selecting the one already connected re-applies the rule and changes nothing else', async () => {
    const already = fakeAccount({ id: 'acc-1', status: 'connected' });
    mockAccount.findOne.mockResolvedValue(already);
    mockAccount.findAll.mockResolvedValue([]);

    const view = await selectAccount({ tenantId: TENANT, accountId: 'acc-1' });

    expect(already.update).not.toHaveBeenCalled();
    expect(view.replaced).toBeUndefined();
  });
});
