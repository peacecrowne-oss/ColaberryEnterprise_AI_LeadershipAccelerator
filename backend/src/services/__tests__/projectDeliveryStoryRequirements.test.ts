/**
 * A story's requirements, on the delivery board.
 *
 * Ali, 2026-09-29: "I would even like to be able to see the story requirements
 * if I click on it."
 *
 * The traceability already existed and nothing read it back: materializeTasks
 * writes the plan story's `fulfills` onto the task row, and the gantt payload
 * selected neither it nor `acceptance`. The statements live one table further
 * out, in the published plan, so the two are joined here rather than in the
 * browser.
 *
 * What these defend is the degraded case. Plenty of projects have no published
 * plan — every hand-authored one, and everything imported before the pipeline —
 * and for those the honest answer is the requirement ID with no sentence, never
 * a blank line and never an error.
 */
const mockQuery = jest.fn();
jest.mock('../../config/database', () => ({ sequelize: { query: (...a: unknown[]) => mockQuery(...a) } }));
// `projectReleaseMeta` is deliberately NOT mocked: it has no imports at all, so
// it reaches no database and there is nothing to isolate. Stubbing it by hand
// cost a run when the factory omitted `extractLandsWhen` — a partial mock
// factory silently deletes every export it does not name.

import { getProjectGantt } from '../projectDeliveryDetail';

const PROJECT = 'proj-1';

const task = (over: Record<string, unknown> = {}) => ({
  id: 't1', title: 'Ingest the listing feed', status: 'not_started',
  release_key: 'r0', due_on: '2026-10-01', due_baseline_on: '2026-10-01',
  verified_at: null, blocked_by: [], narrative: 'As an agent…',
  fulfills: ['REQ-001'], acceptance: ['Given a feed, when it syncs, then rows land.'],
  build: '', position: 0, ...over,
});

/** tasks query, release titles query, then the published-plan lookup. */
const respond = (tasks: unknown[], planJson: unknown | undefined) => {
  mockQuery.mockReset();
  mockQuery
    .mockResolvedValueOnce(tasks)                                   // student_tasks
    .mockResolvedValueOnce([])                                      // release titles
    .mockResolvedValueOnce(planJson === undefined ? [] : [{ plan_json: planJson }]);
};

beforeEach(() => jest.clearAllMocks());

describe('the story carries its own traceability', () => {
  it('selects fulfills and acceptance, which nothing read before', async () => {
    respond([task()], undefined);
    await getProjectGantt(PROJECT);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('fulfills');
    expect(sql).toContain('acceptance');
  });

  it('returns them on the task', async () => {
    respond([task()], undefined);
    const g = await getProjectGantt(PROJECT);
    const t = g.releases.flatMap((r) => r.tasks)[0];
    expect(t.fulfills).toEqual(['REQ-001']);
    expect(t.acceptance).toEqual(['Given a feed, when it syncs, then rows land.']);
  });

  it('answers an empty array, never null, when the columns hold nothing', async () => {
    // A task written by the manual import path has neither. An empty array is
    // the honest "which requirements" answer; null would make every consumer
    // guard for it.
    respond([task({ fulfills: null, acceptance: undefined })], undefined);
    const t = (await getProjectGantt(PROJECT)).releases.flatMap((r) => r.tasks)[0];
    expect(t.fulfills).toEqual([]);
    expect(t.acceptance).toEqual([]);
  });
});

describe('the requirement statements', () => {
  it('come from the PUBLISHED plan, keyed by id', async () => {
    respond([task()], {
      requirements: [
        { id: 'REQ-001', statement: 'An agent sees listing velocity by street.' },
        { id: 'REQ-002', statement: 'Stale prices are never shown.' },
      ],
    });
    const g = await getProjectGantt(PROJECT);
    expect(g.requirements['REQ-001']).toBe('An agent sees listing velocity by street.');
    expect(g.requirements['REQ-002']).toBe('Stale prices are never shown.');
  });

  it('asks for the newest plan, published or not', async () => {
    // This used to require status = 'published', which was right while every build
    // published itself. Now that an admin-initiated build is HELD for review, that
    // restriction made the reviewer's own screen empty: the plan exists, and the one
    // query that could show it refused to look. The newest version still wins.
    respond([task()], undefined);
    await getProjectGantt(PROJECT);
    const sql = String(mockQuery.mock.calls[2][0]);
    expect(sql).not.toContain("status = 'published'");
    expect(sql).toContain('ORDER BY version DESC');
  });

  it('is empty for a project with no published plan, rather than an error', async () => {
    // Every hand-authored project is this case. The board must still render,
    // and the story must still show its requirement IDS.
    respond([task()], undefined);
    const g = await getProjectGantt(PROJECT);
    expect(g.requirements).toEqual({});
    expect(g.releases.flatMap((r) => r.tasks)[0].fulfills).toEqual(['REQ-001']);
  });

  it('survives a plan whose JSON carries no requirements', async () => {
    respond([task()], { releases: [], stories: [] });
    expect((await getProjectGantt(PROJECT)).requirements).toEqual({});
  });

  it('skips a requirement missing an id or a statement rather than inventing one', async () => {
    respond([task()], {
      requirements: [
        { id: 'REQ-001', statement: 'Real.' },
        { id: 'REQ-002' },
        { statement: 'Orphaned.' },
      ],
    });
    expect(await getProjectGantt(PROJECT).then((g) => g.requirements)).toEqual({ 'REQ-001': 'Real.' });
  });

  it('fails soft when the plan lookup throws, because the board is the point', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce([task()])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('build_plans is unreachable'));
    const g = await getProjectGantt(PROJECT);
    expect(g.requirements).toEqual({});
    expect(g.releases.flatMap((r) => r.tasks)).toHaveLength(1);
  });
});

