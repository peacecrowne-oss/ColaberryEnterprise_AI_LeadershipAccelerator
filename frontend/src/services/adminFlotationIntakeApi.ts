import api from '../utils/api';

/**
 * The management door into the one project intake.
 *
 * These call `/api/admin/flotation/*`, which calls the same `startBuild` the portal wizard
 * does. An admin building a project from here gets exactly what a prospect converting from
 * AI Flotation gets, which is exactly what a student creating one in the portal gets - not
 * because three surfaces are kept aligned, but because there is one pipeline.
 */

export interface FlotationUnderstandingRow {
  id: string;
  title: string | null;
  source: string;
  items: number;
  confirmed_at: string | null;
  lead: { id: number; name: string | null; email: string; company: string | null } | null;
  enrollment: { id: string; tier: string; cohort_id: string | null } | null;
  /** `assigned` is the difference between a plan that exists and one they can see. */
  build: { project_id: string; started_at: string; assigned: boolean } | null;
}

export interface StartedBuild {
  ok: true;
  projectId: string;
  correlationId: string;
  status: string;
  reused: boolean;
  intake: { name: string; answers: Array<{ id: string; question: string; answer: string }>; dropped: unknown[] };
}

export async function listFlotationUnderstandings(): Promise<FlotationUnderstandingRow[]> {
  const { data } = await api.get<{ understandings: FlotationUnderstandingRow[] }>('/api/admin/flotation/understandings');
  return data.understandings ?? [];
}

export async function buildFromUnderstanding(
  understandingId: string,
  opts: { enrollmentId?: string; requireConfirmed?: boolean } = {},
): Promise<StartedBuild> {
  const { data } = await api.post<StartedBuild>(`/api/admin/flotation/understandings/${understandingId}/build`, {
    ...(opts.enrollmentId ? { enrollment_id: opts.enrollmentId } : {}),
    ...(opts.requireConfirmed ? { require_confirmed: true } : {}),
  });
  return data;
}

/**
 * The reason a build could not start, in a sentence. The server distinguishes "nowhere to
 * land" (409) from "not found" (404) from "it broke" (500), and so must this.
 */
export function describeBuildError(err: unknown): string {
  const res = (err as { response?: { status?: number; data?: { error?: string; reason?: string } } })?.response;
  if (res?.data?.error) return res.data.error;
  if (res?.status === 404) return 'That understanding no longer exists.';
  if (res?.status === 401 || res?.status === 403) return 'Your session cannot do this. Sign in again.';
  return 'The build could not be started. Nothing was created.';
}

// ── The interview itself, from the management side ──────────────────────────────────────
//
//     "I want that same exact intake on the Mgmt side so I can build projects for students."
//
// The server runs the same `runIntakeTurn` the public /start page calls. This client does
// what /start's does: keeps the transcript, mints one session id, posts the whole thing
// each turn. The session id is the extraction's idempotency key.

export interface IntakeTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface IntakeStudent {
  id: string;
  full_name: string | null;
  email: string;
  tier: string;
  cohort_id: string | null;
}

export type IntakeTurnResult =
  | { done: false; message: string; exchanges?: number; error_class?: string }
  | {
      done: true;
      message: string;
      understanding: 'created' | 'deduplicated' | 'failed' | 'skipped';
      understanding_id?: string;
      build?: { started: boolean; project_id?: string; reason?: string };
    };

export async function searchIntakeStudents(q: string): Promise<IntakeStudent[]> {
  const { data } = await api.get<{ enrollments: IntakeStudent[] }>('/api/admin/flotation/intake/enrollments', { params: { q } });
  return data.enrollments ?? [];
}

/** A document the admin attached, once the server has read the text out of it. */
export interface IntakeDocument {
  name: string;
  text: string;
}

export async function sendIntakeTurn(params: {
  enrollmentId: string;
  sessionId: string;
  turns: IntakeTurn[];
  /**
   * Re-sent every turn, like the transcript, because the endpoint keeps nothing between
   * turns. That is also what lets a reload resume the conversation with its documents.
   */
  documents?: IntakeDocument[];
}): Promise<IntakeTurnResult> {
  const { data } = await api.post<IntakeTurnResult>('/api/admin/flotation/intake/turn', {
    enrollment_id: params.enrollmentId,
    session_id: params.sessionId,
    turns: params.turns,
    ...(params.documents?.length ? { documents: params.documents } : {}),
  });
  return data;
}

/**
 * Read a document so the interview can use it.
 *
 *     "I should be able to add documents to this process that can be analyzed before
 *      submitting the next question."  (Ali, 2026-09-29)
 *
 * Extraction happens here and only here: the server returns text and keeps nothing, so
 * the caller holds it and sends it with each turn. Uploading BEFORE the next question is
 * the point — the admin sees what was actually read before deciding what to type, rather
 * than discovering a scanned PDF yielded nothing at the moment they expected an answer.
 */
export async function readIntakeDocument(file: File): Promise<{
  document: IntakeDocument;
  chars: number;
  clipped: boolean;
}> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<{ document: IntakeDocument; chars: number; clipped: boolean }>(
    '/api/admin/flotation/intake/document',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

// ── The spoken interview, from the management side ──────────────────────────────────────
//
// Places the same call "Call me now" on /start places, stamped with the student it is
// for. The vendor then talks to the webhook, not to the browser, so the page watches the
// call through `getIntakeCall` until it has become a project.

export type CallbackStatus = 'call_initiated' | 'deduplicated' | 'skipped' | 'failed';

export interface PlacedCall {
  status: CallbackStatus;
  lead_id: number;
  call_id: string | null;
  deduped: boolean;
  reason?: string;
  correlation_id: string;
}

export interface IntakeCallProgress {
  /** 'sent' = placed, 'delivered' = ended with the transcript in, 'failed' = did not complete. */
  call: {
    status: string;
    /** Synthflow's own word for where a `sent` call is right now: ringing, in-progress. */
    live_status: string | null;
    duration: number | null;
    has_transcript: boolean;
    /** The conversation, once the call has ended. Rendered where the typed one would be. */
    transcript: string;
    end_reason: string | null;
  };
  understanding: { id: string; status: string; title: string | null; items: number } | null;
  build: { project_id: string; started_at: string } | null;
}

export async function placeIntakeCall(params: { enrollmentId: string; phone: string; idea?: string }): Promise<PlacedCall> {
  const { data } = await api.post<PlacedCall>('/api/admin/flotation/intake/call', {
    enrollment_id: params.enrollmentId,
    phone: params.phone,
    ...(params.idea ? { idea: params.idea } : {}),
  });
  return data;
}

export async function getIntakeCall(callId: string): Promise<IntakeCallProgress> {
  const { data } = await api.get<IntakeCallProgress>(`/api/admin/flotation/intake/call/${encodeURIComponent(callId)}`);
  return data;
}

/** Why a call was not placed, in a sentence. The server says which, and so must this. */
export function describeCallError(err: unknown): string {
  const res = (err as { response?: { status?: number; data?: { error?: string; reason?: string; status?: string } } })?.response;
  const reason = res?.data?.reason;
  if (res?.data?.status === 'skipped') return `The call was not placed: ${reason || 'voice is not available right now'}.`;
  if (res?.data?.status === 'failed') return `The phone system refused the call: ${reason || 'upstream error'}. Nothing was created.`;
  if (res?.data?.error) return res.data.error;
  return 'The call could not be placed. Nothing was created.';
}
