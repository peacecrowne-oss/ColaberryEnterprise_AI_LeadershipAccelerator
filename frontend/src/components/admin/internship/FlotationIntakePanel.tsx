import React, { useCallback, useEffect, useState } from 'react';
import { SectionCard, StatusBadge } from '../shell';
import {
  buildFromUnderstanding,
  describeBuildError,
  listFlotationUnderstandings,
  FlotationUnderstandingRow,
  StartedBuild,
} from '../../../services/adminFlotationIntakeApi';
import { getViewAsUrl } from '../../../services/adminOrgApi';
import ProjectPlanReview from './ProjectPlanReview';

/**
 * The management door into the one project intake.
 *
 *     "as an admin, I can create the project myself so I test the processes (that must stay
 *      in sync) and understand the user experience."  (Ali, 2026-09-16)
 *
 * Every AI Flotation conversation that produced an understanding is listed here with the
 * person it belongs to, where a build would land, and whether one already exists. "Build
 * this project" runs it through the SAME `startBuild` the portal wizard uses - not a copy of
 * the pipeline, the pipeline - so what the admin sees afterwards is what the prospect would
 * see, and what a student would see.
 *
 * Contrast with `InternshipProjectAuthor` beside it, which lets a manager hand-write
 * releases and stories. That bypasses intake, decompose and gate entirely; this does not.
 */

const fmtWhen = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

interface RowState {
  busy: boolean;
  error: string | null;
  started: StartedBuild | null;
}

export default function FlotationIntakePanel() {
  const [rows, setRows] = useState<FlotationUnderstandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, RowState>>({});
  // Which row has its plan open. One at a time: a table of expanded plans is a
  // wall, and the question being asked is always about one project.
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // No lead means no person and nowhere to build into - every such row on production
      // is a leftover from testing the extractor. Buildable rows first, then the rest.
      const all = (await listFlotationUnderstandings()).filter((r) => r.lead);
      setRows([...all.filter((r) => r.enrollment), ...all.filter((r) => !r.enrollment)]);
    } catch (err) {
      setLoadError(describeBuildError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const EMPTY: RowState = { busy: false, error: null, started: null };
  const patch = (id: string, p: Partial<RowState>) =>
    setState((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY), ...p } }));

  const build = async (row: FlotationUnderstandingRow) => {
    patch(row.id, { busy: true, error: null });
    try {
      const started = await buildFromUnderstanding(row.id, { enrollmentId: row.enrollment?.id });
      patch(row.id, { busy: false, started });
      // The list is the source of truth for "already built"; refresh it rather than
      // guessing at the row locally.
      void load();
    } catch (err) {
      patch(row.id, { busy: false, error: describeBuildError(err) });
    }
  };

  const viewAs = async (enrollmentId: string) => {
    const url = await getViewAsUrl(enrollmentId);
    if (url) window.open(url, '_blank', 'noopener');
  };

  return (
    <SectionCard
      title="Build a project from an enquiry"
      icon="hammer-line"
      subtitle="Pick a conversation, build it, then open their portal to see exactly what they would see"
      actions={
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void load()} disabled={loading}>
          <i className="ri-refresh-line me-1" />Refresh
        </button>
      }
    >
      {loading && rows.length === 0 ? (
        <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary" /></div>
      ) : loadError ? (
        <p className="text-danger small mb-0">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted small mb-0 text-center py-3">No AI Flotation conversation has produced an understanding yet.</p>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover table-sm align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>Project</th>
                <th>Who</th>
                <th>Lands in</th>
                <th className="text-end">Items</th>
                <th>Build</th>
                <th className="text-end" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const s = state[row.id] ?? EMPTY;
                const built = row.build || s.started;
                return (
                  <React.Fragment key={row.id}>
                  <tr>
                    <td>
                      <div className="fw-semibold">{row.title || 'Untitled'}</div>
                      <div className="small text-muted">
                        {row.source === 'voice_transcript' ? 'from a call' : 'from the written interview'}
                        {row.confirmed_at ? ' · confirmed' : ' · not yet confirmed'}
                      </div>
                    </td>
                    <td>
                      {row.lead ? (
                        <>
                          <div>{row.lead.name || row.lead.email}</div>
                          <div className="small text-muted">{row.lead.company || row.lead.email}</div>
                        </>
                      ) : <span className="text-muted small">no lead</span>}
                    </td>
                    <td>
                      {row.enrollment ? (
                        <StatusBadge label={row.enrollment.tier} tone={row.enrollment.tier === 'guest' ? 'neutral' : 'info'} />
                      ) : (
                        <StatusBadge label="no account" tone="warning" />
                      )}
                    </td>
                    <td className="text-end">{row.items}</td>
                    <td>
                      {built ? (
                        <div className="small">
                          <StatusBadge
                            label={row.build?.assigned ? 'assigned' : 'held for review'}
                            tone={row.build?.assigned ? 'success' : 'info'}
                          />
                          <div className="text-muted">{row.build ? fmtWhen(row.build.started_at) : 'just now'}</div>
                        </div>
                      ) : s.error ? (
                        <span className="text-danger small">{s.error}</span>
                      ) : !row.enrollment ? (
                        <span className="text-muted small">No account to build into. Newer enquiries get one automatically; this one predates that.</span>
                      ) : (
                        <span className="text-muted small">Not built yet</span>
                      )}
                    </td>
                    <td className="text-end text-nowrap">
                      {built && row.enrollment ? (
                        <div className="d-inline-flex gap-2">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => setOpen((o) => (o === row.id ? null : row.id))}
                          >
                            <i className={`ri-arrow-${open === row.id ? 'up' : 'down'}-s-line me-1`} />
                            {open === row.id ? 'Hide plan' : row.build?.assigned ? 'View plan' : 'Review plan'}
                          </button>
                          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void viewAs(row.enrollment!.id)}>
                            <i className="ri-eye-line me-1" />See it as they would
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={s.busy || !row.enrollment}
                          title={row.enrollment ? undefined : 'This enquiry has no account to build into yet'}
                          onClick={() => void build(row)}
                        >
                          {s.busy ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="ri-hammer-line me-1" />}
                          Build this project
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* The SAME review the conversation shows, not a second idea of one.
                      A build started here is held like any other admin-initiated build,
                      so this is where it gets read and assigned. */}
                  {open === row.id && built && (
                    <tr>
                      <td colSpan={6} className="bg-light">
                        <ProjectPlanReview
                          projectId={(row.build?.project_id || s.started?.projectId) as string}
                          personName={row.lead?.name || row.lead?.email}
                          onAssigned={() => void load()}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small text-muted mb-0 mt-3">
        <strong>Build</strong> runs the portal&rsquo;s own intake &rarr; decompose &rarr; gate &rarr; repair &rarr; publish, which takes a minute
        or two. <strong>See it as they would</strong> then opens their portal in a new tab, signed in as them, with the project
        exactly as a student-created one would appear.
      </p>
    </SectionCard>
  );
}
