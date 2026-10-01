/**
 * A government-contract opportunity as the Factory entry page needs it — a DISCOVERED CANDIDATE that still
 * requires qualification, never a recommended pursuit. This is the explicit browser allowlist: we map only
 * these fields from the (much richer) upstream Opportunity Pulse row and never forward the whole response.
 *
 * Evidence discipline (Phase 1): the source's free-text submissionRequirements/rawText are UNVERIFIED and are
 * deliberately NOT surfaced here — they must not become confirmed requirements. The ONLY exception is
 * `preliminarySummary` (overview/strategy): a read-only, clearly-labeled "preliminary, unverified" blurb shown in
 * the discovery Details popup so a reviewer can get a sense of a candidate BEFORE downloading requirements. It is
 * display-only on the v1 discovery feed and can NEVER become a confirmed requirement — qualification requirements,
 * evidence coverage, and pursuit approval are served by the SEPARATE opDetailClient (v2) path, which does not read
 * this field. A null vetVerdict means UNASSESSED (never approved). A value with no verified provenance is shown as
 * unverified and never counted as forecast revenue. `enrichedAt` is freshness of enrichment, NOT proof the
 * portal/amendments were re-checked.
 */
export type PursuitStatus = 'none' | 'pursuing' | 'submitted' | 'declined';

/**
 * Opportunity Pulse's own vetting verdict — an EXPLICIT allowlist (no index signature), so unexpected nested
 * upstream properties can never reach the browser. `status` drives our review view; `method` + `evidence` let
 * the UI mark a weak/unevidenced legacy assessment (e.g. a title-regex verdict) clearly. This is a SOURCE
 * assessment, never an eligibility or approval decision.
 */
export interface VetVerdict {
  status?: string | null;
  /** Verbatim upstream label, when the source printed one. */
  label?: string | null;
  reason?: string | null;
  disqualifier?: string | null;
  /** How it was assessed — 'title_regex' is weak evidence; 'document_deep_vet' | 'manual' | 'auto_signal'. */
  method?: string | null;
  /** Supporting evidence; null means the verdict was asserted WITHOUT evidence. */
  evidence?: string | null;
}

/** Provenance of estimatedValue. OP does not yet send a basis, so a live value defaults to 'unverified'. */
export type ValueBasis = 'published_ceiling' | 'estimated' | 'unverified';

export interface GovOpportunity {
  /** Bonfire opportunity id (the external id space — distinct from delivery_projects.id). */
  uuid: string;
  /** Stable upstream source record id when provided (may be a title-derived ALIAS, not a dependable canonical key). */
  externalId?: string | null;
  title: string;
  agency: string;
  /** Display date (YYYY-MM-DD) derived from closeAt; null if unknown. */
  closeDate: string | null;
  /** FULL source close timestamp, preserved verbatim. NOT silently shifted — OP flagged a tz-stripping parser. */
  closeAt?: string | null;
  /** 0-100 best-fit score from Opportunity Pulse, or null. */
  fitScore: number | null;
  /** 0-100 priority score from Opportunity Pulse (the "priority" badge), or null/absent (snapshot omits it). */
  priorityScore?: number | null;
  /** Estimated contract value in USD, or null. NEVER forecast revenue — see valueBasis. */
  estimatedValue: number | null;
  /** Provenance of estimatedValue; absent/'unverified' => display "Value unverified". */
  valueBasis?: ValueBasis | null;
  /** AI category / sector tag from Opportunity Pulse (e.g. "IT Services"), or null/absent. */
  category?: string | null;
  /** Link to the agency's Bonfire portal / source, or null. Never invent a submission portal. */
  sourceUrl: string | null;
  /** Full pursuit status, preserved (none|pursuing|submitted|declined). declined MUST stay distinct from none. */
  pursuitStatus?: PursuitStatus | null;
  /** Whether it is actively pursued — derived convenience (pursuing|submitted). Not a substitute for pursuitStatus. */
  pursued?: boolean;
  /** OP's vetting verdict object, or null when present-but-unassessed. */
  vetVerdict?: VetVerdict | null;
  /** Distinguishes ABSENT (field not returned) from null (returned, unassessed). true => the field was present. */
  vetVerdictPresent?: boolean;
  /** Freshness signals — enrichment/attachment fetch times. Not proof the live portal was just checked. */
  freshness?: { enrichedAt: string | null; attachmentsFetchedAt: string | null } | null;
  /**
   * OP's PRELIMINARY, UNVERIFIED project blurb (from the source's overview/strategy free text), length-capped and
   * display-only. Shown in the discovery Details popup so a reviewer gets a sense of a candidate before downloading
   * requirements. NEVER a confirmed requirement and never read by the qualification/coverage/approval path. null
   * when the source supplied no usable text.
   */
  preliminarySummary?: string | null;
}

/** Why a feed degraded to the snapshot: a deliberate dark state vs a configured feed that actually FAILED. */
export type SnapshotReason = 'not_configured' | 'source_failed';

