/**
 * Builds stranded by a restart are resumed at boot, not left looking alive.
 *
 * The defect: generation runs on an in-process queue and `generating` is a database row.
 * Kill the process - every deploy does - and the row outlives the queue. `startBuild`
 * refuses a `generating` row, so nothing could ever recover it. This proves the sweep
 * finds those rows, re-enqueues generation from the intake on file, skips what already
 * ran (truth, naming), and marks the unrecoverable ones failed with a reason.
 */

const mockListByStatus = jest.fn();
const mockGetIntake = jest.fn();
const mockSaveIntake = jest.fn();
const mockSaveTruth = jest.fn();
const mockDecompose = jest.fn();
const mockQueueRun = jest.fn();
const mockNameProject = jest.fn();

jest.mock('../planStore', () => ({
  saveIntake: (...a: any[]) => mockSaveIntake(...a),
  getIntake: (...a: any[]) => mockGetIntake(...a),
  listIntakesByStatus: (...a: any[]) => mockListByStatus(...a),
  savePlanDraft: jest.fn(),
  getPlan: jest.fn(),
  publishPlan: jest.fn(),
}));
jest.mock('../intakeTruthStore', () => ({
  saveIntakeTruth: (...a: any[]) => mockSaveTruth(...a),
  loadIntakeTruthAtRevision: async () => null,
}));
jest.mock('../boundedQueue', () => ({
  getProvisionQueue: () => ({ run: (...a: any[]) => mockQueueRun(...a) }),
}));
jest.mock('../decomposeService', () => ({ decomposeBuild: (...a: any[]) => mockDecompose(...a) }));
jest.mock('../repoWriter', () => ({ writeDocsToRepo: jest.fn(), readRepoManifest: async () => null }));
jest.mock('../buildProgressSnapshot', () => ({ loadBuildProgress: async () => ({ progress: [], baselineByStory: {} }) }));
jest.mock('../materializeTasks', () => ({ materializePlanAsTasks: jest.fn() }));
jest.mock('../workspaceRepo', () => ({ repoForProject: async () => null }));
jest.mock('../repoWriteAccess', () => ({ repoWriteAccessForProject: async () => 'push' }));
jest.mock('../projectNaming', () => ({ nameProjectFromIntake: (...a: any[]) => mockNameProject(...a) }));
jest.mock('../../../config/database', () => ({ sequelize: { query: jest.fn(async () => []) } }));
// A failed generation emails an alert; the brief test below fails generation on purpose.
jest.mock('../../alertService', () => ({ emitAlert: jest.fn(async () => undefined) }));

import { recoverStrandedBuilds, startBuild } from '../sbpOrchestrator';

const stranded = (over: Record<string, unknown> = {}) => ({
  project_id: 'proj-1',
  enrollment_id: 'enr-1',
  idea: 'A tool loan system for a repair cafe, replacing the paper sign-out sheet.',
  name: 'Tool Loans',
  size: 'project',
  target_weeks: 8,
  answers: [{ id: 'q1', question: 'Who runs the desk?', answer: 'Marta, on Saturdays.' }],
  correlation_id: 'old-corr',
  status: 'generating',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  mockQueueRun.mockImplementation(async () => undefined);
  mockSaveIntake.mockResolvedValue({ project_id: 'proj-1', status: 'generating' });
  mockSaveTruth.mockResolvedValue({ outcome: 'saved', revision: 1, items: [], unmapped: 0 });
});

afterEach(() => {
  (console.log as jest.Mock).mockRestore?.();
});

