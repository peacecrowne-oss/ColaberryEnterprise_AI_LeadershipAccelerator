import { BRAND_TABS, domainNotice, isBrandTab, setupSteps, setupSummary, type BrandSetupFacts } from '../brandSetup';

/**
 * "Is this brand set up?" as a tested function.
 *
 * It used to be a question you answered by visiting four pages and forming an impression. The
 * line at the top of the brand page is this, so it has to be right about the two things without
 * which the product does not work - somewhere to post, and a verified domain to send from.
 */

const READY: BrandSetupFacts = {
  channelCount: 1, channelsNeedingAttention: 0, domainCount: 1, verifiedDomainCount: 1, pendingApprovals: 0,
};

describe('what a brand still needs', () => {
  it('a fully set up brand says so, and lists nothing outstanding', () => {
    expect(setupSteps(READY).every((s) => s.done)).toBe(true);
    expect(setupSummary(READY)).toEqual({ done: true, text: expect.stringContaining('This brand is set up') });
  });

  it('a brand with no channel is told to connect one, and which tab does it', () => {
    const facts = { ...READY, channelCount: 0 };
    const step = setupSteps(facts).find((s) => !s.done)!;
    expect(step).toMatchObject({ key: 'channel', tab: 'channels' });
    expect(setupSummary(facts).text).toMatch(/One thing left: connect a network/);
  });

  it('a connection that has stopped working is outstanding even though a channel exists', () => {
    const facts = { ...READY, channelsNeedingAttention: 1 };
    expect(setupSteps(facts).find((s) => s.key === 'channel_health')!.done).toBe(false);
    expect(setupSummary(facts).text).toMatch(/fix the connection/);
  });

  it('never asks anyone to verify a domain, because nothing in the platform can', () => {
    // There is no route that creates or verifies a domain and no DNS check anywhere, so every
    // domain reads "pending" for ever. A checklist item nobody can complete is worse than none:
    // it makes a working brand read as unfinished and sends the operator looking for a button
    // that does not exist.
    expect(setupSteps({ ...READY, verifiedDomainCount: 0 }).some((s) => s.key === 'domain')).toBe(false);
    expect(setupSummary({ ...READY, verifiedDomainCount: 0, domainCount: 2 }).done).toBe(true);
  });

  it('and does not claim a verified domain in the finished line', () => {
    expect(setupSummary(READY).text).not.toMatch(/verified sending domain/);
  });

  it('counts several outstanding things and leads with the first', () => {
    const facts = { ...READY, channelCount: 0, channelsNeedingAttention: 1 };
    const summary = setupSummary(facts);
    expect(summary.done).toBe(false);
    expect(summary.text).toMatch(/^2 things left, starting with: connect a network/);
  });
});

describe('what the Domains tab admits', () => {
  it('says the domains cannot be added, edited or verified here, and why', () => {
    const notice = domainNotice({ ...READY, domainCount: 2 });
    expect(notice.text).toMatch(/2 sending domains are recorded/);
    expect(notice.text).toMatch(/cannot be added, edited or verified here/);
    expect(notice.text).toMatch(/nothing in the platform checks DNS yet/);
  });

  it('scopes the bad news: social publishing does not use domains', () => {
    // Otherwise this reads as "publishing is blocked", which would be false and alarming.
    expect(domainNotice(READY).text).toMatch(/Social publishing is unaffected/);
  });

  it('counts one domain in the singular', () => {
    expect(domainNotice({ ...READY, domainCount: 1 }).text).toMatch(/^1 sending domain is recorded/);
  });

  it('readiness that has not loaded says so, rather than reporting zero domains', () => {
    const notice = domainNotice({ ...READY, domainCount: null });
    expect(notice.text).toBe('Send readiness has not loaded yet.');
    expect(notice.tone).toBe('info');
  });
});

describe('the tabs', () => {
  it('are in the order the work happens', () => {
    expect(BRAND_TABS.map((t) => t.key)).toEqual(['channels', 'domains', 'approvals', 'campaigns', 'details']);
  });

  it('every tab says what it is for, so the row is not five bare nouns', () => {
    for (const t of BRAND_TABS) expect(t.hint.length).toBeGreaterThan(20);
  });

  it('only a real tab name is accepted from the URL', () => {
    expect(isBrandTab('channels')).toBe(true);
    expect(isBrandTab('Channels')).toBe(false);
    expect(isBrandTab('slots')).toBe(false);
    expect(isBrandTab(null)).toBe(false);
  });
});
