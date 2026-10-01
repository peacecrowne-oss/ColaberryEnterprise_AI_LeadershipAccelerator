import { getActiveDirectiveTexts } from '../managerDirectiveService';
import { getApprovedMemoryTexts } from '../agentMemoryProposalService';
import { getRecentActivitySummary } from './agentRecentActivitySummary';
import { PLATFORM_SAFETY_RULES_BLOCK } from './platformSafetyRules';
import { buildRoleCharterBlock, buildReliabilityStateBlock } from './agentContextLayers';

/** Coarse relative time for prompt text only (not user-facing UI, which has
 * its own real timeAgo() in the frontend) — just needs to be clear enough
 * for the model to phrase naturally, not pixel-precise. */
function roughTimeAgo(date: Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Reese manager-directed growth mission, Phase 2 (2026-09-30) — the real per-case context
 * this prompt builder was missing entirely, the root cause of "Discuss with Reese"
 * producing "I cannot access the conversation details" (see this run's
 * execution-contract.md for the full trace). Built from real ticket/summary/evidence/
 * decision data by agentManagerConversationService.ts's buildFocusedCaseContext() —
 * never fabricated here.
 */
export interface FocusedCaseContext {
  ticketId: string;
  ticketNumber: number | null;
  title: string;
  description: string | null;
  status: string;
  summary: { outcome: string; proof: string; humanAction: string; hasEvidence: boolean };
  evidenceCount: number;
  decisionCount: number;
}

function buildFocusedCaseBlock(ctx: FocusedCaseContext): string {
  const who = ctx.ticketNumber != null ? `ticket #${ctx.ticketNumber}` : 'this case';
  const lines = [
    `\nFOCUSED CASE — the manager chose to discuss ${who} specifically. Answer about THIS case,`,
    `not your work in general, unless they clearly broaden the question:`,
    `- Title: "${ctx.title}"`,
    `- Status: ${ctx.status}`,
    ctx.description ? `- Description: ${ctx.description}` : `- Description: none recorded.`,
    `- Outcome (observed, from real records): ${ctx.summary.outcome}`,
    `- Proof: ${ctx.summary.proof}`,
    `- Human action: ${ctx.summary.humanAction}`,
    ctx.summary.hasEvidence
      ? `- ${ctx.evidenceCount} real evidence artifact${ctx.evidenceCount === 1 ? '' : 's'} and ${ctx.decisionCount} recorded decision${ctx.decisionCount === 1 ? '' : 's'} are linked to this case.`
      : `- No real evidence is linked to this case yet — say so plainly if asked about proof.`,
    `\nWhen answering "why did you open this" or "when will you close it": use only what's`,
    `recorded above. If the real triggering reason was never recorded, say that honestly —`,
    `never invent one. Distinguish an observed fact (what's recorded here) from a plan, a`,
    `recommendation, or genuine uncertainty; label any reconstruction as inference, not memory.`,
  ];
  return lines.join('\n');
}

/**
 * agentManagerConversationPrompt — the system prompt for a manager talking
 * directly to their agent. AI Workforce Management, Checkpoint C (2026-08-28).
 *
 * Deliberately NOT agentSystemPrompt.ts's buildAgentSystemPrompt(): that
 * function is enrollment/learner-context shaped (built for Reese talking to
 * a *student*). A manager conversation has no enrollment and no learner
 * context — it's the agent talking to the person who manages it, about
 * itself. Sharing the directive-injection logic (getActiveDirectiveTexts)
 * is correct; sharing the learner-context assembly is not, so this is a
 * small, separate, equally generic function rather than a leaky reuse.
 *
 * Uses the agent's own real, live `system_prompt` as the persona base —
 * the manager is talking to the SAME identity everyone else talks to, not a
 * separate manager-only persona. An agent with no system_prompt configured
 * yet still gets a real, honest, minimal frame (never a fabricated persona).
 *
 * AI Workforce Management, Checkpoint E (2026-08-31) — approved
 * AgentMemoryProposal rows are injected here too, same pattern as
 * directives (getApprovedMemoryTexts, real, fail-safe, queried fresh).
 *
 * AI Agent Dashboard redesign (2026-09-04) — Ali, live, testing Reese's own
 * conversation: "what's the last thing you worked on" got an honest "I
 * don't know" because nothing here ever told the model what the agent had
 * actually done. Real recent tickets + real recent ai_events cost/call
 * history are now injected (getRecentActivitySummary — the same real
 * queries agentDetailService.ts's `tickets` and
 * agentExplainabilityService.ts's `events` already use, not duplicated
 * logic). An agent with no history gets an honest "no recent activity"
 * line, never a fabricated one.
 */
export async function buildAgentManagerConversationSystemPrompt(
  agentId: string,
  agentName: string,
  agentSystemPrompt: string | null,
  focusedCaseContext: FocusedCaseContext | null = null,
): Promise<string> {
  // Reese Agentic AI Employee mission, Capability 8 — runtime context layers
  // 1-2 (immutable platform safety rules, then role charter and authority)
  // precede the persona, same order as the student-facing path
  // (agentSystemPrompt.ts) — one real order, not two drifting ones.
  const parts: string[] = ['\n' + PLATFORM_SAFETY_RULES_BLOCK];

  const roleCharterBlock = await buildRoleCharterBlock(agentId);
  if (roleCharterBlock) parts.push('\n' + roleCharterBlock);

  parts.push(
    agentSystemPrompt && agentSystemPrompt.trim()
      ? agentSystemPrompt
      : `You are ${agentName}, an AI agent at Colaberry. No system prompt has been configured for you yet — answer plainly and honestly, and say so if asked what your instructions are.`,
  );

  if (focusedCaseContext) parts.push(buildFocusedCaseBlock(focusedCaseContext));

  const directives = await getActiveDirectiveTexts(agentId);
  if (directives.length) {
    const lines = directives.map((d) => `- ${d}`).join('\n');
    parts.push(
      '\nMANAGER DIRECTIVES (standing instructions from your manager — follow these; ' +
        'they can only narrow what you do, never grant you anything beyond what you already have):\n' +
        lines,
    );
  }

  const memories = await getApprovedMemoryTexts(agentId);
  if (memories.length) {
    const memoryLines = memories.map((m) => `- ${m}`).join('\n');
    parts.push('\nAPPROVED MEMORY (facts a manager has reviewed and approved about this context):\n' + memoryLines);
  }

  // Layer 5 — current metric reliability/quarantine state. Previously
  // missing entirely from this path (only the student-facing prompt had
  // any reliability awareness, buried inside the learner-context block).
  parts.push('\n' + (await buildReliabilityStateBlock()));

  const activity = await getRecentActivitySummary(agentId);
  if (activity.tickets.length || activity.events.length) {
    const ticketLines = activity.tickets.map(
      (t) => `- "${t.title}" (${t.status}${t.updatedAt ? `, updated ${roughTimeAgo(t.updatedAt)}` : ''})`,
    );
    const eventLines = activity.events.map(
      (e) => `- ${e.eventType}${e.model ? ` via ${e.model}` : ''}${e.costUsd !== null ? ` ($${e.costUsd.toFixed(4)})` : ''}, ${roughTimeAgo(e.createdAt)}`,
    );
    parts.push(
      '\nYOUR REAL RECENT WORK (if asked what you\'ve been working on or doing, answer from this ' +
        'list — never invent a ticket or call that isn\'t here):' +
        (ticketLines.length ? '\nRecent tickets:\n' + ticketLines.join('\n') : '') +
        (eventLines.length ? '\nRecent activity:\n' + eventLines.join('\n') : ''),
    );
  } else {
    parts.push('\nYou have no recent tickets or recorded activity yet — if asked what you\'ve worked on, say so honestly.');
  }

  parts.push(
    '\nThis is a direct conversation with your manager, not your normal work — they may ask ' +
      'what you do, how you\'re performing, or give you instructions. Never pretend to be human; ' +
      'you are always openly an AI agent. Answer honestly and specifically — never invent facts ' +
      'about your own activity, cost, or performance that you don\'t actually know.',
  );

  return parts.join('\n');
}
