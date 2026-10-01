/**
 * projectUnderstanding — the canonical contract for "what we know about this project".
 *
 * ## Why this exists
 *
 * The build plan's customer journey has no "we will contact you" step:
 *
 *     CHOOSE CHAT OR CALL ME NOW → AI INTERVIEW → PROJECT UNDERSTANDING
 *     → BUILD BLUEPRINT → TRUST BLUEPRINT → LIVE UI CONCEPTS → WOW
 *
 * Everything up to AI INTERVIEW was built first: the form, the routing rule, the consent
 * gate, the outbound call. What did not exist was the step immediately after it, which is
 * the one that makes the flow continuous rather than a lead-capture form with a phone call
 * bolted on. Gate 0's own VOICE_INTAKE_MAP said so before any of this was written:
 * "Steps 1 through 5 exist. What does not exist is the last part - turning a transcript
 * into structured project truth for a Build Blueprint."
 *
 * This module is that structure. It is deliberately PURE - no model calls, no database,
 * no I/O - because it is the contract, and a contract that can only be exercised by
 * calling an LLM and a database is a contract nobody tests.
 *
 * ## One contract, several doors
 *
 * The plan offers four ways in (§14): chat, a phone call, an existing artifact, and fast
 * track. They are different conversations, not different projects, so they converge here.
 * A voice transcript and a chat thread produce the SAME shape, and the difference between
 * them survives only as provenance on each item. That is what lets the Build Blueprint
 * consume all four doors without knowing which one the customer walked through.
 *
 * ## The rule that carries the most weight
 *
 * §16: "Do not merge assumptions into facts."
 *
 * That single line is the difference between a discovery document and a liability. An
 * inferred integration presented as an established one becomes a commitment nobody made,
 * and by the time it is discovered it is in a blueprint the customer has already agreed
 * to. So it is enforced here as a type-level and validation-level invariant rather than
 * left as guidance: an item whose provenance is `ai_inferred` CANNOT be classified FACT,
 * and `parseUnderstanding` rejects the payload rather than quietly downgrading it. A model
 * that returns a confident hallucination gets an error, not a promotion.
 */

import { z } from 'zod';

/* ── Dimensions ───────────────────────────────────────────────────── */

/**
 * The twenty things §16 requires Project AI to derive, in the plan's own order.
 *
 * Kept as one flat list rather than a nested object because every consumer wants a
 * different slice - the wow screen wants four of them, the blueprint wants most, the
 * open-questions view wants whatever is still unresolved - and a flat list with a typed
 * key is the only shape that serves all of those without a translation layer per consumer.
 */
export const UNDERSTANDING_DIMENSIONS = [
  'problem',
  'desired_outcome',
  'actors',
  'current_workflow',
  'inputs',
  'outputs',
  'data',
  'systems',
  'integrations',
  'pain_points',
  'exceptions',
  'approval_points',
  'security_context',
  'ai_opportunities',
  'human_only_decisions',
  'assumptions',
  'unknowns',
  'constraints',
  'success_definition',
  'delivery_profile',
  /**
   * EXPLICIT REQUIREMENTS, in the customer's own words.
   *
   * Added 2026-10-01 after a measured failure. A simulated intake stated THIRTY numbered
   * requirements; the understanding kept 13 items, the brief carried none of them, and the
   * plan came back with 24 requirements of which 18 were invented. There was nowhere for a
   * requirement to go: every other dimension here describes the SHAPE of a problem - who,
   * what flows, what hurts - and a person handing over a specification was having it
   * compressed into roughly one item per dimension.
   *
   * Last in the list on purpose: the first twelve drive the interview's question order
   * (`interviewMethod`), and this is not a thing to interview for - it is a thing to
   * record verbatim when someone states it.
   */
  'requirements',
] as const;

export type UnderstandingDimension = (typeof UNDERSTANDING_DIMENSIONS)[number];

/** Human-facing labels. The plan's wording, not re-invented. */
export const DIMENSION_LABELS: Record<UnderstandingDimension, string> = {
  problem: 'Problem',
  desired_outcome: 'Desired outcome',
  actors: 'Actors / users',
  current_workflow: 'Current workflow',
  inputs: 'Inputs',
  outputs: 'Outputs',
  data: 'Data',
  systems: 'Systems',
  integrations: 'Integrations',
  pain_points: 'Pain points',
  exceptions: 'Exceptions',
  approval_points: 'Approval points',
  security_context: 'Security context',
  ai_opportunities: 'AI opportunities',
  human_only_decisions: 'Human-only decisions',
  assumptions: 'Assumptions',
  unknowns: 'Unknowns',
  constraints: 'Constraints',
  success_definition: 'Success definition',
  delivery_profile: 'Likely delivery profile',
  requirements: 'Stated requirements',
};

