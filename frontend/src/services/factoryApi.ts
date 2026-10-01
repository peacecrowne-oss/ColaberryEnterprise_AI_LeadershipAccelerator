/**
 * factoryApi — the Command Center's data access. Thin typed wrappers over the shared axios `api`
 * client (which attaches the admin_token and bounces to /admin/login on 401). The view-model types
 * mirror the backend's factoryProjectView output + the route's approval envelope; kept here because
 * the frontend cannot import backend types across the workspace boundary.
 */
import api from '../utils/api';

export interface GateCheck { code: string; label: string; ok: boolean; }
export interface CcTrack {
  trackType: string;
  status: string;
  owner: string | null;
  requirementIds: string[];
  linkedStudentProjectId: string | null;
}
export interface CcFlowNode {
  id: string;
  title: string;
  kind: 'START' | 'TASK' | 'DECISION' | 'END';
  executorType: string | null;
  performerRole: string | null;
  accountableRole: string | null;
  method: string;
  confidence: number | null;
  sourceEvidence: string[];
}
export interface CcFlowEdge { from: string; to: string; condition: string | null; isRework: boolean; }
export interface CcAllocation {
  taskId: string;
  taskTitle: string;
  executionClass: string;
  performer: string | null;
  accountable: string | null;
  rationale: string;
}
export interface CcRole {
  roleId: string;
  name: string;
  definition: string;
  executorType: string | null;
  isAgent: boolean;
  accountableHuman: string | null;
}
export interface CcRequirement {
  id: string;
  statement: string;
  kind: string;
  priority: string;
  evidenceState: string;
  tracks: string[];
  citedBy: string[];
}
export interface CcRoleMap { previousFunction: string; aiContribution: string; newRole: string; retained: string[]; }

export interface FactoryApprovalInfo {
  status: string;
  level: string | null;
  version: number;
  trackType: string;
  enrichmentStatus: string | null;
  contentHash: string | null;
}

export interface FactoryCommandCenterView {
  deliveryProjectId: string;
  contractName: string;
  isSample: boolean;
  gate: { ok: boolean; errorCount: number; checks: GateCheck[] };
  process: { id: string; businessOutcome: string; successCriterion: string } | null;
  tracks: CcTrack[];
  flow: { nodes: CcFlowNode[]; edges: CcFlowEdge[] };
  allocation: CcAllocation[];
  roster: CcRole[];
  compliance: CcRequirement[];
  roleMap: CcRoleMap[];
  workforce: { people: number; agents: number };
  approval: FactoryApprovalInfo | null;
}

/** The day-one fixture (the Phase-1 sample), always available. */
export async function getFactorySample(): Promise<FactoryCommandCenterView> {
  const { data } = await api.get<FactoryCommandCenterView>('/api/admin/factory/sample');
  return data;
}

/** A real delivery contract's decomposition; rejects (404) until one has been generated. */
export async function getFactoryContract(deliveryProjectId: string): Promise<FactoryCommandCenterView> {
  const { data } = await api.get<FactoryCommandCenterView>(`/api/admin/factory/contract/${encodeURIComponent(deliveryProjectId)}`);
  return data;
}

// ── Phase 4 write actions ────────────────────────────────────────────────────
export interface FactoryContractListItem {
  deliveryProjectId: string;
  name: string | null;
  trackType: string;
  status: string;
  version: number;
}
export interface ApproveContractBody {
  trackType: string;
  expectedVersion: number;
  level: 'documented' | 'full';
  enrichmentStatus: 'pending' | 'partial' | 'resolved';
}
export interface RequestChangesBody { trackType: string; reviewedVersion: number; reason: string; }
export interface ApprovalResult { id: string; version: number; status: string; approval_level: string; approved_at: string; }

/** Delivery contracts that have a persisted decomposition, so the page can default to a real one. */
export async function listFactoryContracts(): Promise<FactoryContractListItem[]> {
  const { data } = await api.get<{ contracts: FactoryContractListItem[] }>('/api/admin/factory/contracts');
  return data.contracts;
}

/** Approve a contract's decomposition (transactional, gate-checked, CAS-guarded). */
export async function approveFactoryContract(deliveryProjectId: string, body: ApproveContractBody): Promise<ApprovalResult> {
  const { data } = await api.post<ApprovalResult>(`/api/admin/factory/contract/${encodeURIComponent(deliveryProjectId)}/approve`, body);
  return data;
}

/** Record a "request changes" review against the version the reviewer looked at. */
export async function requestFactoryChanges(deliveryProjectId: string, body: RequestChangesBody): Promise<{ id: string; decision: string }> {
  const { data } = await api.post<{ id: string; decision: string }>(`/api/admin/factory/contract/${encodeURIComponent(deliveryProjectId)}/request-changes`, body);
  return data;
}

