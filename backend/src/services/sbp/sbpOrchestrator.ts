/**
 * sbpOrchestrator — the chain that turns a student's idea into a buildable plan.
 *
 * Everything else in services/sbp/ is a correct, tested component that nothing
 * called. This is what calls them, in order:
 *
 *   intake → generate → gate → repair → persist(draft) → publish
 *          → render → commit to the workspace repo
 *
 * Three design rules the pilot taught us the hard way:
 *
 *  1. **Generate once.** The draft is written at generation and `publish`
 *     promotes THAT row. The pilot regenerated between review and commit, which
 *     is how a reviewed 6/3/1/1/1 plan shipped as 8/1/1/1/1.
 *  2. **Fail closed, and say why.** A plan that cannot pass the gate is never
 *     persisted as publishable. The violations are stored so the student sees
 *     what is missing rather than a spinner that stops.
 *  3. **Nothing waits on a human.** Generation ends by publishing a gate-clean
 *     plan itself (see `autoPublish`). There used to be a `[review]` step in
 *     this chain with nothing on either end of it: no UI offered the review, no
 *     UI offered the publish, and `publishBuild` had exactly one caller — an
 *     HTTP route nothing in the product called. So every gate-clean plan came
 *     to rest in `build_plans.status = 'draft'` and never became the lists,
 *     dates and prompts in `student_tasks` that the portal renders. Measured on
 *     2026-08-12/13: five students finished the wizard, five correct plans were
 *     generated, and all five students were left looking at the browser's local
 *     fallback build. Publishing is what makes a plan real, so publishing is
 *     part of generating.
 *
 * Generation is minutes long, so `startBuild` returns immediately and the work
 * runs on the bounded queue. State lives in `build_intake.status` and
 * `build_plans`, so a restart loses progress but never leaves a half-built plan
 * — the intake is always replayable.
 */
import { randomUUID } from 'crypto';
import { decomposeBuild } from './decomposeService';
import { tierTargets } from './buildTiers';
import { GateResult, formatViolations, blockingViolations, advisoryViolations, isPublishable } from './planGate';
import { gateAndRepair } from './planRepair';
import { scopeAgents, agentScopingEnabledFor } from './scopeAgents';
import { env } from '../../config/env';
import { BuildPlan } from './planContract';
import { renderDocs } from './renderDocs';
import { repoWriteAccessForProject } from './repoWriteAccess';
import { writeDocsToRepo, readRepoManifest } from './repoWriter';
import { loadBuildProgress } from './buildProgressSnapshot';
import { materializePlanAsTasks } from './materializeTasks';
import { markProjectPendingApproval } from '../projects/projectApprovalService';
import { Schedule } from './buildSchedule';
import { scheduleForEnrollment } from './scheduleForEnrollment';
import { hashPlan } from './planHash';
import {
  saveIntake, getIntake, savePlanDraft, getPlan, publishPlan, firstPublishedAt, StoredPlan, BuildIntake,
  listIntakesByStatus,
} from './planStore';
import { getProvisionQueue } from './boundedQueue';
import { setProjectNameIfEmpty } from './projectNaming';

/** Where a build is. Stored on `build_intake.status`. */
export type BuildStatus =
  | 'captured'        // intake saved, nothing generated yet
  | 'generating'      // a model call is in flight
  | 'gate_failed'     // generated, but the plan has BLOCKING violations — not publishable
  | 'drafted'         // gate-clean and stored, but not yet promoted. Since
                      // auto-publish this is a FAILURE state, not a resting
                      // one: the plan is good and something downstream of it
                      // (repo lookup, materialization, the database) refused.
                      // The student is told, and POST .../publish retries it.
  | 'published'       // promoted; documents written if a repo exists
  | 'awaiting_repo'   // published, but no repo to write documents into
  | 'failed';         // generation itself failed; intake is replayable

/** Statuses in which the plan has actually reached the student's portal. */
export const DELIVERED_STATUSES: ReadonlySet<BuildStatus> = new Set<BuildStatus>(['published', 'awaiting_repo']);

export interface BuildState {
  projectId: string;
  status: BuildStatus;
  correlationId: string | null;
  plan: StoredPlan | null;
  gate: GateResult | null;
  /** Present when status is 'failed'. */
  error?: { error_class: string; message: string };
}

function log(event: string, correlationId: string | null, outcome: string, ctx: Record<string, unknown>): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: outcome === 'failure' ? 'error' : 'info',
    service: 'sbp-orchestrator',
    event,
    correlation_id: correlationId,
    outcome,
    context: ctx,
  }));
}

