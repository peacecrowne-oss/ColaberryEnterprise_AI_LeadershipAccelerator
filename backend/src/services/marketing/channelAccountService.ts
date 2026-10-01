import { Op } from 'sequelize';
import { ChannelAccount, ConnectorCredential } from '../../models';
import type { ChannelAccountStatus } from '../../models/ChannelAccount';
import type { CredentialType } from '../../models/ConnectorCredential';
import { WorkflowError } from '../content/contentWorkflowService';
import { isVaultAvailable, seal, open, activeKeyId, CredentialVaultError } from '../security/credentialVault';
import { redactedJson } from '../security/secretRedaction';
import { accountHealth, accessTokenExpiry, connectionExpiry, type AccountHealth } from './overviewHealth';
import { IMPLEMENTED_CONNECTORS, type ProviderKey } from '../publishing/providerCapabilities';

/**
 * channelAccountService — connect, read, refresh and revoke social accounts.
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE: a secret enters through `connectAccount` or
 * `rotateCredential` and leaves only through `getAccessToken`. Nothing else in the codebase
 * touches `ConnectorCredential`'s sealed columns, so "where can a token escape?" has three
 * greppable answers instead of being a property of the whole backend.
 *
 * NO PLAINTEXT FALLBACK. If the vault is unavailable (master key absent or malformed),
 * `connectAccount` refuses. The product then behaves exactly as it does today, with every
 * provider in handoff mode, which is a known-good state rather than a silent downgrade to
 * storing bare tokens.
 */

export interface ConnectInput {
  tenantId: string;
  /** Exactly one of brandId / ownerMemberId. Brand for company pages, member for a person. */
  brandId?: string | null;
  ownerMemberId?: string | null;
  provider: string;
  providerAccountId: string;
  displayName: string;
  handle?: string | null;
  avatarUrl?: string | null;
  grantedScopes?: string[];
  /** Scopes the integration asked for and did not receive; surfaced to the operator. */
  missingScopes?: string[];
  accessToken: string;
  refreshToken?: string | null;
  /** When the access token stops working, if the provider said. */
  tokenExpiresAt?: Date | null;
  /**
   * When the refresh token itself stops working, if the provider said (TikTok: 365 days; Google
   * and X do not say). The connection lives as long as this does, so the Overview reads it.
   */
  refreshTokenExpiresAt?: Date | null;
  connectedBy?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * True when ONE sign-in discovered several destinations on this network and the operator has
   * not yet said which the brand should use. Such an account is sealed as `needs_selection`,
   * publishes nothing, and revokes nothing. Set by the OAuth callback, never by a human caller.
   */
  awaitingSelection?: boolean;
}

/** The account as any caller outside this module may see it. No secret, by construction. */
export interface AccountView {
  id: string;
  tenant_id: string;
  brand_id: string | null;
  owner_member_id: string | null;
  provider: string;
  provider_account_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  status: ChannelAccountStatus;
  granted_scopes: string[];
  missing_scopes: string[];
  connected_at: Date;
  last_health_check_at: Date | null;
  last_health_ok: boolean | null;
  last_health_error_class: string | null;
  revoked_at: Date | null;
  /** Lifecycle only: whether a secret exists and when it expires, never the secret. */
  credentials: Array<{
    credential_type: CredentialType;
    token_expires_at: Date | null;
    rotated_at: Date | null;
    key_id: string;
    expired: boolean;
  }>;
  /**
   * The same verdict the Overview shows, computed once here so every screen agrees. A network
   * with a publishing adapter is judged by its access token (what the adapter uses, and nothing
   * renews it); one without, by whether the connection is alive - so an X account does not read
   * "expired" two hours after it was connected. See overviewHealth.connectionExpiry.
   */
  health: AccountHealth;
  /** When this account stops being usable, by the same rule. Null: no stated end. */
  usable_until: Date | null;
  /**
   * Set only by `connectAccount`, when connecting REPLACED an existing account for the same
   * network on the same brand. The operator is told what was disconnected on their behalf.
   */
  replaced?: Array<{ id: string; display_name: string }>;
}

function log(level: 'info' | 'warn' | 'error', event: string, context: Record<string, unknown>, outcome = 'success'): void {
  // Redacted at the boundary rather than trusting each caller: this is the log line most
  // likely to be handed an object that contains a token.
  console[level](redactedJson({
    timestamp: new Date().toISOString(),
    level,
    service: 'marketing-channel-accounts',
    event,
    outcome,
    context,
  }));
}

