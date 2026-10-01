import { Router, Request, Response } from 'express';
import { decodeState, pkceVerifier, OAuthError } from '../services/marketing/oauth/oauthState';
import { genericConnector } from '../services/marketing/oauth/connectorRegistry';
import { fetchOAuthHttp } from '../services/marketing/oauth/oauthHttp';
import type { OAuthHttp } from '../services/marketing/oauth/connectorTypes';
import type { ConnectInput, AccountView } from '../services/marketing/channelAccountService';

/**
 * marketingOAuthCallbackRoutes - `GET /api/marketing/oauth/:connector/callback?code=&state=`
 *
 * PUBLIC, and it MUST be mounted ABOVE `adminRoutes` in server.ts: the network redirects the
 * operator's BROWSER here, a top-level navigation carries no Authorization header, and anything
 * behind the admin guard answers 401. `/r/`, `/i/`, `/m/` and the LinkedIn callback all learned
 * this; the test builds both mount orders. Under `/api/` because both nginx layers already proxy
 * that prefix, so no edge change is needed.
 *
 * What stands in for the missing session is the SIGNED STATE (oauthState.ts): network, admin,
 * brand and time under an HMAC only this server can mint, ten-minute life. The brand comes from
 * the state and nothing else, and the state must have been minted for THIS path's network.
 *
 * ONE SIGN-IN, SEVERAL ACCOUNTS. A Facebook sign-in returns every Page ticked plus each linked
 * Instagram account; each is sealed separately. If sealing fails partway, the accounts already
 * sealed stay connected (connectAccount is idempotent, so pressing Connect again completes the
 * rest without duplicates) and the redirect reports the failure rather than a partial success.
 *
 * The result is a redirect to the Brands page, because this URL is the address bar at that moment
 * and a JSON body would be what the operator sees. It carries an outcome, the network and the
 * brand id - never a token, which is already sealed by then.
 */

export interface OAuthCallbackDeps {
  http: OAuthHttp;
  connect: (input: ConnectInput) => Promise<AccountView>;
  /** The brand's tenant, or null when the brand is gone. Injectable so tests need no models. */
  brandTenant: (brandId: string) => Promise<string | null>;
  now: () => number;
  env: NodeJS.ProcessEnv;
  returnPath: string;
}

/** Must be a path the frontend router renders; the Brands page reads the outcome from it. */
export const OAUTH_RETURN_PATH = '/admin/marketing/brands';

function defaultDeps(): OAuthCallbackDeps {
  return {
    http: fetchOAuthHttp,
    connect: async (input) => {
      const { connectAccount } = await import('../services/marketing/channelAccountService');
      return connectAccount(input);
    },
    brandTenant: async (brandId) => {
      const { Brand } = await import('../models');
      const brand = await Brand.findByPk(brandId);
      return brand?.tenant_id ?? null;
    },
    now: () => Date.now(),
    env: process.env,
    returnPath: OAUTH_RETURN_PATH,
  };
}

function log(level: 'info' | 'error', event: string, context: Record<string, unknown>, errorClass?: string): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(), level, service: 'marketing', event,
    outcome: level === 'error' ? 'failure' : 'success', ...(errorClass ? { error_class: errorClass } : {}), context,
  });
  if (level === 'error') console.error(line); else console.log(line);
}

