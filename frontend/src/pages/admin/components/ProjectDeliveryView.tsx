import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../utils/api';
import { SectionCard, StatCard, StatusBadge } from '../../../components/admin/shell';
import CaseStudyKpi from './projectDelivery/CaseStudyKpi';
import CaseStudyReadinessModal from './projectDelivery/CaseStudyReadinessModal';
import BuildEvidencePanel, { ProjectEvidence } from './projectDelivery/BuildEvidencePanel';
import ArtifactsPanel, { ArtifactGroup } from './projectDelivery/ArtifactsPanel';
import LinkChip from './projectDelivery/LinkChip';
import WithoutProjectPanel, { WithoutProjectSummary } from './projectDelivery/WithoutProjectPanel';
import {
  RiskPill, SortToggle, sortRows, countAttention, RiskAssessment, SortMode,
} from './projectDelivery/RiskControls';
import {
  SegBar, ReleaseStrip, StatePill, Pill, Legend, RowShell, EvidenceLine, RELEASE_GRID,
  TaskBuckets, ReleaseState,
} from './projectDelivery/CompactRow';
import ReleaseRow, {
  ReleaseSummaryLike, TimingRollup, releaseColor, fmtDay as fmtReleaseDay,
} from './projectDelivery/ReleaseRow';

/**
 * ProjectDeliveryView — what each student has actually built, on a timeline,
 * ranked by how close it is to being a case study.
 *
 * TWO DESIGN DECISIONS, both forced by what production actually holds:
 *
 * 1. READINESS IS RANKED, NOT GATED. A prod audit found zero projects hold both
 *    a build plan and artifacts — 29 live projects carry tasks with no repo, and
 *    the repo-bearing ones carry no tasks. A "ready for case study" filter would
 *    therefore show an empty list, which reads as a broken page rather than as a
 *    true statement. So every project is scored and ordered, and each names what
 *    it is MISSING. An empty ready-list becomes a worklist.
 *
 * 2. THE GANTT IS DRAWN ON THE RELEASE SPINE, not per task. Production has 656
 *    tasks across 29 projects on six shared releases (r0-r4 plus prep). Drawing
 *    656 bars would be unreadable; drawing six per project shows the shape of
 *    the programme and expands to the task detail on demand.
 *
 * Bars are positioned by percentage across a shared date axis rather than by a
 * charting library — a Gantt is a date scale and two divs, and adding a
 * dependency is a decision that belongs to the operator, not to this view.
 */

interface ReadinessComponent { key: string; label: string; score: number; weight: number; gap?: string }
interface Readiness { score: number; ready: boolean; components: ReadinessComponent[]; gaps: string[] }

interface ProjectRow {
  project_id: string;
  name: string | null;
  student_name: string | null;
  student_email: string | null;
  cohort_id: string | null;
  cohort_name: string | null;
  stage: string;
  maturity_score: number | null;
  /** The owner holds an active internship. Shown, not filtered on — see `internsFirst`. */
  is_intern: boolean;
  has_repo: boolean;
  repo_url: string | null;
  /** The student's Command Center — a GitHub Pages site at the root of their own repo.
   *  Null until they publish Pages, which is why the icon renders conditionally. */
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
  readiness: Readiness;
  risk?: RiskAssessment | null;
  /** The release spine, delivered with the LIST so a collapsed row can draw its
   *  coloured bars immediately. Measured at 11ms for all 30 projects in two batched
   *  queries — the reason this is eager rather than fetched per expand. */
  releases: ReleaseSummaryLike[];
  /** Task-state split for the segmented bar, summed server-side from the releases
   *  so the bar and the release strip cannot disagree. */
  buckets: TaskBuckets;
}

