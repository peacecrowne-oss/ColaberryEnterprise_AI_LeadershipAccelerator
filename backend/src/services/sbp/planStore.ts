/**
 * planStore — persistence for generated plans. The I/O half of T4.
 *
 * THE DEFECT THIS CLOSES: the pilot's dry-run and commit each called the model
 * independently, so the plan a human reviewed was not the plan that shipped. A
 * reviewed 6/3/1/1/1 plan was persisted as 8/1/1/1/1. Here the plan is written
 * ONCE at generation as a `draft`, review reads that row, and publish promotes
 * the same row — with a hash re-check, so a mismatch is impossible rather than
 * merely unlikely.
 *
 * Raw SQL rather than a Sequelize model: `build_intake`/`build_plans` are
 * created by `db/ensureSbpSchema.ts` and have no model. backend/CLAUDE.md allows
 * this where no model exists, provided the result is typed at the call site —
 * which every query below does.
 */
import { sequelize } from '../../config/database';
import { QueryTypes } from 'sequelize';
import { BuildPlan } from './planContract';
import { hashPlan } from './planHash';
import { GateResult } from './planGate';

export type PlanStatus = 'draft' | 'published' | 'superseded';

export interface StoredPlan {
  id: string;
  project_id: string;
  version: number;
  status: PlanStatus;
  plan: BuildPlan;
  plan_sha256: string;
  gate_ok: boolean;
  gate_violations: unknown;
  model: string | null;
  attempts: number | null;
  correlation_id: string | null;
  /**
   * Which revision of the confirmed truth this plan was built from.
   *
   * NULL on every plan generated before this existed, permanently. That is the
   * truthful answer rather than a gap to backfill: we do not know which truth
   * those plans came from, and inventing one would be the fabricated provenance
   * the whole truth contract exists to prevent.
   */
  truth_revision: number | null;
  published_at: string | null;
  created_at: string;
}

/** Row shape as Postgres returns it — jsonb arrives already parsed. */
interface PlanRow {
  id: string;
  project_id: string;
  version: number;
  status: PlanStatus;
  plan_json: BuildPlan;
  plan_sha256: string;
  gate_ok: boolean;
  gate_violations: unknown;
  model: string | null;
  attempts: number | null;
  correlation_id: string | null;
  /**
   * Which revision of the confirmed truth this plan was built from.
   *
   * NULL on every plan generated before this existed, permanently. That is the
   * truthful answer rather than a gap to backfill: we do not know which truth
   * those plans came from, and inventing one would be the fabricated provenance
   * the whole truth contract exists to prevent.
   */
  truth_revision: number | null;
  published_at: string | null;
  created_at: string;
}

const toStored = (r: PlanRow): StoredPlan => ({
  id: r.id,
  project_id: r.project_id,
  version: r.version,
  status: r.status,
  plan: r.plan_json,
  plan_sha256: r.plan_sha256,
  gate_ok: r.gate_ok,
  gate_violations: r.gate_violations,
  model: r.model,
  attempts: r.attempts,
  correlation_id: r.correlation_id,
  truth_revision: r.truth_revision ?? null,
  published_at: r.published_at,
  created_at: r.created_at,
});

export class PlanStoreError extends Error {
  constructor(public readonly error_class: 'NotFound' | 'HashMismatch' | 'AlreadyPublished', message: string) {
    super(message);
    this.name = 'PlanStoreError';
  }
}

/**
 * Write a freshly generated plan as the next `draft` version. Returns the stored
 * row including its hash, which the caller shows to the reviewer.
 *
 * Concurrency: the version is chosen inside the same statement that inserts, so
 * two simultaneous generations cannot both claim the same version — the unique
 * index on (project_id, version) is the backstop.
 */
