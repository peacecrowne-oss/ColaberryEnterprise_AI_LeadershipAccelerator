import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../../middlewares/authMiddleware';
import { adminTenantScope, scopeAllows, type AdminTenantScope } from '../../modules/tenancy/adminScopeBridge';
import { WorkflowError } from '../../services/content/contentWorkflowService';
import { isVaultAvailable, activeKeyId } from '../../services/security/credentialVault';
import { redactedJson } from '../../services/security/secretRedaction';
import {
  connectAccount,
  listAccounts,
  getAccount,
  revokeAccount,
  rotateCredential,
  credentialsNeedingRewrap,
  selectAccount,
} from '../../services/marketing/channelAccountService';

/**
 * Admin HTTP surface for connected social accounts (T003).
 *
 * NO RESPONSE ON THIS ROUTER EVER CONTAINS A SECRET. Every handler returns the service's
 * `AccountView`, which is built field by field and has no path to the sealed columns. That is
 * enforced by construction rather than by remembering to omit something, and asserted by
 * `channelAccountRoutes.test.ts`.
 *
 * A token DOES arrive on the way in, on connect and rotate. Two consequences are handled here:
 * the error handler never echoes the request body (a 400 that quotes the body would put the
 * token in the client's console and in any error-reporting pipeline), and every log line goes
 * through `redactedJson`.
 *
 * The OAuth authorization-code flow the spec calls for is a later task. This router accepts a
 * token obtained out of band, which is what makes the first connector testable end to end; the
 * storage contract is identical either way.
 */

const router = Router();

const UUID = z.string().uuid();

/**
 * Which tenant owns the account being connected.
 *
 * A brand-owned account inherits its brand's tenant, which is authoritative and cannot be
 * spoofed from the request body. A person-owned account has no brand, so it can only be
 * resolved when the caller's scope names exactly one tenant; anything else is ambiguous and is
 * refused rather than guessed, because guessing wrong files a token under the wrong tenant.
 */
async function resolveTenantId(scope: AdminTenantScope, brandId: string | null): Promise<string | null> {
  if (brandId) {
    const { Brand } = await import('../../models');
    const brand = await Brand.findByPk(brandId);
    if (!brand || !scopeAllows(scope, brand.tenant_id)) return null;
    return brand.tenant_id;
  }
  if (scope.mode === 'scoped' && scope.tenantIds.length === 1) return scope.tenantIds[0];
  return null;
}