/* ── Provenance and classification ────────────────────────────────── */

/** §16's provenance list, verbatim. Where a piece of knowledge came from. */
export const PROVENANCES = [
  'client_confirmed',
  'source_message',
  'source_document',
  'voice_transcript',
  'ai_inferred',
  'pm_confirmed',
  /**
   * Something a story's own work showed: a file, a commit, a test. Added by the
   * continuous-enrichment protocol (Unified Project Discovery, Phase 6). It can
   * confirm a BUILD fact and never a business outcome; see
   * REPO_EVIDENCE_NEVER_FACT_DIMENSIONS.
   */
  'repo_evidence',
] as const;

export type Provenance = (typeof PROVENANCES)[number];

/** §16's classification list, verbatim. What KIND of statement this is. */
export const CLASSIFICATIONS = ['FACT', 'ASSUMPTION', 'RECOMMENDATION', 'QUESTION', 'DECISION'] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * Provenances that can support a FACT.
 *
 * `ai_inferred` is absent, and that absence is the whole point - see the header. Everything
 * else traces to something a person said, wrote, or confirmed, which is what makes a fact
 * a fact here: not that the model is confident, but that a human is on the record.
 */
export const FACT_BEARING_PROVENANCES: readonly Provenance[] = [
  'client_confirmed',
  'source_message',
  'source_document',
  'voice_transcript',
  'pm_confirmed',
  'repo_evidence',
];

/**
 * What a repository cannot establish. A commit can prove what was built and
 * how it behaves; it cannot prove what the business wanted, what hurts today,
 * or what "good" means to the people paying for it. Repo evidence on these
 * dimensions is refused at the contract, not downgraded, so nobody can argue
 * a test run into a business result.
 */
export const REPO_EVIDENCE_NEVER_FACT_DIMENSIONS: readonly UnderstandingDimension[] = [
  'success_definition',
  'desired_outcome',
  'pain_points',
];

/**
 * Dimensions that are definitionally not facts.
 *
 * `assumptions` and `unknowns` are the two places a model is most tempted to launder a
 * guess into settled knowledge, because the field name already sounds like a disclaimer.
 * It is not one: an item sitting under "assumptions" classified FACT is still a fact in
 * every consumer that reads classification, which is all of them.
 */
export const NEVER_FACT_DIMENSIONS: readonly UnderstandingDimension[] = ['assumptions', 'unknowns'];

/* ── The item and the document ────────────────────────────────────── */

export interface UnderstandingItem {
  dimension: UnderstandingDimension;
  /** One statement, in plain language, as it would be shown to the customer. */
  value: string;
  classification: Classification;
  provenance: Provenance;
  /**
   * The words this came from, when it came from words. Optional because `ai_inferred`
   * items have no quote by definition - which is exactly why they cannot be FACT.
   */
  source_quote?: string;
  /**
   * Earlier values this item held, newest first. A correction or a strengthening
   * replaces the value and keeps what it replaced, so history survives without a
   * second table. Absent on an item that has never changed.
   */
  history?: UnderstandingItemHistoryEntry[];
}

export interface UnderstandingItemHistoryEntry {
  value: string;
  classification: Classification;
  provenance: Provenance;
  source_quote?: string;
  /** ISO timestamp of when this value stopped being current. */
  replaced_at: string;
  /** What replaced it: a student correction, or a story's evidence. */
  replaced_by: 'correction' | 'repo_evidence';
}

export interface ProjectUnderstanding {
  /** §17's headline: "I THINK YOU'RE BUILDING <this>". */
  title: string;
  /** §17's "Proposed surfaces". Not a §16 dimension; a derived product suggestion. */
  proposed_surfaces: string[];
  items: UnderstandingItem[];
}

/* ── Schema ───────────────────────────────────────────────────────── */

const historyEntrySchema = z.object({
  value: z.string().trim().min(1),
  classification: z.enum(CLASSIFICATIONS),
  provenance: z.enum(PROVENANCES),
  source_quote: z.string().trim().min(1).optional(),
  replaced_at: z.string().min(1),
  replaced_by: z.enum(['correction', 'repo_evidence']),
});