function toView(account: ChannelAccount, credentials: ConnectorCredential[]): AccountView {
  const now = Date.now();
  const lifecycle = credentials.map((c) => ({ credential_type: c.credential_type, token_expires_at: c.token_expires_at }));
  const judged = { status: account.status, revoked_at: account.revoked_at, last_health_ok: account.last_health_ok, credentials: lifecycle };
  const byConnection = !IMPLEMENTED_CONNECTORS.has(account.provider as ProviderKey);
  return {
    id: account.id,
    tenant_id: account.tenant_id,
    brand_id: account.brand_id,
    owner_member_id: account.owner_member_id,
    provider: account.provider,
    provider_account_id: account.provider_account_id,
    display_name: account.display_name,
    handle: account.handle,
    avatar_url: account.avatar_url,
    status: account.status,
    granted_scopes: account.granted_scopes ?? [],
    missing_scopes: account.missing_scopes ?? [],
    connected_at: account.connected_at,
    last_health_check_at: account.last_health_check_at,
    last_health_ok: account.last_health_ok,
    last_health_error_class: account.last_health_error_class,
    revoked_at: account.revoked_at,
    credentials: credentials.map((c) => ({
      credential_type: c.credential_type,
      token_expires_at: c.token_expires_at,
      rotated_at: c.rotated_at,
      key_id: c.key_id,
      expired: c.token_expires_at ? c.token_expires_at.getTime() <= now : false,
    })),
    health: accountHealth(judged, new Date(now), byConnection),
    usable_until: byConnection ? connectionExpiry(judged) : accessTokenExpiry(judged),
  };
}

function assertExactlyOneOwner(input: Pick<ConnectInput, 'brandId' | 'ownerMemberId'>): void {
  const hasBrand = Boolean(input.brandId);
  const hasMember = Boolean(input.ownerMemberId);
  if (hasBrand === hasMember) {
    throw new WorkflowError(
      'A channel account belongs to exactly one owner: a brand or a person, never both and never neither.',
      400,
      'ValidationError',
    );
  }
}

/**
 * One per network per brand: revoke whatever else is live on this network for the same owner.
 *
 * Shared by `connectAccount` (the ordinary single-destination case) and `selectAccount` (the
 * operator choosing between destinations one sign-in discovered), so the rule has exactly one
 * implementation and the two paths cannot drift apart.
 *
 * Credentials are destroyed, not just orphaned - a revoked account must not leave a usable token
 * behind it.
 */
async function supersedeSiblings(
  account: ChannelAccount,
  actorId: string | null,
): Promise<Array<{ id: string; display_name: string }>> {
  const ownerWhere = account.brand_id
    ? { brand_id: account.brand_id }
    : { owner_member_id: account.owner_member_id ?? null };
  const superseded = await ChannelAccount.findAll({
    where: {
      tenant_id: account.tenant_id,
      provider: account.provider,
      ...ownerWhere,
      revoked_at: { [Op.is]: null } as any,
      id: { [Op.ne]: account.id } as any,
    },
  });
  const replaced: Array<{ id: string; display_name: string }> = [];
  for (const old of superseded) {
    const destroyed = await ConnectorCredential.destroy({ where: { channel_account_id: old.id } });
    await old.update({ status: 'revoked', revoked_at: new Date(), revoked_by: actorId });
    replaced.push({ id: old.id, display_name: old.display_name });
    log('info', 'account_superseded', {
      account_id: old.id,
      replaced_by: account.id,
      provider: old.provider,
      credentials_destroyed: destroyed,
    });
  }
  return replaced;
}

/**
 * Connect an account and seal its tokens.
 *
 * Idempotent on `(tenant, provider, provider_account_id)` among non-revoked rows: reconnecting
 * the same page updates it and replaces the credentials rather than creating a second account
 * that would publish a duplicate of every post.
 *
 * ONE ACCOUNT PER NETWORK PER BRAND (Loomly's rule, adopted 2026-09-29). Connecting a DIFFERENT
 * account for a network the brand already has replaces the old one: it is revoked and its
 * credentials destroyed, and the returned view names what was replaced so the operator is told
 * rather than left to notice. Before this, two accounts could sit on one brand and
 * `resolveAccountFor` silently published from whichever was connected most recently - the same
 * family of confusion that stopped Ali's first real post on 2026-09-18.
 *
 * The replacement happens AFTER the new account is sealed, so a failure to seal leaves the brand
 * with the connection it already had rather than with none.
 */
