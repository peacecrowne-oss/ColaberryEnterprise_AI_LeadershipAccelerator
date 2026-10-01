import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, StatCard, SectionCard } from '../../components/admin/shell';
import {
  listGovOpportunities, dismissGovOpportunity, restoreGovOpportunity,
  type GovOpportunity, type GovOpportunityFeed,
} from '../../services/factoryApi';

/**
 * AdminGovOpportunitiesPage — the government-contract discovery dashboard.
 *
 * DISCOVERED CANDIDATES, not recommended pursuits: each row from Opportunity Pulse still needs qualification
 * before it becomes a pursuit. Honesty rails kept from the Phase-1 correction: Fit/Priority are LEGACY,
 * title-derived discovery scores (advisory, never a verified match); estimated values are UNVERIFIED and never
 * presented as revenue; a null verdict is UNASSESSED (never approved); rows Opportunity Pulse flagged (no_bid /
 * needs_review / declined) are shown in a separate "flagged for review" section, never as candidates; and the
 * "Qualify" action routes to the qualification workspace (a canonical id is NEVER derived from a title here).
 *
 * Discovery upgrade: the feed now shows the full curated best-fit set (~50) with a "showing N of M" line, a
 * "Good fits" count and a "Decent options" filter, a per-row Details popup (why it surfaced + OP's PRELIMINARY,
 * UNVERIFIED overview — never a requirement), and a team-scoped Dismiss (reversible) so a candidate can be
 * eliminated from everyone's feed.
 * Design: Bootstrap 5 + admin-shell + RemixIcon; colors via design tokens / Bootstrap utilities, no hardcoded hex.
 */

type Band = { label: 'High' | 'Med' | 'Low'; tone: 'success' | 'warning' | 'danger' };
const band = (score: number | null | undefined): Band => {
  const s = typeof score === 'number' ? score : -1;
  if (s >= 75) return { label: 'High', tone: 'success' };
  if (s >= 60) return { label: 'Med', tone: 'warning' };
  return { label: 'Low', tone: 'danger' };
};
const subtle = (tone: 'success' | 'warning' | 'danger' | 'secondary'): string => `bg-${tone}-subtle text-${tone}-emphasis`;

/** "Decent options" threshold — Med band or better (matches band()'s 60 boundary). */
const DECENT_FIT = 60;
const GOOD_FIT = 75;

const fmtValue = (v: number | null | undefined): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
};
const shortValue = (v: number | null | undefined): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
};