const itemSchema = z.object({
  dimension: z.enum(UNDERSTANDING_DIMENSIONS),
  value: z.string().trim().min(1, 'value cannot be empty'),
  classification: z.enum(CLASSIFICATIONS),
  provenance: z.enum(PROVENANCES),
  source_quote: z.string().trim().min(1).optional(),
  history: z.array(historyEntrySchema).max(50).optional(),
});

const understandingSchema = z.object({
  title: z.string().trim().min(1, 'title cannot be empty'),
  proposed_surfaces: z.array(z.string().trim().min(1)).default([]),
  items: z.array(itemSchema),
});

/**
 * Validate ONE item, saying what arrived rather than only what was expected.
 *
 * Zod's enum message lists the twenty valid options and omits the invalid one, which makes
 * a real failure undiagnosable: "expected one of problem|desired_outcome|..." does not tell
 * you the model said "budget". That mattered the first time this ran against a live
 * transcript in production - the error named everything except the thing that was wrong.
 *
 * Per-item because a document is not all-or-nothing. A model that returns eleven good
 * items and one with an invented dimension has still understood the call, and throwing the
 * whole thing away over the twelfth is a worse outcome than dropping it and saying so.
 */
export function validateItem(raw: unknown): { ok: true; item: UnderstandingItem } | { ok: false; reason: string } {
  const shape = itemSchema.safeParse(raw);
  if (!shape.success) {
    const got = (raw ?? {}) as Record<string, unknown>;
    const reason = shape.error.issues
      .map((issue) => {
        const field = issue.path.join('.') || '(root)';
        const received = got[String(issue.path[0])];
        return received === undefined
          ? `${field}: ${issue.message}`
          : `${field}: ${issue.message} (received ${JSON.stringify(received)})`;
      })
      .join('; ');
    return { ok: false, reason };
  }

  const item = shape.data as UnderstandingItem;
  const violations = findIntegrityViolations({ title: 'x', proposed_surfaces: [], items: [item] });
  if (violations.length > 0) {
    // Strip the positional prefix; the caller knows which item this is.
    return { ok: false, reason: violations.map((v) => v.replace(/^item \d+ \([^)]*\): /, '')).join('; ') };
  }

  return { ok: true, item };
}

export class UnderstandingContractError extends Error {
  readonly error_class = 'ContractViolation';
  readonly violations: string[];

  constructor(violations: string[]) {
    super(`project understanding failed the contract: ${violations.join('; ')}`);
    this.name = 'UnderstandingContractError';
    this.violations = violations;
  }
}

/**
 * The integrity rules, separate from the shape rules.
 *
 * Zod can say "this is a valid Classification". It cannot say "this classification is not
 * allowed to sit next to that provenance", and the second is the one that matters. Kept as
 * its own exported function so a caller that assembles an understanding by hand - a PM
 * editing an item in the project room - runs the same checks as the extractor does.
 */
export function findIntegrityViolations(u: ProjectUnderstanding): string[] {
  const violations: string[] = [];

  u.items.forEach((item, i) => {
    const where = `item ${i} (${item.dimension})`;

    if (item.classification === 'FACT' && !FACT_BEARING_PROVENANCES.includes(item.provenance)) {
      violations.push(`${where}: classified FACT on provenance "${item.provenance}", which cannot support one`);
    }

    if (item.classification === 'FACT' && NEVER_FACT_DIMENSIONS.includes(item.dimension)) {
      violations.push(`${where}: the "${item.dimension}" dimension cannot hold a FACT`);
    }

    // A quote is what makes a sourced item checkable. Without it there is nothing to hold
    // the statement against, and "the transcript says so" becomes unfalsifiable.
    if ((item.provenance === 'voice_transcript' || item.provenance === 'source_document') && !item.source_quote) {
      violations.push(`${where}: provenance "${item.provenance}" requires a source_quote`);
    }

    // An inference that carries a quote is not an inference; it is a misfiled sourced item,
    // and the misfiling costs it the FACT status it was entitled to.
    if (item.provenance === 'ai_inferred' && item.source_quote) {
      violations.push(`${where}: "ai_inferred" cannot carry a source_quote`);
    }

    // Repo evidence is checkable or it is nothing: the reference IS the evidence.
    if (item.provenance === 'repo_evidence' && !item.source_quote) {
      violations.push(`${where}: provenance "repo_evidence" requires a source_quote naming the file, commit or test`);
    }

    // A repository proves what was built, never what the business wanted or
    // what success means. Refused outright rather than downgraded, so a test
    // run can never be argued into a business result.
    if (item.provenance === 'repo_evidence' && REPO_EVIDENCE_NEVER_FACT_DIMENSIONS.includes(item.dimension)) {
      violations.push(`${where}: repository evidence cannot establish "${item.dimension}"; that is a business statement, not a build fact`);
    }
  });

  return violations;
}

