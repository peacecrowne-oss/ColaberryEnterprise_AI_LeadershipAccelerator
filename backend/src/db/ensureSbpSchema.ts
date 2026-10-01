import { sequelize } from '../config/database';

/**
 * Student Build Pipeline (SBP) schema — `build_intake` and `build_plans`.
 *
 * Ensured via idempotent raw SQL rather than `sequelize.sync({ alter: true })`,
 * matching ensureWorkLedgerSchema/ensureInboxCaseSchema. Additive only: two new
 * tables, nothing existing is altered or dropped.
 *
 * `build_intake` (SBP-REQ-v1 FR-001) stores the student's answers BEFORE any
 * generation runs, so a failed or interrupted generation is replayable and a
 * provisioning failure can park the project in `awaiting_repo` without losing
 * the idea. Today the wizard discards all of this client-side.
 *
 * `build_plans` (FR-013 / plan task T4) stores a generated plan keyed on
 * (project_id, version). It exists so the plan a human REVIEWS is byte-identical
 * to the plan that gets persisted — currently the dry run and the commit each
 * call the model independently, which is how a reviewed 6/3/1/1/1 plan shipped
 * as 8/1/1/1/1.
 *
 * POST-CONDITION ASSERTION (see below): every statement here is best-effort and
 * only warns on failure, so "it didn't throw" is NOT evidence the schema landed.
 * Earlier in this workstream a `DROP INDEX` failed silently against a
 * constraint-backed index inside exactly this kind of loop and the fix shipped
 * green having done nothing. This function verifies its own outcome against the
 * catalog and logs a structured SchemaInvariantViolation if it did not.
 */
