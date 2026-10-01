import api from '../utils/api';

/**
 * contentComposerApi — the client for /api/admin/content (the marketing composer).
 *
 * NOT the curriculum composer (`/api/admin/composer`, Experience Studio). Same word, different
 * product; the backend keeps them under different prefixes for the same reason this file has
 * a different name.
 *
 * Types mirror the backend field for field. `ConfirmationSummary` in particular is the exact
 * shape `composerConfirmation.ts` builds, because the confirmation surface is the last thing
 * an operator reads before a post goes out and a loosened type here would let a renamed field
 * render as blank without anything objecting.
 */

export type ProviderKey =
  | 'meta_facebook_page' | 'meta_instagram' | 'linkedin_organization' | 'linkedin_member'
  | 'youtube' | 'tiktok' | 'x';

export type ContentType = 'text' | 'image' | 'video' | 'carousel' | 'thread' | 'link' | 'poll' | 'document';

/** Mirrors backend content/pollSpec.ts. Stored as `metadata.poll` on the item. */
export interface Poll {
  question: string;
  options: string[];
  durationDays: number;
}

export type ContentItemStatus =
  | 'idea' | 'draft' | 'ready_for_review' | 'changes_requested' | 'approved' | 'scheduled'
  | 'publishing' | 'published' | 'validation_failed' | 'publish_failed' | 'partially_published'
  | 'cancelled' | 'expired' | 'removed_by_provider' | 'archived';

export type PublishMode = 'direct' | 'handoff';

export interface ProviderSummary {
  provider: ProviderKey;
  displayName: string;
  contentTypes: ContentType[];
  maxChars: number;
  linkBehavior: 'inline' | 'first_comment_recommended' | 'no_clickable_links' | 'attachment';
  mode: PublishMode;
  reasons: string[];
  asOf: string;
}

