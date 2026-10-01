import React, { useEffect, useState } from 'react';
import {
  InternProjectBuildView,
  assignProject,
  internProjectBuildByProject,
} from '../../../services/adminInternshipApi';
import { describeBuildError } from '../../../services/adminFlotationIntakeApi';
import RequirementCoveragePanel from '../../../pages/admin/components/RequirementCoveragePanel';

/**
 * What a reviewer is being asked to approve, wherever they were asked from.
 *
 *     "the Build this project button should be the same across the admin and student
 *      side. They should both have the interview element and be built the exact same.
 *      They should be using the same skill to build out the entire project."
 *      (Ali, 2026-09-30)
 *
 * There are two admin surfaces that start a build - the conversation on the internship
 * Projects page, and the enquiry list beside it - and they were about to grow two
 * different ideas of what "review" means. This is the one component both use, for the
 * same reason there is one `startBuild`: a second copy is not kept aligned, it drifts.
 *
 * It owns the polling, the gate reading and the assign, so a surface that wants to offer
 * a review only has to hand it a project id.
 *
 * ── WHY IT POLLS AND THEN STOPS ────────────────────────────────────────────────
 *
 * A held build rests at `drafted`, which is TERMINAL here rather than a failure: per the
 * SBP runbook `drafted` means the plan is good and something chose not to publish it, and
 * on this path that something is us. Only `generating` is worth asking about again.
 */
const ProjectPlanReview: React.FC<{
  projectId: string;
  /** Whose project it is, for the Assign button's label. */
  personName?: string | null;
  /** Fired after a successful assign, so a list can refresh itself. */
  onAssigned?: () => void;
}> = ({ projectId, personName, onAssigned }) => {
  const [review, setReview] = useState<InternProjectBuildView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!projectId) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const look = async () => {
      try {
        const view = await internProjectBuildByProject(projectId);
        if (!live) return;
        setReview(view);
        setError(null);
        if (view.status === 'generating' || view.status === null) {
          timer = setTimeout(() => void look(), 5000);
        }
      } catch (err) {
        if (!live) return;
        setError(describeBuildError(err));
        // Slower on failure: a plan that cannot be read will not become readable by
        // asking harder.
        timer = setTimeout(() => void look(), 15000);
      }
    };
    void look();

    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [projectId]);

  /**
   * The reviewer says yes.
   *
   * `expected_sha256` is the hash of the plan actually on screen. `publishPlan` refuses on
   * a mismatch, so a regeneration between reading and assigning cannot ship a plan nobody
   * reviewed - the failure that parameter was added for.
   */
  const assign = async () => {
    if (!review || assigning) return;
    setAssigning(true);
    setError(null);
    try {
      await assignProject(review.project_id, { expected_sha256: review.plan_sha256 });
      setReview(await internProjectBuildByProject(review.project_id));
      onAssigned?.();
    } catch (err) {
      setError(describeBuildError(err));
    } finally {
      setAssigning(false);
    }
  };

  if (error && !review) return <p className="text-danger small mb-0">{error}</p>;

  if (!review) {
    return (
      <div className="d-flex align-items-center gap-2 small">
        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
        <span>Reading the plan…</span>
      </div>
    );
  }

  const { plan } = review;

  return (
    <div className="d-flex flex-column gap-2">
      {error && <p className="text-danger small mb-0">{error}</p>}

      {review.status === 'generating' && (
        <div className="d-flex align-items-center gap-2" style={{ fontSize: 13 }}>
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
          <span>Generating. A minute or two, and nothing is visible to them yet.</span>
        </div>
      )}

      {review.status === 'failed' && (
        <div className="alert alert-danger py-2 mb-0" role="alert" style={{ fontSize: 13 }}>
          Generation failed. Nothing was assigned; have the conversation again with more in it.
        </div>
      )}

      {review.blocking.length > 0 && (
        <div className="alert alert-warning py-2 mb-0" role="alert" style={{ fontSize: 12.5 }}>
          <strong>This plan cannot be assigned yet.</strong>
          <ul className="mb-0 mt-1" style={{ paddingLeft: 18 }}>
            {review.blocking.map((v, i) => <li key={`${v.rule}-${i}`}>{v.message}</li>)}
          </ul>
          <div className="mt-1">Usually the brief is thin. Start again and say more in the conversation.</div>
        </div>
      )}

      {plan && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{plan.project_name}</div>
          <div className="text-muted mb-2" style={{ fontSize: 12.5 }}>
            {plan.descriptor} · {plan.requirements.length} requirements
            · {plan.releases.length} releases · {plan.stories.length} stories
            {review.version ? ` · v${review.version}` : ''}
          </div>
          <div className="d-flex flex-column gap-2">
            {plan.releases.map((rel) => {
              const stories = plan.stories.filter((s) => s.release === rel.key);
              return (
                <div key={rel.key} style={{ border: '1px solid #e9ecef', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {rel.name}
                    <span className="text-muted" style={{ fontWeight: 400 }}>
                      {' '}· {stories.length} stories · weeks {rel.week_start}-{rel.week_end}
                    </span>
                  </div>
                  {rel.goal && <div className="text-muted" style={{ fontSize: 12 }}>{rel.goal}</div>}
                  <ul className="mb-0 mt-1" style={{ paddingLeft: 18, fontSize: 12.5 }}>
                    {stories.map((s) => (
                      <li key={s.id}><span style={{ fontWeight: 600 }}>{s.id}</span> {s.title}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {review.advisory.length > 0 && (
        <details style={{ fontSize: 12.5 }}>
          <summary className="text-muted">
            {review.advisory.length} advisory note(s) — these do not stop an assignment
          </summary>
          <ul className="mb-0 mt-1" style={{ paddingLeft: 18 }}>
            {review.advisory.map((v, i) => <li key={`${v.rule}-${i}`}>{v.message}</li>)}
          </ul>
        </details>
      )}

      {review.coverage && (
        <RequirementCoveragePanel coverage={review.coverage} summary={review.coverage_summary} />
      )}

      <div>
        <button
          type="button"
          className="btn btn-sm btn-success"
          disabled={assigning || review.assigned || review.status === 'generating' || review.blocking.length > 0 || !plan}
          onClick={() => void assign()}
        >
          {assigning ? 'Assigning…' : review.assigned ? 'Assigned' : `Assign to ${personName || 'them'}`}
        </button>
      </div>

      {review.assigned && (
        <p className="text-success small mb-0">Published and materialised. It is on their Projects page now.</p>
      )}
    </div>
  );
};

export default ProjectPlanReview;
