import {
  decidePublishMode,
  type ProviderKey,
  LIVE_CONNECTORS,
  getProviderCapabilities,
  isStale,
  publishButtonFor,
  LIMITS_STALE_AFTER_DAYS,
  PROVIDER_CAPABILITIES,
  PROVIDER_KEYS,
  type ProviderCapabilities,
  type PublishAction,
} from '../providerCapabilities';

/**
 * The capability registry drives validation AND the Handoff decision, and no code path can
 * render a Publish button for an unsupported action.
 *
 * The second clause is enforced two ways. Behaviourally: for every provider and every action,
 * if the capability is absent or the app is unapproved, `decidePublishMode` returns handoff and
 * `publishButtonFor` never yields the label "Publish". Structurally: `PublishMode` has no
 * "direct, but" variant, so there is no third outcome for a button to misread.
 */

const ACTIONS: PublishAction[] = ['publish', 'firstComment', 'reply', 'edit', 'delete', 'analytics', 'ads', 'webhooks'];

describe('every provider is registered with complete, dated data', () => {
  it.each(PROVIDER_KEYS)('%s has a version, an asOf date, scopes and a review status', (key) => {
    const c = getProviderCapabilities(key);
    expect(c.provider).toBe(key);
    expect(c.version).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    expect(Number.isNaN(Date.parse(c.asOf))).toBe(false);
    expect(c.requiredScopes.length).toBeGreaterThan(0);
    expect(['not_submitted', 'in_review', 'approved', 'rejected', 'self_serve']).toContain(c.appReview.status);
    // A review note is not optional: "not_submitted" with no note leaves the operator asking
    // what to do about it.
    expect(c.appReview.note.length).toBeGreaterThan(20);
  });

  it('every provider declares a text limit greater than zero', () => {
    for (const key of PROVIDER_KEYS) expect(getProviderCapabilities(key).text.maxChars).toBeGreaterThan(0);
  });

  it('a provider with no image support says null, not zero limits', () => {
    // YouTube is video-only. `image: null` is the honest shape; `{ maxSizeMb: 0 }` would
    // validate every image as too large, which is a rejection dressed as a limit.
    expect(getProviderCapabilities('youtube').image).toBeNull();
    expect(getProviderCapabilities('youtube').contentTypes).toEqual(['video']);
  });

  it('Instagram has no text-only content type', () => {
    // A text draft cannot be published to Instagram at all. The registry says so by omission
    // in contentTypes, so the composer can refuse before validation rather than at publish.
    expect(getProviderCapabilities('meta_instagram').contentTypes).not.toContain('text');
  });
});

describe('an unsupported action yields Handoff, and never a Publish button', () => {
  it('for every provider and every unsupported action', () => {
    for (const key of PROVIDER_KEYS) {
      const caps = getProviderCapabilities(key);
      for (const action of ACTIONS) {
        if (caps.supports[action]) continue;
        const mode = decidePublishMode(caps, action);
        expect(mode.mode).toBe('handoff');
        expect(publishButtonFor(mode).label).toBe('Handoff required');
      }
    }
  });

  it('names "not supported" as the reason', () => {
    const mode = decidePublishMode(getProviderCapabilities('linkedin_member'), 'edit');
    expect(mode.mode).toBe('handoff');
    if (mode.mode === 'handoff') expect(mode.reasons.some((r) => /does not support "edit"/.test(r))).toBe(true);
  });
});