/**
 * Validate an understanding from an untrusted source - which is to say, from a model.
 *
 * Throws rather than repairing. A silently-corrected understanding is worse than a
 * rejected one: the correction is invisible, it happens on the path where nobody is
 * looking, and the customer sees the repaired version presented with the same confidence
 * as the rest.
 */
export function parseUnderstanding(raw: unknown): ProjectUnderstanding {
  const shape = understandingSchema.safeParse(raw);
  if (!shape.success) {
    throw new UnderstandingContractError(shape.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }

  const understanding = shape.data as ProjectUnderstanding;
  const violations = findIntegrityViolations(understanding);
  if (violations.length > 0) throw new UnderstandingContractError(violations);

  return understanding;
}

/* ── Reading an understanding ─────────────────────────────────────── */

export function itemsFor(u: ProjectUnderstanding, dimension: UnderstandingDimension): UnderstandingItem[] {
  return u.items.filter((i) => i.dimension === dimension);
}

/**
 * §17's wow screen, which is a counting exercise and nothing more.
 *
 * Counts every item in the dimension regardless of classification, because the screen is
 * showing the customer the SHAPE of what was heard, not asserting each entry is settled.
 * The classifications are what the blueprint reads; this is the "I think you're building"
 * moment, and hedging it into "4 users, 2 of them assumed" would defeat its purpose.
 */
export function summarizeForWow(u: ProjectUnderstanding): {
  title: string;
  primary_users: number;
  core_workflows: number;
  ai_opportunities: number;
  human_decision_points: number;
  proposed_surfaces: string[];
} {
  return {
    title: u.title,
    primary_users: itemsFor(u, 'actors').length,
    core_workflows: itemsFor(u, 'current_workflow').length,
    ai_opportunities: itemsFor(u, 'ai_opportunities').length,
    human_decision_points: itemsFor(u, 'human_only_decisions').length,
    proposed_surfaces: u.proposed_surfaces,
  };
}

/**
 * What the flow still needs from a human, in the order the plan's effort protocol implies.
 *
 * §2 forbids interrogating the customer, so the useful question is never "what do we not
 * know" - it is "what do we not know that we cannot infer or default". QUESTION items are
 * the ones the interview itself could not resolve; DECISION items are the ones §3 says
 * belong to the customer by right and must never be auto-resolved even when a default
 * would be obvious.
 */
export function openQuestions(u: ProjectUnderstanding): UnderstandingItem[] {
  return u.items.filter((i) => i.classification === 'QUESTION');
}

export function decisionsForCustomer(u: ProjectUnderstanding): UnderstandingItem[] {
  return u.items.filter((i) => i.classification === 'DECISION');
}

/**
 * How much of the picture is actually established, as opposed to guessed at.
 *
 * Used to decide whether an understanding is strong enough to hand to the Build Blueprint.
 * A transcript that produced forty items of which two are facts is not understanding; it
 * is a model talking to itself, and it should be visible as such before anything is built
 * on top of it.
 */
export function confidenceProfile(u: ProjectUnderstanding): {
  total: number;
  facts: number;
  inferred: number;
  fact_ratio: number;
  dimensions_covered: number;
  dimensions_missing: UnderstandingDimension[];
} {
  const total = u.items.length;
  const facts = u.items.filter((i) => i.classification === 'FACT').length;
  const inferred = u.items.filter((i) => i.provenance === 'ai_inferred').length;
  const covered = new Set(u.items.map((i) => i.dimension));

  return {
    total,
    facts,
    inferred,
    fact_ratio: total === 0 ? 0 : facts / total,
    dimensions_covered: covered.size,
    dimensions_missing: UNDERSTANDING_DIMENSIONS.filter((d) => !covered.has(d)),
  };
}