interface GanttTask {
  id: string; title: string; status: string; release_key: string | null;
  due_on: string | null; due_baseline_on: string | null;
  slipped: boolean; overdue: boolean; blocked_by: string[];
  /** The plan's own traceability: which requirements this story fulfils. */
  fulfills?: string[];
  /** What "done" means for it, in the plan's words. */
  acceptance?: string[];
  narrative?: string | null;
}
interface GanttRelease extends ReleaseSummaryLike {
  lands_when?: string | null;
  buckets?: TaskBuckets;
  state?: ReleaseState;
  tasks: GanttTask[];
}
interface Gantt {
  project_id: string;
  releases: GanttRelease[];
  /** REQ id -> statement, from the published plan. Empty for a project that has none. */
  requirements?: Record<string, string>;
  totals: { tasks: number; complete: number; overdue: number; undated: number };
}

/** The small uppercase label above a story's requirement and acceptance lists. */
const STORY_LABEL: React.CSSProperties = {
  color: 'var(--text-muted)', fontWeight: 600, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '.04em',
};

interface Props {
  /** Scope to one cohort when opened from a drill-down; undefined = all cohorts. */
  cohortId?: string;
  /**
   * Scope to people holding an active internship membership.
   *
   * A separate flag rather than a cohort id on purpose: an intern's enrollment
   * still points at their CLASS cohort, because the internship is a secondary
   * `cohort_memberships` row. Passing the internship cohort as `cohortId` would
   * quietly return nothing.
   */
  internsOnly?: boolean;
  /**
   * Show EVERY project, interns first.
   *
   *     "All projects built moving fwd should be assigned to an intern above or shown
   *      below with drill down. Either way, I should be able to drill down into the
   *      projects."  (Ali, 2026-09-30)
   *
   * `internsOnly` answered that by hiding the rest, so a project built for a prospect
   * from the enquiry list was absent from the board rather than merely lower down it.
   * This orders instead of excluding.
   */
  internsFirst?: boolean;
  /** Hide the "enrolled with no project" panel where it is not the point. */
  hideWithoutProject?: boolean;
}

