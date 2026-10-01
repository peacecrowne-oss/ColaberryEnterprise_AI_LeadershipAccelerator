/**
 * oppPulseClient — fetch the ranked best-fit government opportunities from Opportunity Pulse (the external
 * Bonfire platform at op.colaberry.ai) when configured, and DEGRADE DARK to the curated in-app snapshot
 * otherwise. Failure-first: every outbound call has an explicit timeout, one retry, errors are classified,
 * and ANY missing-config/failure falls back to the snapshot. This function NEVER throws and NEVER logs the key.
 *
 * Configuration (all read from env at call time):
 *   OPPORTUNITY_PULSE_API_KEY   — a scoped read-only key (op_<64 hex>) OP mints for the accelerator. Sent as
 *                                 the `X-API-Key` header. It is NOT an admin account — writes stay 401 — but it
 *                                 has admin-level READ so `sourceUrl` is returned un-redacted.
 *   OPPORTUNITY_PULSE_BASE      — default https://op.colaberry.ai
 *   OPPORTUNITY_PULSE_LIST_PATH — default /api/v1/bonfire/best-fit?limit=50 (the digest-parity endpoint, which
 *                                 delegates to richDigest.topBonfire; best-fit caps at ~50, so limit=50 surfaces the
 *                                 whole CURATED good set, not just the top 10. The generic /api/v1/bonfire/
 *                                 opportunities sorts NULL scores FIRST and is NOT the digest order).
 *
 * Each row is a BonfireOpportunity: { id(uuid), title, agency, priorityScore, fitScore (0-100 int, nullable),
 * estimatedValue (BIGINT CENTS returned as a JSON STRING), closeDate (ISO-8601 timestamptz), sourceUrl,
 * aiCategory, pursuitStatus ('none' | 'pursuing' | 'submitted' | 'declined'), ... } inside { data, pagination }.
 * NOTE: when BONFIRE_ENGINE_ENABLED is off, every /api/v1/bonfire/* route returns 404 — treated here as a
 * degrade, not a crash.
 */
import {
  GovOpportunity, GovOpportunityFeed, GOV_OPPORTUNITY_SNAPSHOT, SNAPSHOT_DATE,
  PursuitStatus, SnapshotReason, VetVerdict,
} from './govOpportunity';

const DEFAULT_BASE = 'https://op.colaberry.ai';
const DEFAULT_LIST_PATH = '/api/v1/bonfire/best-fit?limit=50';
const TIMEOUT_MS = 8000;
const VALID_PURSUIT: readonly string[] = ['none', 'pursuing', 'submitted', 'declined'];

/**
 * The labeled fallback. `reason` separates a deliberate dark state ('not_configured') from a configured feed
 * that actually FAILED ('source_failed') — the page must not describe a real outage as merely "not configured".
 */
function snapshotFeed(reason: SnapshotReason): GovOpportunityFeed {
  return { opportunities: [...GOV_OPPORTUNITY_SNAPSHOT], source: 'snapshot', snapshotDate: SNAPSHOT_DATE, snapshotReason: reason };
}

/**
 * A LIVE-path failure fell back to the snapshot. Structured, classified, and key-free, so a configured live
 * pull never fails silently (CLAUDE.md Observability). The unconfigured path does NOT log — that is a
 * deliberate dark state, not a failure.
 */
function logDegraded(event: string, context: Record<string, unknown>): void {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(), level: 'warn', service: 'opp-pulse',
    event, outcome: 'degraded', context,
  }));
}

const toNum = (v: unknown): number | null =>
  v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);

/** ISO-8601 timestamptz (or date) -> YYYY-MM-DD for display; null/empty stays null. */
const toDateOnly = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v).slice(0, 10);

// Verdict fields are text-only. A non-string (object, array, boolean, number) is INVALID and becomes null —
// never String()-coerced into "[object Object]" / "true" / "1", so malformed data can never masquerade as a
// real verdict, evidence, or method label.
const toStrOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

// Max characters forwarded for the preliminary summary — a sense-making blurb, not the full solicitation text.
const PRELIMINARY_SUMMARY_MAX = 2000;

