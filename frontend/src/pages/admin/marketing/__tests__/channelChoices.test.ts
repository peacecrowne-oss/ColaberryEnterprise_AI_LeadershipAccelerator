import {
  channelChoices, connectedProviders, orphanVariantNote, pruneSelection, unavailableNote,
  type ConnectedAccountLike,
} from '../composer/channelChoices';
import type { ProviderKey, ProviderSummary } from '../../../../services/contentComposerApi';

/**
 * Which networks a brand may generate a variant for.
 *
 * The case that sent me here, from production: Colaberry Training has Facebook and Instagram
 * connected, and the composer offered all seven networks. Seven variants were generated, four of
 * them for networks with nowhere to post.
 */

function provider(key: string, displayName: string, mode: 'direct' | 'handoff' = 'handoff'): ProviderSummary {
  return { provider: key as ProviderKey, displayName, mode, maxChars: 3000 } as ProviderSummary;
}

const PROVIDERS = [
  provider('meta_facebook_page', 'Facebook Page'),
  provider('meta_instagram', 'Instagram (professional account)'),
  provider('linkedin_organization', 'LinkedIn Page (organization)'),
  provider('linkedin_member', 'LinkedIn (personal profile)', 'direct'),
  provider('tiktok', 'TikTok'),
];

function account(p: string, over: Partial<ConnectedAccountLike> = {}): ConnectedAccountLike {
  return { provider: p, status: 'connected', revoked_at: null, ...over };
}

// Colaberry Training, as it actually is in production.
const TRAINING = connectedProviders([account('meta_facebook_page'), account('meta_instagram')]);

describe('what counts as connected', () => {
  it('a live, chosen account', () => {
    expect(connectedProviders([account('meta_facebook_page')]).has('meta_facebook_page')).toBe(true);
  });

  it('a revoked account does not count, even if its status was never updated', () => {
    expect(connectedProviders([account('tiktok', { revoked_at: '2026-09-30T00:00:00Z' })]).size).toBe(0);
  });

  it('an account still awaiting a choice does not count', () => {
    // `resolveAccountFor` will not publish from a needs_selection row, so offering it here
    // would be offering the same dead end one screen earlier.
    expect(connectedProviders([account('meta_facebook_page', { status: 'needs_selection' })]).size).toBe(0);
  });

  it('nor does one that needs reconnecting', () => {
    expect(connectedProviders([account('linkedin_member', { status: 'needs_reconnect' })]).size).toBe(0);
  });
});

describe('the channel row', () => {
  const choices = channelChoices(PROVIDERS, TRAINING, true);

  it('lets the brand pick only what it has connected', () => {
    expect(choices.filter((c) => c.selectable).map((c) => c.provider))
      .toEqual(['meta_facebook_page', 'meta_instagram']);
  });

  it('keeps the others visible rather than hiding them', () => {
    // Hiding turns "where did LinkedIn go?" into a question the page cannot answer.
    expect(choices).toHaveLength(PROVIDERS.length);
  });

  it('says why each one cannot be chosen, and where to fix it', () => {
    const tiktok = choices.find((c) => c.provider === 'tiktok')!;
    expect(tiktok.selectable).toBe(false);
    expect(tiktok.reason).toMatch(/no connected TikTok account/);
    expect(tiktok.reason).toMatch(/Brands/);
  });

  it('a selectable network carries no reason', () => {
    expect(choices.find((c) => c.provider === 'meta_facebook_page')!.reason).toBeNull();
  });

  it('still reports handoff separately from unavailable - they are different problems', () => {
    // A connected network can still be handoff-only; that must not read as "not connected".
    const fb = choices.find((c) => c.provider === 'meta_facebook_page')!;
    expect(fb.selectable).toBe(true);
    expect(fb.handoff).toBe(true);
  });

  it('with no brand chosen, nothing is selectable and the reason says so', () => {
    const none = channelChoices(PROVIDERS, new Set(), false);
    expect(none.every((c) => !c.selectable)).toBe(true);
    expect(none[0].reason).toBe('Choose a brand first.');
  });
});