export interface StartBuildInput {
  projectId: string;
  enrollmentId: string;
  idea: string;
  name?: string;
  size?: string;
  users?: string;
  dataSources?: string;
  doneDefinition?: string;
  targetWeeks?: number;
  /** The expanded requirements document, when one exists. Optional: the brief alone works. */
  document?: string;
  /**
   * Answers to the adaptive intake interview. Replaces the three fixed fields
   * above for any client new enough to send them; both are supported so a
   * cached older bundle still produces a build.
   */
  answers?: Array<{ id: string; question: string; answer: string; angle?: string }>;
  /**
   * Angles the description already answered, quoted, as the intake service
   * reported them. Carried through so the truth store files them as facts
   * rather than losing the one thing that made the short interview honest.
   */
  covered?: Array<{ angle: string; evidence: string }>;
  /**
   * Hold the finished plan at `drafted` for a human to read before anyone else
   * sees it. Default (undefined) keeps the student path exactly as it was:
   * auto-publish on, governed by `SBP_AUTO_PUBLISH`.
   *
   * This is the review step `autoPublishEnabled`'s own comment anticipated, per
   * build rather than per deployment. A reviewer-initiated build must not
   * materialise onto the person's Projects page the moment generation ends,
   * because then the reviewer is approving something the intern is already
   * looking at. The publish route is how the reviewer says yes, and it takes
   * `expected_sha256` so the plan they read is provably the plan that ships.
   */
  holdForReview?: boolean;
}

/**
 * Capture the intake and start generation. Returns as soon as the intake is
 * durable — generation continues on the queue.
 *
 * Idempotent on `projectId`: re-submitting updates the intake rather than
 * stacking, and a build already generating is not started twice.
 */
/**
 * Which revision of the confirmed truth a plan is about to be built from.
 *
 * BOUNDED, and that bound is not decoration. The first version of this read the
 * revision inline and unbounded, which put a database round trip into the
 * generation path with nothing stopping it taking as long as it liked. The
 * auto-publish suite caught it immediately by timing out, and the same shape in
 * production would have been every student's build waiting on a lookup that is
 * nice to have.
 *
 * A plan with an unknown basis is worse than one with a known basis and far
 * better than a build that hangs, so every failure here - slow, thrown, or
 * missing - records `null`, which already means "we do not know".
 */
/*
 * 750ms, lowered from 2000.
 *
 * NOT because it fixed a test - it did not. The auto-publish suite fails under
 * parallel load on a contended machine with or without this read, verified by
 * stashing the change and reproducing the same single failure. The number came
 * down because looking at it honestly, two seconds was never a budget for the
 * happy path: this is one indexed lookup of one row, milliseconds when the
 * database is healthy. Two seconds only ever bought time for an unhealthy one,
 * and spending that much of a student's build waiting on a value we are
 * explicitly willing to lose is the wrong trade.
 */
const TRUTH_REVISION_TIMEOUT_MS = 750;

