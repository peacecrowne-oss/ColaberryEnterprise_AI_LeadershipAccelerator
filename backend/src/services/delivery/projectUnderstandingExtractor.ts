/**
 * projectUnderstandingExtractor — turn a conversation into structured project truth.
 *
 * This is the step the customer journey was missing. The call already happens; the
 * transcript already arrives; what did not exist was anything that read it. Gate 0's
 * VOICE_INTAKE_MAP named this precisely: "build the missing piece: transcript → structured
 * intake, converging with chat on one canonical contract".
 *
 * The canonical contract is `projectUnderstanding.ts`. This module is one door into it.
 *
 * ## An extractor may not mint provenance it could not have
 *
 * The contract allows six provenances, but a given extraction run has only seen ONE kind
 * of source. A run over a phone transcript has no way to know what a PM confirmed or what
 * a document said, so it must not be able to say so - and a model asked for provenance
 * will cheerfully return `client_confirmed` for everything, because that is the most
 * agreeable-sounding value in the list.
 *
 * So the allowed set is narrowed per source and enforced after the model returns, not
 * requested politely in the prompt. A transcript run can produce exactly two things:
 * something the person said (`voice_transcript`, with their words attached) or something
 * the model worked out (`ai_inferred`, which by contract can never be a FACT).
 *
 * That is what makes the provenance trail worth anything downstream. Without it, every
 * item in the blueprint would claim to be client-confirmed and none of them would be.
 *
 * ## Empty is a failure, not an understanding
 *
 * `chatJson` swallows a JSON parse error and returns `{}` - both the Anthropic and OpenAI
 * paths do. An empty object would otherwise fail contract validation with "title cannot be
 * empty", which reads like the model produced a nameless project rather than that it
 * produced nothing parseable. The two need different responses from a human, so they are
 * reported differently here.
 */

import { chatJson } from '../runtime/runtimeAi';
import {
  parseUnderstanding,
  validateItem,
  UnderstandingContractError,
  UNDERSTANDING_DIMENSIONS,
  DIMENSION_LABELS,
  type ProjectUnderstanding,
  type Provenance,
} from './projectUnderstanding';

/** Provenances an extractor is allowed to produce, by what it actually looked at. */
export const PROVENANCE_BY_SOURCE = {
  voice_transcript: ['voice_transcript', 'ai_inferred'] as Provenance[],
  chat: ['source_message', 'ai_inferred'] as Provenance[],
  document: ['source_document', 'ai_inferred'] as Provenance[],
} as const;

export type ExtractionSource = keyof typeof PROVENANCE_BY_SOURCE;

export interface ExtractionFacts {
  name?: string | null;
  company?: string | null;
  role?: string | null;
}

/**
 * An item the model produced that the contract would not accept.
 *
 * Kept rather than discarded. The customer said something to produce it, and a dropped item
 * that nobody can see is indistinguishable from a call that was never made - so the raw
 * value travels with the reason it was refused, and a human can look at the pile.
 */
export interface RejectedItem {
  index: number;
  reason: string;
  raw: unknown;
}

export type ExtractionResult =
  | {
      ok: true;
      understanding: ProjectUnderstanding;
      /** Items the contract refused. Empty on a clean run; never silently dropped. */
      rejected: RejectedItem[];
      runtime_ms: number;
      cost_usd: number;
    }
  | { ok: false; error_class: 'EmptyInput' | 'EmptyModelResponse' | 'ContractViolation'; error: string; violations?: string[] };

/**
 * Items whose provenance the source could not possibly support.
 *
 * Exported so the chat and document extractors reuse it rather than re-deriving the rule
 * and drifting from it - the failure mode being a second door into the same contract that
 * quietly permits a provenance the first one forbids.
 */
export function provenanceViolations(u: ProjectUnderstanding, source: ExtractionSource): string[] {
  const allowed = PROVENANCE_BY_SOURCE[source];
  return u.items
    .map((item, i) =>
      allowed.includes(item.provenance)
        ? null
        : `item ${i} (${item.dimension}): provenance "${item.provenance}" is not available to a ${source} extraction`,
    )
    .filter((v): v is string => v !== null);
}

/* ── Quotes have to be real, and they have to be theirs ───────────── */