export default function ProjectDeliveryView({ cohortId, internsOnly, internsFirst, hideWithoutProject }: Props) {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [gantt, setGantt] = useState<Record<string, Gantt>>({});
  const [ganttLoading, setGanttLoading] = useState<string | null>(null);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  // Which question the list is answering. Readiness is the default because the
  // page's job is case-study conversion; attention is the inversion of it.
  const [sortMode, setSortMode] = useState<SortMode>('readiness');
  // Students with no project at all. Fetched alongside the list because the board
  // cannot show them and their absence is the thing worth reporting.
  const [without, setWithout] = useState<WithoutProjectSummary | null>(null);
  // Evidence and artifacts are fetched on EXPAND, unlike the release bars: they are
  // detail nobody reads from a collapsed row, and both are empty for every project
  // today, so eager-loading them would cost 60 requests to render two empty states.
  const [evidence, setEvidence] = useState<Record<string, ProjectEvidence>>({});
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactGroup[]>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  /** The row whose readiness breakdown is open, or null. Holds the row rather than an id
   *  so the modal keeps rendering the numbers it was opened with even if the list refreshes
   *  underneath it. */
  const [scoreFor, setScoreFor] = useState<ProjectRow | null>(null);
  /** Which release row is expanded, keyed `projectId::releaseKey` so two projects
   *  cannot both think their R0 is open. */
  const [openRelease, setOpenRelease] = useState<string | null>(null);
  /** The story whose requirements are open, keyed by task id. One at a time:
   *  this sits inside an already-expanded release, and two open at once turns a
   *  readable list into a wall. */
  const [openStory, setOpenStory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (cohortId) params.cohort_id = cohortId;
      if (internsOnly) params.interns = '1';
      // Settled, not all: the delivery table is the page. If the without-project
      // panel fails, the board must still render rather than showing an error for
      // a supplementary panel.
      const [res, wp] = await Promise.allSettled([
        api.get('/api/admin/projects/delivery', { params }),
        api.get('/api/admin/projects/without-project', { params }),
      ]);
      if (res.status === 'rejected') throw res.reason;
      setRows(res.value.data.projects || []);
      setWithout(hideWithoutProject ? null : (wp.status === 'fulfilled' ? wp.value.data : null));
    } catch {
      setError('Could not load project delivery.');
    } finally {
      setLoading(false);
    }
  }, [cohortId, internsOnly, hideWithoutProject]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (gantt[id] && evidence[id] && artifacts[id]) return;

    setGanttLoading(gantt[id] ? null : id);
    setDetailLoading(id);
    // Fetched together so one expand is one round of requests. Settled rather than
    // all-or-nothing: a failing artifacts call must not blank the timeline.
    const [g, ev, ar] = await Promise.allSettled([
      gantt[id] ? Promise.resolve(null) : api.get(`/api/admin/projects/${id}/gantt`),
      evidence[id] ? Promise.resolve(null) : api.get(`/api/admin/projects/${id}/evidence`),
      artifacts[id] ? Promise.resolve(null) : api.get(`/api/admin/projects/${id}/artifacts`),
    ]);
    if (g.status === 'fulfilled' && g.value) {
      setGantt((prev) => ({ ...prev, [id]: g.value!.data }));
    }
    if (ev.status === 'fulfilled' && ev.value) {
      setEvidence((prev) => ({ ...prev, [id]: ev.value!.data }));
    }
    if (ar.status === 'fulfilled' && ar.value) {
      setArtifacts((prev) => ({ ...prev, [id]: ar.value!.data.artifacts || [] }));
    }
    // A rejected gantt leaves it absent, so the row says "timeline unavailable"
    // rather than rendering an empty plan, which would read as "no work".
    setGanttLoading(null);
    setDetailLoading(null);
  };

  const visible = useMemo(
    () => {
      const sorted = sortRows(onlyOverdue ? rows.filter((r) => r.tasks_overdue > 0) : rows, sortMode);
      if (!internsFirst) return sorted;
      // Stable partition, so the chosen sort still decides the order WITHIN each
      // group and the toggle keeps meaning what it says.
      return [...sorted.filter((r) => r.is_intern), ...sorted.filter((r) => !r.is_intern)];
    },
    [rows, onlyOverdue, sortMode, internsFirst]
  );

  const totals = useMemo(() => ({
    projects: rows.length,
    building: rows.filter((r) => r.tasks_total > 0).length,
    overdue: rows.reduce((n, r) => n + r.tasks_overdue, 0),
    candidates: rows.filter((r) => !r.already_case_study && r.readiness.score >= 35).length,
  }), [rows]);

  if (loading) {
    return (
      <SectionCard title="Project Delivery">
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading…</span></div>
        </div>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <SectionCard title="Project Delivery">
        <div className="d-flex align-items-center justify-content-between">
          <span className="text-danger small mb-0">{error}</span>
          <button className="btn btn-sm btn-outline-secondary" onClick={load}>Retry</button>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Project Delivery"
      subtitle="Every student build on one timeline, ranked by how close it is to being a case study. Each row names what is still missing."
      icon="rocket-2-line"
      actions={
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <SortToggle mode={sortMode} onChange={setSortMode}
            attentionCount={countAttention(rows)} />
          <div className="form-check form-switch mb-0">
            <input className="form-check-input" type="checkbox" id="only-overdue"
              checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
            <label className="form-check-label small" htmlFor="only-overdue">Overdue only</label>
          </div>
          <button className="btn btn-sm btn-outline-secondary" onClick={load}>Refresh</button>
        </div>
      }
    >
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><StatCard label="Projects" value={totals.projects} icon="folder-line" tone="primary" /></div>
        <div className="col-6 col-lg-3"><StatCard label="With a build plan" value={totals.building} icon="list-check" tone="info" /></div>
        <div className="col-6 col-lg-3"><StatCard label="Overdue tasks" value={totals.overdue} icon="alarm-warning-line" tone={totals.overdue > 0 ? 'danger' : 'success'} /></div>
        <div className="col-6 col-lg-3"><StatCard label="Case-study candidates" value={totals.candidates} icon="award-line" tone="success" hint="score 35+" /></div>
      </div>

      <WithoutProjectPanel data={without} />

      {visible.length === 0 && (
        <div className="border rounded p-4 text-center text-muted small">
          {onlyOverdue ? 'No project has overdue tasks.' : 'No projects found for this scope.'}
        </div>
      )}

      {/* The compact portfolio table, per the approved mockup. A table rather than
          cards: thirty projects at ~90px each showed six on screen; these rows show
          twenty-plus, which is what makes a portfolio scannable. */}
      <Legend />

      <div style={{
        border: '0.5px solid var(--border-subtle)', borderRadius: 12,
        overflow: 'hidden', background: 'var(--surface-card)',
      }}>
        <RowShell header>
          <span />
          <span>Project</span>
          <span>Tasks</span>
          <span>Releases</span>
          <span style={{ textAlign: 'right' }}>Late</span>
          <span style={{ textAlign: 'right' }}>Case</span>
        </RowShell>

      {visible.map((r) => {
        const g = gantt[r.project_id];
        const open = expanded === r.project_id;
        const b = r.buckets;
        return (
          <React.Fragment key={r.project_id}>
            <RowShell active={open} onClick={() => toggle(r.project_id)}>
              <i className={`ri-arrow-${open ? 'down' : 'right'}-s-line`} aria-hidden="true"
                style={{ fontSize: 16, color: 'var(--text-muted)' }} />

              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{r.name || '(unnamed project)'}</span>{' '}
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {r.student_name || '—'}{r.cohort_name ? ` · ${r.cohort_name}` : ''}
                </span>
                {/* Only on the boards that mix the two. Marking every intern on an
                    all-intern board is a badge that carries no information. */}
                {internsFirst && !r.is_intern && (
                  <span
                    className="ms-2"
                    style={{
                      fontSize: 10.5, fontWeight: 600, letterSpacing: '.03em',
                      color: 'var(--text-muted)', border: '1px solid var(--border-subtle, #dee2e6)',
                      borderRadius: 3, padding: '0 5px', textTransform: 'uppercase',
                    }}
                    title="This project's owner does not hold an active internship"
                  >
                    not an intern
                  </span>
                )}
                <RiskPill risk={r.risk} />
                {/* Both are public URLs the platform already stores, and each renders only
                    when detected so a row never shows a link that goes nowhere.

                    THEY ARE CHIPS, NOT BARE GLYPHS. As two unlabelled icons sitting side by
                    side in muted text they read as decoration — the operator's report was
                    "we are still missing the icon links", on a page that was already
                    rendering them. The Command Center carries the accent colour because it
                    is the live thing the student built; the repository stays muted because
                    it is the source behind it. Only 11 of 30 rows have a Command Center, so
                    its presence has to be legible at a glance rather than inferred from
                    which of two similar shapes came first. */}
                <LinkChip
                  href={r.command_center_url}
                  icon="ri-dashboard-3-line"
                  label="Command Center"
                  accent
                />
                <LinkChip href={r.repo_url} icon="ri-github-fill" label="Repository" />
              </div>

              <div>
                <SegBar buckets={b} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  {b.done}/{b.total}{b.no_date > 0 ? ` · ${b.no_date} undated` : ''}
                </div>
              </div>

              <ReleaseStrip states={(r.releases || []).map((rel) => (rel as any).state || 'empty')} />

              <div style={{ textAlign: 'right' }}>
                {b.overdue > 0
                  ? <Pill tone="danger">{b.overdue}</Pill>
                  : <span style={{ color: 'var(--text-muted)' }}>0</span>}
              </div>

              <div style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                <CaseStudyKpi
                  readiness={r.readiness}
                  alreadyCaseStudy={r.already_case_study}
                  compact
                  onOpen={r.already_case_study ? undefined : () => setScoreFor(r)}
                />
              </div>
            </RowShell>

            {open && (
              <div style={{ background: 'var(--surface-subtle)', padding: '4px 10px 10px 40px' }}>
                {/* Gaps first: what stands between this build and a case study. */}
                {r.readiness.gaps.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 10px' }}>
                    {r.readiness.gaps.map((gp) => (
                      <Pill key={gp} tone={/no repo|no artifacts/.test(gp) ? 'danger'
                        : /stage is/.test(gp) ? 'neutral' : 'warning'}>{gp}</Pill>
                    ))}
                  </div>
                )}

                {ganttLoading === r.project_id && (
                  <div className="text-center py-3">
                    <div className="spinner-border spinner-border-sm text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                )}
                {!ganttLoading && !g && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Timeline unavailable for this project.</div>
                )}
                {g && g.totals.tasks === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    No build plan for this project, so there is nothing to place on a timeline yet.
                  </div>
                )}

                {/* The release table. Each row expands to its stories, so the spine and
                    the work sit in one place rather than in separate panels. */}
                {g && g.totals.tasks > 0 && (
                  <div style={{
                    border: '0.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-card)', overflow: 'hidden',
                  }}>
                    <div style={{ ...RELEASE_GRID, borderTop: 0, fontSize: 11, color: 'var(--text-muted)', padding: '5px 10px' }}>
                      <span /><span>Release</span><span>Stories</span><span>Window</span><span>Status</span>
                    </div>
                    {g.releases.map((rel) => {
                      const relKey = r.project_id + '::' + rel.release_key;
                      const relOpen = openRelease === relKey;
                      return (
                        <React.Fragment key={rel.release_key}>
                          <div
                            style={{
                              ...RELEASE_GRID, padding: '6px 10px', fontSize: 12.5,
                              borderTop: '0.5px solid var(--border-subtle)', cursor: 'pointer',
                              background: relOpen ? 'var(--surface-subtle)' : undefined,
                            }}
                            onClick={() => setOpenRelease(relOpen ? null : relKey)}
                          >
                            <i className={`ri-arrow-${relOpen ? 'down' : 'right'}-s-line`} aria-hidden="true"
                              style={{ fontSize: 16, color: 'var(--text-muted)' }} />
                            <span style={{ fontWeight: relOpen ? 500 : undefined }}>
                              {rel.display_name || rel.release_key}
                            </span>
                            <span>{rel.complete}/{rel.total}</span>
                            <span style={{ color: 'var(--text-muted)' }}>
                              {rel.starts_on ? fmtReleaseDay(rel.starts_on) + ' to ' + fmtReleaseDay(rel.ends_on) : 'no dates'}
                            </span>
                            <StatePill state={(rel as any).state || 'empty'} overdue={rel.overdue} />
                          </div>

                          {relOpen && (
                            <div style={{ background: 'var(--surface-subtle)', padding: '2px 0 6px' }}>
                              {/* The definition of done, when the build text carries one.
                                  Omitted entirely otherwise, rather than an empty quote. */}
                              {(rel as any).lands_when && (
                                <div style={{ fontSize: 12, color: 'var(--text-body)', fontStyle: 'italic', padding: '4px 10px 6px 46px' }}>
                                  Lands when: {(rel as any).lands_when}
                                </div>
                              )}
                              {rel.tasks.map((t) => {
                                // Normalised once: both columns are JSONB and absent on any
                                // task the manual import path wrote, and reading them
                                // through `?.` at five call sites invites exactly one of
                                // them to be missed.
                                const fulfills = t.fulfills ?? [];
                                const acceptance = t.acceptance ?? [];
                                // Only clickable when there is something behind it. A row
                                // that opens to nothing teaches people the arrow lies.
                                const hasDetail = Boolean(fulfills.length || acceptance.length || t.narrative);
                                const storyOpen = openStory === t.id;
                                return (
                                  <React.Fragment key={t.id}>
                                    <div
                                      style={{
                                        fontSize: 12, color: 'var(--text-body)', padding: '3px 10px 3px 46px',
                                        display: 'flex', justifyContent: 'space-between', gap: 12,
                                        cursor: hasDetail ? 'pointer' : undefined,
                                      }}
                                      onClick={hasDetail ? () => setOpenStory(storyOpen ? null : t.id) : undefined}
                                      title={hasDetail ? 'Show what this story has to satisfy' : undefined}
                                    >
                                      <span style={t.status === 'complete'
                                        ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : undefined}>
                                        {hasDetail && (
                                          <i
                                            className={storyOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
                                            aria-hidden="true"
                                            style={{ fontSize: 14, color: 'var(--text-muted)', marginRight: 2 }}
                                          />
                                        )}
                                        {t.title}
                                        {fulfills.length > 0 && (
                                          <span style={{ color: 'var(--text-muted)' }}> · {fulfills.length} req</span>
                                        )}
                                        {t.blocked_by.length > 0 && (
                                          <span style={{ color: 'var(--text-muted)' }}> · blocked by {t.blocked_by.length}</span>
                                        )}
                                      </span>
                                      <span style={{
                                        whiteSpace: 'nowrap',
                                        color: t.overdue ? 'var(--status-danger)'
                                          : t.status === 'complete' ? 'var(--text-muted)' : 'var(--text-body)',
                                      }}>
                                        {fmtReleaseDay(t.due_on)}
                                        {t.slipped && <span title="moved later than its baseline"> &#9873;</span>}
                                      </span>
                                    </div>

                                    {storyOpen && (
                                      <div style={{ padding: '2px 10px 8px 62px', fontSize: 12 }}>
                                        {t.narrative && (
                                          <div style={{ color: 'var(--text-body)', fontStyle: 'italic', marginBottom: 6 }}>
                                            {t.narrative}
                                          </div>
                                        )}
                                        {fulfills.length > 0 && (
                                          <div style={{ marginBottom: 6 }}>
                                            <div style={STORY_LABEL}>Requirements it fulfils</div>
                                            <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                                              {fulfills.map((reqId) => (
                                                <li key={reqId}>
                                                  <strong>{reqId}</strong>
                                                  {/* The statement when the published plan carries one; the id
                                                      alone otherwise, which is the honest answer for a
                                                      hand-authored or pre-pipeline project rather than a blank. */}
                                                  {g.requirements?.[reqId] ? ` — ${g.requirements[reqId]}` : ''}
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {acceptance.length > 0 && (
                                          <div>
                                            <div style={STORY_LABEL}>Done when</div>
                                            <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                                              {acceptance.map((line, i) => <li key={i}>{line}</li>)}
                                            </ul>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}

                {/* Evidence as ONE line, per the mockup: commits and criteria read at a
                    glance rather than as a grid of cards. The full panels stay available
                    behind the disclosure for version history and the outstanding list. */}
                <EvidenceLine
                  evidence={evidence[r.project_id] ?? null}
                  artifactCount={(artifacts[r.project_id] || []).length}
                  loading={detailLoading === r.project_id && !evidence[r.project_id]}
                />

                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--text-body)' }}>
                    Evidence and artifact detail
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    <BuildEvidencePanel
                      evidence={evidence[r.project_id] ?? null}
                      repoUrl={r.repo_url}
                      loading={detailLoading === r.project_id && !evidence[r.project_id]}
                    />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <ArtifactsPanel
                      artifacts={artifacts[r.project_id] ?? null}
                      loading={detailLoading === r.project_id && !artifacts[r.project_id]}
                    />
                  </div>
                </details>
              </div>
            )}
          </React.Fragment>
        );
      })}
      </div>

      {scoreFor && (
        <CaseStudyReadinessModal
          projectName={scoreFor.name || '(unnamed project)'}
          studentName={scoreFor.student_name}
          readiness={scoreFor.readiness}
          onClose={() => setScoreFor(null)}
        />
      )}
    </SectionCard>
  );
}
