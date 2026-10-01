import { checkVideoLink, excludedByContentType, linkPostNotice } from '../composer/videoSource';
import type { ContentType, ProviderKey, ProviderSummary } from '../../../../services/contentComposerApi';

/**
 * Video by link.
 *
 * Ali asked for it: "For video, it can come with a link to vimeo or youtube OR it can be an
 * upload." The thing the composer must not do is accept the link and quietly publish something
 * other than what was asked for - a page URL is not a video file, so it becomes a LINK post, and
 * networks with no link post drop out.
 */

function provider(key: string, displayName: string, contentTypes: ContentType[]): ProviderSummary {
  return { provider: key as ProviderKey, displayName, contentTypes, mode: 'direct', maxChars: 3000 } as ProviderSummary;
}

// The real shapes, from PROVIDER_CAPABILITIES.
const CONNECTED = [
  provider('meta_facebook_page', 'Facebook Page', ['text', 'image', 'video', 'carousel', 'link']),
  provider('meta_instagram', 'Instagram (professional account)', ['image', 'video', 'carousel']),
];

describe('is the link usable at all', () => {
  it('accepts a real https video page', () => {
    expect(checkVideoLink('https://vimeo.com/123456789')).toEqual({ ok: true, reason: null });
    expect(checkVideoLink('https://www.youtube.com/watch?v=abc').ok).toBe(true);
  });

  it('accepts http, grudgingly, and trims what was pasted', () => {
    expect(checkVideoLink('  http://example.com/v.mp4  ').ok).toBe(true);
  });

  it('refuses something that is not a web address at all', () => {
    const r = checkVideoLink('not a url');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/starting with https/);
  });

  it('refuses a javascript: URL, which parses perfectly well and must never reach a post', () => {
    // `new URL()` accepts this, and so would the server's z.string().url(). The protocol check
    // is the reason this function exists rather than a regex on "http".
    expect(checkVideoLink('javascript:alert(1)')).toEqual({ ok: false, reason: 'Only http and https links can be posted.' });
  });

  it('refuses a data: URL for the same reason', () => {
    expect(checkVideoLink('data:text/html,<script>').ok).toBe(false);
  });

  it('asks for the link rather than scolding when the box is empty', () => {
    expect(checkVideoLink('   ').reason).toBe('Paste the video link first.');
  });
});

describe('which networks a link post loses', () => {
  it('names Instagram for a link, because its contentTypes has none', () => {
    expect(excludedByContentType(CONNECTED, 'link')).toEqual(['Instagram (professional account)']);
  });

  it('excludes nobody for a type everyone supports', () => {
    expect(excludedByContentType(CONNECTED, 'video')).toEqual([]);
  });

  it('is derived from provider data, so a capability change is reflected without editing code', () => {
    // The guard against hardcoding "Instagram". Give Instagram a link capability and it stops
    // being excluded; take Facebook's away and it starts.
    const changed = [
      provider('meta_facebook_page', 'Facebook Page', ['text', 'image']),
      provider('meta_instagram', 'Instagram (professional account)', ['image', 'link']),
    ];
    expect(excludedByContentType(changed, 'link')).toEqual(['Facebook Page']);
  });

  it('treats a provider that declares no contentTypes as capable, not excluded', () => {
    // Guessing "it cannot" would hide a network the operator has connected - the worse error.
    const unknown = [{ provider: 'x' as ProviderKey, displayName: 'X', mode: 'handoff', maxChars: 280 } as ProviderSummary];
    expect(excludedByContentType(unknown, 'link')).toEqual([]);
  });
});

describe('what the operator is told before choosing', () => {
  it('says what the post becomes first, then what it costs', () => {
    const note = linkPostNotice(['Instagram (professional account)']);
    expect(note).toMatch(/^A video link publishes as a link post with a thumbnail, not as a video\./);
    expect(note).toMatch(/Instagram \(professional account\) cannot take a link post, so it is excluded/);
  });

  it('reads correctly when several networks drop out', () => {
    expect(linkPostNotice(['Instagram', 'TikTok'])).toMatch(/Instagram and TikTok cannot take a link post, so they are excluded/);
  });

  it('still explains the change when nothing is lost', () => {
    // The post type changes whether or not a network drops out; silence there would be the
    // "quietly published something else" failure.
    expect(linkPostNotice([])).toBe('A video link publishes as a link post with a thumbnail, not as a video.');
  });
});