/** Whole days from today (UTC date math) to a YYYY-MM-DD close date; null when unknown. */
const daysLeft = (dateStr: string | null | undefined): number | null => {
  if (!dateStr) return null;
  const d = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d)) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((d - todayUtc) / 86_400_000);
};
const closeLabel = (dateStr: string | null | undefined): string => {
  if (!dateStr) return 'TBD';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

const isIT = (o: GovOpportunity): boolean => /it|software|cyber|technolog|system|digital|data/i.test(`${o.category ?? ''} ${o.title}`);
const isConsulting = (o: GovOpportunity): boolean => /consult/i.test(`${o.category ?? ''} ${o.title}`);

/** An opportunity Opportunity Pulse flagged (no_bid / needs_review) or that was declined — never a candidate. */
const isFlaggedForReview = (o: GovOpportunity): boolean => {
  const s = o.vetVerdict?.status;
  return s === 'no_bid' || s === 'needs_review' || o.pursuitStatus === 'declined';
};

type CatFilter = 'all' | 'it' | 'consulting';
type SortKey = 'priority' | 'fit' | 'closing' | 'value';

/** The segmented High/Med/Low distribution bar + legend text. */
function MixBar({ label, items }: { label: string; items: Array<number | null | undefined> }): React.ReactElement {
  const high = items.filter((s) => typeof s === 'number' && s >= 75).length;
  const med = items.filter((s) => typeof s === 'number' && s >= 60 && s < 75).length;
  const low = items.filter((s) => typeof s === 'number' && s < 60).length;
  const total = Math.max(high + med + low, 1);
  const seg = (n: number, tone: string) => n > 0 && <div className={`bg-${tone}`} style={{ width: `${(n / total) * 100}%` }} aria-hidden="true" />;
  return (
    <div className="d-flex align-items-center gap-3 flex-wrap">
      <span className="small fw-semibold" style={{ minWidth: 72 }}>{label}</span>
      <div className="d-flex rounded overflow-hidden flex-grow-1" style={{ height: 8, minWidth: 160, background: 'var(--surface-sunken)' }}>
        {seg(high, 'success')}{seg(med, 'warning')}{seg(low, 'danger')}
      </div>
      <span className="small text-secondary">{high} high · {med} med · {low} low</span>
    </div>
  );
}

/** A score chip: number + band label + a thin colored meter. */
function ScoreChip({ score }: { score: number | null | undefined }): React.ReactElement {
  const b = band(score);
  const pct = Math.max(0, Math.min(100, typeof score === 'number' ? score : 0));
  return (
    <div style={{ minWidth: 92 }}>
      <div className="d-flex align-items-center gap-2 mb-1">
        <span className={`badge ${subtle(b.tone)}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{typeof score === 'number' ? score : '—'}</span>
        <span className="small text-secondary">{b.label}</span>
      </div>
      <div className="progress" style={{ height: 4 }} role="presentation">
        <div className={`progress-bar bg-${b.tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * The per-row Details popup: why it surfaced (advisory scores + category + any OP verdict) and OP's PRELIMINARY,
 * UNVERIFIED overview. The overview is clearly labeled and can never become a confirmed requirement — qualification
 * (requirements, coverage, approval) happens in the separate workspace reached via Qualify.
 */
function DetailsModal({ opp, onClose, onQualify, onDismiss, dismissing }: {
  opp: GovOpportunity; onClose: () => void; onQualify: () => void; onDismiss: () => void; dismissing: boolean;
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const v = opp.vetVerdict;
  const dl = daysLeft(opp.closeDate);
  return (
    <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label="Opportunity details"
      style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable" role="document" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title">{opp.title}</h5>
              <div className="small text-secondary d-flex flex-wrap align-items-center gap-2 mt-1">
                <span>{opp.agency}</span>
                {opp.category && <span className="badge bg-secondary-subtle text-secondary-emphasis">{opp.category}</span>}
              </div>
            </div>
            <button type="button" className="btn-close" aria-label="Close" autoFocus onClick={onClose} />
          </div>
          <div className="modal-body">
            {/* Why it surfaced */}
            <div className="mb-3">
              <div className="text-uppercase small fw-semibold text-secondary mb-2" style={{ letterSpacing: '.05em' }}>Why it surfaced</div>
              <div className="d-flex flex-wrap gap-4">
                <div><div className="small text-secondary">Priority (legacy)</div><ScoreChip score={opp.priorityScore} /></div>
                <div><div className="small text-secondary">Fit (legacy)</div><ScoreChip score={opp.fitScore} /></div>
                <div>
                  <div className="small text-secondary">Est. value</div>
                  <div className="fw-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtValue(opp.estimatedValue)}</div>
                  <div className="small text-secondary">unverified</div>
                </div>
                <div>
                  <div className="small text-secondary">Closes</div>
                  <div>{closeLabel(opp.closeDate)}{dl !== null ? ` · ${dl} days` : ''} <i className="ri-error-warning-line text-warning" aria-hidden="true" title="Verify on the portal — timezone unverified." /></div>
                </div>
              </div>
              <div className="small text-secondary mt-2">
                {v
                  ? <><i className="ri-alert-line me-1" aria-hidden="true" />Source note: {(v.label ?? v.status ?? 'flagged').replace(/_/g, ' ')}{v.reason ? ` — ${v.reason}` : ''}<span className="text-secondary"> · method: {v.method ?? 'unknown'}{v.method === 'title_regex' || v.evidence == null ? ' (legacy, unevidenced — weak)' : ''}</span></>
                  : <>No source verdict — <strong>unassessed</strong>. Legacy discovery scores are advisory, not a verified company fit.</>}
              </div>
            </div>

            {/* Preliminary overview — labeled, unverified, never a requirement */}
            <div>
              <div className="text-uppercase small fw-semibold text-secondary mb-2" style={{ letterSpacing: '.05em' }}>Project overview</div>
              <div className="alert alert-warning py-2 px-3 small mb-2" role="note">
                <i className="ri-draft-line me-1" aria-hidden="true" />Preliminary, unverified — not confirmed requirements. Download and qualify the solicitation before relying on anything here.
              </div>
              {opp.preliminarySummary
                ? <p className="mb-0" style={{ whiteSpace: 'pre-line' }}>{opp.preliminarySummary}</p>
                : <p className="text-secondary mb-0">No preliminary summary available yet — open the source posting or qualify to learn more.</p>}
            </div>
          </div>
          <div className="modal-footer justify-content-between">
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={onDismiss} disabled={dismissing}>
              <i className="ri-eye-off-line me-1" aria-hidden="true" />{dismissing ? 'Dismissing…' : 'Dismiss'}
            </button>
            <div className="d-flex gap-2">
              {opp.sourceUrl && (
                <a className="btn btn-outline-secondary btn-sm" href={opp.sourceUrl} target="_blank" rel="noopener noreferrer">
                  <i className="ri-external-link-line me-1" aria-hidden="true" />Source
                </a>
              )}
              <button type="button" className="btn btn-danger btn-sm" onClick={onQualify}>Qualify <i className="ri-arrow-right-line" aria-hidden="true" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminGovOpportunitiesPage(): React.ReactElement {
  const navigate = useNavigate();
  const [feed, setFeed] = useState<GovOpportunityFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<CatFilter>('all');
  const [sort, setSort] = useState<SortKey>('priority');
  const [decentOnly, setDecentOnly] = useState(false);
  const [detailsOf, setDetailsOf] = useState<GovOpportunity | null>(null);
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);
  const [recentlyDismissed, setRecentlyDismissed] = useState<GovOpportunity[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFeed(await listGovOpportunities());
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not load government opportunities.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const opportunities = feed?.opportunities ?? [];
  const isLive = feed?.source === 'live';
  const candidates = useMemo(() => opportunities.filter((o) => !isFlaggedForReview(o)), [opportunities]);
  const flagged = useMemo(() => opportunities.filter(isFlaggedForReview), [opportunities]);

  // Derived summary — all from the discovery feed; estimates stay UNVERIFIED and are never called revenue.
  const stats = useMemo(() => {
    const sum = (list: GovOpportunity[]) => list.reduce((a, o) => a + (o.estimatedValue ?? 0), 0);
    const itVal = sum(candidates.filter(isIT));
    const consultVal = sum(candidates.filter((o) => !isIT(o) && isConsulting(o)));
    const pipeline = sum(candidates);
    const fits = candidates.map((o) => o.fitScore).filter((s): s is number => typeof s === 'number');
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const closing = candidates
      .map((o) => ({ o, d: daysLeft(o.closeDate) }))
      .filter((x) => x.d !== null && (x.d as number) <= 14)
      .sort((a, b) => (a.d as number) - (b.d as number));
    const unassessed = candidates.filter((o) => o.vetVerdict == null).length;
    const inPursuit = candidates.filter((o) => o.pursuitStatus === 'pursuing' || o.pursuitStatus === 'submitted').length;
    const goodFits = candidates.filter((o) => typeof o.fitScore === 'number' && o.fitScore >= GOOD_FIT).length;
    const decentCount = candidates.filter((o) => typeof o.fitScore === 'number' && o.fitScore >= DECENT_FIT).length;
    return {
      pipeline, itVal, consultVal, avgFit: avg(fits), goodFits, decentCount,
      closingCount: closing.length, nextClose: closing[0]?.o ?? null, unassessed, inPursuit,
    };
  }, [candidates]);

  const shown = useMemo(() => {
    const list = candidates.filter((o) => {
      const catOk = catFilter === 'all' || (catFilter === 'it' ? isIT(o) : isConsulting(o) && !isIT(o));
      const decentOk = !decentOnly || (typeof o.fitScore === 'number' && o.fitScore >= DECENT_FIT);
      return catOk && decentOk;
    });
    const by: Record<SortKey, (a: GovOpportunity, b: GovOpportunity) => number> = {
      priority: (a, b) => (b.priorityScore ?? -1) - (a.priorityScore ?? -1),
      fit: (a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1),
      closing: (a, b) => (daysLeft(a.closeDate) ?? 1e9) - (daysLeft(b.closeDate) ?? 1e9),
      value: (a, b) => (b.estimatedValue ?? -1) - (a.estimatedValue ?? -1),
    };
    return [...list].sort(by[sort]);
  }, [candidates, catFilter, sort, decentOnly]);

  const dismissedCount = feed?.dismissedCount ?? 0;
  const totalAvailable = feed?.totalAvailable ?? candidates.length;

  const handleDismiss = useCallback(async (o: GovOpportunity) => {
    setActionError(null);
    setDismissingKey(o.uuid);
    try {
      await dismissGovOpportunity(o.uuid, { title: o.title, agency: o.agency });
      // Optimistically remove it from the feed and remember it for immediate restore.
      setFeed((prev) => (prev ? { ...prev, opportunities: prev.opportunities.filter((x) => x.uuid !== o.uuid), dismissedCount: (prev.dismissedCount ?? 0) + 1 } : prev));
      setRecentlyDismissed((prev) => (prev.some((x) => x.uuid === o.uuid) ? prev : [o, ...prev]));
      setDetailsOf(null);
    } catch (err: any) {
      setActionError(err?.response?.data?.error ?? 'Could not dismiss that opportunity. Please try again.');
    } finally {
      setDismissingKey(null);
    }
  }, []);

  const handleRestore = useCallback(async (o: GovOpportunity) => {
    setActionError(null);
    try {
      await restoreGovOpportunity(o.uuid);
      setRecentlyDismissed((prev) => prev.filter((x) => x.uuid !== o.uuid));
      await load(); // bring it back into the authoritative feed
    } catch (err: any) {
      setActionError(err?.response?.data?.error ?? 'Could not restore that opportunity. Please try again.');
    }
  }, [load]);

  const livePill = isLive
    ? <span className="badge rounded-pill d-inline-flex align-items-center gap-1 bg-success-subtle text-success-emphasis"><i className="ri-broadcast-line" aria-hidden="true" />Live from Opportunity Pulse</span>
    : <span className="badge rounded-pill d-inline-flex align-items-center gap-1 bg-warning-subtle text-warning-emphasis"><i className="ri-archive-line" aria-hidden="true" />Snapshot{feed?.snapshotDate ? ` · ${feed.snapshotDate}` : ''}</span>;

  const itCount = candidates.filter(isIT).length;
  const consultingCount = candidates.filter((o) => !isIT(o) && isConsulting(o)).length;

  return (
    <div>
      <PageHeader
        title="Government Opportunities"
        subtitle="Discovered by Opportunity Pulse · each candidate needs qualification before it becomes a pursuit"
        icon="government-line"
        actions={feed ? livePill : undefined}
      />

      {/* ── Summary ─────────────────────────────────────────────────────────── */}
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-2">
          <div className="card text-bg-dark h-100 border-0 position-relative overflow-hidden">
            <div className="card-body">
              <div className="small text-uppercase" style={{ letterSpacing: '.05em', opacity: .7 }}>Pipeline value</div>
              <div className="fs-3 fw-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtValue(stats.pipeline)}</div>
              <div className="progress mt-2" style={{ height: 6, background: 'rgba(255,255,255,.14)' }} role="presentation">
                <div className="progress-bar bg-info" style={{ width: `${stats.pipeline ? (stats.itVal / stats.pipeline) * 100 : 0}%` }} />
                <div className="progress-bar bg-warning" style={{ width: `${stats.pipeline ? (stats.consultVal / stats.pipeline) * 100 : 0}%` }} />
              </div>
              <div className="small mt-1" style={{ opacity: .8 }}>IT {shortValue(stats.itVal)} · Consulting {shortValue(stats.consultVal)}</div>
              <div className="small mt-1" style={{ opacity: .55 }}>unverified source estimates · not revenue</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-lg-2">
          <StatCard label="Candidates" value={String(candidates.length)} icon="file-list-3-line" tone="primary" hint={`${stats.unassessed} unassessed · ${stats.inPursuit} in pursuit`} />
        </div>
        <div className="col-6 col-lg-2">
          <StatCard label="Good fits" value={String(stats.goodFits)} icon="focus-3-line" tone={stats.goodFits ? 'success' : 'neutral'}
            hint={`fit ≥ ${GOOD_FIT} · ${stats.decentCount} decent (≥ ${DECENT_FIT})`} />
        </div>
        <div className="col-6 col-lg-2">
          <StatCard label="Closing ≤ 14 days" value={String(stats.closingCount)} icon="time-line" tone={stats.closingCount ? 'danger' : 'neutral'}
            hint={stats.nextClose ? `Next ${closeLabel(stats.nextClose.closeDate)} · ${stats.nextClose.agency}` : 'None closing soon'} />
        </div>
        <div className="col-6 col-lg-2">
          <StatCard label="Avg fit (legacy)" value={stats.avgFit ?? '—'} icon="bar-chart-2-line" tone="warning"
            hint="advisory, not verified" />
        </div>
        <div className="col-6 col-lg-2">
          <StatCard label="Flagged for review" value={String(flagged.length)} icon="alert-line" tone={flagged.length ? 'warning' : 'neutral'}
            hint={flagged.length ? 'needs your review' : 'nothing waiting on you'} />
        </div>
      </div>

      {candidates.length > 0 && (
        <SectionCard className="mb-3">
          <div className="d-flex flex-column gap-2">
            <MixBar label="Priority mix" items={candidates.map((o) => o.priorityScore)} />
            <MixBar label="Fit mix" items={candidates.map((o) => o.fitScore)} />
            <div className="small text-secondary">Legacy discovery scores are advisory, not verified company fit. Qualification comes before any pursuit.</div>
          </div>
        </SectionCard>
      )}

      {/* ── Banners ─────────────────────────────────────────────────────────── */}
      {feed && !isLive && feed.snapshotReason === 'source_failed' && (
        <div className="alert alert-warning d-flex align-items-start gap-2" role="alert">
          <i className="ri-error-warning-line mt-1" aria-hidden="true" />
          <div>
            <strong>Live source unavailable — showing a saved snapshot{feed.snapshotDate ? ` from ${feed.snapshotDate}` : ''}.</strong>{' '}
            The Opportunity Pulse feed is configured but did not respond, so these are older saved candidates, not current results.
          </div>
        </div>
      )}
      {feed && !isLive && feed.snapshotReason !== 'source_failed' && (
        <div className="alert alert-info d-flex align-items-start gap-2" role="status">
          <i className="ri-information-line mt-1" aria-hidden="true" />
          <div>
            <strong>Snapshot{feed.snapshotDate ? ` as of ${feed.snapshotDate}` : ''}.</strong>{' '}
            The live Opportunity Pulse pull is not configured yet, so these are saved candidates.
          </div>
        </div>
      )}
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {actionError && <div className="alert alert-danger d-flex justify-content-between align-items-center" role="alert"><span>{actionError}</span><button type="button" className="btn-close" aria-label="Dismiss error" onClick={() => setActionError(null)} /></div>}

      {/* ── Candidates table ────────────────────────────────────────────────── */}
      {loading ? (
        <SectionCard title="Loading"><p className="text-secondary mb-0">Loading government opportunities…</p></SectionCard>
      ) : opportunities.length === 0 ? (
        <SectionCard title="No opportunities"><p className="text-secondary mb-0">No discovered candidates are available right now.</p></SectionCard>
      ) : (
        <SectionCard
          title="Discovered candidates"
          subtitle="Legacy discovery scores are advisory, not verified company fit. Qualification comes before any pursuit."
          icon="search-line"
          className="mb-3"
          actions={
            <div className="d-flex flex-wrap gap-2">
              <div className="btn-group btn-group-sm" role="group" aria-label="Filter by category">
                <button type="button" className={`btn ${catFilter === 'all' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setCatFilter('all')}>All {candidates.length}</button>
                <button type="button" className={`btn ${catFilter === 'it' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setCatFilter('it')}>IT {itCount}</button>
                <button type="button" className={`btn ${catFilter === 'consulting' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setCatFilter('consulting')}>Consulting {consultingCount}</button>
              </div>
              <button type="button" className={`btn btn-sm ${decentOnly ? 'btn-success' : 'btn-outline-success'}`} aria-pressed={decentOnly}
                onClick={() => setDecentOnly((v) => !v)} title={`Show only decent options (fit ≥ ${DECENT_FIT})`}>
                <i className="ri-filter-3-line me-1" aria-hidden="true" />Decent options {stats.decentCount}
              </button>
              <div className="btn-group btn-group-sm" role="group" aria-label="Sort by">
                {(['priority', 'fit', 'closing', 'value'] as SortKey[]).map((k) => (
                  <button key={k} type="button" className={`btn ${sort === k ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setSort(k)}>
                    {k === 'closing' ? 'Closing soon' : k[0].toUpperCase() + k.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
            <div className="small text-secondary">
              Showing <strong>{shown.length}</strong> of <strong>{totalAvailable}</strong> curated{totalAvailable > candidates.length ? ' (best-fit set)' : ''}
              {dismissedCount > 0 && <> · <strong>{dismissedCount}</strong> dismissed</>}
            </div>
            {recentlyDismissed.length > 0 && (
              <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => setShowDismissed((v) => !v)}>
                <i className="ri-eye-off-line me-1" aria-hidden="true" />Dismissed this session ({recentlyDismissed.length}) {showDismissed ? '▲' : '▼'}
              </button>
            )}
          </div>

          {showDismissed && recentlyDismissed.length > 0 && (
            <div className="alert alert-secondary py-2" role="region" aria-label="Dismissed opportunities">
              <ul className="list-unstyled mb-0">
                {recentlyDismissed.map((o) => (
                  <li key={o.uuid} className="d-flex justify-content-between align-items-center gap-2 py-1">
                    <span className="small"><span className="fw-semibold">{o.title}</span> <span className="text-secondary">· {o.agency}</span></span>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => handleRestore(o)}>
                      <i className="ri-arrow-go-back-line me-1" aria-hidden="true" />Restore
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {shown.length === 0 ? (
            <p className="text-secondary mb-0">No candidates in this filter.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr className="text-uppercase small text-secondary">
                    <th style={{ width: 36 }}>#</th>
                    <th>Opportunity</th>
                    <th style={{ width: 130 }}>Priority</th>
                    <th style={{ width: 130 }}>Fit</th>
                    <th style={{ width: 120 }}>Est. value</th>
                    <th style={{ width: 130 }}>Closes</th>
                    <th style={{ width: 230 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((o, i) => {
                    const dl = daysLeft(o.closeDate);
                    const soon = dl !== null && dl <= 14;
                    const unassessed = o.vetVerdict == null;
                    return (
                      <tr key={o.uuid}>
                        <td className="text-secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>{String(i + 1).padStart(2, '0')}</td>
                        <td>
                          <div className="fw-semibold">{o.title}</div>
                          <div className="small text-secondary d-flex flex-wrap align-items-center gap-2">
                            <span>{o.agency}</span>
                            {o.category && <span className="badge bg-secondary-subtle text-secondary-emphasis">{o.category}</span>}
                            {unassessed && <span className="badge bg-secondary-subtle text-secondary-emphasis" title="No review verdict (absent or null) — unassessed, never approved">Unassessed</span>}
                          </div>
                        </td>
                        <td><ScoreChip score={o.priorityScore} /></td>
                        <td><ScoreChip score={o.fitScore} /></td>
                        <td>
                          <div className="fw-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{shortValue(o.estimatedValue)}</div>
                          <div className="small text-secondary">unverified</div>
                        </td>
                        <td>
                          <div title="Deadline from the source; verify on the portal — timezone unverified.">
                            {closeLabel(o.closeDate)} <i className="ri-error-warning-line text-warning" aria-hidden="true" />
                          </div>
                          {dl !== null && <span className={`badge ${soon ? subtle('danger') : subtle('secondary')} mt-1`}>{dl} days left</span>}
                        </td>
                        <td>
                          <div className="d-flex flex-wrap gap-1">
                            {o.sourceUrl && (
                              <a className="btn btn-outline-secondary btn-sm" href={o.sourceUrl} target="_blank" rel="noopener noreferrer" title="Open the source posting">
                                <i className="ri-external-link-line me-1" aria-hidden="true" />Source
                              </a>
                            )}
                            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setDetailsOf(o)}
                              title="Why it surfaced + a preliminary overview">
                              <i className="ri-information-line me-1" aria-hidden="true" />Details
                            </button>
                            <button type="button" className="btn btn-outline-danger btn-sm" disabled={dismissingKey === o.uuid}
                              onClick={() => handleDismiss(o)} title="Hide this from the whole team's feed (reversible)">
                              <i className="ri-eye-off-line" aria-hidden="true" /><span className="visually-hidden">Dismiss</span>
                            </button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => navigate('/admin/gov-qualification')}
                              title="Qualify this opportunity (review source evidence before a pursuit)">
                              Qualify <i className="ri-arrow-right-line" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Flagged for review (never candidates) ───────────────────────────── */}
      {flagged.length > 0 && (
        <SectionCard title="Flagged for review — not recommended"
          subtitle="Opportunity Pulse marked these no-bid / needs-review, or they were declined" icon="alert-line" className="mb-3">
          <ul className="list-unstyled mb-0">
            {flagged.map((o) => {
              const v = o.vetVerdict;
              const weak = v != null && (v.method === 'title_regex' || v.evidence == null);
              return (
                <li key={o.uuid} className="py-2 border-bottom">
                  <div className="d-flex flex-wrap justify-content-between gap-2">
                    <div>
                      <div className="fw-semibold">{o.title}</div>
                      <div className="small text-secondary">{o.agency}{o.category ? ` · ${o.category}` : ''}</div>
                    </div>
                    {o.sourceUrl && (
                      <a className="btn btn-outline-secondary btn-sm align-self-start" href={o.sourceUrl} target="_blank" rel="noopener noreferrer">
                        <i className="ri-external-link-line me-1" aria-hidden="true" />Source
                      </a>
                    )}
                  </div>
                  {v && (
                    <div className="small text-warning-emphasis mt-1">
                      <i className="ri-alert-line me-1" aria-hidden="true" />
                      {(v.label ?? v.status ?? 'flagged').replace(/_/g, ' ')}{v.reason ? ` — ${v.reason}` : ''}{v.disqualifier ? ` (disqualifier: ${v.disqualifier})` : ''}
                      <span className="text-secondary"> · method: {v.method ?? 'unknown'}{weak ? ' — legacy, unevidenced (weak)' : (v.evidence ? ' — evidenced' : '')}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {detailsOf && (
        <DetailsModal
          opp={detailsOf}
          dismissing={dismissingKey === detailsOf.uuid}
          onClose={() => setDetailsOf(null)}
          onQualify={() => { setDetailsOf(null); navigate('/admin/gov-qualification'); }}
          onDismiss={() => handleDismiss(detailsOf)}
        />
      )}
    </div>
  );
}
