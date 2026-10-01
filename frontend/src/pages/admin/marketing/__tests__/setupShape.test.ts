import { mediaGateNote, missingRequiredMedia, setupShape } from '../composer/setupShape';
import type { ContentType } from '../../../../services/contentComposerApi';

/**
 * What Setup shows for the type you picked.
 *
 * Reported from production 2026-10-01, with a video attached: "Am I supposed to generate the
 * Canonical Message for videos because it still gives me the option and that's confusing", and
 * "the setup should be customized by each content type. Only allow the things that are needed."
 */

/** Every member of the union, written out. A ninth type fails this file rather than the operator. */
const ALL: ContentType[] = ['text', 'image', 'video', 'carousel', 'thread', 'link', 'poll', 'document'];

describe('every content type has a shape', () => {
  it.each(ALL)('%s is described, not left to a default', (type) => {
    const s = setupShape(type);
    expect(s.messageLabel.length).toBeGreaterThan(0);
    expect(['none', 'optional', 'required']).toContain(s.mediaRole);
    // A type that takes a file must say what file; "Media" alone sends people to the docs.
    if (s.mediaRole !== 'none') expect(s.mediaHint && s.mediaHint.length).toBeGreaterThan(10);
    else expect(s.mediaHint).toBeNull();
  });

  it('covers the whole union, so adding a type without a shape cannot ship', () => {
    // If ContentType grows and SHAPES does not, `setupShape` falls back to text and the form
    // silently misdescribes the new type. This is the test that catches that.
    expect(ALL).toHaveLength(8);
    for (const t of ALL) expect(setupShape(t)).toBeDefined();
  });
});

describe('the message field is named for what it actually is', () => {
  it('a text post writes the post', () => {
    expect(setupShape('text').messageLabel).toBe('Canonical message');
    expect(setupShape('text').offerDraft).toBe(true);
  });

  it('a video post writes a CAPTION, and is not offered a drafting button', () => {
    // The video is the post. A "Write a first draft" button beside it invites writing the post
    // twice and is what prompted the report.
    const s = setupShape('video');
    expect(s.messageLabel).toBe('Caption');
    expect(s.offerDraft).toBe(false);
  });

  it('so does an image, a carousel and a document', () => {
    for (const t of ['image', 'carousel', 'document'] as ContentType[]) {
      expect(setupShape(t).messageLabel).toBe('Caption');
    }
    expect(setupShape('document').offerDraft).toBe(false);
  });

  it('a poll says the message sits ABOVE the poll, because the question is elsewhere', () => {
    expect(setupShape('poll').messageLabel).toMatch(/above the poll/i);
    expect(setupShape('poll').showPoll).toBe(true);
  });
});

describe('fields a type does not use are not shown', () => {
  it('a poll has no landing page - the post is the question', () => {
    expect(setupShape('poll').showLandingPage).toBe(false);
  });

  it('every other type keeps it', () => {
    for (const t of ALL.filter((x) => x !== 'poll')) {
      expect(setupShape(t).showLandingPage).toBe(true);
    }
  });

  it('only poll shows the poll editor', () => {
    expect(ALL.filter((t) => setupShape(t).showPoll)).toEqual(['poll']);
  });
});

describe('which types need a file', () => {
  it('image, video, carousel and document require one', () => {
    expect(ALL.filter((t) => setupShape(t).mediaRole === 'required').sort())
      .toEqual(['carousel', 'document', 'image', 'video']);
  });

  it('text and poll take none at all', () => {
    expect(ALL.filter((t) => setupShape(t).mediaRole === 'none').sort()).toEqual(['poll', 'text']);
  });

  it('link and thread may have one', () => {
    expect(ALL.filter((t) => setupShape(t).mediaRole === 'optional').sort()).toEqual(['link', 'thread']);
  });

  it('names the format and the limit, so the limit is not found by failing an upload', () => {
    expect(setupShape('video').mediaHint).toMatch(/MP4/);
    expect(setupShape('video').mediaHint).toMatch(/200 MB/);
    expect(setupShape('document').mediaHint).toMatch(/LinkedIn only/);
  });
});

describe('what to say before the draft exists', () => {
  it('a required file says the draft must come first, and what happens if it does not', () => {
    const note = mediaGateNote(setupShape('video'), false)!;
    expect(note).toMatch(/Create the draft first/);
    expect(note).toMatch(/validation will block/i);
  });

  it('an optional file says so more softly', () => {
    expect(mediaGateNote(setupShape('link'), false)).toMatch(/if you want to attach/);
  });

  it('once the draft exists there is nothing to say', () => {
    expect(mediaGateNote(setupShape('video'), true)).toBeNull();
  });

  it('a type that takes no file is never gated', () => {
    expect(mediaGateNote(setupShape('text'), false)).toBeNull();
  });
});

describe('a post missing the file its own type promises', () => {
  it('is flagged for a required type with nothing attached', () => {
    expect(missingRequiredMedia(setupShape('video'), 0)).toBe(true);
    expect(missingRequiredMedia(setupShape('video'), 1)).toBe(false);
  });

  it('is never flagged where the file is optional or absent by design', () => {
    expect(missingRequiredMedia(setupShape('link'), 0)).toBe(false);
    expect(missingRequiredMedia(setupShape('text'), 0)).toBe(false);
  });
});