const ConnectSchema = z.object({
  brand_id: UUID.nullable().optional(),
  owner_member_id: UUID.nullable().optional(),
  provider: z.string().trim().min(1).max(64),
  provider_account_id: z.string().trim().min(1).max(255),
  display_name: z.string().trim().min(1).max(255),
  handle: z.string().trim().max(255).nullable().optional(),
  avatar_url: z.string().trim().url().max(2048).nullable().optional(),
  granted_scopes: z.array(z.string().max(128)).max(64).default([]),
  missing_scopes: z.array(z.string().max(128)).max(64).default([]),
  access_token: z.string().min(8).max(8192),
  refresh_token: z.string().min(8).max(8192).nullable().optional(),
  token_expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

const RotateSchema = z.object({
  credential_type: z.enum(['access_token', 'refresh_token']).default('access_token'),
  secret: z.string().min(8).max(8192),
  token_expires_at: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

const ListSchema = z.object({
  brand_id: UUID.optional(),
  owner_member_id: UUID.optional(),
  include_revoked: z.enum(['true', 'false']).optional(),
}).strict();

function bad(res: Response, details: unknown): void {
  // Deliberately does NOT echo the submitted body: it carries the token.
  res.status(400).json({ error: 'Validation failed', error_class: 'ValidationError', details });
}

function fail(res: Response, err: unknown, event: string): void {
  if (err instanceof WorkflowError) {
    res.status(err.status).json({ error: err.message, error_class: err.errorClass });
    return;
  }
  const e = err as { name?: string; message?: string };
  console.error(redactedJson({
    timestamp: new Date().toISOString(), level: 'error', service: 'marketing-channel-accounts',
    event, outcome: 'failure', error_class: e?.name ?? 'Error',
    context: { message: String(e?.message ?? err).slice(0, 200) },
  }));
  res.status(500).json({ error: 'The request could not be completed.', error_class: 'InternalError' });
}

/**
 * Whether accounts can be connected at all on this server, and why not when they cannot.
 * The composer reads this to explain "handoff only" honestly instead of showing a Connect
 * button that fails.
 */
router.get('/api/admin/channel-accounts/status', requireAdmin, async (req: Request, res: Response) => {
  try {
    const scope = await adminTenantScope(req.admin);
    if (scope.mode === 'denied') return void res.status(404).json({ error: 'Not found', error_class: 'NotFound' });
    const available = isVaultAvailable();
    res.json({
      vault_available: available,
      active_key_id: activeKeyId(),
      credentials_needing_rewrap: available ? await credentialsNeedingRewrap() : 0,
      reason: available
        ? null
        : 'The credential store is not configured on this server (SOCIAL_CREDENTIAL_MASTER_KEY). Publishing stays in handoff mode.',
    });
  } catch (err) { fail(res, err, 'channel_account_status_failed'); }
});

router.get('/api/admin/channel-accounts', requireAdmin, async (req: Request, res: Response) => {
  const parsed = ListSchema.safeParse(req.query);
  if (!parsed.success) return bad(res, parsed.error.flatten());
  try {
    const scope = await adminTenantScope(req.admin);
    if (scope.mode === 'denied') return void res.status(404).json({ error: 'Not found', error_class: 'NotFound' });

    const accounts = await listAccounts({
      // `migration_open` is the membership ramp, where every admin reads across tenants by
      // design; anything else is restricted to its own list. Never a single guessed tenant.
      tenantIds: scope.mode === 'migration_open' ? null : scope.tenantIds,
      brandId: parsed.data.brand_id ?? null,
      ownerMemberId: parsed.data.owner_member_id ?? null,
      includeRevoked: parsed.data.include_revoked === 'true',
    });
    res.json({ accounts });
  } catch (err) { fail(res, err, 'channel_account_list_failed'); }
});

router.get('/api/admin/channel-accounts/:id', requireAdmin, async (req: Request, res: Response) => {
  const id = UUID.safeParse(req.params.id);
  if (!id.success) return bad(res, { id: ['Must be a UUID'] });
  try {
    const scope = await adminTenantScope(req.admin);
    const account = await getAccount(id.data);
    if (!account || !scopeAllows(scope, account.tenant_id)) {
      return void res.status(404).json({ error: 'Channel account not found', error_class: 'NotFound' });
    }
    res.json({ account });
  } catch (err) { fail(res, err, 'channel_account_get_failed'); }
});

router.post('/api/admin/channel-accounts', requireAdmin, async (req: Request, res: Response) => {
  const parsed = ConnectSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed.error.flatten());
  try {
    const scope = await adminTenantScope(req.admin);
    if (scope.mode === 'denied') return void res.status(404).json({ error: 'Not found', error_class: 'NotFound' });

    // The BRAND fixes the tenant, resolved server-side and never taken from the body - the
    // same rule the composer's create follows. A person-owned account has no brand to read it
    // from, so it takes the caller's own tenant, which only a single-tenant scope can supply.
    const tenantId = await resolveTenantId(scope, parsed.data.brand_id ?? null);
    if (!tenantId) {
      return void res.status(400).json({
        error: 'Could not determine which tenant this account belongs to. Give it a brand, or connect it from a single-tenant login.',
        error_class: 'TenantUnresolved',
      });
    }
    const account = await connectAccount({
      tenantId,
      brandId: parsed.data.brand_id ?? null,
      ownerMemberId: parsed.data.owner_member_id ?? null,
      provider: parsed.data.provider,
      providerAccountId: parsed.data.provider_account_id,
      displayName: parsed.data.display_name,
      handle: parsed.data.handle ?? null,
      avatarUrl: parsed.data.avatar_url ?? null,
      grantedScopes: parsed.data.granted_scopes,
      missingScopes: parsed.data.missing_scopes,
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token ?? null,
      tokenExpiresAt: parsed.data.token_expires_at ? new Date(parsed.data.token_expires_at) : null,
      connectedBy: req.admin?.sub ?? null,
      metadata: parsed.data.metadata,
    });
    res.status(201).json({ account });
  } catch (err) { fail(res, err, 'channel_account_connect_failed'); }
});

router.post('/api/admin/channel-accounts/:id/credentials', requireAdmin, async (req: Request, res: Response) => {
  const id = UUID.safeParse(req.params.id);
  if (!id.success) return bad(res, { id: ['Must be a UUID'] });
  const parsed = RotateSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed.error.flatten());
  try {
    const scope = await adminTenantScope(req.admin);
    const existing = await getAccount(id.data);
    if (!existing || !scopeAllows(scope, existing.tenant_id)) {
      return void res.status(404).json({ error: 'Channel account not found', error_class: 'NotFound' });
    }
    const account = await rotateCredential(
      id.data,
      parsed.data.credential_type,
      parsed.data.secret,
      parsed.data.token_expires_at ? new Date(parsed.data.token_expires_at) : null,
    );
    res.json({ account });
  } catch (err) { fail(res, err, 'channel_account_rotate_failed'); }
});

router.delete('/api/admin/channel-accounts/:id', requireAdmin, async (req: Request, res: Response) => {
  const id = UUID.safeParse(req.params.id);
  if (!id.success) return bad(res, { id: ['Must be a UUID'] });
  try {
    const scope = await adminTenantScope(req.admin);
    const existing = await getAccount(id.data);
    if (!existing || !scopeAllows(scope, existing.tenant_id)) {
      return void res.status(404).json({ error: 'Channel account not found', error_class: 'NotFound' });
    }
    res.json({ account: await revokeAccount(id.data, req.admin?.sub ?? null) });
  } catch (err) { fail(res, err, 'channel_account_revoke_failed'); }
});

/**
 * Choose which discovered destination this brand posts as.
 *
 * Used when one sign-in found several destinations on the same network - the rule is one per
 * network per brand, so the operator says which. Selecting revokes the others, which is why the
 * response names them: `account.replaced`.
 */
router.post('/api/admin/channel-accounts/:id/select', requireAdmin, async (req: Request, res: Response) => {
  const id = UUID.safeParse(req.params.id);
  if (!id.success) return bad(res, { id: ['Must be a UUID'] });
  try {
    const scope = await adminTenantScope(req.admin);
    const existing = await getAccount(id.data);
    // Same 404 for "no such account" and "not yours" - a different answer would confirm the id.
    if (!existing || !scopeAllows(scope, existing.tenant_id)) {
      return void res.status(404).json({ error: 'Channel account not found', error_class: 'NotFound' });
    }
    res.json({
      account: await selectAccount({
        tenantId: existing.tenant_id,
        accountId: id.data,
        selectedBy: req.admin?.sub ?? null,
      }),
    });
  } catch (err) { fail(res, err, 'channel_account_select_failed'); }
});

export default router;
