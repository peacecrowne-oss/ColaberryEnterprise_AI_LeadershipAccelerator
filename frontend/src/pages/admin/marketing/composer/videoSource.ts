import type { ContentType, ProviderSummary } from '../../../../services/contentComposerApi';

/**
 * "For video, it can come with a link to vimeo or youtube OR it can be an upload." (Ali, 2026-10-01)
 *
 * WHAT A LINK ACTUALLY IS. A Vimeo or YouTube page URL is not a video file. Meta fetches a URL and
 * expects media bytes; given a page it builds a LINK post with a thumbnail. So "video by link" is
 * a link post, and this module exists to make the composer say that rather than quietly produce
 * something different from what was asked for.
 *
 * WHICH NETWORKS DROP OUT. Instagram has no link post at all - `contentTypes` is image/video/
 * carousel and `linkBehavior` is `no_clickable_links`. That is read from the provider data the
 * server already sends, not hardcoded here, so it stays true when a provider's capabilities move.
 */

export type VideoSource = 'upload' | 'link';

export interface LinkCheck {
  ok: boolean;
  /** Why it was refused. Null when fine. */
  reason: string | null;
}

/**
 * Is this a link we are willing to turn a post into?
 *
 * http/https only. `javascript:` and `data:` parse perfectly well as URLs and must not reach the
 * post body; the server's `z.string().url()` on `destination_url` would also take them, so this
 * is the stricter half rather than a duplicate of it.
 */
export function checkVideoLink(raw: string): LinkCheck {
  const value = raw.trim();
  if (value === '') return { ok: false, reason: 'Paste the video link first.' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'That is not a web address. Paste the full link, starting with https://' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https links can be posted.' };
  }
  return { ok: true, reason: null };
}

/**
 * The networks that cannot carry this content type, by display name.
 *
 * Derived from each provider's declared `contentTypes`. A provider missing that field is treated
 * as capable rather than excluded - guessing "it cannot" would hide a network the operator has
 * connected, which is the worse error.
 */
export function excludedByContentType(
  providers: readonly ProviderSummary[],
  type: ContentType,
): string[] {
  return providers
    .filter((p) => Array.isArray(p.contentTypes) && !p.contentTypes.includes(type))
    .map((p) => p.displayName);
}

/**
 * The sentence shown when the operator chooses a link instead of a file.
 *
 * Says what the post becomes AND what it costs, in that order, before the choice applies. Being
 * told afterwards that Instagram was dropped would read as a bug.
 */
export function linkPostNotice(excluded: readonly string[]): string {
  const base = 'A video link publishes as a link post with a thumbnail, not as a video.';
  if (excluded.length === 0) return base;
  return `${base} ${excluded.join(' and ')} cannot take a link post, so ${excluded.length === 1 ? 'it is' : 'they are'} excluded.`;
}