export async function connectAccount(input: ConnectInput): Promise<AccountView> {
  assertExactlyOneOwner(input);

  if (!isVaultAvailable()) {
    log('error', 'account_connect_refused', {
      provider: input.provider,
      reason: 'credential vault unavailable',
    }, 'failure');
    throw new WorkflowError(
      'The credential store is not configured on this server, so accounts cannot be connected. '
      + 'Publishing stays in handoff mode until it is.',
      503,
      'VaultUnavailable',
    );
  }

  const existing = await ChannelAccount.findOne({
    where: {
      tenant_id: input.tenantId,
      provider: input.provider,
      provider_account_id: input.providerAccountId,
      revoked_at: { [Op.is]: null } as any,
    },
  });

  /**
   * Is this one of several destinations discovered in a single sign-in?
   *
   * `inBatch` suppresses the supersede rule for EVERY member of the batch, including one that
   * stays connected. That is what makes the outcome independent of the order the provider
   * happened to list the destinations in: whichever way round they arrive, the brand keeps the
   * connection it had and the others wait to be chosen. Letting an already-connected member
   * supersede would revoke its own siblings if it happened to be processed last - the same
   * destruction this change exists to stop, moved one step later.
   *
   * `awaiting` is narrower: it decides the STATUS of this row. An account that is already the
   * live connection stays connected, because re-running a Meta sign-in and ticking the same Page
   * again must not demote a working connection to "please choose".
   */
  const inBatch = Boolean(input.awaitingSelection);
  const awaiting = inBatch && existing?.status !== 'connected';

  const fields = {
    tenant_id: input.tenantId,
    brand_id: input.brandId ?? null,
    owner_member_id: input.ownerMemberId ?? null,
    provider: input.provider,
    provider_account_id: input.providerAccountId,
    display_name: input.displayName,
    handle: input.handle ?? null,
    avatar_url: input.avatarUrl ?? null,
    status: (awaiting ? 'needs_selection' : 'connected') as ChannelAccountStatus,
    granted_scopes: input.grantedScopes ?? [],
    missing_scopes: input.missingScopes ?? [],
    connected_by: input.connectedBy ?? null,
    connected_at: new Date(),
    last_health_check_at: null,
    last_health_ok: null,
    last_health_error_class: null,
    metadata: input.metadata ?? {},
  };

  const account = existing
    ? await existing.update(fields)
    : await ChannelAccount.create(fields as any);

  await writeCredential(account, 'access_token', input.accessToken, input.tokenExpiresAt ?? null);
  if (input.refreshToken) {
    // Refresh tokens have their own lifetime, which is why they are a separate row rather than
    // a second column: an expired access token beside a live refresh token is the normal state.
    await writeCredential(account, 'refresh_token', input.refreshToken, input.refreshTokenExpiresAt ?? null);
  }

  // A batch that discovered several destinations supersedes NOTHING. See supersedeSiblings.
  const replaced = inBatch ? [] : await supersedeSiblings(account, input.connectedBy ?? null);

  log('info', existing ? 'account_reconnected' : 'account_connected', {
    account_id: account.id,
    provider: account.provider,
    owner: account.brand_id ? 'brand' : 'member',
    granted_scope_count: (input.grantedScopes ?? []).length,
    missing_scope_count: (input.missingScopes ?? []).length,
  });

  return { ...toView(account, await credentialsFor(account.id)), ...(replaced.length ? { replaced } : {}) };
}

/**
 * Choose which discovered destination this brand posts as.
 *
 * The other side of `awaitingSelection`. One sign-in can hand back several destinations - three
 * LinkedIn Pages you administer, four Facebook Pages you ticked - and the rule is one per network
 * per brand, so somebody has to say which. Selecting promotes this account to `connected` and
 * applies the ordinary supersede rule, which revokes the siblings AND the previous connection, if
 * any, destroying their credentials.
 *
 * Idempotent: selecting the account that is already connected re-applies the rule and returns the
 * same view, so a double-click cannot produce a different outcome than a single one.
 */
export async function selectAccount(input: {
  tenantId: string;
  accountId: string;
  selectedBy?: string | null;
}): Promise<AccountView> {
  const account = await ChannelAccount.findOne({
    where: { id: input.accountId, tenant_id: input.tenantId },
  });
  // Scoped by tenant in the query itself, so a wrong tenant is indistinguishable from a wrong id.
  if (!account) throw new WorkflowError('That account does not exist.', 404, 'AccountNotFound');

  if (account.revoked_at || account.status === 'revoked') {
    throw new WorkflowError(
      'That account was disconnected and its credentials were destroyed. Connect the network again.',
      409,
      'AccountRevoked',
    );
  }

  if (account.status !== 'connected') {
    await account.update({ status: 'connected' });
  }
  const replaced = await supersedeSiblings(account, input.selectedBy ?? null);

  log('info', 'account_selected', {
    account_id: account.id,
    provider: account.provider,
    brand_id: account.brand_id,
    replaced_count: replaced.length,
  });

  return { ...toView(account, await credentialsFor(account.id)), ...(replaced.length ? { replaced } : {}) };
}