describe('an unapproved app yields Handoff even for a supported action', () => {
  it('Facebook Page is approved self-serve, so only the env switch stands between it and direct', () => {
    // This test asserted TWO handoff reasons until 2026-09-30 - "not approved" and "switched
    // off" - because Facebook was recorded as `not_submitted`. A real post to the Agent Cory
    // Page from the stored Page token then returned HTTP 200 with the app unpublished and no
    // App Review: Standard Access lets an app-role user post to a Page they administer, so
    // approval was never a gate here. One reason remains, and it names the thing to go and do.
    const caps = getProviderCapabilities('meta_facebook_page');
    expect(caps.supports.publish).toBe(true);
    expect(caps.appReview.status).toBe('self_serve');
    const mode = decidePublishMode(caps, 'publish');
    expect(mode.mode).toBe('handoff');
    if (mode.mode === 'handoff') {
      expect(mode.reasons).toHaveLength(1);
      expect(mode.reasons[0]).toMatch(/built but switched off/);
      // And it must NOT claim approval is missing, or the fix gets looked for in the wrong place.
      expect(mode.reasons[0]).not.toMatch(/not approved/);
    }
  });

  it('Instagram is self-serve too, proved on its OWN flow rather than inherited from Facebook', () => {
    // This asserted `not_submitted` for a few hours on 2026-09-30, deliberately, because
    // Facebook passing said nothing about Instagram - it publishes through its own
    // container/publish flow. It was then proved on that flow: creating a real media container
    // against @agentcory.ai returned HTTP 200 and a creation id, with the app unpublished and no
    // App Review. Only the gate moved; the "prove each flow separately" rule stands.
    const caps = getProviderCapabilities('meta_instagram');
    expect(caps.appReview.status).toBe('self_serve');
    const mode = decidePublishMode(caps, 'publish');
    expect(mode.mode).toBe('handoff');
    if (mode.mode === 'handoff') {
      // Switched off in this process, so one reason - and it must not blame approval.
      expect(mode.reasons).toHaveLength(1);
      expect(mode.reasons[0]).toMatch(/built but switched off/);
    }
  });

  it('reports BOTH reasons when both apply, as separate problems with separate fixes', () => {
    // TikTok: publish unsupported (unaudited apps are private-only) AND app not submitted.
    const mode = decidePublishMode(getProviderCapabilities('tiktok'), 'publish');
    expect(mode.mode).toBe('handoff');
    if (mode.mode === 'handoff') {
      expect(mode.reasons).toHaveLength(3);
      expect(mode.reasons[0]).toMatch(/does not support/);
      expect(mode.reasons[1]).toMatch(/not approved/);
      expect(mode.reasons[2]).toMatch(/No live connector/);
    }
  });

  it('LinkedIn member posting is self-serve, and STILL a handoff until a live connector exists', () => {
    // Share on LinkedIn needs no app review, so the registry alone would call it direct.
    // But the switch is off in this process (LIVE_CONNECTORS unset), and "Direct publish"
    // over a switched-off connector is the fake Publish button spec 8.2 forbids. The first dev
    // deploy showed exactly that label; this pins the fix - and, since the adapter now exists,
    // the reason says "built but switched off", not "not implemented".
    const mode = decidePublishMode(getProviderCapabilities('linkedin_member'), 'publish');
    expect(mode.mode).toBe('handoff');
    if (mode.mode === 'handoff') {
      expect(mode.reasons).toHaveLength(1);
      expect(mode.reasons[0]).toMatch(/built but switched off on this server \(LIVE_CONNECTORS\)/);
      expect(mode.reasons[0]).not.toMatch(/not implemented/);
    }
    expect(publishButtonFor(mode).label).toBe('Handoff required');
    // With a connector registered it becomes the one direct path.
    const withConnector = decidePublishMode(getProviderCapabilities('linkedin_member'), 'publish', new Set<ProviderKey>(['linkedin_member']));
    expect(withConnector).toEqual({ mode: 'direct' });
  });

  it('NO provider resolves publish to direct against the registry as it stands', () => {
    // Pinned so the first live connector is a deliberate edit to this test, not a surprise.
    expect(LIVE_CONNECTORS.size).toBe(0);
    const direct = PROVIDER_KEYS.filter((k) => decidePublishMode(getProviderCapabilities(k), 'publish').mode === 'direct');
    expect(direct).toEqual([]);
  });

  it('flipping a status to approved flips the decision once a connector exists - the registry drives it', () => {
    // Proves the decision reads the data rather than a hardcoded list of provider names.
    const caps: ProviderCapabilities = {
      ...getProviderCapabilities('meta_facebook_page'),
      appReview: { status: 'approved', reviewedAt: '2026-10-01', note: 'approved' },
    };
    const live = new Set<ProviderKey>(['meta_facebook_page']);
    expect(decidePublishMode(caps, 'publish', live)).toEqual({ mode: 'direct' });
    // Approved but switched off: handoff, with only that reason.
    const noConnector = decidePublishMode(caps, 'publish');
    expect(noConnector.mode).toBe('handoff');
    if (noConnector.mode === 'handoff') expect(noConnector.reasons).toEqual([expect.stringMatching(/built but switched off/)]);
    // But not for an action the provider still does not support.
    expect(decidePublishMode({ ...caps, supports: { ...caps.supports, edit: false } }, 'edit', live).mode).toBe('handoff');
  });
});

describe('limits are dated', () => {
  it('a fresh entry is not stale', () => {
    const now = Date.parse('2026-09-11T00:00:00Z');
    for (const key of PROVIDER_KEYS) expect(isStale(getProviderCapabilities(key), now)).toBe(false);
  });

  it('an entry older than the threshold IS stale', () => {
    const later = Date.parse('2026-09-11T00:00:00Z') + (LIMITS_STALE_AFTER_DAYS + 1) * 86_400_000;
    expect(isStale(getProviderCapabilities('meta_instagram'), later)).toBe(true);
  });

  it('an unparseable asOf is treated as stale, not as fresh', () => {
    // The failure direction matters: "unknown age" must read as "re-check", never as "fine".
    const caps = { ...getProviderCapabilities('x'), asOf: 'unknown' };
    expect(isStale(caps, Date.now())).toBe(true);
  });
});

describe('the registry is the single source', () => {
  it('exports exactly the seven providers the spec orders', () => {
    expect([...PROVIDER_KEYS].sort()).toEqual([
      'linkedin_member', 'linkedin_organization', 'meta_facebook_page', 'meta_instagram',
      'tiktok', 'x', 'youtube',
    ]);
  });

  it('Instagram carries the one hard published daily cap', () => {
    // Raised from 50 on 2026-09-18 against Meta's current Content Publishing documentation:
    // "100 API-published posts within a 24-hour moving period", a carousel counting as one.
    expect(PROVIDER_CAPABILITIES.meta_instagram.rateLimits.postsPerDay).toBe(100);
  });
});
