import api from '../utils/api';
import type { AttentionItem, ExcludedSignal } from '../pages/admin/marketing/NeedsAttentionQueue';

/**
 * marketingOpsApi — clients for the Marketing Operations command-center endpoints.
 *
 * Kept separate from `adminBrandApi` because they are different surfaces with different
 * lifecycles; a client module that grows to cover everything under /api/admin/marketing
 * becomes the 15-import module the composition rule warns about.
 */

export type ScopeMode = 'scoped' | 'migration_open' | 'denied';

export interface NeedsAttentionResponse {
  items: AttentionItem[];
  /** Signals NOT shown because their metric is not trusted, with the registry's reason. */
  excluded: ExcludedSignal[];
  scope_mode: ScopeMode;
}

export async function getNeedsAttention(params?: { brand_id?: string }): Promise<NeedsAttentionResponse> {
  const res = await api.get('/api/admin/marketing/needs-attention', { params });
  return {
    items: res.data.items ?? [],
    excluded: res.data.excluded ?? [],
    scope_mode: res.data.scope_mode,
  };
}
/** How an account reads on the Overview. Mirrors backend `overviewHealth.AccountHealth`. */
export type AccountHealth = 'revoked' | 'expired' | 'unhealthy' | 'unselected' | 'expiring' | 'ok';

export interface UpcomingPost {
  id: string;
  title: string;
  brand_id: string | null;
  brand_name: string | null;
  scheduled_for: string;
  status: string;
  providers: string[];
  late: boolean;
}

export interface OverviewAccount {
  id: string;
  brand_id: string | null;
  brand_name: string | null;
  provider: string;
  display_name: string;
  health: AccountHealth;
  token_expires_at: string | null;
  expires_in_days: number | null;
}

export interface MarketingOverview {
  upcoming: UpcomingPost[];
  upcoming_truncated: boolean;
  accounts: OverviewAccount[];
  handoff_providers: string[];
  recent: { published: number; since: string; window_days: number };
  scope_mode?: string;
}

/**
 * The whole Overview in one request.
 *
 * One call rather than four, because the generic content list takes a single status and sorts
 * by `updated_at`, which cannot express "the next five posts going out".
 */
export async function getMarketingOverview(params?: { brand_id?: string }): Promise<MarketingOverview> {
  const res = await api.get('/api/admin/marketing/overview', { params });
  return res.data;
}