export interface ContentItem {
  id: string;
  tenant_id: string;
  brand_id: string | null;
  campaign_id: string | null;
  title: string;
  canonical_body: string | null;
  content_type: ContentType;
  status: ContentItemStatus;
  scheduled_for: string | null;
  revision: number;
  human_approved: boolean;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface ContentVariant {
  id: string;
  provider: ProviderKey;
  body: string | null;
  link_url: string | null;
  tracked_link_id: string | null;
  is_manually_edited: boolean;
  validation_state: 'unvalidated' | 'valid' | 'invalid' | 'handoff_required';
  validation_errors: VariantProblem[];
  metadata: { canonicalFingerprint?: string; stale?: boolean };
}

export interface Variant {
  provider: ProviderKey;
  text: string;
  source: 'generated' | 'edited';
  canonicalFingerprint: string;
  stale: boolean;
}

export interface VariantProblem {
  provider: ProviderKey;
  field: 'text' | 'hashtags' | 'contentType' | 'media' | 'links' | 'registry';
  severity: 'block' | 'warn';
  message: string;
}

export interface ItemValidation {
  ok: boolean;
  providers: { ok: boolean; variants: Array<{ provider: ProviderKey; ok: boolean; problems: VariantProblem[] }>; blockers: VariantProblem[] };
  governance: { ok: boolean; violations: Array<{ severity: string; message: string }> } | null;
}

export interface ItemLink {
  provider: ProviderKey;
  trackedLinkId: string;
  shortUrl: string;
  finalUrl: string;
  utm: Record<string, string>;
  reused: boolean;
}

export interface LocalTime { day: string; time: string; zone: string; offset: string; dayLabel: string }

export type ApprovalLabel =
  | 'Not requested' | 'Awaiting review' | 'Approved' | 'Changes requested' | 'Rejected'
  | 'Approval invalidated by a later edit' | 'Withdrawn';

export interface ConfirmationSummary {
  item: { id: string; title: string; status: ContentItemStatus; contentType: string; revision: number; poll: Poll | null };
  brand: { id: string; name: string; timezone: string; timezoneSource: 'brand' | 'default' } | null;
  campaign: { id: string; name: string; slug: string | null } | null;
  accounts: Array<{
    provider: ProviderKey; displayName: string; mode: PublishMode; reasons: string[];
    /** The brand's connected account this post publishes FROM; null when there is none. */
    account: { id: string; provider: string; displayName: string; handle: string | null; status: string } | null;
  }>;
  schedule: { utc: string; utcLabel: string; local: LocalTime; timezone: string; differsFromUtc: boolean } | null;
  copy: Array<{ provider: ProviderKey; text: string; source: 'generated' | 'edited'; stale: boolean; chars: number }>;
  assets: Array<{ id: string; filename: string | null; mimeType: string; altText: string | null; position: number }>;
  links: Array<{ provider: ProviderKey; shortUrl: string; finalUrl: string; utm: Record<string, string> }>;
  linkGaps: ProviderKey[];
  approval: {
    label: ApprovalLabel;
    itemStatus: ContentItemStatus;
    humanApproved: boolean;
    request: { status: string; requested_by: string | null; requested_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null } | null;
  };
  validation: { ran: boolean; ok: boolean; blockerCount: number; blockers: VariantProblem[] };
  readiness: { canSaveDraft: boolean; canSendForApproval: boolean; canSchedule: boolean; canPublishNow: boolean; publishLabel: string; reasons: string[] };
}

export type ComposerAction = 'save_draft' | 'send_for_approval' | 'schedule' | 'publish_now';

export interface ActionResponse {
  action: ComposerAction;
  item: ContentItem;
  approval_request_id: string | null;
  jobs: Array<{ id: string; provider: string; publishAt: string; created: boolean }>;
  validation: { ok: boolean; blockers: VariantProblem[] } | null;
}

export interface CreateDraftInput {
  brand_id: string;
  campaign_id?: string | null;
  title: string;
  canonical_body?: string;
  content_type?: ContentType;
  is_paid?: boolean;
  has_offer?: boolean;
  kinds?: string[];
  poll?: Poll | null;
}

export async function listProviders(): Promise<ProviderSummary[]> {
  const res = await api.get('/api/admin/content/providers');
  return res.data.providers ?? [];
}

export async function listItems(params?: { brand_id?: string; status?: ContentItemStatus; limit?: number }): Promise<ContentItem[]> {
  const res = await api.get('/api/admin/content', { params });
  return res.data.items ?? [];
}

export async function createDraft(input: CreateDraftInput): Promise<ContentItem> {
  const res = await api.post('/api/admin/content', input);
  return res.data.item;
}

export async function getItem(id: string): Promise<{ item: ContentItem; variants: ContentVariant[] }> {
  const res = await api.get(`/api/admin/content/${id}`);
  return { item: res.data.item, variants: res.data.variants ?? [] };
}

export async function updateItem(id: string, patch: { title?: string; canonical_body?: string; content_type?: ContentType; scheduled_for?: string | null; poll?: Poll | null }): Promise<ContentItem> {
  const res = await api.patch(`/api/admin/content/${id}`, patch);
  return res.data.item;
}

export async function generateVariants(id: string, providers: ProviderKey[]): Promise<Variant[]> {
  const res = await api.post(`/api/admin/content/${id}/variants/generate`, { providers });
  return res.data.variants ?? [];
}

export async function editVariant(id: string, provider: ProviderKey, text: string): Promise<Variant> {
  const res = await api.patch(`/api/admin/content/${id}/variants/${provider}`, { text });
  return res.data.variant;
}

export async function revertVariant(id: string, provider: ProviderKey): Promise<Variant> {
  const res = await api.post(`/api/admin/content/${id}/variants/${provider}/revert`);
  return res.data.variant;
}

export async function validateItem(id: string): Promise<ItemValidation> {
  const res = await api.post(`/api/admin/content/${id}/validate`);
  return res.data;
}

export async function generateLinks(id: string, destinationUrl: string): Promise<ItemLink[]> {
  const res = await api.post(`/api/admin/content/${id}/links`, { destination_url: destinationUrl });
  return res.data.links ?? [];
}

export async function getConfirmation(id: string): Promise<ConfirmationSummary> {
  const res = await api.get(`/api/admin/content/${id}/confirmation`);
  return res.data.confirmation;
}

export async function runAction(id: string, action: ComposerAction, scheduledFor?: string): Promise<ActionResponse> {
  const res = await api.post(`/api/admin/content/${id}/action`, scheduledFor ? { action, scheduled_for: scheduledFor } : { action });
  return res.data;
}

export async function assignCampaignSlug(
  campaignId: string,
  inputs: { offer?: string | null; audience?: string | null; brand_id?: string | null } = {},
): Promise<{ campaign_id: string; utm_campaign_slug: string; unchanged: boolean; brand_id: string | null }> {
  const res = await api.post(`/api/admin/campaigns/${campaignId}/slug`, inputs);
  return res.data;
}

export interface DraftedMessage {
  message: string;
  /** Bracketed holes the operator must fill before publishing. */
  placeholders: string[];
  /** Specifics the model produced that the brief did not support. Shown, never auto-removed. */
  unverifiedClaims: string[];
  model: string;
}

export async function draftCanonicalMessage(input: {
  topic: string;
  brand_id: string;
  campaign_id?: string | null;
  content_type?: string;
  is_paid?: boolean;
  has_offer?: boolean;
  destination_url?: string | null;
}): Promise<DraftedMessage> {
  const res = await api.post('/api/admin/content/draft-message', input);
  return res.data;
}

/** Mirrors `ItemMediaView` in backend/src/services/media/mediaAssetService.ts, field for field. */
export interface ItemMedia {
  mediaAssetId: string;
  mimeType: string;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  altText: string | null;
  position: number;
  originalFilename: string | null;
  /** Videos only; what the container's own header says. */
  durationMs: number | null;
  /** PDFs only, when the file states its page count plainly. */
  pages: number | null;
  /**
   * Short-lived signed URL for the actual file, so the preview can show it. Null when the server
   * has no public base URL configured - the preview falls back to a placeholder rather than
   * rendering a broken image.
   */
  url: string | null;
}

export async function listItemMedia(id: string): Promise<ItemMedia[]> {
  const res = await api.get(`/api/admin/content/${id}/media`);
  return res.data.media ?? [];
}

/**
 * Multipart, not JSON: the file goes in `file`, the description in `alt_text`.
 *
 * The header override is load-bearing. The shared `api` instance defaults to
 * `Content-Type: application/json`, and axios 1.x, seeing FormData under a JSON content type,
 * SERIALISES THE FORM TO JSON (`formDataToJSON`) - the file arrives as `{}` and multer sees no
 * upload. Naming `multipart/form-data` makes axios drop the header and let the browser set the
 * boundary. Same trick `AdminImportPage.tsx` uses.
 */
/** Bytes sent so far and the total, from the browser's own upload events. */
export type UploadProgress = (sent: number, total: number) => void;

export async function attachMedia(id: string, file: File, altText: string, onProgress?: UploadProgress): Promise<ItemMedia[]> {
  const form = new FormData();
  form.append('alt_text', altText);
  form.append('file', file, file.name);
  await api.post(`/api/admin/content/${id}/media`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // The browser reports bytes on the wire, which is what a person waiting on a 200 MB video
    // wants to see. `total` is the multipart body (a little over the file); the file size is the
    // fallback when the browser does not know the total.
    onUploadProgress: (e) => onProgress?.(e.loaded, e.total ?? file.size),
  });
  return listItemMedia(id);
}