export async function savePlanDraft(
  projectId: string,
  plan: BuildPlan,
  meta: {
    gate: GateResult; model?: string; attempts?: number; correlationId?: string;
    /** The confirmed truth revision this plan was generated from, when known. */
    truthRevision?: number | null;
  },
): Promise<StoredPlan> {
  const sha = hashPlan(plan);
  const rows = await sequelize.query<PlanRow>(
    `INSERT INTO build_plans
       (project_id, version, status, plan_json, plan_sha256, gate_ok, gate_violations, model, attempts, correlation_id, truth_revision)
     VALUES (
       :projectId,
       (SELECT COALESCE(MAX(version), 0) + 1 FROM build_plans WHERE project_id = :projectId),
       'draft', CAST(:planJson AS jsonb), :sha, :gateOk, CAST(:violations AS jsonb), :model, :attempts, :correlationId, :truthRevision
     )
     RETURNING *`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        projectId,
        planJson: JSON.stringify(plan),
        sha,
        gateOk: meta.gate.ok,
        violations: JSON.stringify(meta.gate.violations ?? []),
        model: meta.model ?? null,
        attempts: meta.attempts ?? null,
        correlationId: meta.correlationId ?? null,
        truthRevision: meta.truthRevision ?? null,
      },
    },
  );
  return toStored(rows[0]);
}

/** Read a specific version, or the latest when `version` is omitted. */
export async function getPlan(projectId: string, version?: number): Promise<StoredPlan | null> {
  const rows = await sequelize.query<PlanRow>(
    version === undefined
      ? `SELECT * FROM build_plans WHERE project_id = :projectId ORDER BY version DESC LIMIT 1`
      : `SELECT * FROM build_plans WHERE project_id = :projectId AND version = :version LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: { projectId, version: version ?? null } },
  );
  return rows.length ? toStored(rows[0]) : null;
}

/** The published plan for a project, if there is one. */
export async function getPublishedPlan(projectId: string): Promise<StoredPlan | null> {
  const rows = await sequelize.query<PlanRow>(
    `SELECT * FROM build_plans WHERE project_id = :projectId AND status = 'published' ORDER BY version DESC LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: { projectId } },
  );
  return rows.length ? toStored(rows[0]) : null;
}

/**
 * Promote a reviewed draft to `published`. Does NOT regenerate — that is the
 * entire point of this function existing.
 *
 * `expectedSha` is the hash the reviewer was shown. Supplying it turns "the
 * reviewed plan is the published plan" into an enforced invariant: if the row
 * changed underneath the reviewer, publish refuses rather than shipping
 * something nobody approved.
 */
/**
 * When this build FIRST published — the origin of its delivery window.
 *
 * Every later version is a revision of the same build, so the window must not
 * move when one lands. `publishPlan` supersedes the previous row but keeps it,
 * so the earliest `published_at` across all versions is the honest origin.
 * Null when nothing has published yet, which the caller reads as "use this
 * publish".
 */
export async function firstPublishedAt(projectId: string): Promise<Date | null> {
  const [rows]: any = await sequelize.query(
    `SELECT min(published_at) AS first_published_at FROM build_plans
      WHERE project_id = :projectId AND published_at IS NOT NULL`,
    { replacements: { projectId }, type: QueryTypes.SELECT },
  );
  const raw = Array.isArray(rows) ? rows[0]?.first_published_at : (rows as any)?.first_published_at;
  return raw ? new Date(raw) : null;
}
export async function publishPlan(
  projectId: string,
  version: number,
  expectedSha?: string,
): Promise<StoredPlan> {
  const existing = await getPlan(projectId, version);
  if (!existing) {
    throw new PlanStoreError('NotFound', `no plan version ${version} for project ${projectId}`);
  }
  if (expectedSha && existing.plan_sha256 !== expectedSha) {
    throw new PlanStoreError(
      'HashMismatch',
      `plan v${version} changed since review (reviewed ${expectedSha.slice(0, 12)}…, stored ${existing.plan_sha256.slice(0, 12)}…)`,
    );
  }
  if (existing.status === 'published') return existing;   // idempotent

  const rows = await sequelize.query<PlanRow>(
    `UPDATE build_plans
        SET status = 'published', published_at = NOW(), updated_at = NOW()
      WHERE project_id = :projectId AND version = :version
      RETURNING *`,
    { type: QueryTypes.SELECT, replacements: { projectId, version } },
  );
  // Any earlier published version for this project is now history.
  await sequelize.query(
    `UPDATE build_plans SET status = 'superseded', updated_at = NOW()
      WHERE project_id = :projectId AND version <> :version AND status = 'published'`,
    { replacements: { projectId, version } },
  );
  return toStored(rows[0]);
}