/**
 * A BUILD HELD FOR REVIEW HAS TO BE REVIEWABLE.
 *
 *     "I should be able to see the project and drill down right away in the admin
 *      dashboard as soon as the project is built."  (Ali, 2026-10-01)
 *
 * Measured on production the same day: a project built through the admin door sat at
 * `drafted` with 30 requirements, 5 releases and 19 stories, and the board showed
 * `0/0 tasks, no releases`. Tasks are written by materialisation, materialisation runs
 * at publish, and the hold is precisely the decision not to publish yet — so the one
 * screen built for reviewing a plan rendered empty for every plan awaiting review.
 *
 * The hold exists to keep an unreviewed plan away from the STUDENT. Hiding it from the
 * reviewer was never the point.
 */
describe('a project whose plan is not published yet', () => {
  const PLAN = {
    requirements: [
      { id: 'REQ-001', statement: 'Every specimen must have a chain of custody record.' },
      { id: 'REQ-002', statement: 'Audit records must be retained for seven years.' },
    ],
    releases: [
      { key: 'r0', name: 'Initial Skeleton', goal: 'The walking skeleton proves the trust spine.' },
      { key: 'r1', name: 'Driver and Client Interfaces', goal: 'The two people who touch it daily.' },
    ],
    stories: [
      { id: 'STORY-001', release: 'r0', title: 'Dispatcher creates and assigns stops', narrative: 'As a dispatcher…', fulfills: ['REQ-001'], acceptance: ['Given a stop, when assigned, then the driver sees it.'] },
      { id: 'STORY-002', release: 'r0', title: 'Audit log implementation', narrative: 'As a supervisor…', fulfills: ['REQ-002'], acceptance: ['Given a change, when it lands, then it is logged.'] },
      { id: 'STORY-003', release: 'r1', title: 'Driver views daily route', narrative: 'As a driver…', fulfills: [], acceptance: [] },
    ],
  };

  it('renders the PLAN when nothing has been materialised, instead of an empty board', async () => {
    respond([], PLAN);

    const g = await getProjectGantt(PROJECT);

    expect(g.releases.map((r) => r.release_key)).toEqual(['r0', 'r1']);
    expect(g.releases.flatMap((r) => r.tasks).map((t) => t.id))
      .toEqual(['STORY-001', 'STORY-002', 'STORY-003']);
    expect(g.totals.tasks).toBe(3);
  });

  it('says so, so the page can tell a held plan from finished work', async () => {
    respond([], PLAN);
    expect((await getProjectGantt(PROJECT)).plan_only).toBe(true);
  });

  it('carries the traceability a reviewer is actually checking', async () => {
    // Reviewing means reading a story against the requirement it claims to fulfil.
    // Without these the drill-down is a list of titles.
    respond([], PLAN);
    const g = await getProjectGantt(PROJECT);
    const story = g.releases.flatMap((r) => r.tasks).find((t) => t.id === 'STORY-001')!;

    expect(story.fulfills).toEqual(['REQ-001']);
    expect(story.acceptance).toEqual(['Given a stop, when assigned, then the driver sees it.']);
    expect(g.requirements['REQ-001']).toBe('Every specimen must have a chain of custody record.');
  });

  it('claims no schedule it does not have', async () => {
    // A held plan has not been scheduled: materialisation assigns the dates. Reporting
    // a due date here would invent one, and reporting overdue would be worse.
    respond([], PLAN);
    const g = await getProjectGantt(PROJECT);
    const tasks = g.releases.flatMap((r) => r.tasks);

    expect(tasks.every((t) => t.due_on === null)).toBe(true);
    expect(tasks.every((t) => !t.overdue && !t.slipped)).toBe(true);
    expect(g.totals.complete).toBe(0);
  });

  it('PREFERS materialised tasks once they exist, so published work is never overwritten', async () => {
    // The real work carries status, dates and what the student has actually finished.
    // A plan would be a worse answer, and after publish both exist.
    respond([task()], PLAN);

    const g = await getProjectGantt(PROJECT);

    expect(g.plan_only).toBe(false);
    expect(g.releases.flatMap((r) => r.tasks).map((t) => t.id)).toEqual(['t1']);
  });

  it('is still empty for a project with neither tasks nor a plan', async () => {
    // A project created and never built. Inventing releases for it would be a lie.
    respond([], undefined);

    const g = await getProjectGantt(PROJECT);

    expect(g.releases).toEqual([]);
    expect(g.plan_only).toBe(false);
  });
});