export async function detachMedia(id: string, mediaAssetId: string): Promise<ItemMedia[]> {
  const res = await api.delete(`/api/admin/content/${id}/media/${mediaAssetId}`);
  return res.data.media ?? [];
}

export type ApprovalDecision = 'approved' | 'changes_requested' | 'rejected';

export async function decideApproval(id: string, decision: ApprovalDecision, note: string | null): Promise<{ item: ContentItem }> {
  const res = await api.post(`/api/admin/content/${id}/approval`, { decision, note });
  return { item: res.data.item };
}

// ── Publishing queue and receipts (/api/admin/publishing) ──────────────────────────────────

export type PublishingJobState = 'pending' | 'retrying' | 'claimed' | 'publishing' | 'published' | 'failed' | 'cancelled' | 'dead_lettered';

export interface PublishingJob {
  id: string;
  provider: ProviderKey;
  state: PublishingJobState;
  publish_at: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  last_error_class: string | null;
  dead_lettered_at: string | null;
  dead_letter_reason: string | null;
}

export interface HandoffPackage {
  /** Present for a poll post; the instructions string also spells it out. */
  poll?: Poll | null;
  provider: ProviderKey;
  displayName: string;
  reasons: string[];
  text: string;
  linkUrl: string | null;
  disclosureText: string | null;
  mediaRefs: string[];
  instructions: string;
}

export interface ExternalPublication {
  id: string;
  publishing_job_id: string | null;
  provider: ProviderKey;
  external_id: string;
  permalink: string | null;
  published_at: string | null;
  current_status: 'live' | 'handoff_pending' | 'removed' | string;
  metadata: { mode?: 'live' | 'dry_run' | 'handoff'; handoff?: HandoffPackage; [k: string]: unknown };
}

export interface WorkerRunResult {
  halted: boolean; haltReason: string | null; claimed: number; published: number; failed: number; retried: number; deadLettered: number; skipped: number;
}

export async function listJobs(itemId: string): Promise<PublishingJob[]> {
  const res = await api.get('/api/admin/publishing/jobs', { params: { item_id: itemId } });
  return res.data.jobs ?? [];
}

export async function listPublications(itemId: string): Promise<ExternalPublication[]> {
  const res = await api.get('/api/admin/publishing/publications', { params: { item_id: itemId } });
  return res.data.publications ?? [];
}

export async function retryJob(jobId: string): Promise<PublishingJob> {
  const res = await api.post(`/api/admin/publishing/jobs/${jobId}/retry`);
  return res.data.job;
}

export async function cancelJob(jobId: string, reason: string | null): Promise<PublishingJob> {
  const res = await api.post(`/api/admin/publishing/jobs/${jobId}/cancel`, { reason });
  return res.data.job;
}

export async function completeHandoff(publicationId: string, externalId: string, permalink: string | null): Promise<ExternalPublication> {
  const res = await api.post(`/api/admin/publishing/publications/${publicationId}/handoff-complete`, { external_id: externalId, permalink });
  return res.data.publication;
}

export async function runQueueNow(): Promise<WorkerRunResult> {
  const res = await api.post('/api/admin/publishing/run');
  return res.data.result;
}

/** The message a failed request carries, or a generic one. Never the raw axios error. */
export function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string; details?: unknown } } };
  const msg = e?.response?.data?.error;
  return typeof msg === 'string' && msg ? msg : fallback;
}