/**
 * Speaker labels that mean "the customer" in each kind of source.
 *
 * A document has no speakers, so every word in it is quotable and the check degrades to
 * verbatim-only.
 */
const CUSTOMER_LABELS: Record<ExtractionSource, string[]> = {
  voice_transcript: ['human', 'user', 'customer', 'caller', 'client', 'prospect'],
  chat: ['user', 'human', 'customer', 'client', 'prospect'],
  document: [],
};

export interface QuoteIndex {
  /** Whether the conversation had recognisable `speaker:` turns at all. */
  has_turns: boolean;
  /** Normalised text of everything the CUSTOMER said. */
  customer_text: string;
  /** Normalised text of the whole conversation, both sides. */
  all_text: string;
}

/**
 * Compare quotes the way a person would, not the way a byte comparator would.
 *
 * Transcripts come back with curly apostrophes and doubled spaces; a model reproducing a
 * quote will often straighten the punctuation without changing a word. Failing an item
 * over `’` versus `'` would punish the model for being right, so the comparison is
 * normalised on both sides. Nothing beyond punctuation and whitespace is touched - the
 * WORDS still have to match, which is the entire point of the check.
 */
export function normalizeQuote(s: string): string {
  return (s || '')
    .replace(/[‘’ʼ‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseTurns(conversation: string): Array<{ speaker: string; text: string }> {
  const turns: Array<{ speaker: string; text: string }> = [];

  conversation.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9 _-]{0,20}):\s?(.*)$/);
    if (match) {
      turns.push({ speaker: match[1].trim().toLowerCase(), text: match[2] });
    } else if (turns.length > 0 && line.trim()) {
      // A wrapped continuation of the previous turn, not a new one.
      turns[turns.length - 1].text += ` ${line.trim()}`;
    }
  });

  return turns;
}

export function buildQuoteIndex(conversation: string, source: ExtractionSource): QuoteIndex {
  const turns = parseTurns(conversation);
  const labels = CUSTOMER_LABELS[source];
  const customerTurns = turns.filter((t) => labels.includes(t.speaker));

  return {
    has_turns: turns.length > 0 && labels.length > 0,
    customer_text: normalizeQuote(customerTurns.map((t) => t.text).join(' \n ')),
    all_text: normalizeQuote(conversation),
  };
}

/**
 * Why a quote cannot be trusted, or null if it can.
 *
 * Both failures were observed on the FIRST real call this ran against, which is the only
 * reason they are enforced rather than assumed away:
 *
 *   - The model attributed a pain point to "Ralph has the sheet, and Johnny needs to stay
 *     in the loop" - the AGENT's own sentence. Provenance said `voice_transcript`, which
 *     was true and worthless: the model had cited itself and the contract could not tell.
 *   - Nothing stops a model from inventing a quote outright, and a fabricated quote is
 *     worse than none, because it launders a guess into a sourced fact.
 *
 * Neither is a judgement call, so neither is left to the prompt. What this CANNOT catch is
 * a genuine customer quote that does not support the claim attached to it - the same call
 * produced "that would be a hobby" as evidence for who approves spending. That needs a
 * different mechanism, and pretending this one covers it would be the exact overclaiming
 * the contract exists to prevent.
 */
export function quoteViolation(quote: string, index: QuoteIndex): string | null {
  const needle = normalizeQuote(quote);
  if (!needle) return null;

  if (!index.all_text.includes(needle)) {
    return 'source_quote does not appear in the conversation';
  }

  if (index.has_turns && !index.customer_text.includes(needle)) {
    return 'source_quote is the agent speaking, not the customer';
  }

  return null;
}

/**
 * Words that carry no evidence, so counting them would flatter every claim.
 *
 * Deliberately small. A longer list would start removing domain words, and the whole test
 * rests on domain words being the ones that have to appear.
 */