async function writeCredential(
  account: ChannelAccount,
  type: CredentialType,
  secret: string,
  expiresAt: Date | null,
): Promise<void> {
  const sealed = seal(secret, { accountId: account.id, credentialType: type });
  const existing = await ConnectorCredential.findOne({
    where: { channel_account_id: account.id, credential_type: type },
  });
  const row = {
    tenant_id: account.tenant_id,
    channel_account_id: account.id,
    credential_type: type,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    auth_tag: sealed.auth_tag,
    wrapped_data_key: sealed.wrapped_data_key,
    key_id: sealed.key_id,
    encrypted_at: new Date(sealed.encrypted_at),
    token_expires_at: expiresAt,
    rotated_at: existing ? new Date() : null,
  };
  if (existing) await existing.update(row);
  else await ConnectorCredential.create(row as any);
}

async function credentialsFor(accountId: string): Promise<ConnectorCredential[]> {
  return ConnectorCredential.findAll({
    where: { channel_account_id: accountId },
    order: [['credential_type', 'ASC']],
  });
}

/** Replace one secret for an account, keeping the account row and its history intact. */
export async function rotateCredential(
  accountId: string,
  type: CredentialType,
  secret: string,
  expiresAt: Date | null = null,
): Promise<AccountView> {
  const account = await ChannelAccount.findByPk(accountId);
  if (!account) throw new WorkflowError('Channel account not found', 404, 'NotFound');
  if (!isVaultAvailable()) {
    throw new WorkflowError('The credential store is not configured on this server.', 503, 'VaultUnavailable');
  }
  await writeCredential(account, type, secret, expiresAt);
  if (account.status === 'needs_reconnect') {
    await account.update({ status: 'connected', last_health_error_class: null });
  }
  log('info', 'credential_rotated', { account_id: accountId, credential_type: type });
  return toView(account, await credentialsFor(accountId));
}

/**
 * The ONLY way to obtain a usable token. Every caller is an adapter about to talk to a
 * provider; nothing else has a reason to call it.
 *
 * A tampered or unopenable row marks the account `needs_reconnect` rather than throwing
 * anonymously, because the operator's remedy is the same in both cases and silence would leave
 * the account looking healthy while every publish failed.
 */
export async function getAccessToken(accountId: string, type: CredentialType = 'access_token'): Promise<string> {
  const account = await ChannelAccount.findByPk(accountId);
  if (!account) throw new WorkflowError('Channel account not found', 404, 'NotFound');
  if (account.status === 'revoked' || account.revoked_at) {
    throw new WorkflowError('This account was disconnected.', 409, 'AccountRevoked');
  }

  const credential = await ConnectorCredential.findOne({
    where: { channel_account_id: accountId, credential_type: type },
  });
  if (!credential) {
    throw new WorkflowError(`This account has no ${type}. Reconnect it.`, 409, 'CredentialMissing');
  }

  try {
    return open(
      {
        ciphertext: credential.ciphertext,
        iv: credential.iv,
        auth_tag: credential.auth_tag,
        wrapped_data_key: credential.wrapped_data_key,
        key_id: credential.key_id,
        encrypted_at: credential.encrypted_at.toISOString(),
      },
      // Binds the row to this account and type: a row transplanted from another account fails
      // authentication instead of opening.
      { accountId: accountId, credentialType: type },
    );
  } catch (err) {
    const errorClass = err instanceof CredentialVaultError ? err.errorClass : 'Error';
    await account.update({
      status: 'needs_reconnect',
      last_health_ok: false,
      last_health_error_class: errorClass,
      last_health_check_at: new Date(),
    });
    log('error', 'credential_unreadable', {
      account_id: accountId,
      credential_type: type,
      error_class: errorClass,
      key_id: credential.key_id,
      active_key_id: activeKeyId(),
    }, 'failure');
    throw new WorkflowError(
      'This account\'s credential could not be read, so it has been marked for reconnection.',
      409,
      errorClass,
    );
  }
}

export interface ListScope {
  /**
   * Tenants the caller may see. `null` means no tenant filter, which is ONLY correct for the
   * membership ramp's `migration_open` mode; a route must never pass null on a scoped caller.
   */
  tenantIds: string[] | null;
  brandId?: string | null;
  ownerMemberId?: string | null;
  includeRevoked?: boolean;
}

