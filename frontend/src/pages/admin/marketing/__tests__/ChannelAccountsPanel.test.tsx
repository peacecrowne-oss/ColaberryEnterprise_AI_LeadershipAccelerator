import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import ChannelAccountsPanel from '../ChannelAccountsPanel';
import type { ChannelAccount, ConnectorStatus, VaultStatus } from '../../../../services/channelAccountApi';

/**
 * ChannelAccountsPanel — the honest-empty-state rule.
 *
 * "No accounts connected" has three causes with three different owners, and the panel's job is
 * to say which one you are looking at. A surface that rendered all three identically would be
 * the "0 that is really unavailable" failure this workstream exists to stop, one layer up.
 */

let container: HTMLDivElement;
let root: Root;

const VAULT_OK: VaultStatus = { vault_available: true, active_key_id: 'a9f2c913df59c9d1', credentials_needing_rewrap: 0, reason: null };
const VAULT_OFF: VaultStatus = {
  vault_available: false, active_key_id: null, credentials_needing_rewrap: 0,
  reason: 'The credential store is not configured on this server (SOCIAL_CREDENTIAL_MASTER_KEY). Publishing stays in handoff mode.',
};

function account(over: Partial<ChannelAccount> = {}): ChannelAccount {
  return {
    id: 'acc-1', tenant_id: 't-1', brand_id: 'b-1', owner_member_id: null,
    provider: 'linkedin_organization', provider_account_id: '98765', display_name: 'Colaberry',
    handle: '@colaberry', avatar_url: null, status: 'connected',
    granted_scopes: ['w_organization_social'], missing_scopes: [],
    connected_at: '2026-09-13T12:00:00.000Z', last_health_check_at: null, last_health_ok: null,
    last_health_error_class: null, revoked_at: null,
    credentials: [{ credential_type: 'access_token', token_expires_at: '2026-12-01T00:00:00.000Z', rotated_at: null, key_id: 'a9f2c913df59c9d1', expired: false }],
    ...over,
  };
}