const EVIDENCE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with',
  'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these',
  'those', 'they', 'them', 'their', 'we', 'our', 'you', 'your', 'i', 'me', 'my', 'he', 'she', 'his',
  'her', 'as', 'so', 'than', 'then', 'there', 'here', 'when', 'where', 'which', 'who', 'what', 'how',
  'not', 'no', 'yes', 'do', 'does', 'did', 'done', 'have', 'has', 'had', 'will', 'would', 'should',
  'could', 'can', 'may', 'might', 'must', 'about', 'into', 'over', 'under', 'up', 'down', 'out',
  'all', 'any', 'some', 'each', 'every', 'other', 'more', 'most', 'much', 'many', 'very', 'just',
]);

/**
 * Crude stemming, on purpose.
 *
 * "messages" against "message" and "members" against "member" have to match or a faithful
 * paraphrase fails the test. A real stemmer would be better and is not worth a dependency
 * for this: chopping a few English suffixes is enough, and being slightly too generous is
 * the right way to be wrong here - a missed match would demote an honest item.
 */
function stem(word: string): string {
  return word
    .replace(/(ies)$/, 'y')
    .replace(/(sses|shes|ches|xes)$/, '')
    .replace(/(ing|ed|es|s)$/, '')
    .slice(0, 8);
}

const evidenceWords = (text: string): string[] =>
  normalizeQuote(text)
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !EVIDENCE_STOPWORDS.has(w))
    .map(stem);

/**
 * Below this, a statement is our language rather than theirs.
 *
 * Chosen against the real extractions rather than by feel - see the dry run in the session
 * log. A paraphrase of one thing somebody said scores well above it; a synthesis stitched
 * across several turns scores far below.
 */
export const MIN_GROUNDED_RATIO = 0.5;

/**
 * How much of a statement's vocabulary the customer actually used.
 *
 * 1 means every content word appears in their own turns; 0 means none do. Returns 1 for a
 * statement with no content words at all, because there is nothing to hold against them and
 * refusing on emptiness would be a different check wearing this one's name.
 */
export function groundednessRatio(value: string, index: QuoteIndex): number {
  const words = evidenceWords(value);
  if (words.length === 0) return 1;

  const haystack = new Set(evidenceWords(index.customer_text || index.all_text));
  const hits = words.filter((w) => haystack.has(w)).length;

  return hits / words.length;
}

/**
 * Demote a statement that claims to be sourced but is our synthesis.
 *
 * §16 forbids merging assumptions into facts, and until now nothing enforced it for the
 * commonest case: an item claiming `source_message` with NO quote. `source_message` does not
 * require one, so the model could file its own summary as something the customer said and
 * every check passed. On a real interview it filed ALL ELEVEN items that way - the trust
 * panel told the prospect "0 things we inferred" while several statements were plainly the
 * interviewer's synthesis.
 *
 * An item carrying a verified quote is left alone: `quoteViolation` has already proved those
 * words are the customer's. Everything else is measured, and what fails is DEMOTED rather
 * than rejected - the statement is still true and still worth showing, it just stops being
 * presented as something they said.
 */
export function groundItem<T extends { value: string; provenance: Provenance; classification: string; source_quote?: string | null }>(
  item: T,
  index: QuoteIndex,
): { item: T; demoted: boolean; ratio: number } {
  if (item.provenance === 'ai_inferred') return { item, demoted: false, ratio: 1 };
  if (item.source_quote) return { item, demoted: false, ratio: 1 };

  const ratio = groundednessRatio(item.value, index);
  if (ratio >= MIN_GROUNDED_RATIO) return { item, demoted: false, ratio };

  return {
    item: {
      ...item,
      provenance: 'ai_inferred' as Provenance,
      // FACT cannot sit on `ai_inferred`; the demotion has to carry through the
      // classification or it would produce an item the contract refuses.
      classification: item.classification === 'FACT' ? 'ASSUMPTION' : item.classification,
    },
    demoted: true,
    ratio,
  };
}

/**
 * The extraction instructions. Deterministic and pure, so the prompt a given run used can
 * be reconstructed rather than guessed at, and so it can be asserted on in a test without
 * a model in the loop.
 */