export function makeOAuthCallbackRouter(overrides: Partial<OAuthCallbackDeps> = {}): Router {
  const deps: OAuthCallbackDeps = { ...defaultDeps(), ...overrides };
  const router = Router();

  router.get('/api/marketing/oauth/:connector/callback', async (req: Request, res: Response) => {
    const connectorKey = String(req.params.connector);
    const q = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : null);
    const back = (params: Record<string, string>) =>
      res.redirect(302, `${deps.returnPath}?${new URLSearchParams(params).toString()}`);

    const connector = genericConnector(connectorKey);
    if (!connector) return back({ connect_error: 'UnknownConnector' });

    // The state is verified FIRST, even when the network reports an error, so the brand id in the
    // redirect is one we signed rather than one an attacker chose.
    let payload: { adminId: string; brandId: string; nonce: string };
    try {
      const state = q('state');
      if (!state) throw new OAuthError('The sign-in state is missing.', 'StateInvalid');
      payload = decodeState(state, connector.key, deps.now(), deps.env);
    } catch (err) {
      return back({ connect_error: (err as OAuthError).errorClass ?? 'StateInvalid', connector: connector.key });
    }
    const fail = (reason: string) => back({ connect_error: reason, connector: connector.key, brand: payload.brandId });

    const providerError = q('error');
    if (providerError) return fail(connector.cancelErrors.includes(providerError) ? 'cancelled' : 'provider_refused');
    const code = q('code');
    if (!code) return fail('NoCode');

    const cfg = connector.config(deps.env);
    if (!cfg) return fail('ProviderNotConfigured');

    try {
      const tenantId = await deps.brandTenant(payload.brandId);
      if (!tenantId) return fail('BrandNotFound');

      const now = new Date(deps.now());
      const verifier = connector.usesPkce ? pkceVerifier(payload.nonce, deps.env) : null;
      const token = await connector.exchangeCode({ cfg, code, verifier, http: deps.http, now });
      const accounts = await connector.discoverAccounts({ cfg, token, http: deps.http, now });
      if (accounts.length === 0) return fail('NoAccountsFound');

      /**
       * How many destinations did this sign-in find on each network?
       *
       * The rule is one per network per brand. A Meta login can hand back four Facebook Pages,
       * and a LinkedIn admin of three company Pages gets all three - but before this, each one
       * was connected in turn and each revoked the one before it, destroying its credentials,
       * while the redirect still reported the full count. The last one discovered won, silently.
       *
       * Counted per PROVIDER, not per batch: a Meta sign-in returning one Page and one Instagram
       * account is two unambiguous connections, not an ambiguous pair.
       */
      const perProvider = new Map<string, number>();
      for (const a of accounts) perProvider.set(a.provider, (perProvider.get(a.provider) ?? 0) + 1);

      const connected: string[] = [];
      const awaiting: string[] = [];
      for (const a of accounts) {
        const view = await deps.connect({
          tenantId,
          brandId: payload.brandId,
          awaitingSelection: (perProvider.get(a.provider) ?? 0) > 1,
          provider: a.provider,
          providerAccountId: a.providerAccountId,
          displayName: a.displayName,
          handle: a.handle,
          avatarUrl: a.avatarUrl,
          grantedScopes: a.grantedScopes,
          missingScopes: a.missingScopes,
          accessToken: a.accessToken,
          refreshToken: a.refreshToken,
          tokenExpiresAt: a.expiresAt,
          refreshTokenExpiresAt: a.refreshExpiresAt,
          connectedBy: payload.adminId,
          metadata: a.metadata,
        });
        if (view.status === 'needs_selection') awaiting.push(view.id);
        else connected.push(view.id);
      }
      log('info', 'oauth_accounts_connected', {
        connector: connector.key,
        brand_id: payload.brandId,
        connected_by: payload.adminId,
        account_ids: connected,
        awaiting_selection_ids: awaiting,
      });
      // `count` is what actually connected. `choose` is what the operator still has to decide -
      // reporting the two as one number is how "3 accounts added" came to mean one account added
      // and two revoked.
      return back({
        connected: connector.key,
        brand: payload.brandId,
        count: String(connected.length),
        ...(awaiting.length ? { choose: String(awaiting.length) } : {}),
      });
    } catch (err) {
      const e = err as { errorClass?: string; name?: string; message?: string };
      log('error', 'oauth_connect_failed', { connector: connector.key, brand_id: payload.brandId, message: String(e?.message ?? err).slice(0, 200) }, e?.errorClass ?? e?.name ?? 'Error');
      return fail(e?.errorClass ?? 'ConnectFailed');
    }
  });

  return router;
}

export default makeOAuthCallbackRouter();
