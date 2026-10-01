/**
 * addStoryService — a student adds ONE story to a build that is already published.
 *
 * ── WHY THIS IS SMALL ────────────────────────────────────────────────────────
 *
 * Everything that makes a story real already exists on the publish path, and
 * all of it is safe to run again:
 *
 *   - `publishPlan` versions the plan behind an `expected_sha256` lock, so a
 *     concurrent edit already has a 409.
 *   - `materializePlanAsTasks` is `findOrCreate` throughout with no `destroy`.
 *     Re-running it with one new story creates only that story's rows; every
 *     existing task, verified or not, is untouched by construction.
 *   - Build prompts are assembled at read time from the plan and the repo
 *     manifest. Nothing is pre-generated, nothing is asked of a model.
 *   - The verifier reads its spec from the published plan, so the new story
 *     becomes verifiable the moment it is published.
 *   - `writeDocsToRepo` commits only the documents whose content changed.
 *
 * So this service builds a revised plan, saves it as the next draft version,
 * and hands it to `publishBuild` — the same function the first publish used.
 * The repo path, the schedule, the Command Center render and the task
 * materialization are inherited, not reimplemented.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *
 * No editing and no deleting of existing stories. A story's acceptance lines
 * ARE the verification contract — the verifier matches them by name against the
 * student's `progress.json` — so changing them on a verified story would either
 * silently un-verify it or leave a stamp on a criterion that no longer exists.
 * That needs a rule ("editable until verified, frozen after") before it needs
 * code, and it is not this change.
 *
 * ── THE TRACEABILITY GATE ───────────────────────────────────────────────────
 *
 * The plan gate blocks any story that cites no requirement (`dangling_requirement`)
 * and any must-have requirement no story covers (`must_uncovered`). A feature the
 * student thought of after publishing has no requirement yet, so one is minted
 * alongside the story, at `should` priority, and the story fulfils it. The pair
 * is what keeps the traceability invariant true rather than special-cased.
 */
import { z } from 'zod';
import type { BuildPlan, PlanStory, PlanRequirement } from './planContract';
import { getPublishedPlan, savePlanDraft } from './planStore';
import { gatePlan, blockingViolations, GateViolation } from './planGate';
import { publishBuild, PublishResult } from './sbpOrchestrator';

/** A build stops accepting stories here. Generated plans run 12–18; a plan
 *  growing past thirty is a scoping problem, not a feature request. */
export const MAX_STORIES_PER_BUILD = 30;

export const addStorySchema = z.object({
  title: z.string().trim().min(4).max(120),
  /** "As a <role>, I want <capability>, so that <outcome>." — not enforced as a
   *  template, only as a sentence long enough to mean something. */
  narrative: z.string().trim().min(20).max(600),
  /** Gherkin-style lines. Exactly one must start with "Trust" — the trust spine
   *  is the programme's method, and a student story is held to the same bar as
   *  a generated one. Checked in `buildStoryRevision`, not here, so the message
   *  can say which rule rather than "invalid". */
  acceptance: z.array(z.string().trim().min(8).max(300)).min(3).max(7),
  /** r1, r2, … — r0 is the walking skeleton and is closed to additions. */
  release: z.string().trim().regex(/^r[1-9]\d*$/, 'release must be r1 or later'),
  /** AGENT-nnn from the plan. Defaults to the plan's first agent. */
  /**
   * Who owns the story. FREE TEXT, because that is what real plans carry:
   * measured across production, 30 of 31 published plans have no `agents[]`
   * at all and their stories name an owner like "User" or "System". An
   * AGENT-nnn regex here refused every real build on the day it shipped.
   * Defaults to whatever the plan's own stories already use.
   */
  owner_agent: z.string().trim().min(1).max(60).optional(),
  task_guidance: z.string().trim().min(10).max(600).optional(),
  failure_paths: z.array(z.string().trim().min(4).max(200)).max(5).optional(),
  /** The sha of the published plan the student is looking at. */
  expected_sha256: z.string().regex(/^[0-9a-f]{64}$/, 'expected_sha256 must be a sha256 hex'),
});
export type AddStoryInput = z.infer<typeof addStorySchema>;