export function buildExtractionSystemPrompt(source: ExtractionSource): string {
  const allowed = PROVENANCE_BY_SOURCE[source];

  return [
    'You convert a conversation about a software project into structured project truth.',
    'You are not writing a summary and you are not writing a proposal. You are recording what is known, what is guessed, and what is still open, keeping those three things apart.',
    '',
    'RETURN STRICT JSON with exactly this shape:',
    '{',
    '  "title": "<short name for what they are building, e.g. Property Operations AI>",',
    '  "proposed_surfaces": ["<screen or area the system would need>", ...],',
    '  "items": [',
    '    { "dimension": "<one of the dimensions below>", "value": "<one plain-language statement>",',
    '      "classification": "FACT|ASSUMPTION|RECOMMENDATION|QUESTION|DECISION",',
    `      "provenance": "${allowed.join('|')}", "source_quote": "<their words, when quoting>" }`,
    '  ]',
    '}',
    '',
    'DIMENSIONS (use these keys exactly):',
    ...UNDERSTANDING_DIMENSIONS.map((d) => `  ${d} - ${DIMENSION_LABELS[d]}`),
    '',
    'CLASSIFICATION RULES, WHICH MATTER MORE THAN COVERAGE:',
    '- FACT: they stated it. It must quote them.',
    '- ASSUMPTION: you worked it out from what they said. It is not a fact no matter how obvious.',
    '- RECOMMENDATION: your suggestion, which nobody has agreed to.',
    '- QUESTION: something genuinely unresolved that a person still has to answer.',
    '- DECISION: a choice that belongs to the customer and must not be made for them.',
    '',
    'NEVER present an assumption as a fact. An inferred item is ASSUMPTION even when you are confident.',
    '',
    'PROVENANCE RULES:',
    `- Allowed values for this extraction: ${allowed.join(', ')}. Using any other value invalidates the whole result.`,
    `- "${allowed[0]}" requires a source_quote containing their actual words.`,
    '- "ai_inferred" must NOT have a source_quote, and can never be classified FACT.',
    '',
    'QUOTE RULES, WHICH ARE CHECKED MECHANICALLY AND WILL REJECT THE ITEM:',
    '- A source_quote must be copied VERBATIM from the conversation. Do not paraphrase, tidy, or compose it.',
    '- Quote only what the CUSTOMER said. Never quote the assistant/agent side of the conversation - quoting your own question back is not evidence of anything.',
    '',
    'WHEN YOU CANNOT HEAR THEM PROPERLY:',
    'Voice transcripts contain mishearings and noise. If their answer is garbled, or the assistant had to ask them to repeat or clarify and never got a clear answer, that is a QUESTION, not a FACT. Record what still needs answering rather than choosing the most likely meaning and stating it as settled.',
    '',
    'PROPOSED SURFACES are screens the NEW system would need. They are not a list of the tools the customer already uses.',
    '',
    'Do not invent integrations, systems, team sizes, budgets or timelines that were not discussed. An empty dimension is correct and useful; a filled-in guess is not.',
    'Leave a dimension out entirely rather than padding it.',
    '',
    'WHEN THEY STATE REQUIREMENTS, RECORD EVERY ONE:',
    'If the customer lists what the system must do - numbered, bulleted, or just one after another - put EACH requirement in its own item under "requirements", in their words. Do not merge two into one, do not summarise a list into a theme, and do not stop early because the list is long. A customer who states thirty requirements and gets twelve back has been told their specification was heard when it was not.',
    'This is the one place where completeness beats brevity. Everything else on this page is about not inventing; this is about not losing.',
  ].join('\n');
}