// ── Gov-entry (Phase 5 slice 1; qualification Phase 1) ───────────────────────
export type PursuitStatus = 'none' | 'pursuing' | 'submitted' | 'declined';
export interface VetVerdict {
  status?: string | null;
  label?: string | null;
  reason?: string | null;
  disqualifier?: string | null;
  /** 'title_regex' is weak evidence; 'document_deep_vet' | 'manual' | 'auto_signal'. */
  method?: string | null;
  /** null => asserted without evidence. */
  evidence?: string | null;
}
export type ValueBasis = 'published_ceiling' | 'estimated' | 'unverified';
export interface GovOpportunity {
  uuid: string;
  /** Stable upstream source id when provided (may be a title-derived alias, not a canonical key). */
  externalId?: string | null;
  title: string;
  agency: string;
  /** Display date (YYYY-MM-DD). */
  closeDate: string | null;
  /** Full source close timestamp — verify against the portal (OP flagged a tz-stripping parser). */
  closeAt?: string | null;
  fitScore: number | null;
  priorityScore?: number | null;
  estimatedValue: number | null;
  /** Provenance of estimatedValue; absent/'unverified' => show "Value unverified", never forecast revenue. */
  valueBasis?: ValueBasis | null;
  category?: string | null;
  sourceUrl: string | null;
  /** Full pursuit status; 'declined' stays distinct from 'none'. */
  pursuitStatus?: PursuitStatus | null;
  pursued?: boolean;
  /** OP's vetting verdict object, or null when present-but-unassessed. */
  vetVerdict?: VetVerdict | null;
  /** true => the verdict field was returned (even if null); false => absent. null verdict = unassessed. */
  vetVerdictPresent?: boolean;
  freshness?: { enrichedAt: string | null; attachmentsFetchedAt: string | null } | null;
  /**
   * OP's PRELIMINARY, UNVERIFIED project blurb (from overview/strategy), display-only in the Details popup. Shown
   * labeled "preliminary, unverified — not confirmed requirements"; NEVER a requirement. null when none supplied.
   */
  preliminarySummary?: string | null;
}
export type SnapshotReason = 'not_configured' | 'source_failed';
export interface GovOpportunityFeed {
  opportunities: GovOpportunity[];
  /** 'live' = pulled from Opportunity Pulse; 'snapshot' = the labeled in-app fallback. */
  source: 'live' | 'snapshot';
  snapshotDate: string | null;
  /** When snapshot: 'not_configured' (dark) vs 'source_failed' (configured feed that errored). */
  snapshotReason?: SnapshotReason | null;
  /** How many the source reported in total (best-fit caps ~50); null when unknown. Used for "showing N of M". */
  totalAvailable?: number | null;
  /** How many returned rows were hidden by active team dismissals this request; 0 if none. */
  dismissedCount?: number | null;
}
export interface StartOpportunityResult { deliveryProjectId: string; created: boolean; }

/** The discovered government candidates (live from Opportunity Pulse, or the labeled snapshot). */
export async function listGovOpportunities(): Promise<GovOpportunityFeed> {
  const { data } = await api.get<GovOpportunityFeed>('/api/admin/factory/opportunities');
  return data;
}

/** A persisted team dismissal row (one per tenant+opportunity). restoredAt null => active (hidden). */
export interface GovOpportunityDismissal {
  opportunity_key: string;
  title?: string | null;
  agency?: string | null;
  reason?: string | null;
  dismissed_by?: string | null;
  dismissed_at?: string | null;
  restored_at?: string | null;
}

/** Hide a discovered candidate from the WHOLE team's feed (reversible). Idempotent; keyed on OP's stable uuid. */
export async function dismissGovOpportunity(
  key: string,
  body: { reason?: string; title?: string; agency?: string } = {},
): Promise<{ dismissed: GovOpportunityDismissal }> {
  const { data } = await api.post<{ dismissed: GovOpportunityDismissal }>(
    `/api/admin/factory/opportunities/${encodeURIComponent(key)}/dismiss`, body,
  );
  return data;
}

/** Un-hide a previously dismissed candidate (recovery). Idempotent. */
export async function restoreGovOpportunity(key: string): Promise<{ restored: GovOpportunityDismissal | null }> {
  const { data } = await api.post<{ restored: GovOpportunityDismissal | null }>(
    `/api/admin/factory/opportunities/${encodeURIComponent(key)}/restore`, {},
  );
  return data;
}

/**
 * Phase 1: reachability of an EXISTING gov project only. New pursuits now require qualification, so the server
 * returns 409 { qualificationRequired } and creates nothing; the entry page no longer offers a create action.
 */