export async function ensureSbpSchema(): Promise<void> {
  const statements: string[] = [
    `CREATE TABLE IF NOT EXISTS build_intake (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       project_id UUID NOT NULL REFERENCES projects(id),
       enrollment_id UUID REFERENCES enrollments(id),
       idea TEXT NOT NULL,
       name VARCHAR(200),
       size VARCHAR(30) NOT NULL DEFAULT 'project',
       users TEXT,
       data_sources TEXT,
       done_definition TEXT,
       target_weeks INTEGER,
       correlation_id UUID,
       status VARCHAR(30) NOT NULL DEFAULT 'captured',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    // One live intake per project: re-submitting the wizard updates rather than
    // stacking rows, so the "same intake twice returns the same build" guarantee
    // (FR-001 idempotency) has something to key on.
    // The adaptive interview's Q&A. Added after the fixed users/data_sources/
    // done_definition columns, which only ever fit the three hardcoded questions
    // the wizard used to ask; those stay for older clients and existing rows.
    // Task due dates. There was no date field of any kind on student_tasks, so
    // a student could see their whole build and never learn when anything was
    // due. Dates are derived at publish from the cohort window and the plan's
    // own release weeks (see buildSchedule). `due_baseline_on` never changes
    // after the first publish: a plan that quietly rewrites its own deadlines
    // teaches the opposite of what a slipping project should teach.
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS due_on DATE`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS due_baseline_on DATE`,
    `CREATE INDEX IF NOT EXISTS idx_student_tasks_due ON student_tasks (due_on) WHERE due_on IS NOT NULL`,

    // Verification, as distinct from self-report. `status = 'complete'` is the
    // student's claim; `verified_at` is the platform having CONFIRMED the story
    // is actually done, and `verified_by` is who or what confirmed it (a human
    // reviewer's identity, or the agent/check that passed). They are separate
    // columns rather than a richer status value because points will be gated on
    // `verified_at` being set, and a gate needs a field that cannot be reached
    // by a student toggling their own checkbox.
    //
    // Nullable with no DEFAULT on purpose: a default would backdate every task a
    // live cohort has already marked complete into "verified", which is the one
    // outcome this column exists to prevent. Nullable + no default also keeps
    // this a catalog-only change in Postgres — no table rewrite, no exclusive
    // lock held while rows are copied — which is what makes it safe to run on
    // every boot against a table a cohort is using right now.
    // WHICH truth revision the plan was generated from (Unified Project
    // Discovery, Phase 4). Nullable and permanently so: a plan generated before
    // this column existed genuinely has no known basis, and backfilling a guess
    // would invent the provenance the truth contract exists to protect.
    //
    // THIS WAS MISSED ON THE FIRST SHIP, AND IT TOOK PRODUCTION BUILDS DOWN.
    // `savePlanDraft` INSERTs this column, so without it every INSERT throws and
    // no plan is ever saved: students reached "your plan generated, but we could
    // not open it up" on every build for 35 minutes on 2026-09-11. The migration
    // file existed and was never run, because nothing forced it. It is declared
    // here now, and in REQUIRED_COLUMNS below, so a boot on a database that lacks
    // it says so out loud instead of failing one INSERT at a time.
    `ALTER TABLE build_plans ADD COLUMN IF NOT EXISTS truth_revision INTEGER`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS verified_by TEXT`,

    // The evidence commit sha, FROZEN at award time. Same write-once discipline
    // as verified_at, and added for a specific defect: `evidence_records` keys
    // an award on `<story>@<sha-at-award-time>`, and the XP read was rebuilding
    // that key from the CURRENT repo state. A student who force-pushes or
    // squashes therefore orphaned their own banked award and the story read
    // 0 XP forever. The sha existed only inside a log line until now, so there
    // was nothing durable to look it up by.
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS verified_ref TEXT`,

    // The live verdict, refreshed on every sync: state, which acceptance
    // criteria are outstanding, the evidence commit, and why it is not verified
    // yet. `verified_at` above answers "was it confirmed"; this answers "what is
    // left", which is the question a student sitting at 3 of 4 criteria is
    // actually asking. JSONB rather than a second table because it is read
    // exactly once per task, always alongside the task, and never queried
    // across rows. Nullable, no default — same catalog-only, lock-free change.
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS verification_json JSONB`,

    `ALTER TABLE build_intake ADD COLUMN IF NOT EXISTS answers JSONB`,
    // Why the last generation failed: { error_class, message, at }. Null while
    // generating and after a success. Until 2026-09-16 the only record of a
    // failed build was a log line, and container recreation ate it: a student
    // whose wizard failed on 11 Sep was found on the 16th with nothing to
    // explain the five days she spent on the starter template.
    `ALTER TABLE build_intake ADD COLUMN IF NOT EXISTS last_error JSONB`,
    // The review hold has to OUTLIVE THE PROCESS. It arrived as a field on the in-memory
    // StartBuildInput, so a deploy mid-generation left `recoverStrandedBuilds` rebuilding
    // the job from this row with no hold in it - and the resumed build published itself to
    // the student. Measured on production 2026-10-01: container restarted 03:06:47, build
    // resumed 03:06:54, `sbp_autopublished` at 03:07:37 on a build started with
    // holdForReview: true. A safety property that evaporates on restart is not one.
    `ALTER TABLE build_intake ADD COLUMN IF NOT EXISTS hold_for_review BOOLEAN NOT NULL DEFAULT FALSE`,
    `CREATE UNIQUE INDEX IF NOT EXISTS build_intake_unique_project ON build_intake (project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_build_intake_enrollment ON build_intake (enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_build_intake_status ON build_intake (status)`,

    `CREATE TABLE IF NOT EXISTS build_plans (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       project_id UUID NOT NULL REFERENCES projects(id),
       version INTEGER NOT NULL DEFAULT 1,
       status VARCHAR(20) NOT NULL DEFAULT 'draft',
       plan_json JSONB NOT NULL,
       plan_sha256 VARCHAR(64) NOT NULL,
       gate_ok BOOLEAN NOT NULL DEFAULT FALSE,
       gate_violations JSONB,
       model VARCHAR(80),
       attempts INTEGER,
       correlation_id UUID,
       published_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    // Versions are immutable once written (FR-004): a regeneration is a new
    // version, never an overwrite.
    `CREATE UNIQUE INDEX IF NOT EXISTS build_plans_unique_project_version ON build_plans (project_id, version)`,
    `CREATE INDEX IF NOT EXISTS idx_build_plans_project ON build_plans (project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_build_plans_status ON build_plans (status)`,

    // Webhook delivery ledger. GitHub retries a delivery it believes failed —
    // including one we handled perfectly but answered slowly — and every retry
    // would otherwise re-run a verification pass that reads GitHub several
    // times. The award itself is already safe (evidence_records has its own
    // unique idempotency key), so this table is not the last line of defence;
    // it is the one that stops us spending a student's rate limit re-deciding a
    // question we already answered.
    //
    // `delivery_id` is GitHub's X-GitHub-Delivery UUID, unique per delivery and
    // stable across its retries — which is exactly the property that makes it
    // the right key.
    `CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
       delivery_id VARCHAR(120) PRIMARY KEY,
       event VARCHAR(60),
       repo_full_name VARCHAR(255),
       project_id UUID,
       outcome VARCHAR(30),
       received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    // Housekeeping reads only. The table is append-only and small (one row per
    // push per student), but a date index keeps any future prune cheap.
    `CREATE INDEX IF NOT EXISTS idx_github_webhook_deliveries_received ON github_webhook_deliveries (received_at)`,

    // PER-REPO webhook secret.
    //
    // Until now one `GITHUB_WEBHOOK_SECRET` covered every student repo. That was
    // survivable while the platform installed every hook itself; it stops being
    // survivable the moment students register their own, because the secret has
    // to be SHOWN to whoever registers it. One shared secret shown to thirty
    // students is a secret that lets any one of them forge pushes for all the
    // others — and student repos are public by default, so a single careless
    // commit would expose the whole cohort.
    //
    // One secret per connection instead. Its blast radius is exactly one repo.
    `ALTER TABLE github_connections ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(120)`,
  ];

  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] sbp schema stmt skipped:', err?.message);
    }
  }

  await assertSbpSchema();
}