export type AddStoryErrorClass =
  | 'NotPublished'
  | 'HashMismatch'
  | 'StoryCap'
  | 'UnknownRelease'
  | 'ReleaseLocked'
  | 'UnknownAgent'
  | 'NoTrustLine'
  | 'PlanPredatesGate'
  | 'GateBlocked';

export class AddStoryError extends Error {
  constructor(
    public readonly status: 404 | 409 | 422,
    public readonly error_class: AddStoryErrorClass,
    message: string,
    public readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'AddStoryError';
  }
}

export interface StoryRevision {
  plan: BuildPlan;
  story: PlanStory;
  requirement: PlanRequirement;
}

/**
 * Where a student's own additions file in `docs/REQUIREMENTS.md`.
 *
 * The cluster used to be copied from `requirements[0]`, on the stated reasoning
 * that it "becomes a task-list grouping" — it does not. `materializeTasks`
 * keys its task lists on the RELEASE (`cluster: rel.key`), and the only reader
 * of a requirement's cluster is `renderDocs`, which uses it as a heading in
 * REQUIREMENTS.md. So the copy bought no grouping and cost accuracy: Swati
 * Raman added four stories to the Stress Test Review App on 2026-09-29 and all
 * four requirements filed under "Marker Detection", which is what
 * `requirements[0]` happened to be and had nothing to do with any of them.
 *
 * Their own heading is both truthful and more useful — it is the list of what
 * they decided the generated plan had missed.
 */
export const STUDENT_ADDED_CLUSTER = 'Student Additions';

/**
 * Turn the student's story into a REQUIREMENT statement.
 *
 * The statement used to be `input.title` verbatim, so a requirement read
 * "Vector Store For Similar Reviews" — a feature name where every other
 * requirement in the document is a sentence about what the system must do.
 * That is not a formatting nit: REQUIREMENTS.md is the artifact a student
 * shows an employer, and one section of bare noun phrases in a document of
 * obligations reads as the part nobody finished.
 *
 * ── WHY THIS IS NOT A GENERAL REWRITER ──────────────────────────────────────
 *
 * There is no safe deterministic way to turn an arbitrary phrase into a
 * "The system must ..." sentence, and a near-miss is worse than the noun
 * phrase it replaced. "I want to export the roster" naively becomes "The
 * system must to export the roster"; "I want uncertain data to be flagged"
 * becomes "The system must uncertain data to be flagged". Both are real
 * narratives from live builds.
 *
 * So exactly ONE shape is rewritten — `As a <role>, I want to <verb...>`,
 * which is the dominant form and converts cleanly — and everything else falls
 * back to the student's narrative VERBATIM. Both outcomes are complete
 * sentences in the student's own words. Neither invents scope, and the bare
 * noun phrase can no longer reach the document by any path.
 */
export function requirementStatementFor(input: { title: string; narrative?: string | null }): string {
  const narrative = (input.narrative ?? '').trim();
  if (!narrative) return input.title;

  const role = /^As\s+(?:(an?|the)\s+)?([^,]+?)\s*,/i.exec(narrative);
  const want = /\bI\s+want\s+to\s+(.+?)(?:\s*,?\s*so\s+that\b.*)?$/is.exec(narrative);
  const capability = want?.[1]?.trim().replace(/[.\s]+$/, '');
  if (!capability) return narrative;

  const who = role?.[2]?.trim();
  // When the student casts the SYSTEM as the actor — "As the review system, I
  // want to recognise the markers" — "must let the review system recognise"
  // is nonsense. The system does not grant itself permission.
  const actorIsTheSystem = !who || /\b(system|platform|service|app|engine)\b/i.test(who);
  if (actorIsTheSystem) return `The system must ${capability}.`;

  const article = role?.[1] ?? (/^[aeiou]/i.test(who) ? 'an' : 'a');
  return `The system must let ${article} ${who} ${capability}.`;
}

