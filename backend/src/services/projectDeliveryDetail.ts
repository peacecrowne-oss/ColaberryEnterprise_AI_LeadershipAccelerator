/**
 * projectDeliveryDetail — the per-project and batched queries behind the Projects
 * delivery view's timeline, build evidence and artifacts.
 *
 * Split from projectDeliveryService (381 lines) to stay under CLAUDE.md's 500-line
 * ceiling. The pure logic these call lives in projectReleaseMeta and is unit-tested
 * there; this file is queries plus assembly.
 *
 * ONE DELIBERATE CHOICE worth stating: timing is classified in JS by
 * `classifyTiming`, not in SQL. Expressing "complete but unverified is NOT on time"
 * as a CASE expression would duplicate the rule in a second place, and the two would
 * drift — the SQL copy silently, since nothing tests it. Fetching the task rows and
 * classifying them in one place costs a few hundred rows and keeps one source of truth.
 */
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/database';
import {
  resolveReleaseName,
  extractLandsWhen,
  classifyTiming,
  rollUpTiming,
  summariseEvidence,
  summariseVerification,
  bucketTasks,
  releaseState,
  TaskBuckets,
  ReleaseState,
  groupArtifacts,
  TimingRollup,
  EvidenceSummary,
  VerificationSummary,
  ArtifactGroup,
} from './projectReleaseMeta';

const DONE = 'complete';

/** Task-list titles keyed `${project_id}::${cluster}` — the readable release names. */
async function loadReleaseTitles(projectIds: string[]): Promise<Map<string, string>> {
  if (!projectIds.length) return new Map();
  const rows = await sequelize.query<{ project_id: string; cluster: string; title: string }>(
    `SELECT project_id, cluster, title
       FROM student_task_lists
      WHERE project_id IN (:ids) AND title IS NOT NULL AND title <> ''`,
    { replacements: { ids: projectIds }, type: QueryTypes.SELECT }
  );
  return new Map(rows.map((r) => [`${r.project_id}::${r.cluster}`, r.title]));
}

export interface ReleaseSummary {
  release_key: string;
  display_name: string;
  total: number;
  complete: number;
  overdue: number;
  starts_on: string | null;
  ends_on: string | null;
  timing: TimingRollup;
  /** Task-state split, for the segmented bar. */
  buckets: TaskBuckets;
  /** One-word status for the release strip on a collapsed row. */
  state: ReleaseState;
}

/**
 * Every visible project's releases, in TWO queries total regardless of project count.
 *
 * This exists so the delivery list can render coloured release bars WITHOUT the
 * operator expanding each row — previously the timeline was fetched per project on
 * click, so a collapsed list showed one flat grey bar per project and gave away
 * nothing at a glance. Batched rather than per-project: 30 projects would otherwise
 * be 30 round trips.
 */
