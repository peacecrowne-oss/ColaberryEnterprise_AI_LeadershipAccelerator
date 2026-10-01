import { dueDateFloor } from '../materializeTasks';

/**
 * A story added to a build that is already running must not arrive overdue,
 * and adding it must not drag anybody else's deadline earlier.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `buildSchedule` spreads a release's stories across that release's slice of
 * the build window BY THEIR POSITION IN THE PLAN. Correct for a plan published
 * once; wrong the moment a story is appended to a plan already in flight,
 * because the new story is dated by where it sits in the sequence rather than
 * by when it arrived.
 *
 * Swati Raman added six stories on 2026-09-30, to a window running
 * 2026-09-17..10-01. Two of them (STORY-014, STORY-015) landed on 09-24 and
 * 09-25 — five and six days before the day she created them — and rendered
 * red on arrival. Eleven of her twenty-three existing stories also recomputed
 * EARLIER than the dates she had been working to, because the same window now
 * had to hold six more items. Nobody had slipped; several deadlines simply
 * moved toward her.
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────
 *
 * `due_on >= due_baseline_on`, always. A new story is floored at today and
 * that floored date becomes its baseline; an existing story is floored at the
 * baseline it already has. Dates may move later. They may never move earlier.
 */
describe('dueDateFloor', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('pushes a story computed into the past up to the floor', () => {
    // Swati's STORY-014: sequence position said 09-24, she created it on 09-30.
    expect(dueDateFloor(d('2026-09-24'), d('2026-09-30'))).toEqual(d('2026-09-30'));
  });

  it('leaves a date that is already later than the floor alone', () => {
    // The overwhelmingly common case: nothing about a healthy build changes.
    expect(dueDateFloor(d('2026-10-08'), d('2026-09-30'))).toEqual(d('2026-10-08'));
  });

  it('is a no-op when the computed date equals the floor', () => {
    expect(dueDateFloor(d('2026-09-30'), d('2026-09-30'))).toEqual(d('2026-09-30'));
  });

  it('will not pull an existing deadline earlier than its baseline', () => {
    // Swati's STORY-002: baseline 09-19, recomputed to 09-18 purely because
    // six new stories had to fit in the same window. She had not slipped and
    // her deadline must not move toward her.
    expect(dueDateFloor(d('2026-09-18'), d('2026-09-19'))).toEqual(d('2026-09-19'));
  });

  it('ignores the time of day on the floor, because due dates are days', () => {
    // A publish at 14:32 is not half a day late. Without the day floor this
    // returns the 14:32 instant and every comparison downstream drifts.
    const computed = d('2026-09-30');
    const floorAfternoon = new Date('2026-09-30T14:32:11.000Z');
    expect(dueDateFloor(computed, floorAfternoon)).toEqual(d('2026-09-30'));
  });

  it('keeps a null date null — a cohort with no start date still materializes', () => {
    // Tasks without due dates are a NORMAL outcome (see scheduleForEnrollment);
    // inventing a date here would be worse than having none.
    expect(dueDateFloor(null, d('2026-09-30'))).toBeNull();
  });

  it('returns the computed date untouched when there is no floor', () => {
    // A task whose baseline was never recorded must not be re-dated to today.
    expect(dueDateFloor(d('2026-09-24'), null)).toEqual(d('2026-09-24'));
    expect(dueDateFloor(d('2026-09-24'), undefined)).toEqual(d('2026-09-24'));
  });

  it('accepts the baseline as the DATE STRING the database hands back', () => {
    // `due_baseline_on` is a DATE column; Sequelize yields 'YYYY-MM-DD', not a
    // Date. Passing that straight in must still floor correctly rather than
    // silently comparing against an invalid date and letting the past through.
    expect(dueDateFloor(d('2026-09-24'), '2026-09-30' as unknown as Date)).toEqual(d('2026-09-30'));
  });
});
