import type { ProviderKey, ProviderSummary } from '../../../../services/contentComposerApi';

/**
 * Which networks this brand can actually make a variant for.
 *
 * WHY. The channel row listed every network the PLATFORM knows about, with no reference to what
 * the BRAND has connected. So an operator could tick LinkedIn Page, YouTube, TikTok and X on a
 * brand that has only Facebook and Instagram, generate seven variants, and find out at
 * confirmation - or at publish time - that four of them have nowhere to go. Reported 2026-09-30
 * from production: "I should be restricted to adding channels that don't exist in the brand."
 *
 * A network with no connected account is DISABLED AND EXPLAINED, not hidden. Hiding it turns
 * "where did Facebook go?" into a mystery with no answer on the page; disabling it with a reason
 * makes the next step obvious, which is to go and connect it.
 *
 * "Connected" here means an account that is live AND chosen - a `needs_selection` row is a
 * destination nobody has picked yet, and `resolveAccountFor` will not publish from one, so
 * offering it here would be offering the same dead end one screen earlier.
 */

export interface ChannelChoice {
  provider: ProviderKey;
  displayName: string;
  /** False when this brand has no connected account for the network. */
  selectable: boolean;
  /** Why it cannot be chosen. Null when it can. */
  reason: string | null;
  /** True when the platform would hand off rather than publish directly. */
  handoff: boolean;
}

export interface ConnectedAccountLike {
  provider: string;
  status: string;
  revoked_at: string | null;
}

/** The providers a brand can publish to: live, chosen, not revoked. */
export function connectedProviders(accounts: readonly ConnectedAccountLike[]): Set<string> {
  return new Set(
    accounts
      .filter((a) => !a.revoked_at && a.status === 'connected')
      .map((a) => a.provider),
  );
}

/**
 * Every network the platform supports, each marked with whether THIS brand may use it.
 *
 * `brandChosen` false means no brand is selected yet - nothing is selectable, and the reason
 * says so rather than claiming every network is disconnected.
 */
export function channelChoices(
  providers: readonly ProviderSummary[],
  connected: ReadonlySet<string>,
  brandChosen: boolean,
): ChannelChoice[] {
  return providers.map((p) => {
    const handoff = p.mode !== 'direct';
    if (!brandChosen) {
      return { provider: p.provider, displayName: p.displayName, selectable: false, handoff, reason: 'Choose a brand first.' };
    }
    if (!connected.has(p.provider)) {
      return {
        provider: p.provider,
        displayName: p.displayName,
        selectable: false,
        handoff,
        reason: `This brand has no connected ${p.displayName} account. Connect one under Brands › Channels.`,
      };
    }
    return { provider: p.provider, displayName: p.displayName, selectable: true, handoff, reason: null };
  });
}

/**
 * Drop any already-ticked network the brand cannot use.
 *
 * Needed because the brand can change under a selection, and because an item saved earlier may
 * name a provider whose account has since been disconnected. Leaving it ticked would generate a
 * variant that cannot publish - the exact thing this module exists to stop.
 */
export function pruneSelection(selected: readonly ProviderKey[], choices: readonly ChannelChoice[]): ProviderKey[] {
  const allowed = new Set(choices.filter((c) => c.selectable).map((c) => c.provider));
  return selected.filter((p) => allowed.has(p));
}

/**
 * Variants that exist for networks this brand cannot publish to.
 *
 * An item generated before the brand lost an account - or before this rule existed at all - keeps
 * those variant cards, and they look exactly like the ones that will go out. Saying so is the
 * difference between "why is there a LinkedIn card on a brand with no LinkedIn?" and a page that
 * answers it.
 */
export function orphanVariantNote(
  variantProviders: readonly string[],
  choices: readonly ChannelChoice[],
): string | null {
  const allowed = new Set(choices.filter((c) => c.selectable).map((c) => c.provider as string));
  const names = choices
    .filter((c) => !allowed.has(c.provider) && variantProviders.includes(c.provider))
    .map((c) => c.displayName);
  if (names.length === 0) return null;
  return `${names.length} variant${names.length === 1 ? '' : 's'} below cannot publish: this brand has no account for ${names.join(', ')}. They are kept so nothing is lost, and they will be skipped.`;
}

/**
 * One line above the row when something is unavailable, so the greyed boxes are explained once.
 *
 * `draftExists` is the case that bit in production: every box is also disabled until the draft is
 * created, so a brand with two connected networks saw SEVEN greyed boxes and a note explaining
 * five of them. The two it said nothing about looked broken. The reason a control is disabled has
 * to be the reason on screen, and "no draft yet" outranks "not connected" because it is the one
 * standing between the operator and every box, not just some.
 */
export function unavailableNote(
  choices: readonly ChannelChoice[],
  brandChosen: boolean,
  draftExists = true,
): string | null {
  if (!brandChosen) return 'Choose a brand to see which networks it can post to.';
  if (!draftExists) return 'Create the draft first, then pick the networks it goes to.';
  const blocked = choices.filter((c) => !c.selectable);
  if (blocked.length === 0) return null;
  if (blocked.length === choices.length) {
    return 'This brand has no connected networks yet, so there is nothing to generate. Connect one under Brands › Channels.';
  }
  return `${blocked.length} network${blocked.length === 1 ? '' : 's'} greyed out: this brand has no account connected for ${blocked.map((c) => c.displayName).join(', ')}.`;
}