// A length-capped, string-ONLY coercion for the preliminary summary. A non-string (object/array/number/boolean)
// is dropped to null (never String()-coerced), and the result is trimmed and hard-capped so a huge upstream blob
// can never bloat the browser payload. Display-only; this text can never become a confirmed requirement.
const toCappedSummary = (v: unknown): string | null => {
  const s = toStrOrNull(v);
  if (s === null) return null;
  const trimmed = s.trim();
  return trimmed.length > PRELIMINARY_SUMMARY_MAX ? `${trimmed.slice(0, PRELIMINARY_SUMMARY_MAX - 1)}…` : trimmed;
};

/**
 * Explicit nested allowlist for the verdict object — only known fields cross to the browser; every other nested
 * property is dropped. A non-object (or array, or a bare string) is MALFORMED and maps to null (unassessed), so
 * a malformed verdict can never be mistaken for a real assessment. `status`/`label`/`reason`/`disqualifier`/
 * `method`/`evidence` are the supported fields (aligned with gov-opportunity.v1 sourceAssessment.legacyVerdict).
 */
function mapVetVerdict(raw: unknown): VetVerdict | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: VetVerdict = {
    status: toStrOrNull(r.status),
    label: toStrOrNull(r.label),
    reason: toStrOrNull(r.reason),
    disqualifier: toStrOrNull(r.disqualifier),
    method: toStrOrNull(r.method),
    evidence: toStrOrNull(r.evidence),
  };
  // A verdict with no status/label/reason/disqualifier carries no assessable signal -> treat as unassessed.
  if (out.status === null && out.label === null && out.reason === null && out.disqualifier === null) return null;
  return out;
}

/**
 * Maps a raw BonfireOpportunity row to a GovOpportunity via an EXPLICIT ALLOWLIST — we never forward the whole
 * upstream row to the browser. We still omit submissionRequirements/rawText so they can't become confirmed
 * requirements; the source's overview/strategy IS forwarded, but ONLY as the length-capped, display-only
 * `preliminarySummary` (labeled "preliminary, unverified" in the UI) — it never reaches the qualification/coverage/
 * approval path, which is served by the separate opDetailClient. Grounded in the confirmed OP contract:
 *  - `estimatedValue` is BIGINT cents as a STRING; coerced then converted to dollars, and tagged `valueBasis`
 *    ('unverified' when OP sends no provenance) — the page renders it as unverified, never forecast revenue.
 *  - `pursuitStatus` (none|pursuing|submitted|declined) is preserved verbatim; `declined` stays distinct from
 *    `none`. `pursued` is only a derived convenience.
 *  - `vetVerdict` is preserved with the ABSENT vs null distinction (`vetVerdictPresent`); null == unassessed.
 *  - `closeAt` keeps the FULL source timestamp verbatim (OP flagged a tz-stripping parser — never silently
 *    shifted); `closeDate` is a display-only truncation.
 * Returns null when the two required anchors (uuid + title) are absent, so junk rows drop out.
 */