export interface GovOpportunityFeed {
  opportunities: GovOpportunity[];
  /** 'live' = pulled from Opportunity Pulse this request; 'snapshot' = the curated in-app fallback. */
  source: 'live' | 'snapshot';
  /** The snapshot's vintage (YYYY-MM-DD) when source === 'snapshot'; null when live. */
  snapshotDate: string | null;
  /** When source==='snapshot': 'not_configured' (dark) vs 'source_failed' (configured but errored). null when live. */
  snapshotReason?: SnapshotReason | null;
  /** How many the source reported in total (from OP pagination.total) before this page/limit; null when unknown. */
  totalAvailable?: number | null;
  /** How many returned rows were hidden by active team dismissals (added by the route after filtering); 0 if none. */
  dismissedCount?: number | null;
}

/**
 * The date GOV_OPPORTUNITY_SNAPSHOT was captured from Opportunity Pulse. Shown on the page so the snapshot
 * is honestly dated (its close dates are historical) until the live pull is configured.
 */
export const SNAPSHOT_DATE = '2026-06-08';

/**
 * Curated snapshot of the best-fit gov proposals, captured from Opportunity Pulse (mirrors the hand-filtered
 * software/system candidate list the gov-bid scripts already used). Static, not user input. Replaced by the
 * live feed once OP_ADMIN_* + OPPORTUNITY_PULSE_LIST_PATH are configured in the environment.
 */
export const GOV_OPPORTUNITY_SNAPSHOT: readonly GovOpportunity[] = [
  { uuid: '8d98ee56-e817-4cb1-93c9-863210cd8db5', title: 'SLCC RFP - Computer Maintenance Management System (CMMS)', agency: 'U3P Utah', closeDate: '2026-06-22', fitScore: 75, estimatedValue: 500000, sourceUrl: 'https://utah.bonfirehub.com/opportunities/238670', pursued: false },
  { uuid: '62033082-b414-410d-9ab3-c385b34acc80', title: 'RFP - Financial Reporting System for Harris County Auditor', agency: 'Harris County', closeDate: '2026-06-22', fitScore: 75, estimatedValue: 300000, sourceUrl: 'https://harriscountytx.bonfirehub.com/opportunities/206717', pursued: false },
  { uuid: '3f55d2af-8396-4089-86be-e2bd94f68fa6', title: 'RFP - Election Management System for Harris County Clerk', agency: 'Harris County', closeDate: '2026-06-22', fitScore: 70, estimatedValue: 1000000, sourceUrl: 'https://harriscountytx.bonfirehub.com/opportunities/206717', pursued: false },
  { uuid: '2e287828-9040-4948-98fe-a0250a5d66a5', title: 'RFP - Agenda and Meeting Management System for Harris County', agency: 'Harris County', closeDate: '2026-06-22', fitScore: 70, estimatedValue: 300000, sourceUrl: 'https://harriscountytx.bonfirehub.com/opportunities/206717', pursued: true },
  { uuid: 'a3e41e69-e7ce-4804-ad13-1f49c22d1885', title: 'Community Engagement Platform', agency: 'City of Detroit', closeDate: '2026-06-22', fitScore: 70, estimatedValue: 500000, sourceUrl: 'https://detroit.bonfirehub.com/opportunities/228082', pursued: false },
  { uuid: 'db592612-b5da-4392-820a-f2333d57ab81', title: 'Professional Licensing & Registration System Modernization', agency: 'U3P Utah', closeDate: '2026-06-23', fitScore: 75, estimatedValue: 1000000, sourceUrl: 'https://utah.bonfirehub.com/opportunities/236841', pursued: false },
  { uuid: 'f8df4b8d-fa4f-4130-9d67-b696677ecaf2', title: 'Data Center Network Infrastructure Services', agency: 'City of Dallas', closeDate: '2026-06-26', fitScore: 75, estimatedValue: 750000, sourceUrl: 'https://dallascityhall.bonfirehub.com/opportunities/', pursued: false },
  { uuid: '2f5fd926-05f6-4d02-9388-c0ae3b141aed', title: 'Multifamily Management System', agency: 'TDHCA', closeDate: '2026-06-29', fitScore: 70, estimatedValue: 750000, sourceUrl: 'https://tdhca-texas-gov.bonfirehub.com/opportunities/', pursued: false },
  { uuid: '4dc18cd6-a1a3-4bdd-86f4-b4e97c6d6dd7', title: 'Community Development Software for Housing', agency: 'UT Dallas', closeDate: '2026-06-30', fitScore: 70, estimatedValue: 500000, sourceUrl: 'https://utdallas.bonfirehub.com/opportunities/', pursued: false },
  { uuid: '3dd7cb9c-be0f-4396-82e8-3502b3b9c8c8', title: 'Juvenile Justice Control System Modernization', agency: 'Galveston County', closeDate: '2026-07-02', fitScore: 70, estimatedValue: 750000, sourceUrl: 'https://galvestoncountytx.bonfirehub.com/opportunities/', pursued: false },
];
