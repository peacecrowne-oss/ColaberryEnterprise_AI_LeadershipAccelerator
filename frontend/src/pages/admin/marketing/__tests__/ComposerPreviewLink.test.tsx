import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import ComposerPreview from '../composer/ComposerPreview';
import type { ContentVariant, ItemLink, ProviderKey, ProviderSummary } from '../../../../services/contentComposerApi';

/**
 * The link card, which is the last content type the preview had no test for.
 *
 * It matters more now that "video by link" exists: choosing a Vimeo or YouTube URL turns the post
 * into a link post, and the preview is where the operator sees what that actually looks like
 * before approving it.
 */

let container: HTMLDivElement;
let root: Root;

function provider(key: string, displayName: string, linkBehavior: string): ProviderSummary {
  return { provider: key as ProviderKey, displayName, mode: 'direct', maxChars: 3000, linkBehavior } as unknown as ProviderSummary;
}

function variant(key: string): ContentVariant {
  return { provider: key as ProviderKey, body: 'Watch the new series', is_manually_edited: false } as ContentVariant;
}

function link(key: string): ItemLink {
  return {
    provider: key as ProviderKey, trackedLinkId: 't-1',
    shortUrl: 'https://rfr.ai/abc', finalUrl: 'https://vimeo.com/123456789',
    utm: {}, reused: false,
  } as unknown as ItemLink;
}

function render(props: Partial<React.ComponentProps<typeof ComposerPreview>> = {}) {
  act(() => {
    root.render(
      <ComposerPreview
        variants={[]} providers={[]} links={[]} mediaCount={0}
        brandName="Colaberry Training" {...props}
      />,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

describe('a network that renders links', () => {
  it('shows the card, with the destination host and the tracked short link', () => {
    render({
      variants: [variant('meta_facebook_page')],
      providers: [provider('meta_facebook_page', 'Facebook Page', 'inline')],
      links: [link('meta_facebook_page')],
    });
    const card = container.querySelector('[data-testid="preview-link-card"]')!;
    expect(card).not.toBeNull();
    // The host is what a reader recognises; the short URL is what actually gets clicked.
    expect(card.textContent).toContain('vimeo.com');
    expect(card.textContent).toContain('https://rfr.ai/abc');
  });
});

describe('a network that does not render links', () => {
  it('shows NO card for Instagram, because nothing there is clickable', () => {
    // Drawing a link card for Instagram would promise a click the network never gives. This is
    // the same fact that excludes Instagram from a video-by-link post.
    render({
      variants: [variant('meta_instagram')],
      providers: [provider('meta_instagram', 'Instagram (professional account)', 'no_clickable_links')],
      links: [link('meta_instagram')],
    });
    expect(container.querySelector('[data-testid="preview-link-card"]')).toBeNull();
  });
});

describe('with no link minted yet', () => {
  it('draws no card rather than an empty one', () => {
    render({
      variants: [variant('meta_facebook_page')],
      providers: [provider('meta_facebook_page', 'Facebook Page', 'inline')],
      links: [],
    });
    expect(container.querySelector('[data-testid="preview-link-card"]')).toBeNull();
  });
});
