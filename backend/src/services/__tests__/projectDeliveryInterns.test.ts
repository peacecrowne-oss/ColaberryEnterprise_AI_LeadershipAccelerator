/**
 * Scoping the delivery board to interns.
 *
 * Ali, 2026-09-29: "I need to be able to see all of the projects at least to
 * the level I see them in the class."
 *
 * The rule worth a test is the one that is wrong in the obvious way: an
 * intern's enrollment still points at their CLASS cohort, because the
 * internship is a secondary `cohort_memberships` row. Filtering on
 * `e.cohort_id = <internship cohort>` returns nothing, and an empty board reads
 * as "no intern has a project" rather than as a wrong query.
 */
const mockQuery = jest.fn();
jest.mock('../../config/database', () => ({ sequelize: { query: (...a: unknown[]) => mockQuery(...a) } }));
// The service's own imports reach Sequelize model definitions at module load.
// Stubbed because this suite is about ONE WHERE clause and nothing it asserts
// needs a model; the early return on an empty result means none is called.
jest.mock('../acceleratorCurrentClassesService', () => ({
  DEPARTED_ENROLLMENT_STATUSES: ['withdrawn', 'removed'],
}));
jest.mock('../projectDeliveryDetail', () => ({ getReleaseSummaries: jest.fn() }));
jest.mock('../projectReleaseMeta', () => ({}));
jest.mock('../projectRiskModel', () => ({ assessPortfolio: jest.fn() }));

import { getProjectDelivery, audienceOf } from '../projectDeliveryService';

/** The SQL of the first call — the projects query whose WHERE clause is under test. */
const sqlOfFirstCall = (): string => String(mockQuery.mock.calls[0][0]);

/**
 * The statement split at its FROM, so a filter can be told from a column.
 *
 * `is_intern` selects the very predicate `internsOnly` filters on, so asserting against
 * the whole statement can no longer distinguish "the board is scoped to interns" from
 * "the board reports who is one" - and an assertion that cannot fail is not a check.
 */
const splitAtFrom = (): { select: string; where: string } => {
  const sql = sqlOfFirstCall();
  const at = sql.indexOf('FROM projects p');
  if (at < 0) throw new Error('projects query no longer reads "FROM projects p"; this helper is stale');
  return { select: sql.slice(0, at), where: sql.slice(at) };
};
const selectListOfFirstCall = (): string => splitAtFrom().select;
const whereOfFirstCall = (): string => splitAtFrom().where;

beforeEach(() => {
  jest.clearAllMocks();
  // No rows: the function returns early, which is all these assertions need.
  mockQuery.mockResolvedValue([]);
});

describe('the interns filter', () => {
  it('matches on internship MEMBERSHIP, never on the enrollment cohort', async () => {
    await getProjectDelivery({ internsOnly: true });
    const sql = sqlOfFirstCall();
    expect(sql).toContain('cohort_memberships');
    expect(sql).toContain("membership_type = 'internship'");
    expect(sql).toContain("ic.cohort_type = 'ai_internship'");
  });

  it('only counts an ACTIVE membership, so a removed intern drops off the board', async () => {
    await getProjectDelivery({ internsOnly: true });
    expect(sqlOfFirstCall()).toContain("m.status = 'active'");
  });

  it('joins the membership to the project owner, not to some other enrollment', async () => {
    await getProjectDelivery({ internsOnly: true });
    expect(sqlOfFirstCall()).toContain('m.enrollment_id = p.enrollment_id');
  });

  it('is absent unless asked for, so the class board is untouched', async () => {
    await getProjectDelivery({});
    // Checked against the WHERE clause, not the whole statement. `is_intern` is now
    // SELECTED on every call, so "cohort_memberships appears somewhere" stopped being
    // able to tell a filter from a column - it would pass with the filter deleted.
    expect(whereOfFirstCall()).not.toContain('cohort_memberships');
  });

  it('composes with a cohort filter rather than replacing it', async () => {
    await getProjectDelivery({ cohortId: 'cohort-1', internsOnly: true });
    const where = whereOfFirstCall();
    expect(where).toContain('e.cohort_id = :cohortId');
    expect(where).toContain('cohort_memberships');
  });

  it('SELECTS whether the owner is an intern on every call, filter or not', async () => {
    // Ali, 2026-09-30: "All projects built moving fwd should be assigned to an intern
    // above or shown below with drill down. Either way, I should be able to drill down
    // into the projects." A board can only order by this if it is always answered.
    for (const opts of [{}, { internsOnly: true }, { cohortId: 'cohort-1' }]) {
      mockQuery.mockClear();
      await getProjectDelivery(opts);
      expect(selectListOfFirstCall()).toContain('AS is_intern');
    }
  });

  it('keeps the existing exclusions, so fixtures do not return with it', async () => {
    // Withdrawn enrollments and unnamed projects are excluded for reasons the
    // query documents; an added filter must not quietly widen the board.
    await getProjectDelivery({ internsOnly: true });
    const sql = sqlOfFirstCall();
    expect(sql).toContain('p.name IS NOT NULL');
    expect(sql).toContain('NOT IN (:departed)');
  });
});

/**
 * Which group a project belongs to.
 *
 *     "default it to active intern projects but allow the ability to add class projects
 *      and unenrolled students projects."  (Ali, 2026-10-01)
 *
 * The board opens on interns, so the precedence between "is an intern" and "sits in a
 * class" decides whether an intern's project is on the default view at all.
 */
describe('audienceOf', () => {
  it('calls an intern an intern even though they also sit in a class', () => {
    // THE failure this guards. An intern's enrollment still points at their CLASS cohort,
    // because the internship is a secondary membership row. Reading cohort_id first would
    // label every intern 'class' and empty the board's default view.
    expect(audienceOf({ is_intern: true, cohort_id: 'class-1' })).toBe('intern');
  });

  it('calls a class student a class student', () => {
    expect(audienceOf({ is_intern: false, cohort_id: 'class-1' })).toBe('class');
  });

  it('calls someone in neither unenrolled', () => {
    // The prospect and guest builds that come out of the enquiry list.
    expect(audienceOf({ is_intern: false, cohort_id: null })).toBe('unenrolled');
  });

  it('treats a missing flag as not an intern rather than throwing', () => {
    expect(audienceOf({})).toBe('unenrolled');
    expect(audienceOf({ cohort_id: 'class-1' })).toBe('class');
  });
});
