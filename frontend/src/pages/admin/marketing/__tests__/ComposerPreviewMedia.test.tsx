import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import ComposerPreview from '../composer/ComposerPreview';
import type { ContentVariant, ItemMedia, ProviderKey, ProviderSummary } from '../../../../services/contentComposerApi';

/**
 * The preview shows the FILE.
 *
 * Reported from production on 2026-10-01: "the preview does not show my video". It never had -
 * the component took `mediaCount: number` and drew that many grey rectangles, so a preview of a
 * video post could not answer the only question it exists to answer, which is whether that is
 * the right video.
 */

let container: HTMLDivElement;
let root: Root;

const PROVIDERS: ProviderSummary[] = [
  { provider: 'meta_facebook_page' as ProviderKey, displayName: 'Facebook Page', mode: 'direct', maxChars: 63206 } as ProviderSummary,
];

const VARIANTS: ContentVariant[] = [
  { provider: 'meta_facebook_page' as ProviderKey, body: 'Explorer Accelerator', is_manually_edited: false } as ContentVariant,
];

function media(over: Partial<ItemMedia> = {}): ItemMedia {
  return {
    mediaAssetId: 'm-1', mimeType: 'video/mp4', byteSize: 77_100_000, width: 1080, height: 1920,
    altText: 'News bulletin', position: 0, originalFilename: 'Reel 10.mp4', durationMs: 55_000,
    pages: null, url: 'https://www.refactored.ai/m/b/reel.mp4?e=1&s=x', ...over,
  };
}

function render(props: Partial<React.ComponentProps<typeof ComposerPreview>> = {}) {
  act(() => {
    root.render(
      <ComposerPreview
        variants={VARIANTS} providers={PROVIDERS} links={[]} mediaCount={0}
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

describe('a video attachment', () => {
  it('renders as a real, playable video at its signed URL', () => {
    render({ media: [media()], mediaCount: 1 });
    const v = container.querySelector('[data-testid="preview-video-m-1"]') as HTMLVideoElement;
    expect(v).not.toBeNull();
    expect(v.getAttribute('src')).toBe('https://www.refactored.ai/m/b/reel.mp4?e=1&s=x');
    expect(v.hasAttribute('controls')).toBe(true);
    // And NOT the grey box it used to be.
    expect(container.querySelector('[data-testid="preview-media-placeholder"]')).toBeNull();
  });
});

describe('an image attachment', () => {
  it('renders as an image carrying the operator\'s own alt text', () => {
    render({ media: [media({ mediaAssetId: 'm-2', mimeType: 'image/png', url: 'https://x/m/b/a.png?e=1&s=y' })], mediaCount: 1 });
    const img = container.querySelector('[data-testid="preview-image-m-2"]') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://x/m/b/a.png?e=1&s=y');
    // The alt text is required at upload; the preview is where you see whether it reads well.
    expect(img.getAttribute('alt')).toBe('News bulletin');
  });
});

describe('a file that cannot be drawn', () => {
  it('states what it is and how long, rather than showing an empty box', () => {
    render({ media: [media({ mediaAssetId: 'm-3', mimeType: 'application/pdf', pages: 12, url: 'https://x/m/b/d.pdf?e=1&s=z' })], mediaCount: 1 });
    const tile = container.querySelector('[data-testid="preview-file-m-3"]')!;
    expect(tile.textContent).toContain('pdf');
    expect(tile.textContent).toContain('12 pages');
  });
});

describe('several attachments', () => {
  it('shows the first four and counts the rest', () => {
    const many = [1, 2, 3, 4, 5, 6].map((i) => media({ mediaAssetId: `m-${i}`, mimeType: 'image/png', url: `https://x/${i}.png` }));
    render({ media: many, mediaCount: many.length });
    expect(container.querySelectorAll('[data-testid^="preview-image-"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="preview-media"]')!.textContent).toContain('+2');
  });
});

describe('when the server cannot sign a URL', () => {
  it('falls back to the placeholder rather than a broken image', () => {
    // `url: null` means no public base URL is configured. Rendering <img src=""> there would
    // show a broken-image icon and read as a corrupt upload.
    render({ media: [media({ url: null })], mediaCount: 1 });
    expect(container.querySelector('[data-testid="preview-video-m-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="preview-file-m-1"]')).not.toBeNull();
  });

  it('and with no media rows at all, still honours the count it was given', () => {
    // The confirmation knows about assets this component was not handed; claiming "nothing
    // attached" would be worse than a grey box.
    render({ media: [], mediaCount: 2 });
    expect(container.querySelector('[data-testid="preview-media-placeholder"]')).not.toBeNull();
  });

  it('and draws nothing at all when there is genuinely no media', () => {
    render({ media: [], mediaCount: 0 });
    expect(container.querySelector('[data-testid="preview-media-placeholder"]')).toBeNull();
    expect(container.querySelector('[data-testid="preview-media"]')).toBeNull();
  });
});