/** What ensureSbpSchema must have produced. Checked, not assumed. */
export const REQUIRED_TABLES = ['build_intake', 'build_plans', 'github_webhook_deliveries'] as const;
/** Columns added after their table's first release. Checked, not assumed. */
export const REQUIRED_COLUMNS = [
  'build_intake.answers',
  'student_tasks.due_on',
  'student_tasks.due_baseline_on',
  // Missing ⇒ savePlanDraft's INSERT throws and NO plan is ever saved. See the
  // ALTER above for what that looked like in production.
  'build_plans.truth_revision',
  // If these two are missing, every task looks unverified forever and the points
  // gate silently awards nothing — a failure with no error attached to it.
  'student_tasks.verified_at',
  'student_tasks.verified_by',
  // Missing ⇒ the frozen evidence sha is never persisted, and every XP lookup
  // falls back to matching the current repo state — which is the defect the
  // column exists to close.
  'student_tasks.verified_ref',
  // Missing => every student repo falls back to the one shared secret, which is
  // the exact exposure per-repo secrets exist to close.
  'github_connections.webhook_secret',
  // Missing ⇒ the verification loop writes a verdict Sequelize silently drops,
  // and every story renders "not started" while the run logs success.
  'student_tasks.verification_json',
] as const;
const REQUIRED_INDEXES = [
  'build_intake_unique_project',
  'build_plans_unique_project_version',
] as const;

/**
 * Verify the post-condition against the catalog and report loudly if it is not
 * met. Exported so a test can prove the assertion actually fires against an
 * un-migrated database — an assertion nobody has seen fail is not an assertion.
 */
export async function assertSbpSchema(): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  try {
    const [rows]: any = await sequelize.query(
      `SELECT
         (SELECT array_agg(table_name) FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ANY($tables)) AS tables,
         (SELECT array_agg(indexname) FROM pg_indexes
           WHERE schemaname = 'public' AND indexname = ANY($indexes)) AS indexes`,
      { bind: { tables: [...REQUIRED_TABLES], indexes: [...REQUIRED_INDEXES] } },
    );
    const foundTables: string[] = rows?.[0]?.tables ?? [];
    const foundIndexes: string[] = rows?.[0]?.indexes ?? [];
    for (const t of REQUIRED_TABLES) if (!foundTables.includes(t)) missing.push(`table:${t}`);
    for (const i of REQUIRED_INDEXES) if (!foundIndexes.includes(i)) missing.push(`index:${i}`);

    // Columns added after a table's first release need checking separately:
    // CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so on any
    // database that already had these tables the ALTERs above are the only
    // thing that creates them — and a silently-skipped ALTER leaves the code
    // writing to a column that is not there.
    const [colRows]: any = await sequelize.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($tables)`,
      // Derived from REQUIRED_COLUMNS rather than hardcoded: a hardcoded list
      // silently stops covering any column added on a NEW table, and the entry
      // then reports missing on every boot forever while the column exists.
      // That happened with github_connections.webhook_secret.
      { bind: { tables: [...new Set(REQUIRED_COLUMNS.map((c) => c.split('.')[0]))] } },
    );
    const found = new Set((colRows ?? []).map((r: any) => `${r.table_name}.${r.column_name}`));
    for (const c of REQUIRED_COLUMNS) if (!found.has(c)) missing.push(`column:${c}`);
  } catch (err: any) {
    console.warn('[DB] sbp schema post-check could not run:', err?.message);
    return { ok: false, missing: ['post-check-failed'] };
  }

  if (missing.length > 0) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'backend',
      event: 'sbp_schema_incomplete',
      outcome: 'failure',
      error_class: 'SchemaInvariantViolation',
      context: {
        missing,
        impact: 'build intake cannot be persisted, so a failed generation is not replayable and the reviewed plan is not the plan that ships; a missing student_tasks column means the pipeline writes a value the table cannot hold and it is dropped without an error',
        remedy: 'inspect the [DB] sbp schema stmt skipped warnings above; the CREATE statements are idempotent and safe to re-run',
      },
    }));
    return { ok: false, missing };
  }

  console.log('[DB] SBP schema ensured (build_intake, build_plans)');
  return { ok: true, missing: [] };
}
