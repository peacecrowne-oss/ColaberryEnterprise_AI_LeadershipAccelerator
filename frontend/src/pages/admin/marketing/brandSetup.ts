/**
 * brandSetup - the tabs of a brand's setup, and what is still missing from it.
 *
 * WHY. Loomly puts everything about a calendar on ONE page with nine tabs, so setting a calendar
 * up is a task with an end. Ours was spread across four pages - channels on Brands, approvals in
 * the composer, campaign slugs under Campaigns, readiness in a panel - so it was a tour, and
 * nobody could tell when it was finished. This is the same page, and this module is the "what is
 * left" line at the top of it.
 *
 * Pure: the rules are decided here from plain counts, so "is this brand set up?" is a tested
 * function rather than something inferred by looking at four screens.
 */

export type BrandTabKey = 'channels' | 'domains' | 'approvals' | 'campaigns' | 'details';

export interface BrandTab {
  key: BrandTabKey;
  label: string;
  /** One line under the heading, saying what the tab is for. */
  hint: string;
}

export const BRAND_TABS: readonly BrandTab[] = [
  { key: 'channels', label: 'Channels', hint: 'The networks this brand posts to, and whether each one still works.' },
  { key: 'domains', label: 'Sending domains', hint: 'The domains this brand sends email from. Configured outside the platform for now.' },
  { key: 'approvals', label: 'Approvals', hint: 'Posts for this brand waiting for someone to approve them.' },
  { key: 'campaigns', label: 'Campaigns', hint: 'The campaigns and tracked-link slugs posts can be attributed to.' },
  { key: 'details', label: 'Details', hint: 'The brand itself: its name, timezone and public address.' },
];

export function isBrandTab(value: string | null | undefined): value is BrandTabKey {
  return typeof value === 'string' && BRAND_TABS.some((t) => t.key === value);
}

/** Plain counts, so the rules below are testable without the page. */
export interface BrandSetupFacts {
  /** Live (non-revoked) channel accounts on this brand. */
  channelCount: number;
  /** Channels that are connected but failing or expiring. */
  channelsNeedingAttention: number;
  /** Sending domains recorded for this brand; null when readiness has not loaded. */
  domainCount: number | null;
  /** Domains that are fully verified. */
  verifiedDomainCount: number;
  /** Posts waiting for approval. Not a setup step - shown so the tab carries a number. */
  pendingApprovals: number;
}

export interface SetupStep {
  key: string;
  /** What is missing, as an instruction. */
  label: string;
  done: boolean;
  /** Which tab fixes it. */
  tab: BrandTabKey;
}

/**
 * What a brand still needs before it can publish, in the order someone would do it.
 *
 * Deliberately short. A checklist that lists everything a brand COULD have is a checklist nobody
 * finishes; these are the two things without which the product does not work, plus a warning when
 * a connection that exists has stopped working.
 */
export function setupSteps(facts: BrandSetupFacts): SetupStep[] {
  return [
    {
      key: 'channel',
      label: 'Connect a network to post to',
      done: facts.channelCount > 0,
      tab: 'channels',
    },
    {
      key: 'channel_health',
      label: 'Fix the connection that has stopped working',
      // Only a step when there is something to fix; a brand with healthy channels has finished it.
      done: facts.channelsNeedingAttention === 0,
      tab: 'channels',
    },
    // No domain step. Verifying a sending domain is not something this product can do - see
    // domainNotice - and a checklist item nobody can complete is worse than no item at all.
  ];
}

/**
 * What the Domains tab has to admit.
 *
 * `brand_domains` rows exist, carry `verification_status`, and are rendered - but NOTHING in the
 * backend ever writes that column. There is no DNS health check, and no route creates or edits a
 * domain; rows come only from the seed. So every domain reads `pending` for ever, `preflightSender`
 * can never pass, and branded email sending on a brand sender profile always throws.
 *
 * Until a verification job exists, the honest thing is to say that here rather than to keep
 * "verify a sending domain" on a checklist as though it were a click away. Found 2026-09-29 while
 * mapping how channels relate to domains; the checklist item had shipped that morning.
 */
export function domainNotice(facts: BrandSetupFacts): { tone: 'info' | 'warning'; text: string } {
  const n = facts.domainCount;
  if (n === null) return { tone: 'info', text: 'Send readiness has not loaded yet.' };
  const counted = n === 1 ? '1 sending domain is' : `${n} sending domains are`;
  return {
    tone: 'warning',
    text: `${counted} recorded for this brand. They cannot be added, edited or verified here: `
      + 'nothing in the platform checks DNS yet, so every domain reads "pending" and branded '
      + 'email sending stays blocked. Social publishing is unaffected - it does not use domains.',
  };
}

/** The line at the top of the page. Says what is left, or that nothing is. */
export function setupSummary(facts: BrandSetupFacts): { done: boolean; text: string } {
  const outstanding = setupSteps(facts).filter((s) => !s.done);
  if (outstanding.length === 0) {
    // Says only what it can stand behind. It used to claim "and a verified sending domain",
    // which no brand can have while nothing verifies one.
    return { done: true, text: 'This brand is set up: it has a working connection to post with.' };
  }
  const first = outstanding[0];
  return {
    done: false,
    text: outstanding.length === 1
      ? `One thing left: ${first.label.toLowerCase()}.`
      : `${outstanding.length} things left, starting with: ${first.label.toLowerCase()}.`,
  };
}
