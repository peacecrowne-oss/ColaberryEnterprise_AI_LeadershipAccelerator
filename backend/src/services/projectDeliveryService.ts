/**
 * projectDeliveryService — what each student has actually built, on a timeline,
 * and how close that project is to becoming a case study.
 *
 * WHY THE READINESS SCORE IS RANKED, NOT BINARY. A production audit on
 * 2026-09-09 found the platform holds two disjoint populations: 33 projects
 * carry a build plan (tasks, dates, releases, 47-100% complete) with no repo and
 * no artifacts, and 7 carry a repo and artifacts with no build plan at all. The
 * overlap is ZERO. A gate of the obvious shape - stage complete AND artifacts
 * present AND tasks done - therefore matches nothing today, and would render an
 * empty page that reads as a broken feature rather than as a true statement
 * about the data.
 *
 * So readiness is scored and ordered, and every project reports the specific
 * things it is MISSING. An empty "ready" list becomes a ranked worklist:
 * "CoreOps - 79% built, no repo, no artifacts". That is useful on day one and
 * becomes a real readiness signal as projects mature, without a rewrite.
 *
 * Implementation work is meant to complement the build plans rather than replace
 * them (operator, 2026-09-09), so a project holding only one of the two is
 * half-finished and the gap list is what says which half.
 */
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/database';
// The same "no longer a student here" rule the current-classes snapshot uses.
// Imported rather than restated so the two cannot drift into disagreeing about
// who counts as enrolled.
import { DEPARTED_ENROLLMENT_STATUSES } from './acceleratorCurrentClassesService';
import { getReleaseSummaries, ReleaseSummary } from './projectDeliveryDetail';
import { TaskBuckets } from './projectReleaseMeta';
import { assessPortfolio, RiskAssessment } from './projectRiskModel';

/** Task statuses that count as finished. The others are not_started, in_progress, blocked. */
export const DONE_TASK_STATUSES = ['complete'] as const;