export async function getReleaseSummaries(
  projectIds: string[]
): Promise<Map<string, ReleaseSummary[]>> {
  const out = new Map<string, ReleaseSummary[]>();
  if (!projectIds.length) return out;

  const [tasks, titles] = await Promise.all([
    sequelize.query<any>(
      `SELECT project_id, release_key, status, due_on::text, verified_at
         FROM student_tasks
        WHERE project_id IN (:ids)`,
      { replacements: { ids: projectIds }, type: QueryTypes.SELECT }
    ),
    loadReleaseTitles(projectIds),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  // project -> release key -> rows
  const grouped = new Map<string, Map<string, any[]>>();
  for (const t of tasks) {
    const key = t.release_key ?? 'unscheduled';
    let byRelease = grouped.get(t.project_id);
    if (!byRelease) { byRelease = new Map(); grouped.set(t.project_id, byRelease); }
    const list = byRelease.get(key);
    if (list) list.push(t);
    else byRelease.set(key, [t]);
  }

  for (const [projectId, byRelease] of grouped) {
    const releases: ReleaseSummary[] = [...byRelease.entries()].map(([key, rows]) => {
      const dates = rows.map((r) => (r.due_on ? String(r.due_on).slice(0, 10) : null))
        .filter((d): d is string => !!d).sort();
      const buckets = bucketTasks(rows, today);
      return {
        release_key: key,
        display_name: resolveReleaseName(key, {
          [key]: titles.get(`${projectId}::${key}`) ?? '',
        }),
        total: rows.length,
        complete: buckets.done,
        overdue: buckets.overdue,
        starts_on: dates[0] ?? null,
        ends_on: dates[dates.length - 1] ?? null,
        timing: rollUpTiming(rows),
        buckets,
        state: releaseState(buckets),
      };
    }).sort(byStartThenKey);
    out.set(projectId, releases);
  }
  return out;
}

/** Chronological by start; the undated bucket sinks to the end. */
function byStartThenKey(a: { starts_on: string | null; release_key: string },
                        b: { starts_on: string | null; release_key: string }): number {
  if (a.starts_on && b.starts_on) return a.starts_on.localeCompare(b.starts_on);
  if (a.starts_on) return -1;
  if (b.starts_on) return 1;
  return a.release_key.localeCompare(b.release_key);
}

export interface GanttTask {
  id: string;
  title: string;
  status: string;
  release_key: string | null;
  due_on: string | null;
  due_baseline_on: string | null;
  slipped: boolean;
  overdue: boolean;
  timing: ReturnType<typeof classifyTiming>;
  verified_at: string | null;
  blocked_by: string[];
  narrative: string | null;
  /**
   * The requirement ids this story fulfils, straight off the task.
   *
   * Ali, 2026-09-29: "I would even like to be able to see the story
   * requirements if I click on it." This is the traceability the plan already
   * carries — materializeTasks writes the plan story's `fulfills` onto the row
   * — and nothing was reading it back out.
   */
  fulfills: string[];
  /** What "done" means for this story, in the plan's own words. */
  acceptance: string[];
}

export interface GanttRelease extends ReleaseSummary {
  /** The release's definition of done, or null when the build text carries none. */
  lands_when: string | null;
  tasks: GanttTask[];
}

/**
 * REQ id -> statement, from the project's published plan.
 *
 * `build_plans` is raw SQL with no Sequelize model (db/ensureSbpSchema.ts owns
 * the DDL), so this reads it directly and types the result at the call site -
 * the same allowance planStore.ts documents.
 *
 * Fails SOFT: a project with no published plan, or a plan whose JSON will not
 * parse, yields an empty map rather than an error. The requirement IDS still
 * render either way, so the worst case is a story showing "REQ-004" without its
 * sentence, which is what the page showed before this existed.
 */
interface StoredPlanJson {
  requirements?: Array<{ id?: string; statement?: string }>;
  releases?: Array<{ key?: string; name?: string; goal?: string; week_start?: number; week_end?: number }>;
  stories?: Array<{
    id?: string; release?: string; title?: string; narrative?: string;
    fulfills?: string[]; acceptance?: string[];
  }>;
}

/**
 * The newest plan on a project, PUBLISHED OR NOT.
 *
 *     "I should be able to see the project and drill down right away in the admin
 *      dashboard as soon as the project is built."  (Ali, 2026-10-01)
 *
 * This read used to require `status = 'published'`, which was fine while every build
 * published itself. Now that an admin-initiated build is HELD for review, requiring
 * published means the reviewer opens the one screen built for reviewing and finds it
 * empty — the plan exists, with its releases and stories, and the board cannot see it.
 *
 * The hold is there to keep an unreviewed plan away from the STUDENT. It was never meant
 * to hide the plan from the person doing the reviewing.
 */
async function loadPlanJson(projectId: string): Promise<StoredPlanJson | null> {
  try {
    const rows = await sequelize.query<{ plan_json: unknown }>(
      `SELECT plan_json FROM build_plans
        WHERE project_id = :projectId
        ORDER BY version DESC LIMIT 1`,
      { replacements: { projectId }, type: QueryTypes.SELECT }
    );
    return (rows[0]?.plan_json as StoredPlanJson | undefined) ?? null;
  } catch {
    return null;
  }
}

function statementsFrom(plan: StoredPlanJson | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of plan?.requirements ?? []) {
    if (r?.id && r?.statement) out[r.id] = r.statement;
  }
  return out;
}

/**
 * The plan's own releases and stories, for a project with nothing materialised yet.
 *
 * Everything a task would carry EXCEPT the things only materialisation produces: no due
 * dates, no status, no completion. Those are reported honestly rather than invented —
 * `due_on: null` and `status: 'not_started'` are what "this has not been scheduled" looks
 * like, and the board already renders an undated task.
 */
function releasesFromPlan(plan: StoredPlanJson): GanttRelease[] {
  const storiesByRelease = new Map<string, StoredPlanJson['stories']>();
  for (const s of plan.stories ?? []) {
    const key = s?.release ?? 'unscheduled';
    const list = storiesByRelease.get(key);
    if (list) list.push(s);
    else storiesByRelease.set(key, [s]);
  }

  return (plan.releases ?? []).map((rel) => {
    const key = rel?.key ?? 'unscheduled';
    const stories = storiesByRelease.get(key) ?? [];
    const tasks: GanttTask[] = stories.map((s) => ({
      id: s?.id ?? '',
      title: s?.title ?? '',
      status: 'not_started',
      release_key: key,
      due_on: null,
      due_baseline_on: null,
      slipped: false,
      overdue: false,
      // 'undated' is what the timing vocabulary already calls work with no due date,
      // which is exactly what an unscheduled plan is. Materialisation assigns the dates.
      timing: 'undated',
      verified_at: null,
      blocked_by: [],
      narrative: s?.narrative ?? null,
      fulfills: Array.isArray(s?.fulfills) ? s!.fulfills! : [],
      acceptance: Array.isArray(s?.acceptance) ? s!.acceptance! : [],
    }));

    // `undated` and `open` are mutually exclusive, and the five buckets must sum to
    // `total` or the segmented bar drops work. Every story here is incomplete and
    // undated, so they all land in that one bucket.
    const buckets: TaskBuckets = {
      total: tasks.length,
      done: 0,
      overdue: 0,
      due_this_week: 0,
      open: 0,
      undated: tasks.length,
      // `no_date` counts ALL undated work and deliberately overlaps the sum above.
      // Every story in an unscheduled plan is both incomplete and undated, so the two
      // agree here — they diverge only once some of it is finished.
      no_date: tasks.length,
    };
    return {
      release_key: key,
      display_name: rel?.name ? `${key} · ${rel.name}` : key,
      lands_when: rel?.goal ?? null,
      total: tasks.length,
      complete: 0,
      overdue: 0,
      starts_on: null,
      ends_on: null,
      timing: { on_time: 0, late: 0, unverified: 0, open: 0, undated: tasks.length, on_time_pct: null },
      buckets,
      state: 'open',
      tasks,
    };
  });
}

/** One project's tasks as a Gantt, grouped into its release spine, with the readable
 *  release name, its definition of done and its timing story. */
export async function getProjectGantt(projectId: string): Promise<{
  project_id: string;
  releases: GanttRelease[];
  /**
   * REQ id -> its statement, from this project's PUBLISHED plan.
   *
   * Carried so a story can show the requirements it fulfils in words rather
   * than as bare ids: "REQ-004" tells a reviewer nothing, and the statement is
   * the thing they are checking the story against. Empty for any project
   * without a published plan - the hand-authored ones, and anything imported
   * before the pipeline existed - which is why the id list is rendered whether
   * or not a statement resolves.
   */
  requirements: Record<string, string>;
  /**
   * The releases came from the PLAN, not from materialised tasks — a build held for
   * review. Carried so the page can say "not assigned yet" rather than quietly showing
   * stories with no dates as though the schedule had gone missing.
   */
  plan_only: boolean;
  totals: { tasks: number; complete: number; overdue: number; undated: number } & { timing: TimingRollup };
}> {
  const [rows, titles] = await Promise.all([
    sequelize.query<any>(
      `SELECT id, title, status, release_key, due_on::text, due_baseline_on::text,
              verified_at, blocked_by, narrative, fulfills, acceptance, build, position
         FROM student_tasks
        WHERE project_id = :projectId
        ORDER BY release_key NULLS LAST, due_on NULLS LAST, position`,
      { replacements: { projectId }, type: QueryTypes.SELECT }
    ),
    loadReleaseTitles([projectId]),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const byRelease = new Map<string, any[]>();
  for (const r of rows) {
    const key = r.release_key ?? 'unscheduled';
    const list = byRelease.get(key);
    if (list) list.push(r);
    else byRelease.set(key, [r]);
  }

  const releases: GanttRelease[] = [...byRelease.entries()].map(([key, list]) => {
    const tasks: GanttTask[] = list.map((r) => {
      const due = r.due_on ? String(r.due_on).slice(0, 10) : null;
      const base = r.due_baseline_on ? String(r.due_baseline_on).slice(0, 10) : null;
      const done = r.status === DONE;
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        release_key: r.release_key ?? null,
        due_on: due,
        due_baseline_on: base,
        slipped: !!(due && base && due > base),
        overdue: !!(due && !done && due < today),
        timing: classifyTiming(r),
        verified_at: r.verified_at ? new Date(r.verified_at).toISOString() : null,
        blocked_by: Array.isArray(r.blocked_by) ? r.blocked_by : [],
        narrative: r.narrative ?? null,
        // JSONB columns: absent on any task written before the plan carried
        // them, and on anything the manual import path wrote. An empty array is
        // the honest answer to "which requirements", never a guess.
        fulfills: Array.isArray(r.fulfills) ? r.fulfills : [],
        acceptance: Array.isArray(r.acceptance) ? r.acceptance : [],
      };
    });
    const dates = tasks.map((t) => t.due_on).filter((d): d is string => !!d).sort();

    // First non-null "lands when" in the release: the build documents within one
    // release restate the same criterion, so the first is representative.
    let landsWhen: string | null = null;
    for (const r of list) {
      landsWhen = extractLandsWhen(r.build);
      if (landsWhen) break;
    }

    const buckets = bucketTasks(list, today);
    return {
      release_key: key,
      display_name: resolveReleaseName(key, { [key]: titles.get(`${projectId}::${key}`) ?? '' }),
      lands_when: landsWhen,
      total: tasks.length,
      complete: buckets.done,
      overdue: buckets.overdue,
      starts_on: dates[0] ?? null,
      ends_on: dates[dates.length - 1] ?? null,
      timing: rollUpTiming(list),
      buckets,
      state: releaseState(buckets),
      tasks,
    };
  }).sort(byStartThenKey);

  const plan = await loadPlanJson(projectId);

  // NOTHING MATERIALISED, BUT THERE IS A PLAN: a build held for review. Show it, rather
  // than an empty row on the screen whose job is reviewing it. Only when there are no
  // tasks at all — a published project always wins, because its tasks carry the dates,
  // the status and the work the student has actually done.
  const fromPlan = rows.length === 0 && plan ? releasesFromPlan(plan) : null;
  const shown = fromPlan ?? releases;

  return {
    project_id: projectId,
    releases: shown,
    requirements: statementsFrom(plan),
    /** True when this is the unassigned plan rather than materialised work. */
    plan_only: fromPlan !== null,
    totals: {
      tasks: fromPlan ? shown.reduce((n, r) => n + r.total, 0) : rows.length,
      complete: shown.reduce((n, r) => n + r.complete, 0),
      overdue: shown.reduce((n, r) => n + r.overdue, 0),
      undated: fromPlan ? shown.reduce((n, r) => n + r.total, 0) : rows.filter((r: any) => !r.due_on).length,
      timing: rollUpTiming(rows),
    },
  };
}

/**
 * What a project's build actually produced, from build_manifests.
 *
 * Returns `has_evidence: false` for every project visible today: all 178 manifests in
 * production belong either to the platform's own project or to a withdrawn test
 * enrollment, so none survives the delivery view's filters. That is a data-pipeline
 * gap, not a bug here — the caller must render the cause rather than a row of zeros,
 * because zeros would assert "built nothing" when the truth is "nothing recorded".
 */
export interface ProjectEvidence {
  /** Which source produced the picture below. 'repo_verification' is the one that
   *  exists for real student work; 'build_manifests' only ever fires for projects
   *  whose owner emits telemetry from their own Claude Code. */
  source: 'repo_verification' | 'build_manifests' | 'none';
  verification: VerificationSummary;
  manifests: EvidenceSummary;
}

export async function getProjectEvidence(projectId: string): Promise<ProjectEvidence> {
  const [manifestRows, verificationRows] = await Promise.all([
    sequelize.query<any>(
      `SELECT files_created, files_modified, apis_added, ui_components_added,
              tests_added, database_changes, execution_timestamp
         FROM build_manifests
        WHERE project_id = :projectId
        ORDER BY execution_timestamp DESC`,
      { replacements: { projectId }, type: QueryTypes.SELECT }
    ),
    sequelize.query<any>(
      `SELECT verification_json
         FROM student_tasks
        WHERE project_id = :projectId AND verification_json IS NOT NULL
        ORDER BY verified_at DESC NULLS LAST`,
      { replacements: { projectId }, type: QueryTypes.SELECT }
    ),
  ]);

  const manifests = summariseEvidence(manifestRows);
  const verification = summariseVerification(verificationRows);

  // Repo verification wins when both exist: a matched commit is stronger evidence
  // than a self-reported manifest, and it is the source that actually covers
  // student work.
  const source: ProjectEvidence['source'] = verification.has_verification
    ? 'repo_verification'
    : manifests.has_evidence
      ? 'build_manifests'
      : 'none';

  return { source, verification, manifests };
}

/**
 * A project's artifacts, grouped by document with version history.
 *
 * Artifacts are stored as submission CONTENT, not files — every row observed in
 * production has `file_name` null and `content_json` populated — so the caller offers
 * the content rather than a download link that would 404.
 */
export async function getProjectArtifacts(projectId: string): Promise<ArtifactGroup[]> {
  const rows = await sequelize.query<any>(
    `SELECT ad.name              AS artifact_name,
            a.artifact_stage,
            a.version,
            s.id                 AS submission_id,
            s.title,
            s.file_name,
            s.content_json IS NOT NULL AS has_content,
            s.submitted_at
       FROM project_artifacts a
       LEFT JOIN artifact_definitions ad ON ad.id = a.artifact_definition_id
       LEFT JOIN assignment_submissions s ON s.id = a.submission_id
      WHERE a.project_id = :projectId
      ORDER BY a.version DESC`,
    { replacements: { projectId }, type: QueryTypes.SELECT }
  );
  return groupArtifacts(rows);
}
