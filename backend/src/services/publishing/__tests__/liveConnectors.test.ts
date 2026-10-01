/**
 * The ON switch for direct publishing lives in the environment. What must hold: unset is off;
 * a real implemented provider turns on; a typo or an unimplemented provider is dropped with a
 * warning rather than switched on; and the implemented list matches the adapters that exist.
 */

import { liveConnectorsFromEnv, IMPLEMENTED_CONNECTORS, LIVE_CONNECTORS, decidePublishMode, getProviderCapabilities } from '../providerCapabilities';
import { LIVE_ADAPTER_KEYS } from '../adapterRegistry';

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { jest.restoreAllMocks(); });

it('unset or empty means OFF, with no default-on', () => {
  expect(liveConnectorsFromEnv({}).size).toBe(0);
  expect(liveConnectorsFromEnv({ LIVE_CONNECTORS: '' }).size).toBe(0);
  expect(liveConnectorsFromEnv({ LIVE_CONNECTORS: ' , ' }).size).toBe(0);
  expect(LIVE_CONNECTORS.size).toBe(0); // this test process has no LIVE_CONNECTORS set
});

it('turns on exactly the implemented providers named, tolerating spaces', () => {
  const on = liveConnectorsFromEnv({ LIVE_CONNECTORS: ' linkedin_member, linkedin_organization ' });
  expect([...on].sort()).toEqual(['linkedin_member', 'linkedin_organization']);
  expect(decidePublishMode(getProviderCapabilities('linkedin_member'), 'publish', on).mode).toBe('direct');
  expect(decidePublishMode(getProviderCapabilities('linkedin_member'), 'publish', new Set()).mode).toBe('handoff');
});

it('drops a typo and a provider with no adapter, each with a warning, rather than switching it on', () => {
  // TikTok is the example here because Meta stopped being one on 2026-09-18, when its adapter
  // landed. Whichever provider is unimplemented, the env must not be able to switch it on.
  const on = liveConnectorsFromEnv({ LIVE_CONNECTORS: 'linkedin_member,linkedn_member,tiktok' });
  expect([...on]).toEqual(['linkedin_member']);
  const warned = (console.warn as jest.Mock).mock.calls.map((c) => JSON.parse(c[0]));
  expect(warned.map((w) => [w.event, w.context.key])).toEqual([
    ['live_connector_unknown', 'linkedn_member'],
    ['live_connector_not_implemented', 'tiktok'],
  ]);
  // Switching on a provider with no adapter would recreate the first dev deploy's
  // no_live_adapter dead letters. The env cannot do that.
  expect(decidePublishMode(getProviderCapabilities('tiktok'), 'publish', on).mode).toBe('handoff');
});

it('Meta CAN be switched on now that its adapter exists - and is off until someone does', () => {
  const on = liveConnectorsFromEnv({ LIVE_CONNECTORS: 'meta_facebook_page,meta_instagram' });
  expect([...on].sort()).toEqual(['meta_facebook_page', 'meta_instagram']);
  // Facebook now publishes directly with the switch on. This assertion said `handoff` until
  // 2026-09-30, when a real post to the Agent Cory Page returned HTTP 200 and a post id with the
  // app unpublished and no App Review - so approval was never the gate for Pages we administer,
  // and treating it as one was quietly costing us direct publishing.
  expect(decidePublishMode(getProviderCapabilities('meta_facebook_page'), 'publish', on).mode).toBe('direct');
  // Instagram too - but proved on its OWN flow (a real media container), not inherited from
  // Facebook. Both were measured against the live API on 2026-09-30.
  expect(decidePublishMode(getProviderCapabilities('meta_instagram'), 'publish', on).mode).toBe('direct');
  expect(liveConnectorsFromEnv({}).has('meta_facebook_page')).toBe(false);
});

it('IMPLEMENTED_CONNECTORS is exactly the set of adapters the registry can build', () => {
  expect([...IMPLEMENTED_CONNECTORS].sort()).toEqual([...LIVE_ADAPTER_KEYS].sort());
});


/**
 * Meta, after the live check on 2026-09-30.
 *
 * A real post to the Agent Cory Page from the stored Page token returned HTTP 200 and a post id
 * with the app UNPUBLISHED and no App Review submitted - so `not_submitted` was the wrong gate
 * for Facebook Pages, and it was silently costing us direct publishing while every other part of
 * the setup was correct. Instagram was NOT proved and is deliberately still gated.
 */
describe('Meta publish mode', () => {
  const on = (keys: string[]) => new Set(keys as never[]);

  it('a Facebook Page publishes directly once the env switch is on', () => {
    const caps = getProviderCapabilities('meta_facebook_page');
    expect(caps.appReview.status).toBe('self_serve');
    expect(decidePublishMode(caps, 'publish', on(['meta_facebook_page'])).mode).toBe('direct');
  });

  it('and still hands off when the env switch is off - approval alone is not enough', () => {
    const mode = decidePublishMode(getProviderCapabilities('meta_facebook_page'), 'publish', new Set());
    expect(mode.mode).toBe('handoff');
    // The reason must point at the switch, not at approval, or the fix gets looked for in the
    // wrong place - which is exactly what happened tonight, in reverse.
    expect(JSON.stringify(mode)).toMatch(/switched off on this server/);
  });

  it('Instagram publishes directly too, proved on its OWN flow', () => {
    // These two assertions said `handoff` / `not approved` earlier on 2026-09-30, deliberately:
    // Facebook passing was no evidence about Instagram, which publishes through a separate
    // container/publish flow. It was then measured on that flow - a real media container against
    // @agentcory.ai returned HTTP 200 and a creation id, app unpublished, no App Review. The
    // rule that each flow is proved separately is what changed the gate, not an inference.
    const caps = getProviderCapabilities('meta_instagram');
    expect(caps.appReview.status).toBe('self_serve');
    expect(decidePublishMode(caps, 'publish', on(['meta_instagram'])).mode).toBe('direct');
  });

  it('and both Meta providers still need the env switch, approval alone being insufficient', () => {
    for (const p of ['meta_facebook_page', 'meta_instagram'] as const) {
      const mode = decidePublishMode(getProviderCapabilities(p), 'publish', new Set());
      expect(mode.mode).toBe('handoff');
      expect(JSON.stringify(mode)).toMatch(/switched off on this server/);
      expect(JSON.stringify(mode)).not.toMatch(/not approved/);
    }
  });
});