export async function startGovOpportunity(uuid: string, body: { title?: string; agency?: string } = {}): Promise<StartOpportunityResult> {
  const { data } = await api.post<StartOpportunityResult>(`/api/admin/factory/opportunities/${encodeURIComponent(uuid)}/start`, body);
  return data;
}

export interface IngestProposalResult { requirements: number; blocks: number; fileName: string; }

/** Upload a solicitation .zip; the factory extracts source-cited requirements and replaces the shell. */
export async function ingestProposal(deliveryProjectId: string, file: File): Promise<IngestProposalResult> {
  const form = new FormData();
  form.append('proposal', file);
  const { data } = await api.post<IngestProposalResult>(
    `/api/admin/factory/contract/${encodeURIComponent(deliveryProjectId)}/ingest-proposal`, form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export interface GenerateDecompositionResult { accepted: boolean; errorCount: number; }

/** Run the generation engine on the contract's requirements -> a task graph (approvable when gate-clean). */
export async function generateDecomposition(deliveryProjectId: string): Promise<GenerateDecompositionResult> {
  const { data } = await api.post<GenerateDecompositionResult>(
    `/api/admin/factory/contract/${encodeURIComponent(deliveryProjectId)}/generate`, {});
  return data;
}

// ── Gov Qualification Workspace (Phase 2) ────────────────────────────────────
/** One evaluated requirement: the server decides whether it BLOCKS a bid pursuit (missing evidence never passes). */
export interface QualRequirementEval { id: string; dueStage: string; applicability: string; blocking: boolean; reason: string | null; }
export interface QualRequirementsEvaluation {
  evals: QualRequirementEval[];
  blocking: QualRequirementEval[];
  deliveryObligations: QualRequirementEval[];
  byDueStage: Record<string, QualRequirementEval[]>;
  canApproveBid: boolean;
}
/** The server-authoritative source detail (a gov-opportunity.v1 subset). Advisory-only fields (legacy fit,
 *  legacyVerdict) are shown labeled as advisory — the qualification depends on evidence, not on OP's verdict. */
export interface QualSourceDetail {
  canonicalOpportunityId: string;
  sourceSnapshotVersion: number;
  isFixture?: boolean;
  notice: { noticeType: { value: string; isBindingSolicitation: boolean }; procurementType: { value: string }; contractVehicle: string | null };
  publisher: { leadBuyer: { name: string; jurisdiction: string }; officialSourceUrl: string | null };
  deadline: { originalText: string | null; utc: string | null; utcConfidence: string; conflicts: Array<{ originalText: string; utc: string | null; source: string }> };
  value: { published: { amountMinorUnits: number | null; currency: string; valueType: string } | null; modelEstimate: { amountMinorUnits: number | null; currency: string; notForRevenuePlanning: boolean } | null };
  documents: { coverage: string; counts: { listed: number; downloaded: number; parsed: number; inaccessible: number }; items?: Array<{ docId: string; filename: string; role: string; retrieval: { status: string } }> };
  requirements: Array<{ id: string; text: string; category: string; applicability: string; responsibleParty: string; dueStage: string; bindingStatus: string; evidenceRef?: { docId: string } | null }>;
  sourceAssessment: { legacyVerdict: { status: string | null; method: string | null; evidence: string | null } | null };
  legacy: { fitScore: number | null; priorityScore: number | null; pursuitStatus: string | null };
}
export interface QualEvidenceCoverage { sufficient: boolean; reasons: string[]; }
export interface ReviewedDocument { docId: string; role: string; method: string; filename: string | null; sha256: string | null; reviewedBy: string | null; reviewedAt: string | null; }
export interface QualificationRecord {
  id: string; bidding_entity: string; decision: string; version: number;
  rationale: string | null; source_snapshot_version: number | null; reviewer_identity_id: string | null;
  requirements_json?: { established?: EstablishedRequirement[]; reviewedDocuments?: ReviewedDocument[] } | null;
}
/** The resolved, honest source state (mirrors the server gate). */
export type QualSourceState = 'available' | 'degraded' | 'snapshot_unrecorded' | 'unavailable' | 'auth_failed' | 'malformed';
export interface GovQualificationWorkspace {
  canonicalOpportunityId: string;
  /** false today: OP's live v2 detail endpoint is not wired, so the source is a labeled fixture. */
  sourceLive: boolean;
  sourceState: QualSourceState;
  sourceStateLabel: string;
  sourceAvailable: boolean;
  sourceSnapshotVersion: number | null;
  snapshotRecorded: boolean;
  source: QualSourceDetail | null;
  evaluation: QualRequirementsEvaluation | null;
  coverage: QualEvidenceCoverage | null;
  qualification: QualificationRecord | null;
  changedSource: boolean;
  /** Server's verdict on whether an approval is currently permitted (source approvable + current + covered + unblocked). */
  canApprove: boolean;
}

/** A reviewer-established, cited applicable requirement (same shape the server coverage/blocking gate evaluates). */
export interface EstablishedRequirement {
  id: string; text: string; category?: string;
  applicability: 'always' | 'conditional' | 'not_applicable' | 'unknown';
  applicabilityEvidenceRef?: { docId: string } | null;
  responsibleParty?: string;
  dueStage: 'submission' | 'award' | 'delivery' | 'unknown';
  bindingStatus: string;
  evidenceRef?: { docId: string } | null;
}

/** The read-only qualification workspace for one opportunity (source facts + requirement evaluation + record). */
export async function getGovQualificationWorkspace(canonicalOpportunityId: string, biddingEntity?: string): Promise<GovQualificationWorkspace> {
  const q = biddingEntity ? `?biddingEntity=${encodeURIComponent(biddingEntity)}` : '';
  const { data } = await api.get<GovQualificationWorkspace>(`/api/admin/factory/qualification/${encodeURIComponent(canonicalOpportunityId)}${q}`);
  return data;
}

const qUrl = (canonicalOpportunityId: string, suffix = ''): string =>
  `/api/admin/factory/qualification/${encodeURIComponent(canonicalOpportunityId)}${suffix}`;

/** Open (create) a pending_review qualification, bound server-side to the re-fetched source snapshot. Idempotent. */
export async function createGovQualification(canonicalOpportunityId: string, body: { biddingEntity: string; deliveryProjectId?: string }): Promise<{ qualification: QualificationRecord }> {
  const { data } = await api.post(qUrl(canonicalOpportunityId), body);
  return data;
}

/** Record a NON-approval decision and/or the reviewer-established cited requirements. */
export async function recordGovQualificationDecision(canonicalOpportunityId: string, body: {
  biddingEntity: string; expectedVersion: number; decision: 'pending_review' | 'needs_evidence' | 'no_bid';
  rationale?: string; establishedRequirements?: EstablishedRequirement[];
}): Promise<{ qualification: QualificationRecord }> {
  const { data } = await api.post(qUrl(canonicalOpportunityId, '/decision'), body);
  return data;
}

/** Record a pursuit APPROVAL (server-side, source-snapshot bound; approver != reviewer enforced server-side). */
export async function approveGovQualification(canonicalOpportunityId: string, body: {
  biddingEntity: string; expectedVersion: number; decision: 'approved_bid_pursuit' | 'rfi_response'; rationale?: string;
}): Promise<{ qualification: QualificationRecord }> {
  const { data } = await api.post(qUrl(canonicalOpportunityId, '/approve'), body);
  return data;
}

/** Record a SEPARATE build authorization (a pursuit approval is not a build authorization). */
export async function authorizeGovBuild(canonicalOpportunityId: string, body: {
  deliveryProjectId: string; scope: string; resourceLimit: string; rationale?: string; govQualificationId?: string;
}): Promise<{ buildAuthorization: { id: string } }> {
  const { data } = await api.post(qUrl(canonicalOpportunityId, '/authorize-build'), body);
  return data;
}

/** Record ('add') or revoke a MANUAL document review — the reviewer uploads the manually-downloaded Bonfire ZIP
 *  (add) and attests to the authoritative docIds it covers, so the coverage gate can clear; the server computes
 *  the sha256. 'revoke' removes an attestation (no file needed). */
export async function reviewGovQualificationDocuments(canonicalOpportunityId: string, args: {
  biddingEntity: string; expectedVersion: number; mode: 'add' | 'revoke'; coveredDocIds: string[]; file?: File | null;
}): Promise<{ qualification: QualificationRecord }> {
  const form = new FormData();
  form.append('biddingEntity', args.biddingEntity);
  form.append('expectedVersion', String(args.expectedVersion));
  form.append('mode', args.mode);
  form.append('coveredDocIds', JSON.stringify(args.coveredDocIds));
  if (args.file) form.append('document', args.file);
  const { data } = await api.post(qUrl(canonicalOpportunityId, '/review-documents'), form, { headers: { 'Content-Type': 'multipart/form-data' } });
  return data;
}

export interface GovCandidate { canonicalOpportunityId: string; title: string | null; agency: string | null; noticeType: string | null; }
export interface GovCandidatesResult { available: boolean; reason?: 'not_configured' | 'source_failed'; candidates: GovCandidate[]; sourceLive: boolean; }

/** The TRUSTED discovery→canonical mapping (OP v2 list). When unavailable, `available:false` + reason — the UI
 *  surfaces the gap and never derives a canonical id from a title. */
export async function getGovOpportunityCandidates(): Promise<GovCandidatesResult> {
  const { data } = await api.get<GovCandidatesResult>('/api/admin/factory/qualification-candidates');
  return data;
}