/** STORY-016 after STORY-015; REQ-023 after REQ-022. Never reuses a number. */
function nextId(prefix: 'STORY' | 'REQ', ids: string[]): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let max = 0;
  for (const id of ids) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

const TRUST_LINE = /^\s*trust\b/i;

/**
 * Who should own a new story, taken from what the plan already does.
 *
 * `plan.agents` is optional and in production almost always absent: 30 of 31
 * published plans carry no agents array, and their stories name an owner like
 * "User" or "System". So the plan's OWN stories are the authority on what an
 * owner looks like here, and `agents` is the fallback for the rare plan that
 * has one. Returns null only when the student named an owner the plan never
 * uses, which is the one case worth refusing.
 */
export function resolveOwnerAgent(plan: BuildPlan, explicit?: string): string | null {
  const owners = (plan.stories ?? [])
    .map((st) => st.owner_agent)
    .filter((o): o is string => typeof o === 'string' && o.trim().length > 0);
  const agentIds = (plan.agents ?? []).map((a) => a.id).filter(Boolean);

  if (explicit) return new Set<string>([...owners, ...agentIds]).has(explicit) ? explicit : null;

  // The most common owner among existing stories, so a new story files with
  // the majority rather than with whichever story happens to be first.
  const tally = new Map<string, number>();
  for (const o of owners) tally.set(o, (tally.get(o) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [o, n] of tally) if (n > bestN) { best = o; bestN = n; }

  // 'System' is the last resort for a plan whose stories name no owner at all.
  // Never a refusal: the student did not choose this and cannot fix it.
  return best ?? agentIds[0] ?? 'System';
}

/**
 * Pure. Given the published plan and the student's input, return the revised
 * plan plus the story and requirement it now carries. Throws `AddStoryError`
 * for every refusal a student can cause, so the route can answer with the
 * rule that fired rather than "invalid".
 *
 * Does NOT run the gate. The caller gates the result, because "your story is
 * malformed" and "this plan predates a gate rule" are different answers and
 * only the caller sees both plans.
 */
export function buildStoryRevision(plan: BuildPlan, input: AddStoryInput): StoryRevision {
  const stories = plan.stories ?? [];
  const requirements = plan.requirements ?? [];
  const releases = plan.releases ?? [];
  const agents = plan.agents ?? [];

  if (stories.length >= MAX_STORIES_PER_BUILD) {
    throw new AddStoryError(422, 'StoryCap',
      `this build already has ${stories.length} stories; the cap is ${MAX_STORIES_PER_BUILD}`);
  }
  if (!releases.some((r) => r.key === input.release)) {
    throw new AddStoryError(422, 'UnknownRelease',
      `release ${input.release} is not in this plan`, { releases: releases.map((r) => r.key) });
  }
  if (input.release === 'r0') {
    // Unreachable through the schema regex, kept so a caller bypassing it
    // still cannot grow the walking skeleton.
    throw new AddStoryError(422, 'ReleaseLocked', 'r0 is the walking skeleton and is closed to additions');
  }

  const trustLines = input.acceptance.filter((a) => TRUST_LINE.test(a)).length;
  if (trustLines !== 1) {
    throw new AddStoryError(422, 'NoTrustLine',
      trustLines === 0
        ? 'one acceptance line must start with "Trust" — what makes this story safe to trust'
        : `exactly one acceptance line may start with "Trust"; found ${trustLines}`);
  }

  const ownerAgent = resolveOwnerAgent(plan, input.owner_agent);
  if (!ownerAgent) {
    const known = [...new Set([
      ...(plan.stories ?? []).map((st) => st.owner_agent).filter(Boolean),
      ...agents.map((a) => a.id),
    ])];
    throw new AddStoryError(422, 'UnknownAgent',
      `this plan has no owner called ${input.owner_agent}`, { known_owners: known });
  }

  const storyId = nextId('STORY', stories.map((s) => s.id));
  const requirementId = nextId('REQ', requirements.map((r) => r.id));

  const requirement: PlanRequirement = {
    id: requirementId,
    statement: requirementStatementFor(input),
    kind: 'FUNC',
    priority: 'should',
    cluster: STUDENT_ADDED_CLUSTER,
  };

  const story: PlanStory = {
    id: storyId,
    release: input.release,
    title: input.title,
    narrative: input.narrative,
    fulfills: [requirementId],
    owner_agent: ownerAgent,
    acceptance: input.acceptance,
    task_guidance: input.task_guidance
      ?? 'Implement exactly what the acceptance lines describe for this story, and nothing that belongs to another one.',
    failure_paths: input.failure_paths ?? [],
  };

  return {
    plan: {
      ...plan,
      requirements: [...requirements, requirement],
      stories: [...stories, story],
    },
    story,
    requirement,
  };
}

export interface AddStoryResult extends PublishResult {
  story_id: string;
  requirement_id: string;
  /** The sha of the NEW published plan — what the client must send next time. */
  plan_sha256: string;
}

/**
 * Add a story to a published build and publish the revision.
 *
 * Failure modes, in order:
 *   404 NotPublished     — nothing published to add to
 *   409 HashMismatch     — the plan changed since the student loaded it
 *   422 (see class)      — the story itself is refused
 *   422 PlanPredatesGate — the EXISTING plan fails a blocking rule added after
 *                          it was published; not the student's story, said so
 *   422 GateBlocked      — the revised plan fails a blocking rule
 *
 * Nothing is written before the gate passes: a refused story leaves no draft
 * behind. After `savePlanDraft`, `publishBuild` owns every remaining step and
 * every remaining failure, exactly as on the first publish.
 */
export async function addStoryToPublishedBuild(
  projectId: string,
  input: AddStoryInput,
  opts: {
    enrollmentId: string;
    repo: { owner: string; repo: string; url: string } | null;
    correlationId?: string;
  },
): Promise<AddStoryResult> {
  const published = await getPublishedPlan(projectId);
  if (!published) {
    throw new AddStoryError(404, 'NotPublished', 'this build has no published plan to add a story to');
  }
  if (published.plan_sha256 !== input.expected_sha256) {
    throw new AddStoryError(409, 'HashMismatch',
      'the plan changed since you loaded it; reload and try again',
      { current_sha256: published.plan_sha256 });
  }

  // A plan published before a blocking rule existed can fail the gate today
  // through no act of the student's. Say that, rather than blaming the story.
  const priorBlocking = blockingViolations(gatePlan(published.plan).violations);
  if (priorBlocking.length) {
    throw new AddStoryError(422, 'PlanPredatesGate',
      'this plan no longer passes the publish gate on its own; a story cannot be added until it is repaired',
      { violations: priorBlocking });
  }

  const revision = buildStoryRevision(published.plan, input);

  const gate = gatePlan(revision.plan);
  const blocking: GateViolation[] = blockingViolations(gate.violations);
  if (blocking.length) {
    throw new AddStoryError(422, 'GateBlocked', 'the revised plan fails the publish gate', { violations: blocking });
  }

  const draft = await savePlanDraft(projectId, revision.plan, {
    gate,
    model: 'student',
    correlationId: opts.correlationId,
    truthRevision: published.truth_revision,
  });

  const result = await publishBuild(projectId, {
    enrollmentId: opts.enrollmentId,
    expectedSha: draft.plan_sha256,
    repo: opts.repo,
  });

  return {
    ...result,
    story_id: revision.story.id,
    requirement_id: revision.requirement.id,
    plan_sha256: draft.plan_sha256,
  };
}