async function readTruthRevision(projectId: string): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const lookup = (async () => {
      const { loadIntakeTruthAtRevision } = await import('./intakeTruthStore');
      return (await loadIntakeTruthAtRevision(projectId))?.revision ?? null;
    })();
    const bound = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TRUTH_REVISION_TIMEOUT_MS);
      // Never hold the process open for a value we are willing to lose.
      timer.unref?.();
    });
    return await Promise.race([lookup, bound]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function startBuild(input: StartBuildInput): Promise<{ projectId: string; correlationId: string; status: BuildStatus }> {
  const correlationId = randomUUID();

  const existing = await getIntake(input.projectId);
  if (existing?.status === 'generating') {
    log('sbp_build_already_running', correlationId, 'success', { projectId: input.projectId });
    return { projectId: input.projectId, correlationId, status: 'generating' };
  }

  await saveIntake({
    project_id: input.projectId,
    enrollment_id: input.enrollmentId,
    idea: input.idea,
    name: input.name ?? null,
    size: input.size ?? 'project',
    users: input.users ?? null,
    data_sources: input.dataSources ?? null,
    done_definition: input.doneDefinition ?? null,
    target_weeks: input.targetWeeks ?? null,
    answers: input.answers ?? null,
    correlation_id: correlationId,
    status: 'generating',
    // WRITTEN DOWN, because a deploy kills the queue but not the row. `recoverStrandedBuilds`
    // rebuilds the job from here, so a hold that existed only on this in-memory input was a
    // hold the next restart quietly dropped - and the build published itself to the student.
    hold_for_review: input.holdForReview === true,
  });
  log('sbp_build_started', correlationId, 'success', { projectId: input.projectId, idea_chars: input.idea.length });

  /*
   * THE INTAKE BECOMES TRUTH HERE, and here is the only place it can.
   *
   * Everything downstream reads `project_understandings` for this project - the
   * confirmation gate, the plan's truth revision, Story 000's own section, the
   * case-study hypothesis. On 2026-09-11 every one of those was found to be
   * correct in isolation and unreachable in practice, because nothing on the
   * real wizard path wrote the row they read. This is the write.
   *
   * IT CANNOT FAIL A BUILD. A student whose truth could not be recorded still
   * gets their plan; they lose the review screen, not the pipeline. Failure is
   * one classified log line and nothing else, because a thrown error here
   * would turn a nice-to-have into a build that never starts.
   */
  try {
    const { saveIntakeTruth } = await import('./intakeTruthStore');
    const truth = await saveIntakeTruth({
      projectId: input.projectId,
      idea: input.idea,
      answers: input.answers,
      covered: input.covered,
    });
    log('sbp_intake_truth_saved', correlationId, 'success', {
      projectId: input.projectId, outcome: truth.outcome, revision: truth.revision,
      items: truth.items.length, unmapped: truth.unmapped,
    });
  } catch (err) {
    log('sbp_intake_truth_failed', correlationId, 'failure', {
      projectId: input.projectId,
      error_class: (err as { name?: string })?.name ?? 'Error',
    });
  }

  // Name the project from what the student just typed. THIS IS THE FIRST MOMENT
  // THE NAME IS KNOWABLE: the `projects` row is created by POST /api/portal/
  // projects (projectService.buildAndActivateProject) before the wizard is ever
  // submitted, so there is nothing to name it with at creation.
  //
  // Until now the name stopped here — it went into `build_intake.name` and no
  // reader existed, so every student build carried `projects.name = NULL` and
  // the portal rendered the literal "Your build" for all 20 of them.
  //
  // Non-fatal on purpose: a build is worth more than its title, and this runs
  // before generation. It also cannot overwrite a name the student already set
  // (see setProjectNameIfEmpty), so re-submitting the wizard is a no-op here.
  await nameProject(input.projectId, input.name, 'intake', correlationId);

  // Bounded: a cohort starting together queues rather than fanning out. The
  // promise is deliberately not awaited — the caller gets its answer now — but
  // it is never unhandled, because a lost rejection is how a build silently dies.
  void getProvisionQueue()
    .run(() => runGeneration(input, correlationId), `generate:${input.projectId}`)
    .catch((err) => {
      log('sbp_build_queue_failed', correlationId, 'failure', {
        projectId: input.projectId, error_class: err?.error_class ?? 'Error', message: err?.message,
      });
    });

  return { projectId: input.projectId, correlationId, status: 'generating' };
}

/** generate → gate → persist. Never throws to the queue; records the outcome instead. */
async function runGeneration(input: StartBuildInput, correlationId: string): Promise<void> {
  const started = Date.now();
  try {
    const { plan, attempts, model, client } = await decomposeBuild({
      brief: buildBriefText(input),
      document: input.document ?? '',
      // FR-002: the tier the student picked has to change the plan's depth.
      // Without this every tier produced the same shared DEFAULT_TARGETS.
      targets: tierTargets(input.size),
      correlationId,
    });

    const source = `${buildBriefText(input)}\n${input.document ?? ''}`;

    // The gate is strict by design, so a first pass usually has a gap — the
    // first live run produced 3 violations. Repair closes them in place rather
    // than failing the student at the first one: without it a build stops at
    // "your plan has a gap" with no way forward, which is a worse experience
    // than the generic template this replaced.
    const repaired = await gateAndRepair(plan, source, {
      client, model, correlationId,
      onAttempt: (attempt, violations) => log('sbp_build_repairing', correlationId, 'partial', {
        projectId: input.projectId, attempt, violations,
      }),
    });
    const gate = repaired.gate;

    // A plan that repair could not make perfect still reaches the student, as
    // long as nothing left is BLOCKING. A lone `story_redundant_scaffold` used
    // to mean an empty Projects page; a slightly redundant story beats no plan.
    const publishable = isPublishable(gate.violations);

    // Scope the AI team from the finished plan. Deliberately AFTER the gate:
    // agents describe how the student's system runs, not whether the plan is
    // sound, and a scoping failure must never cost them a publishable build —
    // scopeAgents returns the plan untouched when anything goes wrong.
    const scoped = agentScopingEnabledFor(input.enrollmentId, env.sbpAgentScoping)
      ? await scopeAgents(repaired.plan, { client, correlationId })
      : { plan: repaired.plan, scoped: false, gated: [] as string[], reason: 'disabled' };
    if (scoped.gated.length) {
      log('sbp_agents_autonomy_capped', correlationId, 'partial', {
        projectId: input.projectId, agents: scoped.gated,
      });
    }

    /*
     * WHICH TRUTH THIS PLAN CAME FROM. Read at save time rather than passed in,
     * so the recorded revision is the one that existed when the plan was
     * written - not the one that existed when generation started, which can be
     * minutes earlier and a correction behind.
     *
     * A failure to read it records null rather than failing the build. A plan
     * with an unknown basis is worse than one with a known basis and better
     * than no plan at all, and null already means "we do not know".
     */
    const truthRevision = await readTruthRevision(input.projectId);

    const draft = await savePlanDraft(input.projectId, scoped.plan, {
      gate, model, attempts, correlationId, truthRevision,
    });
    await setStatus(input.projectId, publishable ? 'drafted' : 'gate_failed');

    log('sbp_build_generated', correlationId, gate.ok ? 'success' : 'partial', {
      projectId: input.projectId,
      duration_ms: Date.now() - started,
      attempts,
      requirements: repaired.plan.requirements.length,
      stories: repaired.plan.stories.length,
      agents: scoped.plan.agents?.length ?? 0,
      agents_scoped: scoped.scoped,
      agents_gated: scoped.gated.length,
      repair_attempts: repaired.attempts,
      repair_rejected: repaired.rejected,
      repaired_stories: repaired.changed.flat(),
      gate_ok: gate.ok,
      publishable,
      violations: gate.violations.length,
      blocking: blockingViolations(gate.violations).map((v) => v.rule),
      advisory: advisoryViolations(gate.violations).map((v) => v.rule),
    });
    if (!gate.ok) console.log(formatViolations(gate));

    // The step that was missing. A gate-clean plan is promoted here, in the same
    // job that generated it, so it becomes lists/dates/prompts the student can
    // actually see. A plan with blocking violations deliberately falls through:
    // it stays `gate_failed` with its violations stored, and the poll endpoint
    // hands the student the reason.
    if (publishable && input.holdForReview) {
      // Deliberately NOT a failure. The plan is gate-clean and durable; it is
      // waiting on a person, which is the one reading of `drafted` that is not
      // a defect. Logged so a build resting here is distinguishable from the
      // `sbp_autopublish_failed` kind at a glance.
      log('sbp_held_for_review', correlationId, 'success', {
        projectId: input.projectId, version: draft.version, sha256: draft.plan_sha256,
      });
    } else if (publishable) {
      await autoPublish(input.projectId, input.enrollmentId, draft.plan_sha256, correlationId);
    }
  } catch (err: any) {
    const error = { error_class: err?.error_class ?? err?.name ?? 'Error', message: String(err?.message ?? err) };
    await setStatus(input.projectId, 'failed', error).catch(() => { /* status write must not mask the real error */ });
    log('sbp_build_failed', correlationId, 'failure', {
      projectId: input.projectId,
      duration_ms: Date.now() - started,
      error_class: error.error_class,
      message: error.message,
    });
    // Heard the same minute, not found five days later. The log line above
    // does not survive a container recreation; this does, and it emails.
    // Imported here, not at the top: alertService pulls the Alert model in, and
    // every orchestrator suite stubs the database.
    const { emitAlert } = await import('../alertService');
    await emitAlert({
      type: 'warning', severity: 3, urgency: 'high', sourceType: 'system', impactArea: 'student_builds',
      entityType: 'project', entityId: input.projectId,
      title: `Build plan failed to generate: ${input.name || input.projectId}`,
      description: `Generation for "${input.name || input.projectId}" failed with ${error.error_class}: ${error.message.slice(0, 300)}. `
        + 'The student has the starter template until this is retried (POST /api/portal/sbp/builds/:projectId/retry, or the Retry button on their build).',
      metadata: { project_id: input.projectId, enrollment_id: input.enrollmentId, correlation_id: correlationId, error_class: error.error_class },
    }).catch(() => { /* alerting must not mask the real error either */ });
  }
}

/**
 * Promote the plan generation just produced, without waiting for anyone.
 *
 * WHY IT CANNOT THROW: by the time this runs the plan is already durable. The
 * student's work is safe whatever happens next, and a publish failure must not
 * be reported as a generation failure — `failed` means "regenerate", `drafted`
 * means "the plan is good, retry the promotion", and telling a student to
 * regenerate a perfectly good plan burns minutes of model time for nothing.
 * So every failure is contained here, logged with its class, and leaves the
 * status at `drafted` for `POST /builds/:id/publish` to retry.
 *
 * `expectedSha` is the hash of the draft we just wrote. Passing it makes "the
 * plan we generated is the plan we published" enforced rather than assumed: if
 * a concurrent generation slipped a newer version underneath us, publishPlan
 * refuses on the mismatch instead of promoting a plan this run never graded.
 *
 * Idempotent, because everything it calls is: publishPlan returns the existing
 * row when the version is already published, materializePlanAsTasks upserts on
 * (project_id, story_id) and preserves completed work, and the active-project
 * write is a guarded UPDATE. Re-running it is a no-op, which is what makes the
 * manual retry safe.
 */
async function autoPublish(
  projectId: string, enrollmentId: string, expectedSha: string, correlationId: string | null,
): Promise<void> {
  if (!autoPublishEnabled()) {
    log('sbp_autopublish_disabled', correlationId, 'partial', { projectId });
    return;
  }
  const started = Date.now();
  try {
    const { repoForProject } = await import('./workspaceRepo');
    const repo = await repoForProject(projectId);
    const result = await publishBuild(projectId, { enrollmentId, expectedSha, repo });
    log('sbp_autopublished', correlationId, 'success', {
      projectId, duration_ms: Date.now() - started,
      status: result.status, version: result.planVersion,
      files: result.filesWritten, has_repo: Boolean(repo),
    });
  } catch (err: any) {
    // Named loudly. This is the difference between a student seeing their plan
    // and a student seeing the browser's fallback, so it is an error with a
    // class on it, not a swallowed exception.
    log('sbp_autopublish_failed', correlationId, 'failure', {
      projectId, duration_ms: Date.now() - started,
      error_class: err?.error_class ?? err?.name ?? 'Error',
      status: typeof err?.status === 'number' ? err.status : null,
      message: err?.message,
      recovery: 'plan is drafted and intact; POST /api/portal/sbp/builds/:projectId/publish retries',
    });
  }
}

/**
 * Auto-publish is ON unless explicitly switched off.
 *
 * Deliberately not a default-OFF flag like the rest of this subsystem. The whole
 * SBP surface already sits behind SBP_PIPELINE_ENABLED; a second default-OFF
 * flag in front of this one would mean shipping the fix and leaving production
 * in the exact broken state it is meant to end. `SBP_AUTO_PUBLISH=off` is the
 * kill switch if a review step is ever genuinely wanted — and when it is off,
 * the plan is still visibly `drafted` rather than silently stuck, and the
 * publish route is still there to promote it.
 */
function autoPublishEnabled(): boolean {
  return (process.env.SBP_AUTO_PUBLISH ?? 'on').trim().toLowerCase() !== 'off';
}

/**
 * The brief the decomposer treats as ground truth. Assembled from the wizard's
 * answers rather than the idea alone, because the sharpening questions are
 * exactly the detail the pilot dropped.
 */
export function buildBriefText(input: StartBuildInput): string {
  const parts = [input.idea.trim()];
  // The adaptive interview, when the client ran one. Each answer is carried
  // with the question that produced it, so the decomposer reads the exchange
  // rather than a bare value whose meaning lived in a label it never sees.
  const answered = (input.answers ?? []).filter((a) => a.answer && a.answer.trim());
  if (answered.length) {
    parts.push(
      ['THE STUDENT ANSWERED THESE QUESTIONS ABOUT THEIR OWN PROJECT:', ...answered.map(
        (a) => `Q: ${a.question.trim()}\nA: ${a.answer.trim()}`,
      )].join('\n\n'),
    );
  }
  // Legacy fixed fields — still honoured when present so an older client works.
  if (input.users) parts.push(`WHO USES IT: ${input.users}`);
  if (input.dataSources) parts.push(`DATA SOURCES IT MUST CONNECT TO: ${input.dataSources}`);
  if (input.doneDefinition) parts.push(`WHAT DONE LOOKS LIKE (the guardrail): ${input.doneDefinition}`);
  // Scheduling context only. Phrased so it shapes release week ranges without
  // becoming a requirement — the first live run turned "TIMELINE: 6 weeks" into
  // REQ-016 "The system must be deployed within 6 weeks", which no story can
  // fulfil and which the coverage rule then flagged as an uncovered must-have.
  if (input.targetWeeks) {
    parts.push(
      `SCHEDULE (context for release planning, NOT a requirement — do not emit a requirement about the timeline): ` +
      `fit the releases into ${input.targetWeeks} weeks.`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Give the project a real name, from `source`, if it does not have one yet.
 *
 * Never throws. Naming is presentation: it must not be able to fail a build
 * that is otherwise fine, and at publish time the plan is already durable. But
 * it is logged with an error_class when it fails, because "every project has a
 * name" is a product promise and a silent miss is how the current state
 * (twenty unnamed builds) lasted as long as it did.
 */
async function nameProject(
  projectId: string, candidate: string | null | undefined,
  source: 'intake' | 'plan', correlationId: string | null,
): Promise<void> {
  try {
    const named = await setProjectNameIfEmpty(projectId, candidate);
    log(named ? 'sbp_project_named' : 'sbp_project_name_noop', correlationId, 'success', {
      projectId, source, named,
    });
  } catch (err: any) {
    log('sbp_project_name_failed', correlationId, 'failure', {
      projectId, source, error_class: err?.name ?? 'Error', message: err?.message,
      impact: 'the project renders the generic fallback title until it is named',
    });
  }
}

async function setStatus(
  projectId: string,
  status: BuildStatus,
  error: { error_class: string; message: string } | null = null,
): Promise<void> {
  const intake = await getIntake(projectId);
  if (!intake) return;
  // A failure carries its reason; any other status clears the previous one, so
  // a build that failed and was then regenerated does not keep telling the
  // student about the first attempt.
  const last_error = status === 'failed' && error
    ? { error_class: error.error_class, message: String(error.message || '').slice(0, 1000), at: new Date().toISOString() }
    : null;
  await saveIntake({ ...(intake as BuildIntake), project_id: projectId, status, last_error });
}

/**
 * Re-run generation from the intake already on file. What a student needs
 * when the wizard failed: the same answers, another attempt, no retyping.
 * Refused while a run is in flight (startBuild already handles that) and
 * when there is no intake to run from.
 */
export async function retryBuild(projectId: string, enrollmentId: string): Promise<{ projectId: string; correlationId: string; status: BuildStatus }> {
  const intake = await getIntake(projectId);
  if (!intake) throw Object.assign(new Error('No intake to retry from'), { status: 404, error_class: 'NoIntake' });
  return startBuild(inputFromIntake(intake, enrollmentId));
}

/** The intake on file, in the shape generation takes. */
function inputFromIntake(intake: BuildIntake, enrollmentId: string): StartBuildInput {
  return {
    projectId: intake.project_id,
    enrollmentId,
    idea: intake.idea,
    name: intake.name ?? undefined,
    size: intake.size ?? undefined,
    users: intake.users ?? undefined,
    dataSources: intake.data_sources ?? undefined,
    doneDefinition: intake.done_definition ?? undefined,
    targetWeeks: intake.target_weeks != null ? Number(intake.target_weeks) : undefined,
    answers: (intake.answers ?? undefined) as StartBuildInput['answers'],
    // Restored from the row. Without this the resumed generation is identical to the
    // original EXCEPT that it publishes, which is the one difference that matters.
    holdForReview: intake.hold_for_review === true,
  };
}

/**
 * Resume every build the last process left mid-generation.
 *
 * WHY THIS EXISTS. Generation runs on an in-process queue, and `generating` is written
 * to the database before it starts. When the process dies - and every deploy kills it -
 * the queue dies with it but the row does not. It sits at `generating` forever, and
 * `startBuild` refuses to touch a row in that state, so neither the student's retry nor
 * an admin's could ever recover it. A project started from a phone call during a deploy
 * would simply never appear, with nothing anywhere saying why. Found by reasoning, not
 * by a report: on 2026-09-16 an intake was stranded exactly this way by a one-off script
 * that exited before its queue drained.
 *
 * WHEN IT IS SAFE. At boot, before the server listens. The queue is per process and this
 * is a new process, so a `generating` row cannot belong to any live run - there is
 * nothing to race. Each instance sees only its own database, so a dev boot cannot resume
 * a prod build.
 *
 * WHAT IT SKIPS. `saveIntakeTruth` and `nameProject` ran the first time and are not
 * repeated; only generation is. A row with no enrolment cannot be resumed (generation
 * needs one to publish) and is marked failed with a reason, so it stops looking alive.
 *
 * Bounded by the queue it runs on. If a resumed generation fails, it fails the way any
 * generation fails - `failed` with `last_error` - and the student can retry.
 */
export async function recoverStrandedBuilds(): Promise<{ resumed: string[]; abandoned: string[] }> {
  const stranded = await listIntakesByStatus('generating');
  const resumed: string[] = [];
  const abandoned: string[] = [];

  for (const intake of stranded) {
    const correlationId = randomUUID();
    if (!intake.enrollment_id) {
      await setStatus(intake.project_id, 'failed', {
        error_class: 'StrandedWithoutEnrollment',
        message: 'generation was interrupted by a restart and the intake names no enrolment to resume for',
      }).catch(() => { /* nothing better to do; the next boot will try again */ });
      log('sbp_build_stranded_abandoned', correlationId, 'failure', { projectId: intake.project_id, error_class: 'StrandedWithoutEnrollment' });
      abandoned.push(intake.project_id);
      continue;
    }

    log('sbp_build_resumed_after_restart', correlationId, 'partial', {
      projectId: intake.project_id, previous_correlation_id: intake.correlation_id ?? null,
    });
    const input = inputFromIntake(intake, intake.enrollment_id);
    void getProvisionQueue()
      .run(() => runGeneration(input, correlationId), `generate:${intake.project_id}`)
      .catch((err) => {
        log('sbp_build_queue_failed', correlationId, 'failure', {
          projectId: intake.project_id, error_class: err?.error_class ?? 'Error', message: err?.message,
        });
      });
    resumed.push(intake.project_id);
  }

  if (stranded.length) {
    log('sbp_stranded_builds_swept', randomUUID(), abandoned.length ? 'partial' : 'success', {
      resumed: resumed.length, abandoned: abandoned.length,
    });
  }
  return { resumed, abandoned };
}

/** Current state of a build, for polling. */
export async function getBuildState(projectId: string): Promise<BuildState | null> {
  const intake = await getIntake(projectId);
  if (!intake) return null;
  const plan = await getPlan(projectId);
  return {
    projectId,
    status: (intake.status as BuildStatus) ?? 'captured',
    ...(intake.status === 'failed' && intake.last_error
      ? { error: { error_class: intake.last_error.error_class, message: intake.last_error.message } }
      : {}),
    correlationId: intake.correlation_id ?? null,
    plan,
    gate: plan ? { ok: plan.gate_ok, violations: (plan.gate_violations as any) ?? [] } : null,
  };
}

export interface PublishResult {
  status: BuildStatus;
  planVersion: number;
  /** Null when there is no repo to write into. */
  commitSha: string | null;
  filesWritten: number;
  repoUrl: string | null;
}

/**
 * Promote the reviewed draft and write its documents into the workspace repo.
 *
 * Refuses a plan that has not passed the gate — "published" must mean every
 * must-have requirement is covered, or the word is worthless. Refuses too if the
 * plan changed since review (`expectedSha`).
 */
export async function publishBuild(
  projectId: string,
  opts: { enrollmentId: string; expectedSha?: string; repo?: { owner: string; repo: string; url: string } | null },
): Promise<PublishResult> {
  const draft = await getPlan(projectId);
  if (!draft) {
    const e: any = new Error('no plan to publish'); e.status = 404; throw e;
  }
  // Refuse only on BLOCKING violations. "Published" still means every must-have
  // is covered, every reference resolves, and r0 is startable — the invariant
  // that makes the word worth anything. It no longer means "stylistically
  // perfect", because enforcing that stranded students with nothing at all.
  const blocking = blockingViolations((draft.gate_violations as any) ?? []);
  if (blocking.length > 0) {
    const e: any = new Error(
      `this plan cannot be published: ${blocking.map((b) => b.message).join('; ')}`,
    );
    e.status = 409;
    throw e;
  }

  const published = await publishPlan(projectId, draft.version, opts.expectedSha);

  // THE WINDOW BELONGS TO THE BUILD, NOT TO THIS VERSION.
  //
  // The schedule floors on when the plan existed, so a plan published after its
  // cohort's start is not born overdue. Passing THIS version's timestamp made
  // that floor today on every republish: a build revised on 2026-09-29 had all
  // fifteen stories re-dated onto 2026-10-01, collapsing a staggered plan onto
  // one day. Hit twice in one afternoon, both times after adding a single story
  // for a student who asked for it.
  //
  // The first publish is the build's origin; later versions are revisions of the
  // same work. `due_baseline_on` survives a rematerialize (it is only set on
  // create), which is why the damage was recoverable, but the live dates are
  // what the student actually sees.
  const windowOrigin = (await firstPublishedAt(projectId)) ?? published.published_at;
  const correlationId = published.correlation_id;

  // Second and last chance to name the project. Five of the twenty live builds
  // reached publish with no intake name — the wizard's name field is optional —
  // and for those the plan's own `project_name` is the best thing anybody has.
  // It is not invented here: it was generated from the student's idea and is a
  // required field of the plan contract, so it is plumbing, not authorship.
  //
  // Placed before both return paths so the no-repo publish gets it too, and
  // guarded on emptiness so an intake name set at startBuild always wins.
  await nameProject(projectId, (published.plan as BuildPlan)?.project_name, 'plan', correlationId);

  if (!opts.repo) {
    // No repo yet, but the plan must still reach the portal — otherwise a
    // student completes a build and sees nothing change on screen, which is the
    // exact failure this pipeline was built to fix. Prompts fall back to
    // inlining their context instead of citing paths (FR-031).
    const schedule = await scheduleFor(
      opts.enrollmentId, published.plan as BuildPlan, correlationId, windowOrigin,
    );
    const m = await materializePlanAsTasks(projectId, opts.enrollmentId, published.plan as BuildPlan, { schedule });
    await makeActiveProject(opts.enrollmentId, projectId, correlationId);
    // Hold it for review, IF the gate is on for this enrollment (no-op otherwise).
    // Never throws — a failed mark must not fail the publish.
    await markProjectPendingApproval(projectId, opts.enrollmentId);
    await setStatus(projectId, 'awaiting_repo');
    log('sbp_build_published_no_repo', correlationId, 'partial', {
      projectId, version: published.version, lists: m.lists, tasks: m.tasks,
    });
    return { status: 'awaiting_repo', planVersion: published.version, commitSha: null, filesWritten: 0, repoUrl: null };
  }

  // The schedule is now computed BEFORE the render, not after it. Real dates
  // (due dates, baselines, demo day, the demo target release) are part of the
  // Command Center's data contract, and a page cannot show a Gantt chart of
  // dates the file does not carry. Materialization still consumes the same
  // object further down, so this is a hoist, not a second computation.
  // `published.published_at` is what floors the build window, so a plan that
  // lands after its cohort's week-4 Thursday is dated from the plan's own
  // existence rather than from a date that has already gone by.
  const schedule = await scheduleFor(
    opts.enrollmentId, published.plan as BuildPlan, correlationId, windowOrigin,
  );

  // What the platform already knows about this build, mirrored into the repo so
  // a static page can render verified/points/commit without an API call.
  const snapshot = await loadBuildProgress(projectId, opts.enrollmentId);

  // What GitHub says we may do here, asked before the render rather than
  // assumed from `opts.repo` being set. STORY-000's doc claims the student's
  // criteria are seeded into `.colaberry/progress.json`, and that claim is only
  // true where we hold push — one repo in thirteen on 2026-08-19.
  const repoWriteAccess = await repoWriteAccessForProject(projectId, correlationId ?? null);

  const files = renderDocs(published.plan as BuildPlan, {
    repoUrl: opts.repo.url,
    generatedAt: new Date().toISOString(),
    planVersion: published.version,
    planSha256: published.plan_sha256,
    correlationId: correlationId ?? undefined,
    projectId,
    truthRevision: published.truth_revision ?? null,
    schedule,
    progress: snapshot.progress,
    baselineByStory: snapshot.baselineByStory,
    repoWriteAccess,
  });

  // Read the manifest that is already in the repo, so the content-hash check in
  // `changedFiles` can actually run.
  //
  // This argument was `null` with a TODO against it, and the cost was concrete:
  // `parseManifestHashes(null)` returns `{}`, every file therefore looked
  // changed, and every republish committed the whole document set. The
  // "unchanged ⇒ no commit" guarantee was fully implemented and unit-tested but
  // never once exercised in production — students got a commit per publish that
  // touched nothing.
  const existingManifest = await readRepoManifest(
    { owner: opts.repo.owner, repo: opts.repo.repo },
    { correlationId: correlationId ?? undefined },
  );

  const write = await writeDocsToRepo(
    { owner: opts.repo.owner, repo: opts.repo.repo },
    files,
    existingManifest,
    { correlationId: correlationId ?? undefined },
  );

  // Materialize AFTER the write, so prompts can cite paths now proven to exist.
  const materialized = await materializePlanAsTasks(projectId, opts.enrollmentId, published.plan as BuildPlan, {
    repoUrl: opts.repo.url,
    manifestPaths: files.map((f) => f.path),
    schedule,
  });
  await makeActiveProject(opts.enrollmentId, projectId, correlationId);
  // Hold it for review, IF the gate is on for this enrollment (no-op otherwise).
  // Never throws — a failed mark must not fail the publish.
  await markProjectPendingApproval(projectId, opts.enrollmentId);

  await setStatus(projectId, 'published');
  log('sbp_build_published', correlationId, 'success', {
    projectId, version: published.version, commit: write.commitSha, files: write.changedPaths.length,
    lists: materialized.lists, tasks: materialized.tasks, preserved_complete: materialized.preservedComplete,
  });

  return {
    status: 'published',
    planVersion: published.version,
    commitSha: write.commitSha ?? null,
    filesWritten: write.changedPaths.length,
    repoUrl: opts.repo.url,
  };
}

/** Verify the stored plan still hashes to what a reviewer was shown. */
export function planMatchesReviewed(plan: BuildPlan, expectedSha: string): boolean {
  return hashPlan(plan) === expectedSha;
}


/**
 * Real dates for this student's cohort. Lives in `scheduleForEnrollment` now,
 * because the sync-time document refresh needs the same answer and a second
 * copy is how the two paths would drift.
 */
const scheduleFor = scheduleForEnrollment;

/**
 * Point the student's portal at the project they just published.
 *
 * WHY THIS IS HERE: the Projects page reads `GET /api/portal/projects/active`,
 * which resolves `enrollments.active_project_id`. Publishing wrote tasks and
 * never touched it — so a student whose active project was something else
 * completed a whole build and saw nothing change. Found on 2026-08-12 against
 * a real account: 12 tasks materialized correctly and were invisible.
 *
 * Only ever sets it when it is empty or points at a different project; never
 * steals focus from a project the student is actively working, because
 * republishing an old plan should not move their portal.
 */
async function makeActiveProject(
  enrollmentId: string, projectId: string, correlationId: string | null,
): Promise<void> {
  try {
    const { sequelize } = await import('../../config/database');
    // No `updated_at` here: the enrollments table does not have that column in
    // production. The first version of this function set it out of habit, the
    // statement threw on every publish, the catch below swallowed it, and the
    // bug it was written to fix stayed fixed only in the unit tests — which
    // mock sequelize.query and so never see a column name at all. Any column
    // added to this statement must exist on the table; ACTIVE_PROJECT_COLUMNS
    // and its test are what hold that true.
    const [rows]: any = await sequelize.query(
      `UPDATE enrollments SET active_project_id = $pid
        WHERE id = $eid AND (active_project_id IS NULL OR active_project_id <> $pid)
        RETURNING id`,
      { bind: { eid: enrollmentId, pid: projectId } },
    );
    if (rows?.length) log('sbp_active_project_set', correlationId, 'success', { enrollmentId, projectId });
    else log('sbp_active_project_noop', correlationId, 'success', { enrollmentId, projectId });
  } catch (err: any) {
    // Not fatal — the plan and its tasks are already written, so losing the
    // pointer costs visibility, not work. But it is the difference between a
    // student seeing their project and seeing nothing, so it is an error, not
    // a shrug: it carries an error_class and names the statement that failed.
    log('sbp_active_project_failed', correlationId, 'failure', {
      enrollmentId, projectId, error_class: err?.name ?? 'Error',
      statement: 'UPDATE enrollments SET active_project_id', message: err?.message,
    });
  }
}

/**
 * Every column `makeActiveProject` writes or reads. Asserted against the real
 * Enrollment model by sbpOrchestrator.activeProject.test.ts, so a column that
 * does not exist cannot reach production a second time.
 */
export const ACTIVE_PROJECT_COLUMNS = ['active_project_id', 'id'] as const;