export function mapOpportunity(raw: any): GovOpportunity | null {
  if (!raw || typeof raw !== 'object') return null;
  const uuid = raw.uuid ?? raw.id ?? raw.opportunityId ?? raw.opportunity_id ?? null;
  const title = raw.title ?? raw.name ?? raw.opportunityTitle ?? raw.opportunity_title ?? null;
  if (!uuid || !title) return null;
  const cents = toNum(raw.estimatedValue ?? raw.estimated_value ?? raw.value);
  const closeRaw = raw.closeDate ?? raw.close_date ?? raw.deadline ?? raw.dueDate ?? raw.due_date ?? null;
  const rawStatus = raw.pursuitStatus ?? raw.pursuit_status;
  const pursuitStatus: PursuitStatus | null =
    typeof rawStatus === 'string' && VALID_PURSUIT.includes(rawStatus) ? (rawStatus as PursuitStatus) : null;
  const vetVerdictPresent = Object.prototype.hasOwnProperty.call(raw, 'vetVerdict');
  const hasFreshness = raw.enrichedAt !== undefined || raw.attachmentsFetchedAt !== undefined;
  return {
    uuid: String(uuid),
    externalId: raw.externalId ?? raw.external_id ?? null,
    title: String(title),
    agency: String(raw.agency ?? raw.agencyName ?? raw.agency_name ?? raw.buyer ?? ''),
    closeAt: closeRaw === null || closeRaw === undefined || closeRaw === '' ? null : String(closeRaw),
    closeDate: toDateOnly(closeRaw),
    fitScore: toNum(raw.fitScore ?? raw.fit_score ?? raw.fit ?? raw.score ?? raw.matchScore),
    priorityScore: toNum(raw.priorityScore ?? raw.priority_score ?? raw.priority),
    estimatedValue: cents === null ? null : Math.round(cents / 100),
    valueBasis: raw.valueBasis ?? raw.value_basis ?? (cents !== null ? 'unverified' : null),
    category: raw.aiCategory ?? raw.category ?? raw.categoryRaw ?? null,
    sourceUrl: raw.sourceUrl ?? raw.source_url ?? raw.bonfire ?? raw.url ?? null,
    pursuitStatus,
    pursued: pursuitStatus !== null
      ? (pursuitStatus === 'pursuing' || pursuitStatus === 'submitted')
      : (raw.pursued === undefined ? undefined : !!raw.pursued),
    vetVerdict: mapVetVerdict(raw.vetVerdict),
    vetVerdictPresent,
    freshness: hasFreshness ? { enrichedAt: raw.enrichedAt ?? null, attachmentsFetchedAt: raw.attachmentsFetchedAt ?? null } : null,
    // Preliminary, UNVERIFIED blurb for the Details popup — overview preferred, then strategy, then summary. Capped
    // and string-only. Display-only: this is NOT a requirement and is never consumed by coverage/approval.
    preliminarySummary: toCappedSummary(raw.overview ?? raw.strategy ?? raw.summary),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The ranked best-fit gov opportunities: live from Opportunity Pulse when the API key is configured, else the
 * labeled snapshot. Never throws.
 */
export async function fetchBestFitOpportunities(): Promise<GovOpportunityFeed> {
  const base = process.env.OPPORTUNITY_PULSE_BASE || DEFAULT_BASE;
  const listPath = process.env.OPPORTUNITY_PULSE_LIST_PATH || DEFAULT_LIST_PATH;
  const apiKey = process.env.OPPORTUNITY_PULSE_API_KEY;

  // Not configured → degrade dark, no network call. This is the ONLY 'not_configured' path.
  if (!apiKey) return snapshotFeed('not_configured');

  const url = `${base}${listPath}`;
  const headers = { 'X-API-Key': apiKey };

  // One retry on a network/timeout error (not on an HTTP error — a 4xx/5xx is authoritative). A CONFIGURED
  // feed that fails degrades with reason 'source_failed', never 'not_configured'.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const listR = await fetchWithTimeout(url, { headers }, TIMEOUT_MS);
      if (!listR.ok) {
        // BONFIRE_ENGINE_ENABLED off returns 404 for every /api/v1/bonfire/* route — a degrade, not a bug.
        logDegraded(listR.status === 404 ? 'opp_pulse_engine_off_or_path' : 'opp_pulse_list_http', { status: listR.status });
        return snapshotFeed('source_failed');
      }
      const body: any = await listR.json().catch(() => null);
      // Confirmed envelope is { data: [...] }; trust `data`, not pagination.limit (which echoes the raw query).
      const rows = Array.isArray(body) ? body : (body?.data ?? body?.opportunities ?? body?.items ?? null);
      if (!Array.isArray(rows)) { logDegraded('opp_pulse_list_shape', {}); return snapshotFeed('source_failed'); }

      const opportunities = rows
        .map(mapOpportunity)
        .filter((o): o is GovOpportunity => o !== null);
      // How many the source has in total (best-fit caps ~50, the full pool is larger) so the page can say
      // "showing N of M". From pagination.total; falls back to the returned row count when OP omits it.
      const totalAvailable = toNum(body?.pagination?.total ?? body?.total) ?? opportunities.length;
      return { opportunities, source: 'live', snapshotDate: null, snapshotReason: null, totalAvailable };
    } catch (err: any) {
      if (attempt === 0) continue; // retry once on network/timeout
      logDegraded('opp_pulse_error', { error_class: err?.constructor?.name ?? 'Error', message: err?.message });
      return snapshotFeed('source_failed'); // any error → snapshot; never throw
    }
  }
  return snapshotFeed('source_failed'); // unreachable; belt-and-suspenders
}