/** List accounts as views. There is no variant of this that returns secrets. */
export async function listAccounts(scope: ListScope): Promise<AccountView[]> {
  const where: Record<string, unknown> = {};
  if (scope.tenantIds) {
    // An empty allow-list means "no tenants", not "every tenant". Returning early keeps a
    // future caller from turning a denied scope into an unfiltered read.
    if (scope.tenantIds.length === 0) return [];
    where.tenant_id = { [Op.in]: scope.tenantIds };
  }
  if (scope.brandId) where.brand_id = scope.brandId;
  if (scope.ownerMemberId) where.owner_member_id = scope.ownerMemberId;
  if (!scope.includeRevoked) where.revoked_at = { [Op.is]: null };

  const accounts = await ChannelAccount.findAll({ where, order: [['display_name', 'ASC']] });
  if (accounts.length === 0) return [];

  const credentials = await ConnectorCredential.findAll({
    where: { channel_account_id: { [Op.in]: accounts.map((a) => a.id) } },
  });
  const byAccount = new Map<string, ConnectorCredential[]>();
  for (const c of credentials) {
    const list = byAccount.get(c.channel_account_id) ?? [];
    list.push(c);
    byAccount.set(c.channel_account_id, list);
  }
  return accounts.map((a) => toView(a, byAccount.get(a.id) ?? []));
}

export async function getAccount(accountId: string): Promise<AccountView | null> {
  const account = await ChannelAccount.findByPk(accountId);
  if (!account) return null;
  return toView(account, await credentialsFor(account.id));
}

/**
 * Disconnect an account: destroy every secret, keep the account row.
 *
 * The row survives on purpose. `content_variants.channel_account_id` and published history
 * point at it, and deleting it would orphan the record of what was posted where. What must not
 * survive is the token, so the credential rows are deleted rather than flagged.
 */
export async function revokeAccount(accountId: string, revokedBy: string | null): Promise<AccountView> {
  const account = await ChannelAccount.findByPk(accountId);
  if (!account) throw new WorkflowError('Channel account not found', 404, 'NotFound');

  const destroyed = await ConnectorCredential.destroy({ where: { channel_account_id: accountId } });
  await account.update({
    status: 'revoked',
    revoked_at: new Date(),
    revoked_by: revokedBy,
  });

  log('info', 'account_revoked', {
    account_id: accountId,
    provider: account.provider,
    credentials_destroyed: destroyed,
  });

  return toView(account, []);
}

/**
 * The author a post is attributed to, as the provider's own URN.
 *
 * This is the ONLY difference between posting as a person and posting as a company page, which
 * is why it lives here (next to the account that knows which it is) rather than inside the
 * adapter. `provider_account_id` holds the OIDC `sub` for a member and the organization id for
 * a page; the URN shape is the provider's, not ours.
 */
/**
 * The provider's own id for an account: a Facebook Page id, an Instagram account id, a LinkedIn
 * organization number. What an adapter addresses when the network does not use a URN.
 */
export async function getProviderAccountId(accountId: string): Promise<string> {
  const account = await ChannelAccount.findByPk(accountId);
  if (!account) throw new WorkflowError('Channel account not found', 404, 'NotFound');
  if (account.status === 'revoked' || account.revoked_at) {
    throw new WorkflowError('This account was disconnected.', 409, 'AccountRevoked');
  }
  return account.provider_account_id;
}

export async function getAuthorUrn(accountId: string): Promise<string> {
  const account = await ChannelAccount.findByPk(accountId);
  if (!account) throw new WorkflowError('Channel account not found', 404, 'NotFound');

  switch (account.provider) {
    case 'linkedin_member':
      return `urn:li:person:${account.provider_account_id}`;
    case 'linkedin_organization':
      return `urn:li:organization:${account.provider_account_id}`;
    default:
      // Not a silent empty string: an adapter given a blank author posts as nobody, and
      // LinkedIn's 422 would be diagnosed as a copy problem rather than a wiring one.
      throw new WorkflowError(
        `No author URN format is known for provider ${account.provider}.`,
        409,
        'UnknownAuthorFormat',
      );
  }
}

/** Rows still sealed under a retired master key. Drives the rotation sweep's reporting. */
export async function credentialsNeedingRewrap(tenantId?: string): Promise<number> {
  const active = activeKeyId();
  if (!active) return 0;
  return ConnectorCredential.count({
    where: {
      key_id: { [Op.ne]: active },
      ...(tenantId ? { tenant_id: tenantId } : {}),
    },
  });
}