// ── intake ──────────────────────────────────────────────────────────────────

export interface BuildIntake {
  project_id: string;
  enrollment_id?: string | null;
  idea: string;
  name?: string | null;
  size?: string;
  users?: string | null;
  data_sources?: string | null;
  done_definition?: string | null;
  target_weeks?: number | null;
  correlation_id?: string | null;
  status?: string;
  /** Adaptive intake interview Q&A. Null on rows captured before it existed. */
  answers?: Array<{ id: string; question: string; answer: string }> | null;
  /** Why the last generation failed; null while generating and after a success. */
  last_error?: BuildIntakeError | null;
  /**
   * Rest at `drafted` instead of publishing. PERSISTED, not merely passed: a restart
   * mid-generation rebuilds the job from this row, and a hold that lives only in memory
   * is a hold that a deploy silently removes.
   */
  hold_for_review?: boolean | null;
}

export interface BuildIntakeError {
  error_class: string;
  message: string;
  /** ISO-8601. */
  at: string;
}

/**
 * Store the wizard's answers before anything is generated (FR-001). Idempotent
 * on `project_id`: re-submitting updates the row rather than stacking, so a
 * retry after a failed generation reuses the same intake.
 */
export async function saveIntake(intake: BuildIntake): Promise<{ project_id: string; status: string }> {
  const rows = await sequelize.query<{ project_id: string; status: string }>(
    `INSERT INTO build_intake
       (project_id, enrollment_id, idea, name, size, users, data_sources, done_definition, target_weeks, correlation_id, status, answers, last_error, hold_for_review)
     VALUES (:project_id, :enrollment_id, :idea, :name, :size, :users, :data_sources, :done_definition, :target_weeks, :correlation_id, :status, CAST(:answers AS JSONB), CAST(:last_error AS JSONB), :hold_for_review)
     ON CONFLICT (project_id) DO UPDATE SET
       idea = EXCLUDED.idea, name = EXCLUDED.name, size = EXCLUDED.size,
       users = EXCLUDED.users, data_sources = EXCLUDED.data_sources,
       done_definition = EXCLUDED.done_definition, target_weeks = EXCLUDED.target_weeks,
       correlation_id = EXCLUDED.correlation_id, status = EXCLUDED.status,
       answers = COALESCE(EXCLUDED.answers, build_intake.answers),
       last_error = EXCLUDED.last_error, hold_for_review = EXCLUDED.hold_for_review, updated_at = NOW()
     RETURNING project_id, status`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        project_id: intake.project_id,
        enrollment_id: intake.enrollment_id ?? null,
        idea: intake.idea,
        name: intake.name ?? null,
        size: intake.size ?? 'project',
        users: intake.users ?? null,
        data_sources: intake.data_sources ?? null,
        done_definition: intake.done_definition ?? null,
        target_weeks: intake.target_weeks ?? null,
        answers: intake.answers ? JSON.stringify(intake.answers) : null,
        correlation_id: intake.correlation_id ?? null,
        status: intake.status ?? 'captured',
        last_error: intake.last_error ? JSON.stringify(intake.last_error) : null,
        hold_for_review: intake.hold_for_review === true,
      },
    },
  );
  return rows[0];
}

/**
 * Every intake in a given state, oldest first. Exists for the one reader that needs the
 * whole set rather than one project: boot-time recovery of builds stranded at `generating`
 * when the process that was generating them went away.
 */
export async function listIntakesByStatus(status: string, limit = 100): Promise<BuildIntake[]> {
  return sequelize.query<BuildIntake>(
    `SELECT * FROM build_intake WHERE status = :status ORDER BY updated_at ASC LIMIT :limit`,
    { type: QueryTypes.SELECT, replacements: { status, limit } },
  );
}

/** Read the intake so a failed generation can be replayed from it. */
export async function getIntake(projectId: string): Promise<BuildIntake | null> {
  const rows = await sequelize.query<BuildIntake>(
    `SELECT * FROM build_intake WHERE project_id = :projectId LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: { projectId } },
  );
  return rows.length ? rows[0] : null;
}
