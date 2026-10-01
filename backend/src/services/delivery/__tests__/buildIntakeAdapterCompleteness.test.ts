import { packItems, toBuildIntake, ANSWER_MAX } from '../buildIntakeAdapter';
import type { ProjectUnderstanding, UnderstandingItem } from '../projectUnderstanding';

/**
 * Detailed requirements have to survive the crossing.
 *
 *     "I heard from Swati today that she gave the process very detailed
 *      requirements and it missed some of them... I think we should build out
 *      all of the requirements - no matter how big. We can always decide which
 *      release they will demo. I would rather have all the requirements there."
 *      (Ali, 2026-09-29)
 *
 * One of the two places hers were lost is here. Every item in a dimension was
 * joined into one string and clipped at ANSWER_MAX, so a customer who answered
 * at length lost the tail — and the loss was recorded as "(N items) clipped",
 * which says THAT something went and never WHICH. These pin the replacement:
 * pack across as many answers as it takes, and never cut an item that could
 * have fitted somewhere.
 */

const item = (n: number, size = 300) => `REQ-${n}: ${'x'.repeat(size)}`;

describe('packing a dimension the customer detailed at length', () => {
  it('keeps every item when the total is far over the per-answer ceiling', () => {
    // 40 items x ~300 chars = ~12k, three times ANSWER_MAX. The old code kept
    // the first 4,000 characters and silently discarded the rest.
    const phrases = Array.from({ length: 40 }, (_, i) => item(i + 1));
    const { chunks, clipped } = packItems(phrases);

    expect(clipped).toEqual([]);
    const joined = chunks.join('\n');
    for (const p of phrases) expect(joined).toContain(p);
  });

  it('splits into more than one answer rather than truncating', () => {
    const phrases = Array.from({ length: 40 }, (_, i) => item(i + 1));
    const { chunks } = packItems(phrases);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('keeps every chunk under the ceiling', () => {
    const phrases = Array.from({ length: 40 }, (_, i) => item(i + 1));
    for (const c of packItems(phrases).chunks) {
      expect(c.length).toBeLessThanOrEqual(ANSWER_MAX);
    }
  });

  it('never splits an item across two answers', () => {
    // A requirement cut in half is worse than one left out: half a sentence
    // reads as a complete, wrong requirement.
    const phrases = Array.from({ length: 30 }, (_, i) => item(i + 1));
    for (const c of packItems(phrases).chunks) {
      for (const line of c.split('\n')) {
        expect(phrases).toContain(line);
      }
    }
  });

  it('leaves a short dimension as a single answer', () => {
    const phrases = [item(1), item(2)];
    expect(packItems(phrases).chunks).toHaveLength(1);
  });

  it('handles an empty dimension without inventing an answer', () => {
    expect(packItems([])).toEqual({ chunks: [], clipped: [] });
  });
});

describe('the one loss that cannot be avoided is named', () => {
  it('reports a single item longer than the ceiling, with its text', () => {
    // Nowhere to put it, so it is clipped — but the report carries the item
    // itself, not a count, so the loss can be read and acted on.
    const huge = `REQ-1: ${'y'.repeat(ANSWER_MAX + 500)}`;
    const { chunks, clipped } = packItems([huge, item(2)]);

    expect(clipped).toEqual([huge]);
    expect(chunks.join('\n')).toContain(item(2));
    expect(chunks.every((c) => c.length <= ANSWER_MAX)).toBe(true);
  });

  it('does not report a loss when everything fitted', () => {
    // The honesty runs both ways: a clean crossing must not produce a warning
    // that sends someone looking for a requirement that is present.
    expect(packItems(Array.from({ length: 40 }, (_, i) => item(i + 1))).clipped).toEqual([]);
  });
});

/**
 * THE PACKING HAS TO BE IN THE LIVE PATH, not merely available to it.
 *
 * `packItems` shipped correct, tested, and with NO CALLER: `toBuildIntake` still
 * joined a dimension's items and clipped at ANSWER_MAX, so every test above
 * passed while Swati's detailed requirements went on being truncated in
 * production. A producer with no consumer is not a fix.
 *
 * These go through `toBuildIntake` — the function the build actually calls — so
 * the only way to satisfy them is for the live path to pack.
 */
const detailed = (n: number, size = 300): UnderstandingItem => ({
  dimension: 'constraints',
  value: `CONSTRAINT-${n}: ${'x'.repeat(size)}`,
  classification: 'FACT',
  provenance: 'source_message',
} as UnderstandingItem);

const withDetailedDimension = (count: number): ProjectUnderstanding => ({
  title: 'A build the customer specified at length',
  proposed_surfaces: [],
  items: [
    {
      dimension: 'problem',
      value: 'Everything about the current process is manual and nothing is written down.',
      classification: 'FACT',
      provenance: 'source_message',
    } as UnderstandingItem,
    ...Array.from({ length: count }, (_, i) => detailed(i + 1)),
  ],
});

describe('toBuildIntake — the detail reaches the decomposer', () => {
  it('carries EVERY item of an over-long dimension into the intake', () => {
    // 40 x ~300 chars = ~12k against a 4k per-answer ceiling. Before the packing
    // was wired in, answers 14 onward simply did not exist.
    const u = withDetailedDimension(40);
    const intake = toBuildIntake(u);

    const everything = intake.answers.map((a) => a.answer).join('\n');
    for (let n = 1; n <= 40; n += 1) {
      expect(everything).toContain(`CONSTRAINT-${n}:`);
    }
  });

  it('splits that dimension across numbered answers instead of truncating it', () => {
    const intake = toBuildIntake(withDetailedDimension(40));
    const ids = intake.answers.map((a) => a.id);

    expect(ids).toContain('constraints');
    expect(ids).toContain('constraints_2');
    expect(ids.filter((id) => id.startsWith('constraints')).length).toBeGreaterThan(1);
  });

  it('labels a continuation as the same question, not a new topic', () => {
    // A second chunk under a bare label reads to the decomposer as a different
    // question that happens to repeat, which is how duplicate requirements are
    // born.
    const intake = toBuildIntake(withDetailedDimension(40));
    const second = intake.answers.find((a) => a.id === 'constraints_2')!;

    expect(second.question).toContain('continued');
    expect(second.question).toContain(intake.answers.find((a) => a.id === 'constraints')!.question.replace('?', ''));
  });

  it('keeps every answer within the ceiling the wizard accepts', () => {
    for (const a of toBuildIntake(withDetailedDimension(40)).answers) {
      expect(a.answer.length).toBeLessThanOrEqual(ANSWER_MAX);
    }
  });

  it('reports NOTHING dropped, and never the old "(N items)" note', () => {
    // "(N items) clipped" was the old report: it proved something was lost and
    // named none of it. Its absence here is the whole point.
    const intake = toBuildIntake(withDetailedDimension(40));

    expect(intake.dropped).toEqual([]);
    expect(JSON.stringify(intake.dropped)).not.toContain('items');
  });

  it('leaves a dimension that fits as one answer, with no suffix', () => {
    // Packing must not cost the common case its readable single answer.
    const intake = toBuildIntake(withDetailedDimension(2));
    const ids = intake.answers.map((a) => a.id);

    expect(ids).toContain('constraints');
    expect(ids).not.toContain('constraints_2');
  });
});

/**
 * THIRTY STATED REQUIREMENTS MUST REACH THE DECOMPOSER.
 *
 * Measured on production 2026-10-01: a conversation stating thirty numbered requirements
 * produced an understanding of 13 items, a brief carrying none of them by name, and a plan
 * of 24 requirements of which 18 were invented. Two causes, both now fixed upstream — there
 * was no `requirements` dimension for them to live in, and the extraction ceiling made
 * recording them impossible anyway.
 *
 * This holds the half that is pure code: GIVEN the understanding did capture them, the
 * brief carries every one. Without it, fixing the extractor would just move the loss.
 */
describe('a specification, once it has been captured', () => {
  const thirty = Array.from({ length: 30 }, (_, i) => ({
    dimension: 'requirements',
    // Real stated requirements run a sentence or two each. Thirty of them is well past
    // what one answer holds, which is the case this whole area exists for.
    value: `REQ-${String(i + 1).padStart(2, '0')} The system must support the ${i + 1}th capability the customer described, `
      + 'including who is allowed to do it, what has to be recorded when they do, and what the system '
      + 'must refuse. Stated at the length a person actually states a requirement.',
    classification: 'FACT',
    provenance: 'source_message',
  })) as unknown as UnderstandingItem[];

  const u: ProjectUnderstanding = {
    title: 'Regional Medical Courier',
    proposed_surfaces: [],
    items: [
      { dimension: 'problem', value: 'Everything is coordinated on a whiteboard.', classification: 'FACT', provenance: 'source_message' } as UnderstandingItem,
      ...thirty,
    ],
  };

  it('carries ALL THIRTY into the brief, by name', () => {
    const intake = toBuildIntake(u);
    const everything = intake.answers.map((a) => a.answer).join('\n');

    for (let n = 1; n <= 30; n += 1) {
      expect(everything).toContain(`REQ-${String(n).padStart(2, '0')}`);
    }
  });

  it('splits them across numbered answers rather than truncating the list', () => {
    const ids = toBuildIntake(u).answers.map((a) => a.id);
    expect(ids).toContain('requirements');
    expect(ids.filter((id) => id.startsWith('requirements')).length).toBeGreaterThan(1);
  });

  it('reports nothing dropped', () => {
    expect(toBuildIntake(u).dropped).toEqual([]);
  });

  it('treats stated requirements as ANSWERS, not as the idea paragraph', () => {
    // The idea is the problem in their words; requirements are what the decomposer must
    // build against. Folding them into the idea would clip them at IDEA_MAX and lose the
    // question-and-answer shape the decomposer reads.
    const intake = toBuildIntake(u);
    expect(intake.idea).not.toContain('REQ-01');
    expect(intake.answers.some((a) => a.id.startsWith('requirements'))).toBe(true);
  });
});