export function buildExtractionUserPrompt(conversation: string, facts: ExtractionFacts = {}): string {
  const who = [
    facts.name ? `Name: ${facts.name}` : null,
    facts.company ? `Company: ${facts.company}` : null,
    facts.role ? `Role: ${facts.role}` : null,
  ].filter(Boolean);

  return [
    who.length > 0 ? `WHAT WE ALREADY KNEW BEFORE THE CONVERSATION:\n${who.join('\n')}\n` : '',
    'THE CONVERSATION:',
    conversation.trim(),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Run an extraction. Returns a result rather than throwing, because every caller here is a
 * pipeline step that has to record WHY it produced nothing - "the model returned junk" and
 * "the model contradicted the contract" lead to different fixes, and collapsing both into a
 * generic failure is how a broken extractor survives in production looking merely quiet.
 */
/**
 * Output ceiling for one extraction.
 *
 * Was 4000, which is roughly a dozen items once each carries a verbatim source_quote. A
 * conversation stating thirty requirements therefore COULD NOT be recorded in full however
 * the prompt was worded - the model's only way to fit was to compress, and it did: 13 items
 * from 30 requirements, measured 2026-10-01. Asking for completeness under a ceiling that
 * forbids it is asking for a quiet lie.
 */
export const EXTRACTION_MAX_TOKENS = 12_000;

export async function extractUnderstanding(params: {
  conversation: string;
  source: ExtractionSource;
  facts?: ExtractionFacts;
  workflow?: string;
  max_tokens?: number;
}): Promise<ExtractionResult> {
  const conversation = (params.conversation || '').trim();
  if (!conversation) {
    return { ok: false, error_class: 'EmptyInput', error: 'no conversation to extract from' };
  }

  const system = buildExtractionSystemPrompt(params.source);
  const user = buildExtractionUserPrompt(conversation, params.facts);

  const { parsed, runtime_ms, cost_usd } = await chatJson(
    params.workflow || 'project-understanding-extraction',
    system,
    user,
    undefined,
    params.max_tokens ?? EXTRACTION_MAX_TOKENS,
  );

  // chatJson returns {} for unparseable output. Distinguish that from a real but invalid
  // understanding, because they are not the same failure.
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
    return {
      ok: false,
      error_class: 'EmptyModelResponse',
      error: 'model returned nothing parseable as JSON',
    };
  }

  // Items are validated ONE AT A TIME rather than as a block.
  //
  // The first live run against a real 245-second call failed entirely because the model
  // invented a dimension on a single item; a rerun of the same transcript produced eleven
  // valid ones. Model drift on an enum key is normal and will keep happening, and losing a
  // customer's whole interview to it is a far worse failure than dropping the one item.
  // Nothing is coerced or repaired - refused items are returned, with the reason and their
  // raw value, so the loss is visible instead of silent.
  const allowed = PROVENANCE_BY_SOURCE[params.source];
  const quotes = buildQuoteIndex(conversation, params.source);
  const rawItems: unknown[] = Array.isArray((parsed as any).items) ? (parsed as any).items : [];
  const items: any[] = [];
  const rejected: RejectedItem[] = [];

  rawItems.forEach((raw, index) => {
    const checked = validateItem(raw);
    if (!checked.ok) {
      rejected.push({ index, reason: checked.reason, raw });
      return;
    }
    if (!allowed.includes(checked.item.provenance)) {
      rejected.push({
        index,
        reason: `provenance "${checked.item.provenance}" is not available to a ${params.source} extraction`,
        raw,
      });
      return;
    }

    // A quote is the only thing making a sourced claim checkable, so it is checked.
    const badQuote = checked.item.source_quote ? quoteViolation(checked.item.source_quote, quotes) : null;
    if (badQuote) {
      rejected.push({ index, reason: badQuote, raw });
      return;
    }

    // And when there is no quote, the claim to be sourced is measured instead of taken.
    const grounded = groundItem(checked.item, quotes);
    if (grounded.demoted) {
      console.warn(
        `[Understanding] demoted item ${index} (${checked.item.dimension}) to ai_inferred: ` +
          `${(grounded.ratio * 100).toFixed(0)}% of its words appear in what the customer said`,
      );
    }

    items.push(grounded.item);
  });

  // Document-level failures, which per-item salvage cannot rescue: no name for the project,
  // or nothing left after the refusals. An understanding of nothing is not an understanding.
  try {
    const understanding = parseUnderstanding({ ...(parsed as any), items });

    if (understanding.items.length === 0) {
      return {
        ok: false,
        error_class: 'ContractViolation',
        error:
          rejected.length > 0
            ? `every item was refused by the contract: ${rejected.map((r) => r.reason).join('; ')}`
            : 'model returned no items',
        violations: rejected.map((r) => `item ${r.index}: ${r.reason}`),
      };
    }

    return { ok: true, understanding, rejected, runtime_ms, cost_usd };
  } catch (err: any) {
    if (err instanceof UnderstandingContractError) {
      return { ok: false, error_class: 'ContractViolation', error: err.message, violations: err.violations };
    }
    throw err;
  }
}