describe('recoverStrandedBuilds', () => {
  it('re-enqueues generation for every row left at generating, from the intake on file', async () => {
    mockListByStatus.mockResolvedValue([stranded(), stranded({ project_id: 'proj-2', enrollment_id: 'enr-2' })]);

    const out = await recoverStrandedBuilds();

    expect(mockListByStatus).toHaveBeenCalledWith('generating');
    expect(out).toEqual({ resumed: ['proj-1', 'proj-2'], abandoned: [] });
    expect(mockQueueRun).toHaveBeenCalledTimes(2);
    expect(mockQueueRun.mock.calls.map((c) => c[1])).toEqual(['generate:proj-1', 'generate:proj-2']);
  });

  it('runs the real generation with the intake\'s idea and answers - not an empty brief', async () => {
    mockListByStatus.mockResolvedValue([stranded()]);
    mockDecompose.mockRejectedValue(new Error('stop here - the brief is what is under test'));

    await recoverStrandedBuilds();
    // Run what was queued, the way the queue would.
    await mockQueueRun.mock.calls[0][0]();

    expect(mockDecompose).toHaveBeenCalledTimes(1);
    const { brief } = mockDecompose.mock.calls[0][0];
    expect(brief).toContain('repair cafe');
    expect(brief).toContain('Marta, on Saturdays.');
  });

  // The resumed build's publish behaviour is held in sbpOrchestrator.autoPublish.test.ts,
  // which has the harness that can tell a publish from a draft.
  it('writes the hold DOWN when a build starts, not only into the running job', async () => {
    // The row is the only thing that outlives the process, so this is the write that makes
    // the test above possible at all.
    mockGetIntake.mockResolvedValue(null);
    mockDecompose.mockRejectedValue(new Error('stop here'));

    await startBuild({
      projectId: 'proj-held', enrollmentId: 'enr-1',
      idea: 'A tool loan system for a repair cafe, replacing the paper sign-out sheet.',
      holdForReview: true,
    });

    const saved = mockSaveIntake.mock.calls.map((c) => c[0]).find((i) => i.project_id === 'proj-held');
    expect(saved).toBeDefined();
    expect(saved.hold_for_review).toBe(true);
  });

  it('does not claim a hold that was never asked for', async () => {
    // The honesty runs both ways: a student's own build must not start resting at drafted.
    mockGetIntake.mockResolvedValue(null);
    mockDecompose.mockRejectedValue(new Error('stop here'));

    await startBuild({
      projectId: 'proj-open', enrollmentId: 'enr-1',
      idea: 'A tool loan system for a repair cafe, replacing the paper sign-out sheet.',
    });

    const saved = mockSaveIntake.mock.calls.map((c) => c[0]).find((i) => i.project_id === 'proj-open');
    expect(saved.hold_for_review).toBe(false);
  });

  it('does not redo what the first start already did - truth and naming', async () => {
    mockListByStatus.mockResolvedValue([stranded()]);
    await recoverStrandedBuilds();
    expect(mockSaveTruth).not.toHaveBeenCalled();
    expect(mockNameProject).not.toHaveBeenCalled();
    // And does not rewrite the intake row before generation either.
    expect(mockSaveIntake).not.toHaveBeenCalled();
  });

  it('marks a row with no enrolment failed with a reason, so it stops looking alive', async () => {
    mockListByStatus.mockResolvedValue([stranded({ enrollment_id: null })]);
    mockGetIntake.mockResolvedValue(stranded({ enrollment_id: null }));

    const out = await recoverStrandedBuilds();

    expect(out).toEqual({ resumed: [], abandoned: ['proj-1'] });
    expect(mockQueueRun).not.toHaveBeenCalled();
    expect(mockSaveIntake).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'proj-1',
      status: 'failed',
      last_error: expect.objectContaining({ error_class: 'StrandedWithoutEnrollment' }),
    }));
  });

  it('is a no-op on a clean boot', async () => {
    mockListByStatus.mockResolvedValue([]);
    const out = await recoverStrandedBuilds();
    expect(out).toEqual({ resumed: [], abandoned: [] });
    expect(mockQueueRun).not.toHaveBeenCalled();
    expect(mockSaveIntake).not.toHaveBeenCalled();
  });

  it('a queue that refuses one build does not stop the sweep', async () => {
    mockListByStatus.mockResolvedValue([stranded(), stranded({ project_id: 'proj-2' })]);
    mockQueueRun.mockImplementationOnce(async () => { throw Object.assign(new Error('full'), { error_class: 'QueueFull' }); });

    const out = await recoverStrandedBuilds();
    // The rejection is caught on the promise; the sweep still lists both as resumed
    // because the hand-off happened. The failure is one classified log line.
    expect(out.resumed).toEqual(['proj-1', 'proj-2']);
    await new Promise((r) => setImmediate(r));
  });
});

describe('the defect this closes', () => {
  it('startBuild still refuses a generating row - which is why the sweep, not a retry, is the recovery', async () => {
    mockGetIntake.mockResolvedValue(stranded());
    const res = await startBuild({ projectId: 'proj-1', enrollmentId: 'enr-1', idea: 'x'.repeat(40) });
    expect(res.status).toBe('generating');
    expect(mockQueueRun).not.toHaveBeenCalled();
    expect(mockSaveIntake).not.toHaveBeenCalled();
  });
});