/** Stages a project passes through, in order — index doubles as progress rank. */
export const PROJECT_STAGES = [
  'discovery', 'architecture', 'implementation', 'portfolio', 'complete',
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export interface ReadinessComponent {
  key: string;
  label: string;
  /** 0..1 — how far this component is satisfied. */
  score: number;
  weight: number;
  /** Present when the component is not fully satisfied: what is missing. */
  gap?: string;
}

export interface ProjectReadiness {
  /** 0..100, weighted. Ordering signal, not a verdict. */
  score: number;
  /** True only when nothing is missing. Expected to be rare, by design. */
  ready: boolean;
  components: ReadinessComponent[];
  /** Human-readable list of what stands between this project and a case study. */
  gaps: string[];
}

/**
 * Which group a project's owner is in.
 *
 * AN INTERNSHIP OUTRANKS A CLASS SEAT, and that is the whole rule. An intern is normally
 * enrolled in a class as well — the internship is a secondary `cohort_memberships` row and
 * their enrollment still points at the class cohort — so reading `cohort_id` first would
 * label every intern a class project and hide them from the board's default view. That is
 * the same mistake `internsOnly` exists to avoid, one layer up.
 *
 * Pure, and exported, so the precedence is testable without standing up the query.
 */
export function audienceOf(
  r: { is_intern?: boolean | null; cohort_id?: string | null },
): ProjectRow['audience'] {
  if (r.is_intern) return 'intern';
  return r.cohort_id ? 'class' : 'unenrolled';
}

export interface ProjectRow {
  project_id: string;
  name: string | null;
  enrollment_id: string;
  student_name: string | null;
  student_email: string | null;
  cohort_id: string | null;
  cohort_name: string | null;
  stage: ProjectStage;
  maturity_score: number | null;
  /**
   * The owner holds an active internship. A column rather than a filter, so a board can
   * put interns first and still show everyone — see the query for why that matters.
   */
  is_intern: boolean;
  /**
   * Who the project belongs to, as one word.
   *
   *     "in the Projects section, default it to active intern projects but allow the
   *      ability to add class projects and unenrolled students projects."  (Ali, 2026-10-01)
   *
   * Derived rather than stored: an intern holds an active internship membership, a class
   * student is anyone else sitting in a cohort, and unenrolled is a project whose owner is
   * in neither — the prospect and guest builds that come out of the enquiry list. Three
   * named groups beat three booleans at the call site, where the question is always "show
   * me which of these".
   */
  audience: 'intern' | 'class' | 'unenrolled';
  has_repo: boolean;
  repo_url: string | null;
  /** Which store answered: 'connection' (the record), 'project_column' (legacy
   *  fallback), or 'none'. Carried so the count still depending on the abandoned
   *  column stays visible rather than being silently absorbed. */
  repo_source: 'connection' | 'project_column' | 'none';
  /** The student's Command Center — a GitHub Pages site at the root of their own repo.
   *  Stored inside `projects.project_variables`, NOT as a column, which is why a schema
   *  search for `command_center_url` finds nothing. Null until they publish Pages. */
  command_center_url: string | null;
  has_exec_summary: boolean;
  artifacts: number;
  tasks_total: number;
  tasks_complete: number;
  tasks_overdue: number;
  tasks_pct: number;
  starts_on: string | null;
  ends_on: string | null;
  already_case_study: boolean;
  /** Soft-delete timestamp. Present on a project the student archived — such a row
   *  is history, not active workload, and a student view must not count it as due
   *  work. Null on a live project. */
  archived_at: string | null;
  /** True when the student themselves has this set as their active project.
   *  Distinguishes a real build from a spare row they have moved off. */
  is_active_project: boolean;
  readiness: ProjectReadiness;
  /** Who needs help, as opposed to which project is closest to shipping. Computed
   *  across the whole portfolio because "has this student built anything" cannot
   *  be answered from one row — see projectRiskModel.ts. */
  risk: RiskAssessment;
  /** The release spine, included in the LIST payload so the collapsed row can draw
   *  coloured bars without a per-project timeline fetch. Batched into two queries for
   *  all projects — see getReleaseSummaries. */
  releases: ReleaseSummary[];
  /** Task-state split across the whole project, summed from its releases so the
   *  segmented bar and the release strip cannot disagree. */
  buckets: TaskBuckets;
}

/**
 * The readiness model, weighted.
 *
 * Build progress carries the most weight because it is the only component
 * populated at scale today; the rest are what turn a finished build into a
 * publishable story. Weights sum to 1 so the score is directly a percentage.
 */
const WEIGHTS = {
  build: 0.40,
  repo: 0.20,
  artifacts: 0.15,
  narrative: 0.15,
  stage: 0.10,
} as const;

/** Pure: the readiness score and gap list for one project's raw numbers. */
export function computeReadiness(input: {
  tasks_total: number;
  tasks_complete: number;
  has_repo: boolean;
  artifacts: number;
  has_exec_summary: boolean;
  stage: ProjectStage;
}): ProjectReadiness {
  const buildPct = input.tasks_total > 0 ? input.tasks_complete / input.tasks_total : 0;
  const stageIdx = Math.max(0, PROJECT_STAGES.indexOf(input.stage));
  const stageScore = stageIdx / (PROJECT_STAGES.length - 1);

  const components: ReadinessComponent[] = [
    {
      key: 'build',
      label: 'Build plan complete',
      score: buildPct,
      weight: WEIGHTS.build,
      gap: input.tasks_total === 0
        ? 'no build plan'
        : buildPct < 1
          ? `${input.tasks_total - input.tasks_complete} of ${input.tasks_total} tasks open`
          : undefined,
    },
    {
      key: 'repo',
      label: 'Code repository',
      score: input.has_repo ? 1 : 0,
      weight: WEIGHTS.repo,
      gap: input.has_repo ? undefined : 'no repo',
    },
    {
      key: 'artifacts',
      label: 'Artifacts produced',
      // Three artifacts is treated as a full evidence set; more does not score
      // higher, because the question is "is there enough to write from", not
      // "who produced the most documents".
      score: Math.min(1, input.artifacts / 3),
      weight: WEIGHTS.artifacts,
      gap: input.artifacts === 0 ? 'no artifacts' : input.artifacts < 3 ? `${input.artifacts} of 3 artifacts` : undefined,
    },
    {
      key: 'narrative',
      label: 'Executive summary',
      score: input.has_exec_summary ? 1 : 0,
      weight: WEIGHTS.narrative,
      gap: input.has_exec_summary ? undefined : 'no executive summary',
    },
    {
      key: 'stage',
      label: 'Stage progression',
      score: stageScore,
      weight: WEIGHTS.stage,
      gap: stageScore < 1 ? `stage is ${input.stage}` : undefined,
    },
  ];

  const score = Math.round(
    components.reduce((n, c) => n + c.score * c.weight, 0) * 100
  );
  const gaps = components.map((c) => c.gap).filter((g): g is string => !!g);
  return { score, ready: gaps.length === 0, components, gaps };
}

/**
 * Every project with its delivery numbers, ranked by readiness.
 *
 * One query per grain, merged in JS. Joining tasks and artifacts in a single
 * statement would multiply the rows by each other and inflate both counts — the
 * classic fan-out, and here it would silently overstate exactly the two numbers
 * the readiness score is built from.
 */
export async function getProjectDelivery(
  opts: {
    cohortId?: string;
    enrollmentId?: string;
    /**
     * Scope to people holding an ACTIVE internship membership.
     *
     * Matched on `cohort_memberships`, never on `e.cohort_id`: an intern's
     * enrollment still points at their CLASS cohort, because the internship is
     * a secondary membership row — which is the whole reason
     * internshipActivationService adds one instead of moving the pointer.
     * Filtering on `e.cohort_id = <the internship cohort>` returns nothing at
     * all, and an empty board reads as "no intern has a project" rather than as
     * a wrong query.
     */
    internsOnly?: boolean;
  } = {},
): Promise<ProjectRow[]> {
  const rows = await sequelize.query<any>(
    `SELECT p.id                AS project_id,
            p.name,
            p.enrollment_id,
            e.full_name         AS student_name,
            e.email             AS student_email,
            e.cohort_id,
            e.active_project_id,
            co.name             AS cohort_name,
            p.project_stage     AS stage,
            p.maturity_score,
            -- THE REPO IS IN github_connections, NOT projects.github_repo_url.
            --
            -- This read p.github_repo_url alone and therefore tagged "no repo" on
            -- every single project on the board. Measured on production the day this
            -- was fixed: of 28 live projects, 22 have a repo via a connection and
            -- ZERO have the project column populated. It is not a stale column, it is
            -- an abandoned one — projectRepoResolver.ts documents the same finding
            -- from 2026-08-20 and exists precisely so callers stop asking the wrong
            -- table.
            --
            -- Precedence mirrors decideRepoPointer: a connection carrying a
            -- non-blank repo_url wins, then the legacy column, then no repo. Blank is
            -- not an answer — a connection with no repo_url is a student who
            -- authorised GitHub and never picked a repo, and counting it would claim
            -- a repository that does not exist. github_connections holds at most
            -- one such row per project (partial unique index
            -- github_connections_unique_project, verified max 1 in production), so
            -- this join cannot fan the result out.
            COALESCE(
              NULLIF(btrim(gc.repo_url), ''),
              NULLIF(btrim(p.github_repo_url), '')
            )                   AS repo_url,
            CASE
              WHEN NULLIF(btrim(gc.repo_url), '') IS NOT NULL THEN 'connection'
              WHEN NULLIF(btrim(p.github_repo_url), '') IS NOT NULL THEN 'project_column'
              ELSE 'none'
            END                 AS repo_source,
            p.project_variables->>'command_center_url' AS command_center_url,
            p.archived_at,
            (p.executive_summary IS NOT NULL AND p.executive_summary <> '') AS has_exec_summary,
            -- Whether this project's owner holds an internship, as a COLUMN rather than
            -- only as a filter.
            --
            --     "All projects built moving fwd should be assigned to an intern above or
            --      shown below with drill down. Either way, I should be able to drill down
            --      into the projects."  (Ali, 2026-09-30)
            --
            -- The internsOnly filter answered that question by making the other projects
            -- vanish, so a project built for a prospect from the enquiry list was not
            -- merely unsorted on the internship board, it was absent. Same predicate,
            -- selected instead of filtered, so a caller can order by it and still show
            -- everything. (No backticks in here: this is inside a template literal, and
            -- one would end the string - it has already happened once in this repo.)
            EXISTS (
              SELECT 1 FROM cohort_memberships m
                JOIN cohorts ic ON ic.id = m.cohort_id
               WHERE m.enrollment_id = p.enrollment_id
                 AND m.membership_type = 'internship'
                 AND m.status = 'active'
                 AND ic.cohort_type = 'ai_internship'
            )                   AS is_intern
       FROM projects p
       LEFT JOIN enrollments e ON e.id = p.enrollment_id
       LEFT JOIN cohorts co    ON co.id = e.cohort_id
       LEFT JOIN github_connections gc
              ON gc.project_id = p.id
             AND NULLIF(btrim(gc.repo_url), '') IS NOT NULL
      -- Two exclusions, both found by ranking this list against production and
      -- seeing test fixtures outrank real student work.
      --   * withdrawn enrollments: every E2E/demo fixture on prod sits on one
      --     ("Demo Run 1 (Reqs E2E)", "E2E Test", "Ali Test Project 2"), and a
      --     withdrawn student's project is not a case-study candidate anyway.
      --     This is the SAME rule the current-classes snapshot applies.
      --   * unnamed projects: scratch/system rows, not somebody's build.
      WHERE p.name IS NOT NULL AND p.name <> ''
        AND (e.status IS NULL OR e.status NOT IN (:departed))
        ${opts.cohortId ? 'AND e.cohort_id = :cohortId' : ''}
        ${opts.enrollmentId ? 'AND p.enrollment_id = :enrollmentId' : ''}
        ${opts.internsOnly ? `AND EXISTS (
              SELECT 1 FROM cohort_memberships m
                JOIN cohorts ic ON ic.id = m.cohort_id
               WHERE m.enrollment_id = p.enrollment_id
                 AND m.membership_type = 'internship'
                 AND m.status = 'active'
                 AND ic.cohort_type = 'ai_internship')` : ''}`,
    {
      replacements: {
        departed: [...DEPARTED_ENROLLMENT_STATUSES],
        ...(opts.cohortId ? { cohortId: opts.cohortId } : {}),
        ...(opts.enrollmentId ? { enrollmentId: opts.enrollmentId } : {}),
      },
      type: QueryTypes.SELECT,
    }
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.project_id);

  const taskAgg = await sequelize.query<any>(
    `SELECT project_id,
            COUNT(*)::int                                                   AS total,
            COUNT(*) FILTER (WHERE status IN (:done))::int                  AS complete,
            COUNT(*) FILTER (WHERE due_on < CURRENT_DATE
                               AND status NOT IN (:done))::int              AS overdue,
            MIN(due_on)::text                                               AS starts_on,
            MAX(due_on)::text                                               AS ends_on
       FROM student_tasks
      WHERE project_id IN (:ids)
      GROUP BY project_id`,
    { replacements: { ids, done: [...DONE_TASK_STATUSES] }, type: QueryTypes.SELECT }
  );
  const tasks = new Map(taskAgg.map((r) => [r.project_id, r]));

  const artAgg = await sequelize.query<any>(
    `SELECT project_id, COUNT(*)::int AS n FROM project_artifacts
      WHERE project_id IN (:ids) GROUP BY project_id`,
    { replacements: { ids }, type: QueryTypes.SELECT }
  );
  const arts = new Map(artAgg.map((r) => [r.project_id, Number(r.n)]));

  const csAgg = await sequelize.query<any>(
    `SELECT DISTINCT project_id FROM case_studies WHERE project_id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT }
  );
  const caseStudies = new Set(csAgg.map((r) => r.project_id));

  // Batched: two queries for ALL projects, not one pair per project. This is what
  // lets a collapsed row render its release colours without the operator clicking.
  const releasesByProject = await getReleaseSummaries(ids);

  // Risk needs the whole portfolio, so rows are built first and assessed after.
  const base: Omit<ProjectRow, 'risk'>[] = rows.map((r) => {
    const t = tasks.get(r.project_id);
    const total = t ? Number(t.total) : 0;
    const complete = t ? Number(t.complete) : 0;
    const artifacts = arts.get(r.project_id) ?? 0;
    const has_repo = !!(r.repo_url && String(r.repo_url).trim());
    const projectReleases = releasesByProject.get(r.project_id) ?? [];
    const stage: ProjectStage = PROJECT_STAGES.includes(r.stage) ? r.stage : 'discovery';

    return {
      project_id: r.project_id,
      name: r.name,
      enrollment_id: r.enrollment_id,
      student_name: r.student_name,
      student_email: r.student_email,
      cohort_id: r.cohort_id,
      cohort_name: r.cohort_name,
      stage,
      maturity_score: r.maturity_score,
      is_intern: !!r.is_intern,
      audience: audienceOf({ is_intern: r.is_intern, cohort_id: r.cohort_id }),
      has_repo,
      repo_url: has_repo ? r.repo_url : null,
      repo_source: has_repo ? (r.repo_source as 'connection' | 'project_column') : 'none',
      command_center_url: r.command_center_url || null,
      has_exec_summary: !!r.has_exec_summary,
      artifacts,
      tasks_total: total,
      tasks_complete: complete,
      tasks_overdue: t ? Number(t.overdue) : 0,
      tasks_pct: total > 0 ? Math.round((complete / total) * 100) : 0,
      starts_on: t?.starts_on ?? null,
      ends_on: t?.ends_on ?? null,
      already_case_study: caseStudies.has(r.project_id),
      archived_at: r.archived_at ?? null,
      is_active_project: !!r.active_project_id && r.active_project_id === r.project_id,
      releases: projectReleases,
      buckets: projectReleases.reduce((acc, rel) => ({
        total: acc.total + rel.buckets.total,
        done: acc.done + rel.buckets.done,
        overdue: acc.overdue + rel.buckets.overdue,
        due_this_week: acc.due_this_week + rel.buckets.due_this_week,
        open: acc.open + rel.buckets.open,
        undated: acc.undated + rel.buckets.undated,
        no_date: acc.no_date + rel.buckets.no_date,
      }), { total: 0, done: 0, overdue: 0, due_this_week: 0, open: 0, undated: 0, no_date: 0 }),
      readiness: computeReadiness({
        tasks_total: total,
        tasks_complete: complete,
        has_repo,
        artifacts,
        has_exec_summary: !!r.has_exec_summary,
        stage,
      }),
    };
  });

  // One pass over every project together — a student's spare rows can only be
  // told apart from a student in trouble by looking at all of their projects.
  const risks = assessPortfolio(base.map((r) => ({
    project_id: r.project_id,
    student_email: r.student_email,
    student_name: r.student_name,
    tasks_total: r.tasks_total,
    tasks_complete: r.tasks_complete,
    tasks_overdue: r.tasks_overdue,
    already_case_study: r.already_case_study,
    is_active_project: r.is_active_project,
  })));

  const out: ProjectRow[] = base.map((r) => ({
    ...r,
    risk: risks.get(r.project_id) ?? {
      state: 'no_plan' as const, attention: 0, reason: 'Not assessed',
      owner_projects: 1, owner_complete: 0,
    },
  }));

  // Closest to case-study ready first; a project already published drops to the
  // bottom, since it is no longer a candidate. The needs-attention ordering is a
  // client-side toggle over this same payload, not a second request.
  return out.sort((a, b) => {
    if (a.already_case_study !== b.already_case_study) return a.already_case_study ? 1 : -1;
    return b.readiness.score - a.readiness.score;
  });
}

/* The Gantt, build evidence and artifact readers moved to projectDeliveryDetail.ts
 * when this file approached CLAUDE.md's 500-line ceiling. Re-exported here so the
 * route layer keeps one import site and existing callers do not break. */
export {
  getProjectGantt,
  getProjectEvidence,
  getProjectArtifacts,
  getReleaseSummaries,
} from './projectDeliveryDetail';
export type { GanttTask, GanttRelease, ReleaseSummary } from './projectDeliveryDetail';
