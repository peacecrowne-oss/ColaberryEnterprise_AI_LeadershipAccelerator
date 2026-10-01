import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, SectionCard } from '../../../components/admin/shell';
import { TrustSignal } from '../../../components/admin/shell/trust';
import BrandReadinessPanel from './BrandReadinessPanel';
import ChannelAccountsPanel from './ChannelAccountsPanel';
import {
  getVaultStatus,
  listChannelAccounts,
  listConnectors,
  revokeChannelAccount,
  selectChannelAccount,
  startConnect,
  errorMessageOf,
  type ChannelAccount,
  type ConnectorKey,
  type ConnectorStatus,
  type VaultStatus,
} from '../../../services/channelAccountApi';
import {
  listBrands,
  getBrandSendReadiness,
  type Brand,
  type BrandSendReadiness,
  type ScopeMode,
} from '../../../services/adminBrandApi';
import { useMarketingBrand } from './MarketingBrandContext';
import { ALL_BRANDS } from './brandScope';
import { BRAND_TABS, domainNotice, isBrandTab, setupSummary, type BrandSetupFacts, type BrandTabKey } from './brandSetup';
import BrandSetupTabs from './BrandSetupTabs';
import { listItems, type ContentItem } from '../../../services/contentComposerApi';

/**
 * Brand administration — brands, their sending domains, and whether they can actually send.
 *
 * This page is the consumer for `brandSendReadiness()` and `listBrandSenderProfiles()`, which
 * existed in the codebase and were called by nothing: the deliverability picture was computed
 * correctly and reachable from nowhere.
 *
 * All rendering lives in `BrandReadinessPanel`, which takes its entire state as props. This
 * shell only fetches. That split is what makes the four empty states testable as prop
 * combinations instead of as mocked network conditions.
 */

function AdminBrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [scopeMode, setScopeMode] = useState<ScopeMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBrandId, setSelectedBrandIdLocal] = useState<string | null>(null);

  /**
   * This page needs ONE brand - an account connects to a brand, not to "all of them" - while the
   * tab's shared scope may be all. So the two are kept in step rather than merged: choosing a
   * brand here sets the tab's scope, and choosing one in the bar above selects it here.
   */
  const { brandId: scopeBrandId, setBrandId: setScopeBrand } = useMarketingBrand();
  const setSelectedBrandId = useCallback((next: string | null) => {
    setSelectedBrandIdLocal(next);
    if (next) setScopeBrand(next);
  }, [setScopeBrand]);
  useEffect(() => {
    if (scopeBrandId !== ALL_BRANDS) setSelectedBrandIdLocal(scopeBrandId);
  }, [scopeBrandId]);
  const [readiness, setReadiness] = useState<BrandSendReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsBusy, setAccountsBusy] = useState(false);
  /** What choosing a destination did, named rather than left to be inferred from the table. */
  const [selectNotice, setSelectNotice] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);

  /**
   * Which tab, in the URL (`?tab=channels`), so a link can open the right one - the same reason
   * the composer keeps its step there.
   */
  const [tabParams, setTabParams] = useSearchParams();
  const tab: BrandTabKey = isBrandTab(tabParams.get('tab')) ? (tabParams.get('tab') as BrandTabKey) : 'channels';
  const goToTab = useCallback((next: BrandTabKey) => {
    const q = new URLSearchParams(tabParams);
    q.set('tab', next);
    setTabParams(q, { replace: true });
  }, [tabParams, setTabParams]);

  /** Posts waiting for a human on this brand. The Approvals tab's content, and its count. */
  const [awaiting, setAwaiting] = useState<ContentItem[] | null>(null);
  useEffect(() => {
    if (!selectedBrandId) { setAwaiting([]); return; }
    let cancelled = false;
    listItems({ brand_id: selectedBrandId, status: 'ready_for_review', limit: 50 })
      .then((rows) => { if (!cancelled) setAwaiting(rows); })
      // Null means "could not load", which the tab says rather than showing an empty list.
      .catch(() => { if (!cancelled) setAwaiting(null); });
    return () => { cancelled = true; };
  }, [selectedBrandId]);
  const [connectorsError, setConnectorsError] = useState<string | null>(null);
  const [connectNotice, setConnectNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  // LinkedIn sends the browser back here after consent with ?linkedin=connected|error. Read it
  // once, say what happened in words, and clear it from the address bar so a reload does not
  // repeat the message. Through the router, not window.location, so the page behaves the same
  // wherever it is mounted.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    // Every other network returns ?connected=<network> or ?connect_error=<reason>.
    const generic = genericConnectNotice(params);
    if (generic) {
      setConnectNotice(generic);
      const brand = params.get('brand');
      if (brand) setSelectedBrandId(brand);
      navigate(location.pathname, { replace: true });
      return;
    }
    const outcome = params.get('linkedin');
    if (!outcome) return;
    if (outcome === 'connected') {
      setConnectNotice({ tone: 'success', text: 'LinkedIn account connected. Posts for this brand can now publish directly.' });
      const brand = params.get('brand');
      if (brand) setSelectedBrandId(brand);
    } else {
      setConnectNotice({ tone: 'danger', text: connectFailureText(params.get('reason')) });
    }
    // Consuming the query changes location.search, which re-runs this effect once more; it then
    // finds no `linkedin` key and returns. No dependency is hidden to stop that.
    navigate(location.pathname, { replace: true });
  }, [location.search, location.pathname, navigate]);

  useEffect(() => {
    listConnectors()
      .then((c) => { setConnectors(c); setConnectorsError(null); })
      .catch(() => setConnectorsError('The list of networks could not be loaded. Reload the page to try again.'));
  }, []);

  const handleConnect = useCallback(async (connector: ConnectorKey) => {
    if (!selectedBrandId) return;
    setAccountsBusy(true);
    try {
      const { url } = await startConnect(connector, selectedBrandId);
      // The whole window goes to the network; it comes back to this page via the callback.
      window.location.assign(url);
    } catch (err) {
      setConnectNotice({ tone: 'danger', text: errorMessageOf(err, 'The connection could not be started.') });
      setAccountsBusy(false);
    }
  }, [selectedBrandId]);

  /**
   * Accounts and vault status are fetched together because the panel cannot tell an honest
   * story with only one of them: an empty list means something different depending on whether
   * connecting is possible at all.
   */
  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const [status, rows] = await Promise.all([
        getVaultStatus(),
        listChannelAccounts(selectedBrandId ? { brand_id: selectedBrandId } : {}),
      ]);
      setVault(status);
      setAccounts(rows);
    } catch (err) {
      setAccountsError(errorMessageOf(err, 'Connected accounts could not be loaded.'));
    } finally {
      setAccountsLoading(false);
    }
  }, [selectedBrandId]);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);

  const handleRevoke = useCallback(async (accountId: string) => {
    setAccountsBusy(true);
    try {
      await revokeChannelAccount(accountId);
      await fetchAccounts();
    } catch (err) {
      setAccountsError(errorMessageOf(err, 'The account could not be disconnected.'));
    } finally {
      setAccountsBusy(false);
    }
  }, [fetchAccounts]);

  /**
   * Choose which discovered destination this brand posts as. Disconnects the others, so what
   * happened is reported by name rather than left for the operator to infer from the table.
   */
  const handleSelect = useCallback(async (accountId: string) => {
    setAccountsBusy(true);
    try {
      const account = await selectChannelAccount(accountId);
      const replaced = account.replaced ?? [];
      setAccountsError(null);
      setSelectNotice(replaced.length
        ? `Now posting as ${account.display_name}. Disconnected: ${replaced.map((r) => r.display_name).join(', ')}.`
        : `Now posting as ${account.display_name}.`);
      await fetchAccounts();
    } catch (err) {
      setAccountsError(errorMessageOf(err, 'That account could not be chosen.'));
    } finally {
      setAccountsBusy(false);
    }
  }, [fetchAccounts]);

  const fetchBrands = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { brands: rows, scope_mode } = await listBrands();
      setBrands(rows);
      setScopeMode(scope_mode);
      setFetchedAt(new Date().toISOString());
      // Select the first brand so the panel has something to show, but only when the operator
      // has not already chosen one - re-selecting on every refresh would fight the user.
      setSelectedBrandIdLocal((current) => current ?? (scopeBrandId !== ALL_BRANDS ? scopeBrandId : rows[0]?.id ?? null));
    } catch {
      // The message matters: "could not load" and "you have no brands" are different facts and
      // the panel renders them differently.
      setError('The brand list could not be loaded.');
      setBrands([]);
      setScopeMode(null);
      setFetchedAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBrands(); }, [fetchBrands]);

  useEffect(() => {
    if (!selectedBrandId) return;
    let cancelled = false;
    setReadinessLoading(true);
    getBrandSendReadiness(selectedBrandId)
      .then((r) => { if (!cancelled) setReadiness(r); })
      // A readiness failure must not be shown as "nothing configured" — that would turn a
      // server error into a false statement about the brand's setup.
      .catch(() => { if (!cancelled) setReadiness(null); })
      .finally(() => { if (!cancelled) setReadinessLoading(false); });
    return () => { cancelled = true; };
  }, [selectedBrandId]);

  /**
   * Derived, never a literal. `updatedAt` is the real fetch time or null — never `new Date()`,
   * which would report the moment this component rendered as the data's freshness.
   */
  const trust: TrustSignal = useMemo(() => ({
    level: error ? 'error' : loading || !fetchedAt ? 'unverified' : 'live',
    source: 'brands',
    updatedAt: fetchedAt,
    summary: error
      ? 'The brand list failed to load. Nothing on this page is current.'
      : loading || !fetchedAt
        ? 'Brand data has not loaded yet.'
        : `${brands.length} brand${brands.length === 1 ? '' : 's'} in scope.`,
    href: '/admin/trust',
    pillars: [{
      name: 'Scope',
      status: error ? 'error' : scopeMode === 'denied' ? 'unverified' : 'live',
      evidence: [{ label: 'Scope mode', value: scopeMode ?? 'not loaded' }],
    }],
  }), [error, loading, fetchedAt, brands.length, scopeMode]);

  const live = accounts.filter((a) => !a.revoked_at);
  // An account still awaiting a choice is not yet a channel this brand can post on, so it does
  // not count towards "connect a network" being done - it counts as something to attend to.
  const chosen = live.filter((a) => a.status === 'connected');
  const facts: BrandSetupFacts = {
    channelCount: chosen.length,
    channelsNeedingAttention: live.filter((a) => a.status === 'needs_selection' || a.health === 'expired' || a.health === 'unhealthy' || a.health === 'expiring').length,
    domainCount: readiness ? readiness.domains.length : null,
    verifiedDomainCount: readiness ? readiness.domains.filter((d) => d.verification_status === 'verified').length : 0,
    pendingApprovals: awaiting?.length ?? 0,
  };
  const summary = setupSummary(facts);
  const brandName = brands.find((b) => b.id === selectedBrandId)?.name ?? null;

  return (
    <>
      <PageHeader
        title={brandName ? `Brand setup: ${brandName}` : 'Brand setup'}
        icon="price-tag-3-line"
        subtitle="Everything this brand needs in order to publish, in one place."
        breadcrumb={[{ label: 'Admin', to: '/admin/dashboard' }, { label: 'Marketing', to: '/admin/marketing' }, { label: 'Brands' }]}
        trust={trust}
      />

      {selectNotice && (
        <div className="alert alert-success m-3 mb-0 py-2 small" role="status" data-testid="select-notice">
          {selectNotice}
        </div>
      )}

      {connectNotice && (
        <div className={`alert alert-${connectNotice.tone} m-3 mb-0 py-2 small`} role="status" data-testid="linkedin-connect-notice">
          {connectNotice.text}
        </div>
      )}

      {/* What is left to do, so setting a brand up is a task with an end rather than a tour. */}
      <div className={`px-3 py-2 small ${summary.done ? 'text-success' : 'text-warning-emphasis'}`} data-testid="brand-setup-summary">
        {summary.text}
      </div>

      <BrandSetupTabs active={tab} counts={{ channels: live.length, approvals: facts.pendingApprovals }} onGo={goToTab} />

      <div className="px-3 py-3">
        {tab === 'channels' && (
          <SectionCard title="Channels" subtitle={BRAND_TABS[0].hint} icon="links-line" padded={false}>
            <ChannelAccountsPanel
              loading={accountsLoading}
              error={accountsError}
              vault={vault}
              accounts={accounts}
              brandId={selectedBrandId}
              connectors={connectors}
              connectorsError={connectorsError}
              busy={accountsBusy}
              onConnect={handleConnect}
              onRevoke={handleRevoke}
              onSelect={handleSelect}
              onRetry={fetchAccounts}
            />
          </SectionCard>
        )}

        {tab === 'domains' && (
          <SectionCard title="Sending domains" subtitle={BRAND_TABS[1].hint} icon="mail-check-line" padded={false}>
            {/* Said before the table, because the table shows a "pending" column that looks like
                something you could act on and is not. */}
            <div className={`alert alert-${domainNotice(facts).tone} m-3 mb-0 py-2 small`} role="status" data-testid="domain-notice">
              {domainNotice(facts).text}
            </div>
            <BrandReadinessPanel
              loading={loading}
              error={error}
              brands={brands}
              scopeMode={scopeMode}
              selectedBrandId={selectedBrandId}
              readiness={readiness}
              readinessLoading={readinessLoading}
              onSelectBrand={setSelectedBrandId}
              onRetry={fetchBrands}
            />
          </SectionCard>
        )}

        {tab === 'approvals' && (
          <SectionCard title="Waiting for approval" subtitle={BRAND_TABS[2].hint} icon="checkbox-circle-line">
            {awaiting === null && <p className="text-danger small mb-0">The list could not be loaded. This is a failed request, not an empty queue.</p>}
            {awaiting?.length === 0 && <p className="text-muted small mb-0">Nothing is waiting for approval on this brand.</p>}
            {awaiting && awaiting.length > 0 && (
              <ul className="list-unstyled mb-0">
                {awaiting.map((it) => (
                  <li key={it.id} className="d-flex align-items-center gap-2 py-1 border-bottom">
                    <Link to={`/admin/marketing/composer/${it.id}?step=confirm`} className="flex-grow-1 text-truncate">
                      {it.title || 'Untitled post'}
                    </Link>
                    <span className="small text-muted">revision {it.revision}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        {tab === 'campaigns' && (
          <SectionCard title="Campaigns and slugs" subtitle={BRAND_TABS[3].hint} icon="price-tag-3-line">
            <p className="small mb-2">
              Campaigns are shared across the whole admin, not owned by one brand, so they are
              managed in one place rather than copied here.
            </p>
            <Link className="btn btn-sm btn-outline-primary" to="/admin/campaigns">Open campaigns</Link>
          </SectionCard>
        )}

        {tab === 'details' && (
          <SectionCard title="Details" subtitle={BRAND_TABS[4].hint} icon="information-line">
            {(() => {
              const brand = brands.find((b) => b.id === selectedBrandId);
              if (!brand) return <p className="text-muted small mb-0">Choose a brand in the bar above.</p>;
              return (
                <>
                  <dl className="row mb-3 small">
                    <dt className="col-sm-3 text-muted">Name</dt><dd className="col-sm-9">{brand.name}</dd>
                    <dt className="col-sm-3 text-muted">Slug</dt><dd className="col-sm-9"><code>{brand.slug}</code></dd>
                    <dt className="col-sm-3 text-muted">Status</dt><dd className="col-sm-9">{brand.status}</dd>
                    <dt className="col-sm-3 text-muted">Public address</dt>
                    <dd className="col-sm-9">{brand.default_public_url ?? <span className="text-muted">not set</span>}</dd>
                    <dt className="col-sm-3 text-muted">Support email</dt>
                    <dd className="col-sm-9">{brand.support_email ?? <span className="text-muted">not set</span>}</dd>
                  </dl>
                  {/* Said plainly rather than implied by the absence of a form. */}
                  <p className="small text-muted mb-0">
                    These are read-only here: there is no API for editing a brand yet. Posting times
                    are set per post in the composer, not as recurring slots.
                  </p>
                </>
              );
            })()}
          </SectionCard>
        )}
      </div>
    </>
  );
}

/** The callback's `reason` codes, in words an operator can act on. */
export function connectFailureText(reason: string | null): string {
  switch (reason) {
    case 'cancelled': return 'The LinkedIn connection was cancelled before finishing. Nothing was saved.';
    case 'StateExpired': return 'The LinkedIn sign-in took longer than ten minutes and expired. Start it again.';
    case 'StateInvalid': return 'The LinkedIn sign-in could not be verified. Start it again from this page.';
    case 'ExchangeFailed': return 'LinkedIn refused the sign-in code. Start the connection again.';
    case 'VaultUnavailable': return 'The credential store is not configured on this server, so the account could not be saved.';
    case 'BrandNotFound': return 'The brand this connection was started for no longer exists.';
    case 'provider_refused': return 'LinkedIn refused the connection. Check the app is approved for Share on LinkedIn and try again.';
    default: return `The LinkedIn connection failed${reason ? ` (${reason})` : ''}. Start it again; if it repeats, check the server log.`;
  }
}

export default AdminBrandsPage;

/** Names for the networks' return messages; the Brands list itself comes from the server. */
const NETWORK_NAMES: Record<string, string> = {
  linkedin_org: 'LinkedIn Company Page',
  meta: 'Facebook & Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
};

/**
 * What to say after any network other than LinkedIn personal profiles sends the browser back.
 * Null when the query carries no outcome. Exported for the test: these sentences are what an
 * operator reads at the exact moment they find out whether it worked.
 */
export function genericConnectNotice(params: URLSearchParams): { tone: 'success' | 'danger'; text: string } | null {
  const connected = params.get('connected');
  const failed = params.get('connect_error');
  if (!connected && !failed) return null;
  const name = NETWORK_NAMES[connected ?? params.get('connector') ?? ''];
  // No known network (a hand-edited URL, or UnknownConnector): say it plainly without a name,
  // rather than building "The The network connection failed" from a placeholder.
  if (!name) {
    return connected
      ? { tone: 'success', text: 'Connected. The new accounts are listed below.' }
      : { tone: 'danger', text: `The connection failed${failed ? ` (${failed})` : ''}. Start it again from this page.` };
  }

  if (connected) {
    const n = Number(params.get('count') ?? '1');
    const choose = Number(params.get('choose') ?? '0');
    const handoff = `Until direct publishing is switched on for ${name}, its posts are prepared for you to publish by hand.`;
    // A sign-in that found several destinations on one network connects none of them - a brand
    // posts as one account per network, so the decision is the operator's. Reporting those in
    // the same number as the connected ones is how "3 accounts added" once meant one added and
    // two silently revoked.
    if (choose > 0) {
      return {
        tone: 'success',
        text: `${name} signed in. ${choose} accounts were found on this network and a brand posts as one, `
          + `so choose which below - the others will be disconnected.`,
      };
    }
    const accounts = `${n} account${n === 1 ? '' : 's'}`;
    return {
      tone: 'success',
      text: `${name} connected: ${accounts} added to this brand. ${handoff}`,
    };
  }

  switch (failed) {
    case 'cancelled': return { tone: 'danger', text: `The ${name} connection was cancelled before finishing. Nothing was saved.` };
    case 'StateExpired': return { tone: 'danger', text: `The ${name} sign-in took longer than ten minutes and expired. Start it again.` };
    case 'StateInvalid':
    case 'StateConnectorMismatch': return { tone: 'danger', text: `The ${name} sign-in could not be verified. Start it again from this page.` };
    case 'NoAccountsFound': return { tone: 'danger', text: `${name} returned no accounts. In its sign-in window, choose the pages or accounts to connect, and check you are an admin of them.` };
    case 'ProviderNotConfigured': return { tone: 'danger', text: `${name} is not set up on this server yet. Open "What it needs" under Connect a network.` };
    case 'BrandNotFound': return { tone: 'danger', text: 'The brand this connection was started for no longer exists.' };
    case 'ExchangeFailed': return { tone: 'danger', text: `${name} refused the sign-in code. Start the connection again.` };
    case 'IdentityFailed': return { tone: 'danger', text: `${name} signed you in but would not say which account it was. Check the app permissions and try again.` };
    case 'VaultUnavailable': return { tone: 'danger', text: 'The credential store is unavailable, so the account could not be saved securely. Nothing was connected.' };
    case 'provider_refused': return { tone: 'danger', text: `${name} refused the connection. Check the app is approved for the permissions it asks for.` };
    default: return { tone: 'danger', text: `The ${name} connection failed${failed ? ` (${failed})` : ''}. Start it again; if it repeats, check the server log.` };
  }
}