const CONNECTORS: ConnectorStatus[] = [
  { key: 'linkedin', label: 'LinkedIn (personal profile)', providers: ['linkedin_member'], configured: true, missing_env: [], redirect_uri: 'https://www.refactored.ai/api/marketing/linkedin/callback', requirements: 'Live. Tokens last 60 days and must be reconnected before they lapse.' },
  { key: 'meta', label: 'Facebook & Instagram', providers: ['meta_facebook_page', 'meta_instagram'], configured: true, missing_env: [], redirect_uri: 'https://www.refactored.ai/api/marketing/oauth/meta/callback', requirements: 'Needs a Meta developer app; until Advanced Access, only app-role users can connect.' },
  { key: 'tiktok', label: 'TikTok', providers: ['tiktok'], configured: false, missing_env: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'], redirect_uri: 'https://www.refactored.ai/api/marketing/oauth/tiktok/callback', requirements: 'Until TikTok audits the app, everything it posts is private.' },
];

function render(props: Partial<React.ComponentProps<typeof ChannelAccountsPanel>> = {}) {
  act(() => {
    root.render(
      <ChannelAccountsPanel
        loading={false} error={null} vault={VAULT_OK} accounts={[]} brandId="b-1" busy={false}
        connectors={CONNECTORS}
        onConnect={() => {}} onRevoke={() => {}} onRetry={() => {}}
        {...props}
      />,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

describe('the three causes of an empty list are distinguishable', () => {
  it('CANNOT connect: says why, and the button is disabled rather than absent or failing', () => {
    render({ vault: VAULT_OFF });
    const banner = container.querySelector('[data-testid="vault-unavailable"]')!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toMatch(/SOCIAL_CREDENTIAL_MASTER_KEY/);
    // The operator is told what the product does instead, not left to infer it is broken.
    expect(banner.textContent).toMatch(/handoff mode/);
    const button = container.querySelector('[data-testid="connect-linkedin"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(container.querySelector('[data-testid="no-accounts"]')!.textContent)
      .toMatch(/none can be until the credential store is configured/);
  });

  it('CAN connect, nothing connected yet: the button is real', () => {
    render();
    expect(container.querySelector('[data-testid="vault-unavailable"]')).toBeNull();
    const button = container.querySelector('[data-testid="connect-linkedin"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(container.querySelector('[data-testid="no-accounts"]')!.textContent)
      .toMatch(/No accounts are connected for this brand yet/);
  });

  it('connected but unreadable: shown as needing reconnection, never hidden or counted as fine', () => {
    render({ accounts: [account({ status: 'needs_reconnect', last_health_error_class: 'CredentialTampered' })] });
    const row = container.querySelector('[data-testid="account-acc-1"]')!;
    expect(row.textContent).toMatch(/Needs reconnecting/);
    expect(row.textContent).toMatch(/CredentialTampered/);
  });
});

describe('status an operator can act on', () => {
  it('flags an expired token as the reason publishing will fail', () => {
    render({ accounts: [account({ credentials: [{ credential_type: 'access_token', token_expires_at: '2020-01-01T00:00:00.000Z', rotated_at: null, key_id: 'k', expired: true }] })] });
    const row = container.querySelector('[data-testid="account-acc-1"]')!;
    expect(row.textContent).toMatch(/Token expired/);
    expect(row.textContent).toMatch(/Expired/);
  });

  it('says "No token stored" rather than implying an account is ready', () => {
    render({ accounts: [account({ credentials: [] })] });
    expect(container.querySelector('[data-testid="account-acc-1"]')!.textContent).toMatch(/No token stored/);
  });

  it('names missing permissions instead of hiding them until publish time', () => {
    render({ accounts: [account({ missing_scopes: ['r_organization_social'] })] });
    expect(container.querySelector('[data-testid="missing-scopes-acc-1"]')!.textContent)
      .toMatch(/Missing: r_organization_social/);
  });

  it('a healthy account reads as connected with its expiry', () => {
    render({ accounts: [account()] });
    const row = container.querySelector('[data-testid="account-acc-1"]')!;
    expect(row.textContent).toMatch(/Connected/);
    expect(row.textContent).toMatch(/Expires/);
    expect(row.textContent).toMatch(/LinkedIn Page/);
  });

  it('a disconnected account keeps its row but offers no disconnect', () => {
    // The row survives because published history points at it; what does not survive is the token.
    render({ accounts: [account({ status: 'revoked', revoked_at: '2026-09-13T12:00:00.000Z', credentials: [] })] });
    expect(container.querySelector('[data-testid="account-acc-1"]')!.textContent).toMatch(/Disconnected/);
    expect(container.querySelector('[data-testid="revoke-acc-1"]')).toBeNull();
  });
});

describe('rotation and interaction', () => {
  it('surfaces credentials still on an old master key, so a rotation is not left half-done', () => {
    render({ vault: { ...VAULT_OK, credentials_needing_rewrap: 3 } });
    expect(container.querySelector('[data-testid="rewrap-pending"]')!.textContent).toMatch(/3 stored credentials/);
  });

  it('passes the account id to disconnect, and disables while busy', () => {
    const onRevoke = jest.fn();
    render({ accounts: [account()], onRevoke });
    act(() => { (container.querySelector('[data-testid="revoke-acc-1"]') as HTMLButtonElement).click(); });
    expect(onRevoke).toHaveBeenCalledWith('acc-1');

    render({ accounts: [account()], onRevoke, busy: true });
    expect((container.querySelector('[data-testid="revoke-acc-1"]') as HTMLButtonElement).disabled).toBe(true);
  });


  it('a THIRD reason - one network is not set up yet - is told per network, with what it needs', () => {
    // Different owner, different fix from a missing vault: the platform app does not exist yet.
    // The row says so, offers no Connect button that would only fail, and names the exact
    // variables and redirect URL - names, never values.
    render();
    expect(container.querySelector('[data-testid="vault-unavailable"]')).toBeNull();
    const row = container.querySelector('[data-testid="connector-row-tiktok"]')!;
    expect(row.textContent).toMatch(/Not set up yet/);
    expect(container.querySelector('[data-testid="connect-tiktok"]')).toBeNull();
    const setup = container.querySelector('[data-testid="connector-setup-tiktok"]')!;
    expect(setup.textContent).toContain('TIKTOK_CLIENT_KEY');
    expect(setup.textContent).toContain('https://www.refactored.ai/api/marketing/oauth/tiktok/callback');
    expect(setup.textContent).toMatch(/private/);
  });

  it('lists every network the server reports, and Connect names which one', () => {
    const onConnect = jest.fn();
    render({ onConnect });
    expect(Array.from(container.querySelectorAll('[data-testid^="connector-row-"]')).map((r) => r.getAttribute('data-testid')))
      .toEqual(['connector-row-linkedin', 'connector-row-meta', 'connector-row-tiktok']);
    act(() => { (container.querySelector('[data-testid="connect-meta"]') as HTMLButtonElement).click(); });
    expect(onConnect).toHaveBeenCalledWith('meta');
  });

  it('tells the operator to pick a brand rather than silently disabling connect', () => {
    render({ brandId: null });
    expect((container.querySelector('[data-testid="connect-linkedin"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toMatch(/Choose a brand first/);
  });

  it('says so when the list of networks could not be loaded, rather than showing none', () => {
    render({ connectors: null, connectorsError: 'The list of networks could not be loaded.' });
    expect(container.querySelector('[data-testid="connectors-error"]')!.textContent).toMatch(/could not be loaded/);
  });

  it('trusts the server verdict: an X account past its 2-hour access token is still Connected', () => {
    render({
      accounts: [account({
        provider: 'x', health: 'ok', usable_until: null,
        credentials: [
          { credential_type: 'access_token', token_expires_at: '2026-09-18T12:00:00.000Z', rotated_at: null, key_id: 'k', expired: true },
          { credential_type: 'refresh_token', token_expires_at: null, rotated_at: null, key_id: 'k', expired: false },
        ],
      })],
    });
    expect(container.textContent).toMatch(/Connected/);
    expect(container.textContent).not.toMatch(/Token expired/);
    expect(container.textContent).toMatch(/No expiry/);
  });

  it('an expiring account says so before it stops, not after', () => {
    render({ accounts: [account({ health: 'expiring', usable_until: '2026-11-16T01:50:34.000Z' })] });
    expect(container.textContent).toMatch(/Expiring soon/);
    expect(container.textContent).toMatch(/Until Nov 15, 2026/);
  });

  it('offers a retry on error instead of an empty panel', () => {
    const onRetry = jest.fn();
    render({ error: 'Could not load accounts.', onRetry });
    expect(container.textContent).toMatch(/Could not load accounts/);
    act(() => { (container.querySelector('button') as HTMLButtonElement).click(); });
    expect(onRetry).toHaveBeenCalled();
  });
});
describe('one account per network, per brand', () => {
  // Adopted from Loomly on 2026-09-29: connecting a different account for a network the brand
  // already has REPLACES the old one. Being told afterwards would feel like a bug, so the row
  // says so before the click.
  it('warns which account connecting will replace', () => {
    render({ accounts: [account({ provider: 'linkedin_member', display_name: 'Ali Muwwakkil' })] });
    const warning = container.querySelector('[data-testid="connect-replaces-linkedin"]');
    expect(warning!.textContent).toBe('Connecting replaces Ali Muwwakkil');
  });

  it('says nothing for a network with nothing on it yet', () => {
    render({ accounts: [account({ provider: 'linkedin_member' })] });
    expect(container.querySelector('[data-testid="connect-replaces-meta"]')).toBeNull();
  });

  it('a revoked account is not something you are replacing', () => {
    render({ accounts: [account({ provider: 'linkedin_member', status: 'revoked', revoked_at: '2026-09-01T00:00:00.000Z' })] });
    expect(container.querySelector('[data-testid="connect-replaces-linkedin"]')).toBeNull();
  });
});


describe('choosing between destinations one sign-in found', () => {
  /**
   * A brand posts as ONE account per network. A Meta login can hand back four Pages and a
   * LinkedIn admin of three company Pages gets all three, so somebody has to say which. Before
   * this, each was connected in turn and each revoked the one before it - the last discovered
   * won, silently, while the banner reported all of them as added.
   */

  const waiting = [
    account({ id: 'acc-a', display_name: 'Colaberry Training', status: 'needs_selection', health: 'unselected' }),
    account({ id: 'acc-b', display_name: 'Colaberry Enterprise', status: 'needs_selection', health: 'unselected' }),
  ];

  it('says a choice is needed, and how many, once at the top', () => {
    render({ accounts: waiting, onSelect: () => {} });
    const banner = container.querySelector('[data-testid="selection-needed"]')!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toMatch(/found 2 accounts on the same network/);
    // What choosing costs, said before the click rather than after it.
    expect(banner.textContent).toMatch(/the others will be disconnected/);
  });

  it('reads as a decision, not as a fault', () => {
    render({ accounts: waiting, onSelect: () => {} });
    const row = container.querySelector('[data-testid="account-acc-a"]')!;
    expect(row.textContent).toContain('Not chosen yet');
    expect(row.textContent).not.toContain('Token expired');
    expect(row.textContent).not.toContain('Connected');
  });

  it('offers the choice on each one and reports which was chosen', () => {
    const chosen: string[] = [];
    render({ accounts: waiting, onSelect: (id: string) => chosen.push(id) });
    const button = container.querySelector('[data-testid="select-acc-b"]') as HTMLButtonElement;
    expect(button.textContent).toBe('Use this one');
    act(() => { button.click(); });
    expect(chosen).toEqual(['acc-b']);
  });

  it('an account that IS chosen offers no choice - there is nothing to decide', () => {
    render({ accounts: [account({ id: 'acc-a' })], onSelect: () => {} });
    expect(container.querySelector('[data-testid="select-acc-a"]')).toBeNull();
    expect(container.querySelector('[data-testid="selection-needed"]')).toBeNull();
  });

  it('an unchosen account does not make Connect warn that it would replace something', () => {
    // `connectedByProvider` drives that warning. An account awaiting a decision is not yet the
    // brand's connection, so claiming connecting would replace it would be wrong.
    render({ accounts: waiting, onSelect: () => {} });
    const warning = container.querySelector('[data-testid="connect-replaces-linkedin_org"]');
    expect(warning).toBeNull();
  });
});