describe('pruning a selection that is no longer valid', () => {
  it('drops networks the brand cannot use', () => {
    const choices = channelChoices(PROVIDERS, TRAINING, true);
    const pruned = pruneSelection(['meta_facebook_page', 'tiktok', 'linkedin_member'] as ProviderKey[], choices);
    expect(pruned).toEqual(['meta_facebook_page']);
  });

  it('leaves a wholly valid selection untouched', () => {
    const choices = channelChoices(PROVIDERS, TRAINING, true);
    const sel = ['meta_facebook_page', 'meta_instagram'] as ProviderKey[];
    expect(pruneSelection(sel, choices)).toEqual(sel);
  });

  it('empties the selection when the brand has nothing connected', () => {
    const choices = channelChoices(PROVIDERS, new Set(), true);
    expect(pruneSelection(['meta_facebook_page'] as ProviderKey[], choices)).toEqual([]);
  });
});

describe('the note above the row', () => {
  it('names what is greyed out', () => {
    const note = unavailableNote(channelChoices(PROVIDERS, TRAINING, true), true)!;
    expect(note).toMatch(/^3 networks greyed out/);
    expect(note).toContain('TikTok');
  });

  it('a brand with everything connected gets no note at all', () => {
    const all = connectedProviders(PROVIDERS.map((p) => account(p.provider)));
    expect(unavailableNote(channelChoices(PROVIDERS, all, true), true)).toBeNull();
  });

  it('a brand with nothing connected is told that plainly, not given a list of five', () => {
    const note = unavailableNote(channelChoices(PROVIDERS, new Set(), true), true)!;
    expect(note).toMatch(/no connected networks yet/);
  });

  it('one greyed network reads in the singular', () => {
    const four = connectedProviders(PROVIDERS.slice(0, 4).map((p) => account(p.provider)));
    expect(unavailableNote(channelChoices(PROVIDERS, four, true), true)).toMatch(/^1 network greyed out/);
  });

  describe('before the draft exists', () => {
    /**
     * Reported from production: "Colaberry Training has a fb and ig but when composing it blocks
     * all of them - they are all dimmed out." They were dimmed because every box is disabled
     * until the draft is created, but the note explained only the five that were disconnected,
     * so the two working ones looked broken with no reason given.
     */
    const choices = channelChoices(PROVIDERS, TRAINING, true);

    it('says the draft is what is missing, not which networks are disconnected', () => {
      expect(unavailableNote(choices, true, false)).toBe('Create the draft first, then pick the networks it goes to.');
    });

    it('outranks the not-connected note, because it blocks EVERY box rather than some', () => {
      const note = unavailableNote(choices, true, false)!;
      expect(note).not.toMatch(/greyed out/);
      expect(note).not.toContain('TikTok');
    });

    it('and the not-connected note returns once the draft exists', () => {
      expect(unavailableNote(choices, true, true)).toMatch(/^3 networks greyed out/);
    });

    it('no brand still outranks no draft - it is the earlier step', () => {
      expect(unavailableNote(choices, false, false)).toMatch(/Choose a brand/);
    });
  });
});

describe('variants that already exist for networks the brand cannot use', () => {
  /**
   * The residue of the same bug: an item generated BEFORE this rule existed keeps its variant
   * cards, and they look exactly like the ones that will publish. Ali's item had seven.
   */
  const choices = channelChoices(PROVIDERS, TRAINING, true);

  it('names them, so a LinkedIn card on a brand with no LinkedIn is explained', () => {
    const note = orphanVariantNote(
      ['meta_facebook_page', 'linkedin_member', 'linkedin_organization'],
      choices,
    )!;
    expect(note).toMatch(/^2 variants below cannot publish/);
    expect(note).toContain('LinkedIn Page (organization)');
    expect(note).toContain('LinkedIn (personal profile)');
    // The one that CAN publish is not accused.
    expect(note).not.toContain('Facebook Page');
  });

  it('says they are kept rather than implying they were thrown away', () => {
    const note = orphanVariantNote(['tiktok'], choices)!;
    expect(note).toMatch(/kept so nothing is lost/);
    expect(note).toMatch(/^1 variant below/);
  });

  it('is silent when every variant can publish', () => {
    expect(orphanVariantNote(['meta_facebook_page', 'meta_instagram'], choices)).toBeNull();
  });

  it('is silent when there are no variants at all', () => {
    expect(orphanVariantNote([], choices)).toBeNull();
  });
});
