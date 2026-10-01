import React from 'react';
import type { ChannelAccount, ConnectorKey, ConnectorStatus, VaultStatus } from '../../../services/channelAccountApi';
import ConnectNetworks from './ConnectNetworks';
import { formatCentralDate } from './centralTime';

/**
 * ChannelAccountsPanel — which social accounts a brand has connected, and why it cannot connect
 * one when it cannot.
 *
 * PRESENTATIONAL ONLY. Every piece of state arrives as a prop, in the same shape as
 * `BrandReadinessPanel` next door, so the whole surface is testable without a network and the
 * page owns fetching.
 *
 * THE HONEST-EMPTY-STATE RULE, which this panel exists to uphold. "No accounts connected" has
 * three different causes and an operator needs to be told which one they are looking at:
 *   1. The credential store is not configured on this server -> connecting is impossible, and
 *      the panel says so instead of offering a button that would 503.
 *   2. It is configured and nothing is connected yet -> the button is real.
 *   3. An account exists but its credential cannot be read -> it is shown as needing
 *      reconnection, NOT hidden and not silently counted as connected.
 * A panel that rendered all three as an identical empty list would be the "0 that is really
 * unavailable" failure this whole workstream was built to stop.
 */

export interface ChannelAccountsPanelProps {
  loading: boolean;
  error: string | null;
  vault: VaultStatus | null;
  accounts: ChannelAccount[];
  /** Null while no brand is selected; connecting needs one. */
  brandId: string | null;
  /**
   * Every network, configured or not, from GET /connectors. Null while loading. Replaces the old
   * single `connectDisabledReason`: whether a network can be connected is now per network, and
   * "not set up yet" comes with the exact variables and redirect URL it needs.
   */
  connectors: ConnectorStatus[] | null;
  connectorsError?: string | null;
  busy: boolean;
  onConnect: (connector: ConnectorKey) => void;
  onRevoke: (accountId: string) => void;
  /** Choose a discovered destination. Absent when selection is not offered. */
  onSelect?: (accountId: string) => void;
  onRetry: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  linkedin_member: 'LinkedIn (personal)',
  linkedin_organization: 'LinkedIn Page',
  meta_facebook_page: 'Facebook Page',
  meta_instagram: 'Instagram',
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** A status an operator can act on, not a colour to decorate with. */
function statusBadge(account: ChannelAccount): { text: string; className: string; hint: string } {
  if (account.status === 'revoked') {
    return { text: 'Disconnected', className: 'text-bg-secondary', hint: 'Its credentials were destroyed. Reconnect to use it again.' };
  }
  if (account.status === 'needs_reconnect') {
    return {
      text: 'Needs reconnecting',
      className: 'text-bg-warning',
      hint: account.last_health_error_class
        ? `The stored credential could not be read (${account.last_health_error_class}).`
        : 'The stored credential could not be read.',
    };
  }
  if (account.status === 'disabled') {
    return { text: 'Disabled', className: 'text-bg-secondary', hint: 'Switched off here; the credential is still stored.' };
  }
  // Discovered by a sign-in that found several destinations on this network, and not yet chosen.
  // Nothing is broken; a decision is missing, so it reads as a question rather than a fault.
  if (account.status === 'needs_selection' || account.health === 'unselected') {
    return {
      text: 'Not chosen yet',
      className: 'text-bg-warning',
      hint: 'This brand posts as one account per network. Choose this one to use it.',
    };
  }
  // The server's verdict when it sent one: it knows which networks have a publishing adapter, and
  // an X account whose two-hour access token has lapsed is not "expired" - its refresh token keeps
  // the connection alive. Older backends send no verdict; then the access token decides.
  const expired = account.health
    ? account.health === 'expired'
    : account.credentials.some((c) => c.credential_type === 'access_token' && c.expired);
  if (expired) {
    return { text: 'Token expired', className: 'text-bg-warning', hint: 'Publishing will fail until this account is reconnected.' };
  }
  if (account.health === 'expiring') {
    return { text: 'Expiring soon', className: 'text-bg-warning', hint: 'Reconnect before the date shown so publishing does not stop.' };
  }
  return { text: 'Connected', className: 'text-bg-success', hint: 'Ready to publish once the provider is enabled.' };
}

function expiryText(account: ChannelAccount): string {
  if (account.usable_until !== undefined) {
    if (account.usable_until === null) return 'No expiry';
    return `${account.health === 'expired' ? 'Expired' : 'Until'} ${formatCentralDate(account.usable_until)}`;
  }
  const access = account.credentials.find((c) => c.credential_type === 'access_token');
  if (!access) return 'No token stored';
  if (!access.token_expires_at) return 'No expiry recorded';
  const when = new Date(access.token_expires_at);
  if (Number.isNaN(when.getTime())) return 'No expiry recorded';
  return `${access.expired ? 'Expired' : 'Expires'} ${formatCentralDate(access.token_expires_at)}`;
}

export default function ChannelAccountsPanel(props: ChannelAccountsPanelProps) {
  const { loading, error, vault, accounts, brandId, busy, onConnect, onRevoke, onSelect, onRetry } = props;
  // How many destinations are waiting on a decision, so the panel can say it once at the top
  // rather than leaving it to be spotted in a table row.
  const awaiting = accounts.filter((a) => a.status === 'needs_selection' && !a.revoked_at);

  if (loading) {
    return <div className="p-4 text-muted">Loading connected accounts…</div>;
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-danger mb-2">{error}</div>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  // Cause 1: connecting is impossible on this server. Said plainly, with the reason the backend
  // gave, instead of an empty list and a button that fails.
  const vaultUnavailable = vault !== null && !vault.vault_available;

  return (
    <div className="p-3">
      {vaultUnavailable && (
        <div className="alert alert-warning py-2" role="status" data-testid="vault-unavailable">
          <strong>Accounts cannot be connected on this server yet.</strong>
          <div className="small mt-1">{vault?.reason ?? 'The credential store is not configured.'}</div>
          <div className="small mt-1">
            Every network stays in handoff mode: the platform prepares the exact post and a person publishes it.
          </div>
        </div>
      )}

      {vault?.vault_available && vault.credentials_needing_rewrap > 0 && (
        <div className="alert alert-info py-2 small" role="status" data-testid="rewrap-pending">
          {vault.credentials_needing_rewrap} stored credential{vault.credentials_needing_rewrap === 1 ? '' : 's'} are
          still sealed under a previous master key. Run the re-wrap sweep to finish the rotation.
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="text-muted" data-testid="no-accounts">
          {vaultUnavailable
            ? 'No accounts are connected, and none can be until the credential store is configured.'
            : 'No accounts are connected for this brand yet.'}
        </div>
      ) : (
        <div className="table-responsive">
          {awaiting.length > 0 && (
            // One sign-in found several destinations. Said here, once, because a row badge alone
            // reads as a fault rather than as a decision someone has to make.
            <div className="alert alert-warning m-3 py-2 small mb-0" role="status" data-testid="selection-needed">
              This sign-in found {awaiting.length} accounts on the same network. A brand posts as
              one account per network, so choose which one - the others will be disconnected.
            </div>
          )}
          <table className="table table-sm align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Network</th>
                <th scope="col">Status</th>
                <th scope="col">Token</th>
                <th scope="col">Permissions</th>
                <th scope="col" className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const badge = statusBadge(account);
                return (
                  <tr key={account.id} data-testid={`account-${account.id}`}>
                    <td>
                      <div className="fw-semibold">{account.display_name}</div>
                      {account.handle && <div className="small text-muted">{account.handle}</div>}
                    </td>
                    <td>{providerLabel(account.provider)}</td>
                    <td>
                      <span className={`badge ${badge.className}`}>{badge.text}</span>
                      <div className="small text-muted">{badge.hint}</div>
                    </td>
                    <td className="small">{expiryText(account)}</td>
                    <td className="small">
                      {account.missing_scopes.length > 0 ? (
                        // Named, not hidden: a missing scope is why a specific action will fail
                        // later, and finding that out at publish time is the expensive way.
                        <span className="text-warning" data-testid={`missing-scopes-${account.id}`}>
                          Missing: {account.missing_scopes.join(', ')}
                        </span>
                      ) : (
                        <span className="text-muted">{account.granted_scopes.length} granted</span>
                      )}
                    </td>
                    <td className="text-end">
                      {account.status === 'needs_selection' && onSelect && (
                        // Says what it will do BEFORE the click. Choosing one disconnects the
                        // others, and being told that afterwards would feel like a bug.
                        <button
                          type="button"
                          className="btn btn-sm btn-primary me-1"
                          disabled={busy}
                          onClick={() => onSelect(account.id)}
                          title="Use this account for this network, and disconnect the others"
                          data-testid={`select-${account.id}`}
                        >
                          Use this one
                        </button>
                      )}
                      {account.status !== 'revoked' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          disabled={busy}
                          onClick={() => onRevoke(account.id)}
                          data-testid={`revoke-${account.id}`}
                        >
                          Disconnect
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3">
        <ConnectNetworks
          connectors={props.connectors}
          error={props.connectorsError ?? null}
          connectedByProvider={new Map(
            // Only a CHOSEN account counts as the brand's connection. One still awaiting a
            // decision must not make the Connect button warn that it would replace something.
            accounts
              .filter((a) => !a.revoked_at && a.status === 'connected')
              .map((a) => [a.provider, a.display_name] as const),
          )}
          // Disabled for a reason the operator can read, rather than absent (which looks like a
          // missing feature) or enabled (which fails).
          blockedReason={vaultUnavailable
            ? 'The credential store is not configured, so no network can be connected yet.'
            : !brandId ? 'Choose a brand first - accounts connect to one brand.' : null}
          busy={busy}
          onConnect={onConnect}
        />
      </div>
    </div>
  );
}
